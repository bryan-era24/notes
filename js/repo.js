/*
 * Purpose: Every change the app makes to its data: catalog (including archiving, deleting unused and merging products), customers, orders,
 * notes, stages, payments, settings and restores.
 * Responsibilities: Validate with NT.logic, stamp updatedAt/updatedBy, and save each change together with its history entry (only the fields that changed) (and, for a
 * new order, the device's folio counter) in one store batch, so they are saved together or not at all. Deletion is soft (deletedAt).
 * It reaches data only through the store contract and gets time, ids and the author from the env passed in; it never touches the DOM.
 */
window.NT = window.NT || {};

NT.repo = (function () {
  "use strict";

  var DEFAULT_SETTINGS = { name: "", phone: "", address: "", ticketFooter: "" };

  /**
   * store: a store (backend/store.js). env: { now() -> Date, today() -> "YYYY-MM-DD", uuid() -> string, by() -> string,
   * deviceCode() -> "A" }.
   */
  function create(store, env) {
    function invalid(problems) {
      var e = new Error("invalid: " + problems.join(", "));
      e.code = "invalid";
      e.problems = problems;
      return e;
    }
    function stamp(doc) {
      return Object.assign({}, doc, { updatedAt: env.now().toISOString(), updatedBy: env.by() });
    }
    /** { field: [old, new] } for the fields that differ, leaving out the stamps. */
    function diff(before, after) {
      var out = {},
        any = false;
      var keys = Object.keys(Object.assign({}, before || {}, after || {}));
      keys.forEach(function (k) {
        if (k === "updatedAt" || k === "updatedBy") return;
        var a = before ? before[k] : undefined,
          b = after ? after[k] : undefined;
        if (JSON.stringify(a) === JSON.stringify(b)) return;
        out[k] = [a === undefined ? null : a, b === undefined ? null : b];
        any = true;
      });
      return any ? out : null;
    }
    /** What a history entry needs to be shown without opening the document. */
    function ref(path, doc) {
      var c = path.split("/")[0];
      if (c === "notes") return { number: doc.number, orderId: doc.orderId };
      if (c === "payments") return { amount: doc.amount, orderId: doc.orderId };
      if (c === "orders") return { folio: doc.folio };
      return { name: doc.name || null };
    }
    function historyOp(path, action, before, after) {
      var at = env.now().toISOString();
      return {
        path: "history/" + env.uuid(),
        value: {
          path: path,
          at: at,
          localDate: env.today(),
          by: env.by(),
          action: action,
          // A creation stores no copy: the document itself is the record (decision 0006).
          changes: action === "create" || action === "payment" ? null : diff(before, after),
          ref: ref(path, after || before || {}),
          updatedAt: at,
        },
      };
    }
    /** Saves `value` at `path` with its history entry, plus any extra ops, in one batch. */
    function save(path, value, action, extra) {
      var before = store.get(path) || null;
      var after = stamp(value);
      var ops = [{ path: path, value: after }, historyOp(path, action || (before ? "update" : "create"), before, after)].concat(
        extra || []
      );
      return store.batch(ops).then(function () {
        return path.split("/").slice(1).join("/");
      });
    }
    function live(collection) {
      return store.list(collection).filter(function (d) {
        return !d.data.deletedAt;
      });
    }

    function settings() {
      return Object.assign({}, DEFAULT_SETTINGS, store.get("settings/business") || {});
    }
    function saveSettings(changes) {
      return save("settings/business", Object.assign(settings(), changes), "update");
    }

    function saveProduct(id, product) {
      var problems = NT.logic.validateProduct(product);
      if (problems.length) return Promise.reject(invalid(problems));
      var path = "products/" + (id || env.uuid());
      var before = store.get(path) || {};
      var value = Object.assign({}, before, product, {
        name: String(product.name).trim(),
        active: product.active !== false,
        position:
          product.position !== undefined ? product.position : before.position !== undefined ? before.position : live("products").length,
        presentations: product.presentations.map(function (p, i) {
          return {
            id: p.id || env.uuid(),
            label: String(p.label).trim(),
            grams: p.grams || null,
            price: p.price,
            active: p.active !== false,
            position: i,
          };
        }),
      });
      return save(path, value);
    }

    /** How many live notes use a product (a deleted or cancelled order's notes still count: they are records). */
    function productUse(id) {
      return live("notes").filter(function (d) {
        return (d.data.lines || []).some(function (l) {
          return l.productId === id;
        });
      }).length;
    }

    /**
     * Saves a version of a document that the person chose (after a sync conflict, decision 0017) as a normal change: stamped, with
     * its history entry, and sent on top of the version everybody else has.
     */
    function useVersion(path, data) {
      if (!store.get(path) || !data) return Promise.reject(invalid(["version.missing"]));
      var copy = Object.assign({}, data);
      delete copy.updatedAt;
      delete copy.updatedBy;
      return save(path, copy, "update");
    }

    /** Archives a product that is no longer sold (it leaves the note editor; old notes and reports keep it), or brings it back. */
    function archiveProduct(id, archived) {
      var path = "products/" + id;
      var current = store.get(path);
      if (!current) return Promise.reject(invalid(["product.missing"]));
      return save(path, Object.assign({}, current, { active: !archived }), "update");
    }

    /** Deletes a product only when no note uses it; a used product is archived or merged instead (decision 0015). */
    function deleteProduct(id) {
      if (productUse(id)) return Promise.reject(invalid(["product.inUse"]));
      return remove("products/" + id);
    }

    /**
     * Moves every note line of product `fromId` to product `toId` and archives `fromId`, all in one batch with a history entry per
     * changed document. Quantities, prices and amounts stay as they were sold; the line takes the target's name so production and
     * reports count both as one. A presentation of `fromId` is matched to the target's by label (ignoring case, accents and spaces)
     * or added to the target as it was.
     */
    function mergeProduct(fromId, toId) {
      var fromPath = "products/" + fromId;
      var toPath = "products/" + toId;
      var from = store.get(fromPath);
      var to = store.get(toPath);
      if (!from || !to || fromId === toId || from.deletedAt || to.deletedAt) return Promise.reject(invalid(["product.merge"]));
      var key = function (label) {
        return NT.logic.normalize(String(label || "")).trim();
      };
      var target = Object.assign({}, to, {
        presentations: (to.presentations || []).map(function (x) {
          return Object.assign({}, x);
        }),
      });
      var mapPres = {};
      (from.presentations || []).forEach(function (x) {
        var match = target.presentations.find(function (y) {
          return key(y.label) === key(x.label);
        });
        if (!match) {
          match = Object.assign({}, x, { position: target.presentations.length });
          target.presentations.push(match);
        }
        mapPres[x.id] = match;
      });
      var ops = [];
      function change(path, before, after, action) {
        var stamped = stamp(after);
        ops.push({ path: path, value: stamped }, historyOp(path, action || "update", before, stamped));
      }
      live("notes").forEach(function (d) {
        var note = d.data;
        if (
          !(note.lines || []).some(function (l) {
            return l.productId === fromId;
          })
        )
          return;
        var lines = note.lines.map(function (l) {
          if (l.productId !== fromId) return l;
          var pres = mapPres[l.presentationId];
          return Object.assign({}, l, {
            productId: toId,
            productName: to.name,
            presentationId: pres ? pres.id : l.presentationId,
          });
        });
        change("notes/" + d.id, note, Object.assign({}, note, { lines: lines }), "merge");
      });
      if (JSON.stringify(target.presentations) !== JSON.stringify(to.presentations)) change(toPath, to, target, "merge");
      change(fromPath, from, Object.assign({}, from, { active: false, mergedInto: toId }), "merge");
      return store.batch(ops);
    }

    function saveCustomer(id, customer) {
      var problems = NT.logic.validateCustomer(customer);
      if (problems.length) return Promise.reject(invalid(problems));
      var path = "customers/" + (id || env.uuid());
      var value = Object.assign({}, store.get(path) || {}, customer, { name: String(customer.name).trim() });
      return save(path, value);
    }

    /** New order with the next folio of this device. Resolves with the order id. */
    function createOrder(fields) {
      var code = String(env.deviceCode() || "A").toUpperCase();
      var counterPath = "counters/" + code;
      var counter = store.get(counterPath) || { next: 1 };
      var order = {
        folio: NT.logic.folio(code, counter.next),
        customerId: fields.customerId || null,
        customerName: fields.customerName || "",
        deliveryDate: fields.deliveryDate || null,
        stage: fields.stage || "ordered",
        comment: fields.comment || "",
        createdAt: env.now().toISOString(),
        localDate: env.today(),
      };
      if (fields.demo) order.demo = true;
      var problems = NT.logic.validateOrder(order);
      if (problems.length) return Promise.reject(invalid(problems));
      var next = stamp({ next: counter.next + 1 });
      return save("orders/" + env.uuid(), order, "create", [{ path: counterPath, value: next }]);
    }

    function updateOrder(id, changes) {
      var path = "orders/" + id;
      var current = store.get(path);
      if (!current) return Promise.reject(invalid(["order.missing"]));
      var value = Object.assign({}, current, changes);
      var problems = NT.logic.validateOrder(value);
      if (problems.length) return Promise.reject(invalid(problems));
      return save(path, value, changes.stage && changes.stage !== current.stage ? "stage" : "update");
    }

    function notesOf(orderId) {
      return store
        .list("notes")
        .map(function (d) {
          return Object.assign({ id: d.id }, d.data);
        })
        .filter(function (n) {
          return n.orderId === orderId;
        });
    }

    /** Creates (id null) or replaces a note. New notes get the next number in their order. Resolves with the note id. */
    function saveNote(id, fields) {
      var order = store.get("orders/" + fields.orderId);
      if (!order) return Promise.reject(invalid(["note.order"]));
      var path = "notes/" + (id || env.uuid());
      var current = store.get(path);
      var number = current
        ? current.number
        : notesOf(fields.orderId).reduce(function (m, n) {
            return Math.max(m, n.number || 0);
          }, 0) + 1;
      var value = Object.assign({}, current || { createdAt: env.now().toISOString(), stage: "ordered" }, fields, {
        number: number,
        orderDate: order.localDate || NT.logic.dateOf(order.createdAt),
        lines: (fields.lines || []).map(function (l) {
          return Object.assign({}, l, { id: l.id || env.uuid() });
        }),
      });
      if (value.customerName === undefined) value.customerName = order.customerName || "";
      var problems = NT.logic.validateNote(value);
      if (problems.length) return Promise.reject(invalid(problems));
      return save(path, value);
    }

    /** Informative stage of an order or note: any change is allowed and recorded. */
    function setStage(path, stage) {
      if (NT.logic.STAGES.indexOf(stage) < 0) return Promise.reject(invalid(["stage"]));
      var current = store.get(path);
      if (!current) return Promise.reject(invalid(["missing"]));
      return save(path, Object.assign({}, current, { stage: stage }), "stage");
    }

    function addPayment(fields) {
      var order = store.get("orders/" + fields.orderId);
      var payment = {
        orderId: fields.orderId,
        noteId: fields.noteId || null,
        amount: fields.amount,
        method: fields.method || "cash",
        comment: fields.comment || "",
        paidAt: fields.paidAt || env.now().toISOString(),
        localDate: fields.localDate || env.today(),
        orderDate: order ? order.localDate || NT.logic.dateOf(order.createdAt) : null,
      };
      if (fields.demo) payment.demo = true;
      var problems = NT.logic.validatePayment(payment);
      if (!order) problems.push("payment.order");
      if (problems.length) return Promise.reject(invalid(problems));
      return save("payments/" + env.uuid(), payment, "payment");
    }

    /** Soft delete: the document stays, marked, so history, sync and undo keep working. */
    function remove(path) {
      var current = store.get(path);
      if (!current) return Promise.resolve();
      return save(path, Object.assign({}, current, { deletedAt: env.now().toISOString() }), "delete");
    }

    /**
     * Undoes one history entry: puts back the old values of the fields it changed (a creation is undone by deleting).
     * Entries written before decision 0006 hold full copies (before/after) and are restored from them.
     */
    function restore(historyId) {
      var h = store.get("history/" + historyId);
      if (!h) return Promise.reject(invalid(["history.missing"]));
      var current = store.get(h.path);
      if (h.action === "create" || h.action === "payment") return remove(h.path);
      var value;
      if (h.changes) {
        if (!current) return Promise.reject(invalid(["missing"]));
        value = Object.assign({}, current);
        Object.keys(h.changes).forEach(function (k) {
          var old = h.changes[k][0];
          if (old === null) delete value[k];
          else value[k] = old;
        });
      } else if (h.before) {
        value = Object.assign({}, h.before);
        delete value.deletedAt;
      } else return remove(h.path);
      return save(h.path, value, "restore");
    }

    function historyOf(pathPrefixes) {
      return store
        .list("history")
        .map(function (d) {
          return Object.assign({ id: d.id }, d.data);
        })
        .filter(function (h) {
          return pathPrefixes.some(function (p) {
            return h.path === p;
          });
        })
        .sort(function (a, b) {
          return a.at < b.at ? 1 : -1;
        });
    }

    return {
      settings: settings,
      saveSettings: saveSettings,
      saveProduct: saveProduct,
      productUse: productUse,
      useVersion: useVersion,
      archiveProduct: archiveProduct,
      deleteProduct: deleteProduct,
      mergeProduct: mergeProduct,
      saveCustomer: saveCustomer,
      createOrder: createOrder,
      updateOrder: updateOrder,
      saveNote: saveNote,
      setStage: setStage,
      addPayment: addPayment,
      remove: remove,
      restore: restore,
      historyOf: historyOf,
      notesOf: notesOf,
    };
  }

  return { create: create, DEFAULT_SETTINGS: DEFAULT_SETTINGS };
})();
