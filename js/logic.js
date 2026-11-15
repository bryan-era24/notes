/*
 * Purpose: Every business rule of the app as pure functions: money, totals, balances, payment status, production, reports, folios, dates, validation, print model and share text.
 * Responsibilities: Compute from plain documents passed in. It must not touch the DOM, storage, network, clock or randomness (callers pass "today" and ids in), so every rule is tested in tests/logic.test.js.
 *
 * Money is integer centavos. Weights are integer grams. Dates are "YYYY-MM-DD" strings; times are ISO strings.
 */
window.NT = window.NT || {};

NT.logic = (function () {
  "use strict";

  var STAGES = ["ordered", "preparing", "delivered", "received_signed", "cancelled"];
  var DONE_STAGES = ["delivered", "received_signed"];
  var METHODS = ["cash", "transfer", "other"];

  function isInt(n) {
    return typeof n === "number" && isFinite(n) && Math.floor(n) === n;
  }
  function live(doc) {
    return !!doc && !doc.deletedAt;
  }
  function counts(doc) {
    return live(doc) && doc.stage !== "cancelled";
  }

  // ---------- money ----------

  /** "1,234.5" or "$35" -> centavos (integer), or null when it is not a non-negative amount. */
  function parseMoney(text) {
    var s = String(text === undefined || text === null ? "" : text)
      .replace(/[$,\s]/g, "")
      .trim();
    if (!/^\d+(\.\d*)?$|^\.\d+$/.test(s)) return null;
    var parts = s.split(".");
    var pesos = parseInt(parts[0] || "0", 10);
    var frac = (parts[1] || "").padEnd(3, "0").slice(0, 3);
    return pesos * 100 + Math.round(parseInt(frac, 10) / 10);
  }

  /** centavos -> "$1,234.56" */
  function formatMoney(cents) {
    var n = Math.round(Number(cents) || 0);
    var sign = n < 0 ? "-" : "";
    n = Math.abs(n);
    var pesos = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return sign + "$" + pesos + "." + String(n % 100).padStart(2, "0");
  }

  /** Plain number for an input field: 3550 -> "35.50". */
  function moneyInput(cents) {
    var n = Math.round(Number(cents) || 0);
    return Math.floor(n / 100) + "." + String(n % 100).padStart(2, "0");
  }

  /** grams -> "6.25 kg" from 1 kg up, otherwise "750 g". */
  function formatWeight(grams) {
    var g = Math.round(Number(grams) || 0);
    if (g < 1000) return g + " g";
    var kg = Math.round(g / 10) / 100;
    return String(kg) + " kg";
  }

  // ---------- totals ----------

  function lineTotal(line) {
    return (Number(line.unitPrice) || 0) * (Number(line.qty) || 0);
  }
  function noteTotal(note) {
    return (note.lines || []).reduce(function (sum, l) {
      return sum + lineTotal(l);
    }, 0);
  }
  /** Sum of the notes that count: not deleted and not cancelled. */
  function orderTotal(notes) {
    return (notes || []).filter(counts).reduce(function (sum, n) {
      return sum + noteTotal(n);
    }, 0);
  }
  function paidTotal(payments) {
    return (payments || []).filter(live).reduce(function (sum, p) {
      return sum + (Number(p.amount) || 0);
    }, 0);
  }
  /** "pending" | "partial" | "paid" | "credit" (paid more than the total). */
  function paymentStatus(total, paid) {
    if (paid > total) return "credit";
    if (paid === total) return "paid";
    return paid > 0 ? "partial" : "pending";
  }
  function orderSummary(notes, payments) {
    var total = orderTotal(notes);
    var paid = paidTotal(payments);
    return { total: total, paid: paid, balance: total - paid, status: paymentStatus(total, paid) };
  }

  // ---------- dates ----------

  function parseDate(d) {
    var p = String(d).split("-");
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }
  function toDate(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  function isDate(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }
  function addDays(date, n) {
    return toDate(parseDate(date) + n * 86400000);
  }
  /** Monday to Sunday around the given date. */
  function weekRange(date) {
    var dow = new Date(parseDate(date)).getUTCDay(); // 0 = Sunday
    var from = addDays(date, -((dow + 6) % 7));
    return { from: from, to: addDays(from, 6) };
  }
  function monthRange(date) {
    var p = String(date).split("-");
    var from = p[0] + "-" + p[1] + "-01";
    var next = toDate(Date.UTC(+p[0], +p[1], 1));
    return { from: from, to: addDays(next, -1) };
  }
  /** The date part of an ISO time, as written (UTC). Callers pass local ISO dates when they matter. */
  function dateOf(iso) {
    return String(iso || "").slice(0, 10);
  }
  function inRange(date, range) {
    return !!date && date >= range.from && date <= range.to;
  }

  /** A note's delivery date: its own, else its order's. */
  function effectiveDate(note, order) {
    return (note && note.deliveryDate) || (order && order.deliveryDate) || null;
  }
  /** The date a note counts on in production and reports: delivery date, else the day the order was made. */
  function workDate(note, order) {
    return effectiveDate(note, order) || (order ? dateOf(order.localDate || order.createdAt) : null);
  }

  // ---------- folios ----------

  function validDeviceCode(code) {
    return /^[A-Za-z]{1,2}$/.test(String(code || ""));
  }
  function folio(code, n) {
    return String(code).toUpperCase() + "-" + String(n).padStart(4, "0");
  }

  // ---------- catalog -> note ----------

  /** A note line from a catalog presentation: names, weight and price are copied, so later catalog edits never change it. */
  function lineFrom(productId, product, presentation, qty, id) {
    return {
      id: id,
      productId: productId,
      presentationId: presentation.id,
      productName: product.name,
      presentationLabel: presentation.label,
      grams: presentation.grams === undefined ? null : presentation.grams,
      unitPrice: presentation.price,
      qty: qty,
    };
  }

  // ---------- production ----------

  function byLabel(a, b) {
    return String(a.label).localeCompare(String(b.label), "es");
  }

  /**
   * What to prepare per product for notes whose work date is in range.
   * orders: { id: order }. Returns [{ productId, productName, grams, pieces, doneGrams, donePieces,
   * presentations: [{ id, label, qty, grams|null, doneQty }], folios: [folio] }] sorted by name.
   */
  function production(orders, notes, range) {
    var map = {};
    (notes || []).forEach(function (n) {
      var o = orders[n.orderId];
      if (!counts(n) || !o || !counts(o)) return;
      if (!inRange(workDate(n, o), range)) return;
      var done = DONE_STAGES.indexOf(n.stage) >= 0;
      (n.lines || []).forEach(function (l) {
        var row =
          map[l.productId] ||
          (map[l.productId] = {
            productId: l.productId,
            productName: l.productName,
            grams: 0,
            pieces: 0,
            doneGrams: 0,
            donePieces: 0,
            byPres: {},
            folios: {},
          });
        var pres =
          row.byPres[l.presentationId] ||
          (row.byPres[l.presentationId] = {
            id: l.presentationId,
            label: l.presentationLabel,
            qty: 0,
            grams: l.grams === null || l.grams === undefined ? null : 0,
            doneQty: 0,
          });
        var g = l.grams ? l.grams * l.qty : 0;
        if (done) {
          row.doneGrams += g;
          row.donePieces += l.qty;
          pres.doneQty += l.qty;
        } else {
          row.grams += g;
          row.pieces += l.qty;
          pres.qty += l.qty;
          if (pres.grams !== null) pres.grams += g;
          row.folios[o.folio] = true;
        }
      });
    });
    return Object.keys(map)
      .map(function (k) {
        var r = map[k];
        var presentations = Object.keys(r.byPres)
          .map(function (p) {
            return r.byPres[p];
          })
          .sort(byLabel);
        return {
          productId: r.productId,
          productName: r.productName,
          grams: r.grams,
          pieces: r.pieces,
          doneGrams: r.doneGrams,
          donePieces: r.donePieces,
          presentations: presentations,
          folios: Object.keys(r.folios),
        };
      })
      .sort(function (a, b) {
        return String(a.productName).localeCompare(String(b.productName), "es");
      });
  }

  // ---------- reports ----------

  /**
   * Sales in a period, by work date of each note; money collected by payment date.
   * Returns { sold, collected, pending, orders, notes, byProduct, byCustomer, byDay }.
   */
  function report(orders, notes, payments, range) {
    var byProduct = {},
      byCustomer = {},
      byDay = {},
      inOrders = {},
      sold = 0,
      noteCount = 0;
    var paidByOrder = {};
    (payments || []).filter(live).forEach(function (p) {
      paidByOrder[p.orderId] = (paidByOrder[p.orderId] || 0) + p.amount;
    });
    (notes || []).forEach(function (n) {
      var o = orders[n.orderId];
      if (!counts(n) || !o || !counts(o)) return;
      var date = workDate(n, o);
      if (!inRange(date, range)) return;
      var total = noteTotal(n);
      sold += total;
      noteCount++;
      inOrders[n.orderId] = (inOrders[n.orderId] || 0) + total;
      byDay[date] = (byDay[date] || 0) + total;
      (n.lines || []).forEach(function (l) {
        var key = l.productId + "|" + l.presentationId;
        var row =
          byProduct[key] ||
          (byProduct[key] = {
            productId: l.productId,
            presentationId: l.presentationId,
            productName: l.productName,
            presentationLabel: l.presentationLabel,
            qty: 0,
            amount: 0,
            grams: 0,
          });
        row.qty += l.qty;
        row.amount += lineTotal(l);
        row.grams += l.grams ? l.grams * l.qty : 0;
      });
    });
    var pending = 0;
    Object.keys(inOrders).forEach(function (id) {
      var o = orders[id];
      var orderNotes = (notes || []).filter(function (n) {
        return n.orderId === id;
      });
      var balance = orderTotal(orderNotes) - (paidByOrder[id] || 0);
      pending += Math.max(0, balance);
      var key = o.customerId || "name:" + (o.customerName || "");
      var c =
        byCustomer[key] ||
        (byCustomer[key] = { customerId: o.customerId || null, name: o.customerName || "", orders: 0, amount: 0, paid: 0, balance: 0 });
      c.orders++;
      c.amount += inOrders[id];
      c.paid += paidByOrder[id] || 0;
      c.balance += balance;
    });
    var collected = (payments || []).filter(live).reduce(function (sum, p) {
      return inRange(dateOf(p.localDate || p.paidAt), range) ? sum + p.amount : sum;
    }, 0);
    // Products merged by product for the summary table; presentations kept as rows.
    var products = Object.keys(byProduct)
      .map(function (k) {
        return byProduct[k];
      })
      .sort(function (a, b) {
        return (
          String(a.productName).localeCompare(String(b.productName), "es") ||
          String(a.presentationLabel).localeCompare(String(b.presentationLabel), "es")
        );
      });
    var perProduct = {};
    products.forEach(function (r) {
      var p =
        perProduct[r.productId] ||
        (perProduct[r.productId] = { productId: r.productId, productName: r.productName, qty: 0, amount: 0, grams: 0, presentations: [] });
      p.qty += r.qty;
      p.amount += r.amount;
      p.grams += r.grams;
      p.presentations.push(r);
    });
    return {
      sold: sold,
      collected: collected,
      pending: pending,
      orders: Object.keys(inOrders).length,
      notes: noteCount,
      byProduct: Object.keys(perProduct).map(function (k) {
        return perProduct[k];
      }),
      byCustomer: Object.keys(byCustomer)
        .map(function (k) {
          return byCustomer[k];
        })
        .sort(function (a, b) {
          return b.amount - a.amount;
        }),
      byDay: Object.keys(byDay)
        .sort()
        .map(function (d) {
          return { date: d, amount: byDay[d] };
        }),
    };
  }

  // ---------- search ----------

  /** Lowercase, without accents, single spaces: "Doña  PÉREZ" -> "dona perez". */
  function normalize(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }
  /**
   * The searchable text of an order: folio (also as "#42" and "a42"), customer and phone, delivery date, comments, and the customers,
   * products and presentations of its notes that are not deleted.
   */
  function searchText(order, notes, customer) {
    var folioText = String(order.folio || "");
    var m = /^([A-Za-z]{1,2})-0*(\d+)$/.exec(folioText);
    var parts = [folioText, order.customerName, order.deliveryDate, order.comment, customer && customer.phone];
    if (m) parts.push("#" + m[2], m[1] + m[2], m[1] + "-" + m[2]);
    (notes || []).filter(live).forEach(function (n) {
      parts.push(n.customerName, n.comment);
      (n.lines || []).forEach(function (l) {
        parts.push(l.productName, l.presentationLabel);
      });
    });
    var text = normalize(parts.filter(Boolean).join(" | "));
    return " " + text + " " + text.replace(/\s/g, "") + " ";
  }
  /** Every word of the query must appear. A number alone matches a folio number exactly ("42" finds A-0042, not A-0420). */
  function matchesSearch(query, text) {
    var words = normalize(query).split(" ").filter(Boolean);
    return words.every(function (w) {
      if (/^\d+$/.test(w)) {
        var n = String(parseInt(w, 10));
        return text.indexOf("#" + n + " ") >= 0 || (w.length >= 4 && text.indexOf(w) >= 0);
      }
      return text.indexOf(w) >= 0 || text.indexOf(w.replace(/-0*(\d)/, "-$1")) >= 0;
    });
  }

  /** { productId: pieces } sold in notes that count, made on or after `from` (order date). For putting best sellers first. */
  function productRanking(notes, from) {
    var out = {};
    (notes || []).forEach(function (n) {
      if (!counts(n) || !n.orderDate || n.orderDate < from) return;
      (n.lines || []).forEach(function (l) {
        out[l.productId] = (out[l.productId] || 0) + (Number(l.qty) || 0);
      });
    });
    return out;
  }

  // ---------- validation (keys are language keys of the problem) ----------

  function validateProduct(p) {
    var problems = [];
    if (!p || !String(p.name || "").trim()) problems.push("product.name");
    var pres = (p && p.presentations) || [];
    if (!pres.length) problems.push("product.presentations");
    pres.forEach(function (x) {
      if (!String(x.label || "").trim()) problems.push("presentation.label");
      if (!(x.grams === null || x.grams === undefined || (isInt(x.grams) && x.grams > 0))) problems.push("presentation.grams");
      if (!isInt(x.price) || x.price < 0) problems.push("presentation.price");
    });
    return unique(problems);
  }
  function validateNote(n) {
    var problems = [];
    if (!n || !n.orderId) problems.push("note.order");
    if (n && STAGES.indexOf(n.stage) < 0) problems.push("note.stage");
    if (n && n.deliveryDate && !isDate(n.deliveryDate)) problems.push("note.date");
    var lines = (n && n.lines) || [];
    if (!lines.length) problems.push("note.lines");
    lines.forEach(function (l) {
      if (!isInt(l.qty) || l.qty < 1) problems.push("line.qty");
      if (!isInt(l.unitPrice) || l.unitPrice < 0) problems.push("line.unitPrice");
      if (!l.productId || !l.presentationId) problems.push("line.product");
    });
    return unique(problems);
  }
  function validateOrder(o) {
    var problems = [];
    if (!o || !o.folio) problems.push("order.folio");
    if (o && STAGES.indexOf(o.stage) < 0) problems.push("order.stage");
    if (o && o.deliveryDate && !isDate(o.deliveryDate)) problems.push("order.date");
    return problems;
  }
  function validatePayment(p) {
    var problems = [];
    if (!p || !p.orderId) problems.push("payment.order");
    if (!p || !isInt(p.amount) || p.amount <= 0) problems.push("payment.amount");
    if (!p || METHODS.indexOf(p.method) < 0) problems.push("payment.method");
    return problems;
  }
  function validateCustomer(c) {
    return c && String(c.name || "").trim() ? [] : ["customer.name"];
  }
  function unique(list) {
    return list.filter(function (v, i) {
      return list.indexOf(v) === i;
    });
  }

  // ---------- print model and share text ----------

  /**
   * Everything a printer or a share needs, already computed. options.scope: "order" | "note" | "summary";
   * options.noteNumber for "note".
   */
  function printModel(business, order, notes, payments, options) {
    options = options || {};
    var scope = options.scope || "order";
    var all = (notes || []).filter(live).sort(function (a, b) {
      return a.number - b.number;
    });
    var shown =
      scope === "note"
        ? all.filter(function (n) {
            return n.number === options.noteNumber;
          })
        : all.filter(counts);
    var summary = orderSummary(all, payments);
    business = business || {};
    return {
      scope: scope,
      business: {
        name: business.name || "",
        phone: business.phone || "",
        address: business.address || "",
        footer: business.ticketFooter || "",
      },
      folio: order.folio,
      customerName: order.customerName || "",
      deliveryDate: order.deliveryDate || null,
      createdAt: order.createdAt,
      orderStage: order.stage,
      comment: order.comment || "",
      notes: shown.map(function (n) {
        return {
          number: n.number,
          customerName: n.customerName || "",
          deliveryDate: effectiveDate(n, order),
          stage: n.stage,
          cancelled: n.stage === "cancelled",
          comment: n.comment || "",
          total: noteTotal(n),
          lines:
            scope === "summary"
              ? []
              : (n.lines || []).map(function (l) {
                  return {
                    productName: l.productName,
                    presentationLabel: l.presentationLabel,
                    qty: l.qty,
                    unitPrice: l.unitPrice,
                    amount: lineTotal(l),
                  };
                }),
        };
      }),
      noteTotal: shown.length === 1 ? noteTotal(shown[0]) : null,
      total: summary.total,
      paid: summary.paid,
      balance: summary.balance,
      status: summary.status,
      payments: (payments || [])
        .filter(live)
        .sort(function (a, b) {
          return String(a.paidAt) < String(b.paidAt) ? -1 : 1;
        })
        .map(function (p) {
          return { amount: p.amount, method: p.method, date: dateOf(p.localDate || p.paidAt) };
        }),
    };
  }

  /**
   * Plain text of a print model, for WhatsApp or any share target.
   * labels: { folio, customer, delivery, note, total, paid, balance, status, formatDate?(date) }
   */
  function shareText(m, labels) {
    var fmt = labels.formatDate || String;
    var out = [];
    if (m.business.name) out.push("*" + m.business.name + "*");
    if (m.business.phone) out.push(m.business.phone);
    out.push(labels.folio + ": " + m.folio);
    if (m.customerName) out.push(labels.customer + ": " + m.customerName);
    if (m.deliveryDate) out.push(labels.delivery + ": " + fmt(m.deliveryDate));
    m.notes.forEach(function (n) {
      out.push("");
      out.push(labels.note + " " + n.number + (n.customerName && n.customerName !== m.customerName ? " - " + n.customerName : ""));
      n.lines.forEach(function (l) {
        out.push(l.qty + " x " + l.productName + " " + l.presentationLabel + "  " + formatMoney(l.amount));
      });
      if (!n.lines.length || m.notes.length > 1) out.push(labels.total + " " + labels.note.toLowerCase() + ": " + formatMoney(n.total));
    });
    out.push("");
    out.push(labels.total + ": " + formatMoney(m.total));
    if (m.paid) out.push(labels.paid + ": " + formatMoney(m.paid));
    out.push(labels.balance + ": " + formatMoney(Math.max(0, m.balance)));
    out.push(labels.status);
    if (m.business.footer) {
      out.push("");
      out.push(m.business.footer);
    }
    return out.join("\n");
  }

  return {
    STAGES: STAGES,
    DONE_STAGES: DONE_STAGES,
    METHODS: METHODS,
    parseMoney: parseMoney,
    formatMoney: formatMoney,
    moneyInput: moneyInput,
    formatWeight: formatWeight,
    lineTotal: lineTotal,
    noteTotal: noteTotal,
    orderTotal: orderTotal,
    paidTotal: paidTotal,
    paymentStatus: paymentStatus,
    orderSummary: orderSummary,
    isDate: isDate,
    addDays: addDays,
    weekRange: weekRange,
    monthRange: monthRange,
    dateOf: dateOf,
    inRange: inRange,
    effectiveDate: effectiveDate,
    workDate: workDate,
    validDeviceCode: validDeviceCode,
    folio: folio,
    lineFrom: lineFrom,
    production: production,
    report: report,
    normalize: normalize,
    searchText: searchText,
    matchesSearch: matchesSearch,
    productRanking: productRanking,
    validateProduct: validateProduct,
    validateNote: validateNote,
    validateOrder: validateOrder,
    validatePayment: validatePayment,
    validateCustomer: validateCustomer,
    printModel: printModel,
    shareText: shareText,
  };
})();
