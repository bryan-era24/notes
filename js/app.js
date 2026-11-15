/*
 * Purpose: The user interface: every screen (orders, the note editor, an order, production, reports, catalog, settings), navigation and actions.
 * Responsibilities: Draw views from store data, turn taps into calls to NT.repo (the only writer), and hand printing and sharing to
 * NT.printers. It reaches data only through the store contract, computes nothing itself (NT.logic does), and writes every text through
 * NT.i18n keys. It starts the app: picks the store, fails closed on unreadable data, and registers the offline worker.
 */
window.NT = window.NT || {};

NT.app = (function () {
  "use strict";

  var t = function (k, v) {
    return NT.i18n.t(k, v);
  };
  var esc = NT.print.escape;
  var L = NT.logic;
  var money = L.formatMoney;
  var VERSION = "1.2.0";

  var store = null,
    backup = null,
    repo = null,
    view = null;
  var ui = {
    filter: "open",
    searches: { pedidos: "", produccion: "", reportes: "", catalogo: "" },
    draft: null,
    confirm: null,
    panel: null, // "payment" | "share" | "editOrder" | "import" | ...
    share: null,
    prod: { mode: "today", offset: 0 },
    report: { mode: "month", from: null, to: null, online: false, data: null, loading: false, error: false },
    productForm: null,
    customerForm: null,
    db: { busy: false, error: "", schema: null, info: "", email: "" },
    importDocs: null,
    cleanup: null,
    dirty: false,
    toastTimer: null,
    undo: null,
  };

  // ---------- helpers ----------
  function today() {
    return NT.clock.today();
  }
  function prefsGet(name, fallback) {
    var v = NT.prefs.get(name);
    return v === null || v === "" ? fallback : v;
  }
  function deviceCode() {
    return String(prefsGet("deviceCode", NT.config.defaultDeviceCode)).toUpperCase();
  }
  function ticketWidth() {
    return prefsGet("ticketWidth", String(NT.config.ticketWidth)) === "58" ? 58 : 80;
  }
  function printerId() {
    return prefsGet("printer", "browser");
  }
  function by() {
    var s = NT.connection.session();
    return s && s.email ? String(s.email).split("@")[0] : "este equipo";
  }
  var fmtCache = {};
  function fmtDate(d, style) {
    if (!d) return "";
    var key = style || "short";
    if (!fmtCache[key]) {
      var opts =
        key === "long"
          ? { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }
          : key === "print"
            ? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }
            : { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" };
      try {
        fmtCache[key] = new Intl.DateTimeFormat("es-MX", opts);
      } catch {
        // catch-ok: a browser without Intl shows the plain date.
        fmtCache[key] = { format: null };
      }
    }
    var f = fmtCache[key];
    return f.format ? f.format(new Date(d + "T00:00:00Z")) : d;
  }
  function relDate(d) {
    if (!d) return t("common.noDate");
    if (d === today()) return t("common.today");
    if (d === L.addDays(today(), 1)) return t("common.tomorrow");
    return fmtDate(d);
  }
  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    } catch {
      // catch-ok: shown as written when the browser cannot format it.
      return String(iso);
    }
  }
  function liveDocs(collection) {
    return store
      .list(collection)
      .filter(function (d) {
        return !d.data.deletedAt;
      })
      .map(function (d) {
        return Object.assign({ id: d.id }, d.data);
      });
  }
  /** Indexes used by most views, built once per render. */
  function snapshot() {
    var orders = liveDocs("orders");
    var notes = liveDocs("notes");
    var payments = liveDocs("payments");
    var byId = {},
      notesOf = {},
      paysOf = {};
    orders.forEach(function (o) {
      byId[o.id] = o;
      notesOf[o.id] = [];
      paysOf[o.id] = [];
    });
    notes.forEach(function (n) {
      if (notesOf[n.orderId]) notesOf[n.orderId].push(n);
    });
    payments.forEach(function (p) {
      if (paysOf[p.orderId]) paysOf[p.orderId].push(p);
    });
    return { orders: orders, notes: notes, payments: payments, byId: byId, notesOf: notesOf, paysOf: paysOf };
  }
  function products() {
    return liveDocs("products").sort(function (a, b) {
      return (a.position || 0) - (b.position || 0) || String(a.name).localeCompare(String(b.name), "es");
    });
  }
  function customers() {
    return liveDocs("customers").sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name), "es");
    });
  }
  function problemText(e) {
    if (e && e.problems && e.problems.length) {
      return e.problems
        .map(function (p) {
          var k = "problem." + p;
          var s = t(k);
          return s === k ? t("problem.generic") : s;
        })
        .filter(function (v, i, a) {
          return a.indexOf(v) === i;
        })
        .join(" ");
    }
    return t("problem.generic");
  }
  function pill(status) {
    return '<span class="pill ' + status + '">' + esc(t("pay.status." + status)) + "</span>";
  }
  function pressed(on) {
    return ' aria-pressed="' + (on ? "true" : "false") + '"';
  }
  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }
  /** Saves text or bytes as a file on the device. */
  function download(name, content, type) {
    var blob = new Blob([content], { type: type || "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }
  function toast(text, undoHistoryId) {
    var el = document.getElementById("toast");
    ui.undo = undoHistoryId || null;
    el.innerHTML =
      "<span>" + esc(text) + "</span>" + (ui.undo ? '<button type="button" data-act="undo">' + esc(t("common.undo")) + "</button>" : "");
    el.hidden = false;
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(
      function () {
        el.hidden = true;
        ui.undo = null;
      },
      ui.undo ? 7000 : 3500
    );
  }
  function lastHistoryId(path) {
    var h = repo.historyOf([path])[0];
    return h ? h.id : null;
  }

  // ---------- status line ----------
  function statusLine() {
    var el = document.getElementById("sync-status");
    if (!el || !store) return;
    var tone = "";
    var text = t("status.saved");
    if (store.sync) {
      var s = store.sync.status();
      var map = {
        syncing: "status.syncing",
        offline: s.pending ? "status.pending" : "status.offline",
        "signed-out": "status.signedOut",
        "needs-schema": "status.needsSchema",
        "needs-business": "status.needsBusiness",
        "needs-choice": "status.needsChoice",
        error: "status.error",
      };
      text = map[s.state] ? t(map[s.state], { n: s.pending }) : s.pending ? t("status.pending", { n: s.pending }) : t("status.synced");
      if (s.failed && s.state === "idle") text = t("status.failed", { n: s.failed });
      if (s.state !== "idle" && s.state !== "syncing") tone = "warn";
    }
    if (ui.spaceWarned) {
      text = t("space.status");
      tone = "warn";
    } else if (backup && !store.sync) {
      var b = backup.status();
      if (b.state === "needs-permission" || b.reminder === "overdue") {
        text = t(b.state === "needs-permission" ? "backup.statusPermission" : "backup.statusOverdue");
        tone = "warn";
      }
    }
    el.textContent = text;
    el.setAttribute("data-tone", tone);
  }
  function brand() {
    var name = repo ? repo.settings().name : "";
    document.getElementById("brand").textContent = name || t("app.title");
  }

  // ---------- routing ----------
  function route() {
    var parts = (location.hash || "#/pedidos").replace(/^#\/?/, "").split("/");
    return {
      name: parts[0] || "pedidos",
      a: parts[1] ? decodeURIComponent(parts[1]) : null,
      b: parts[2] ? decodeURIComponent(parts[2]) : null,
    };
  }
  var TAB_OF = {
    pedidos: "orders",
    pedido: "orders",
    nuevo: "orders",
    nota: "orders",
    produccion: "production",
    reportes: "reports",
    catalogo: "catalog",
    producto: "catalog",
    cliente: "catalog",
    ajustes: "settings",
  };

  function render() {
    if (!store || store.corrupt) return;
    var r = route();
    var html;
    switch (r.name) {
      case "pedido":
        html = orderView(r.a);
        break;
      case "nuevo":
        html = draftView({ mode: "newOrder" });
        break;
      case "nota":
        html = draftView({ mode: "note", orderId: r.a, noteId: r.b === "nueva" ? null : r.b });
        break;
      case "produccion":
        html = productionView();
        break;
      case "reportes":
        html = reportsView();
        break;
      case "catalogo":
        html = catalogView();
        break;
      case "producto":
        html = productView(r.a === "nuevo" ? null : r.a);
        break;
      case "cliente":
        html = customerView(r.a === "nuevo" ? null : r.a);
        break;
      case "ajustes":
        html = settingsView();
        break;
      default:
        html = ordersView();
    }
    view.innerHTML = html;
    document.querySelectorAll(".tabs a").forEach(function (a) {
      if (a.getAttribute("data-tab") === TAB_OF[r.name]) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    brand();
    statusLine();
    ui.dirty = false;
  }

  // ---------- orders list ----------
  var PAGE_SIZE = 40;
  var SEARCH_IDS = { pedidos: "order-search", produccion: "production-search", reportes: "report-search", catalogo: "catalog-search" };
  var SEARCH_HINTS = {
    pedidos: "orders.searchPlaceholder",
    produccion: "production.searchPlaceholder",
    reportes: "reports.searchPlaceholder",
    catalogo: "catalog.search",
  };

  function query(screen) {
    return (ui.searches[screen] || "").trim();
  }
  /** The same search box on every screen: type to filter, × to clear (docs/FLOWS.md). */
  function searchBox(screen) {
    var id = SEARCH_IDS[screen];
    return (
      '<div class="searchbox"><label class="visually-hidden" for="' +
      id +
      '">' +
      esc(t("common.search")) +
      '</label><input id="' +
      id +
      '" type="search" enterkeyhint="search" autocomplete="off" data-input="search" data-screen="' +
      screen +
      '" value="' +
      esc(ui.searches[screen] || "") +
      '" placeholder="' +
      esc(t(SEARCH_HINTS[screen])) +
      '" /><button type="button" class="quiet clear" data-act="clearSearch" data-screen="' +
      screen +
      '" aria-label="' +
      esc(t("orders.clearSearch")) +
      '"' +
      (ui.searches[screen] ? "" : " hidden") +
      ">×</button></div>"
    );
  }
  /** While a search is active, a band says so, so nobody forgets the screen is filtered. */
  function filterBanner(screen) {
    var q = query(screen);
    if (!q) return "";
    return (
      '<p class="filter-banner"><span>' +
      esc(t("search.only", { q: q })) +
      '</span><button type="button" class="quiet" data-act="clearSearch" data-screen="' +
      screen +
      '">' +
      esc(t("search.clear")) +
      "</button></p>"
    );
  }
  function customersById() {
    var out = {};
    customers().forEach(function (c) {
      out[c.id] = c;
    });
    return out;
  }
  var RESULTS = {};

  /** On Pedidos: a band when the automatic backup needs a tap, or, without folder backup, when today's backup is missing. */
  function backupBanner() {
    if (!backup) return "";
    var b = backup.status();
    if (b.state === "needs-permission")
      return (
        '<div class="notice stack"><p>' +
        esc(t("backup.permissionText")) +
        '</p><button type="button" class="primary" data-act="backupReactivate">' +
        esc(t("backup.reactivate")) +
        "</button></div>"
      );
    if (b.state === "off" && !store.sync && b.reminder !== "none")
      return (
        '<div class="notice stack"><p>' +
        esc(t("backup.offReminder")) +
        '</p><button type="button" class="primary" data-act="backupChoose">' +
        esc(t("backup.choose")) +
        "</button></div>"
      );
    if (b.state === "manual" && !store.sync && b.reminder !== "none")
      return (
        '<div class="notice stack"><p>' +
        esc(t(b.reminder === "overdue" ? "backup.reminderOverdue" : "backup.reminderToday")) +
        '</p><div class="row stretch"><button type="button" class="primary" data-act="backupNow">' +
        esc(t("backup.saveNow")) +
        "</button>" +
        (b.canShare ? '<button type="button" data-act="backupShare">' + esc(t("backup.share")) + "</button>" : "") +
        "</div></div>"
      );
    return "";
  }

  function ordersView() {
    var html =
      '<div id="backup-banner">' +
      backupBanner() +
      '</div><div class="stack"><a class="btn primary big" href="#/nuevo">' +
      esc(t("orders.new")) +
      "</a>" +
      searchBox("pedidos");
    html +=
      '<div class="chips" id="order-filters"' +
      (query("pedidos") ? " hidden" : "") +
      ">" +
      ["open", "balance", "all"]
        .map(function (f) {
          return (
            '<button type="button" data-act="filter" data-v="' +
            f +
            '"' +
            pressed(ui.filter === f) +
            ">" +
            esc(t("orders.filter." + f)) +
            "</button>"
          );
        })
        .join("") +
      "</div></div>";
    return html + '<div id="results" aria-live="polite">' + ordersResults() + "</div>";
  }

  function stubRow(r) {
    return (
      '<li><a class="stub" href="#/pedido/' +
      encodeURIComponent(r.o.id) +
      '"><span class="folio">' +
      esc(r.o.folio) +
      '</span><span class="who">' +
      esc(r.o.customerName || t("orders.noCustomer")) +
      '</span><span class="money">' +
      money(r.s.total) +
      '</span><span class="meta"><span>' +
      esc(relDate(r.o.deliveryDate)) +
      " · " +
      esc(t("stage." + r.o.stage)) +
      " · " +
      esc(r.notes === 1 ? t("orders.oneNote") : t("orders.notesCount", { n: r.notes })) +
      "</span>" +
      pill(r.s.status) +
      "</span></a></li>"
    );
  }

  /** The list under the search box: search results across every order, or the filtered list grouped by delivery date. */
  function ordersResults() {
    var snap = snapshot();
    var q = query("pedidos");
    if (!snap.orders.length) {
      var noCatalog = !products().length;
      return (
        '<div class="empty"><p>' +
        esc(t("orders.empty")) +
        "</p>" +
        (noCatalog ? "<p>" + esc(t("orders.emptyCatalog")) + "</p>" : "") +
        '<div class="stack">' +
        (noCatalog ? '<a class="btn" href="#/producto/nuevo">' + esc(t("catalog.addProduct")) + "</a>" : "") +
        '<button type="button" class="quiet" data-act="demoLoad">' +
        esc(t("orders.tryDemo")) +
        "</button></div></div>"
      );
    }
    var phones = {};
    customers().forEach(function (c) {
      phones[c.id] = c;
    });
    var rows = snap.orders.map(function (o) {
      return {
        o: o,
        s: L.orderSummary(snap.notesOf[o.id], snap.paysOf[o.id]),
        notes: snap.notesOf[o.id].filter(function (n) {
          return n.stage !== "cancelled";
        }).length,
      };
    });
    var shown = ui.shown || PAGE_SIZE;
    var more = function (total) {
      return total > shown
        ? '<button type="button" class="quiet big" data-act="showMore">' +
            esc(t("orders.showMore", { n: Math.min(PAGE_SIZE, total - shown), left: total - shown })) +
            "</button>"
        : "";
    };

    if (q) {
      var found = rows
        .filter(function (r) {
          return L.matchesSearch(q, L.searchText(r.o, snap.notesOf[r.o.id], phones[r.o.customerId]));
        })
        .sort(function (a, b) {
          var da = a.o.deliveryDate || a.o.localDate || "",
            db = b.o.deliveryDate || b.o.localDate || "";
          return da < db ? 1 : da > db ? -1 : String(b.o.folio).localeCompare(String(a.o.folio));
        });
      var head =
        filterBanner("pedidos") +
        '<p class="hint">' +
        esc(found.length === 1 ? t("orders.foundOne") : t("orders.found", { n: found.length })) +
        "</p>";
      if (!found.length) return head + '<p class="empty">' + esc(t("orders.notFound")) + "</p>";
      return head + '<ul class="stubs">' + found.slice(0, shown).map(stubRow).join("") + "</ul>" + more(found.length);
    }

    rows = rows.filter(function (r) {
      if (ui.filter === "open") return ["delivered", "received_signed", "cancelled"].indexOf(r.o.stage) < 0;
      if (ui.filter === "balance") return r.o.stage !== "cancelled" && r.s.balance > 0;
      return true;
    });
    if (!rows.length) return '<p class="empty">' + esc(t("orders.emptyFilter")) + "</p>";
    var groups = { late: [], today: [], tomorrow: [], week: [], later: [], noDate: [], past: [] };
    var d0 = today(),
      d1 = L.addDays(d0, 1),
      d7 = L.addDays(d0, 7);
    rows.forEach(function (r) {
      var d = r.o.deliveryDate;
      var g = !d
        ? "noDate"
        : d < d0
          ? ui.filter === "all"
            ? "past"
            : "late"
          : d === d0
            ? "today"
            : d === d1
              ? "tomorrow"
              : d <= d7
                ? "week"
                : "later";
      groups[g].push(r);
    });
    var folds = ordersFold();
    var html =
      '<div class="row fold-tools"><button type="button" class="quiet" data-act="foldAll" data-set="orders" data-v="1">' +
      esc(t("reports.expandAll")) +
      '</button><button type="button" class="quiet" data-act="foldAll" data-set="orders" data-v="0">' +
      esc(t("reports.collapseAll")) +
      "</button></div>";
    ["late", "today", "tomorrow", "week", "later", "noDate", "past"].forEach(function (g) {
      if (!groups[g].length) return;
      groups[g].sort(function (a, b) {
        var da = a.o.deliveryDate || "9999",
          db = b.o.deliveryDate || "9999";
        if (g === "past") return da < db ? 1 : da > db ? -1 : 0;
        return da < db ? -1 : da > db ? 1 : String(a.o.folio).localeCompare(String(b.o.folio));
      });
      // Each group pages on its own, so a folded group never hides orders of the others.
      var limit = (ui.shownByGroup && ui.shownByGroup[g]) || PAGE_SIZE;
      var part = groups[g].slice(0, limit);
      var left = groups[g].length - part.length;
      html +=
        '<details class="order-group" data-fold-set="orders" data-fold="g:' +
        g +
        '"' +
        (folds["g:" + g] === false ? "" : " open") +
        '><summary><h2 class="group-title">' +
        esc(t("orders.group." + g)) +
        " (" +
        groups[g].length +
        ')</h2></summary><ul class="stubs">' +
        part.map(stubRow).join("") +
        "</ul>" +
        (left > 0
          ? '<button type="button" class="quiet big" data-act="showMore" data-group="' +
            g +
            '">' +
            esc(t("orders.showMore", { n: Math.min(PAGE_SIZE, left), left: left })) +
            "</button>"
          : "") +
        "</details>";
    });
    return html;
  }

  RESULTS.pedidos = ordersResults;

  /** Which order groups are folded on this device: { "g:<group>": false } (groups start open). */
  function ordersFold() {
    if (!ui.ordersFold) {
      try {
        ui.ordersFold = JSON.parse(NT.prefs.get("ordersFold") || "null") || {};
      } catch {
        // catch-ok: an unreadable preference starts with every group open.
        ui.ordersFold = {};
      }
    }
    return ui.ordersFold;
  }

  // ---------- note editor (new order or a note of an order) ----------
  function startDraft(spec) {
    var d = ui.draft;
    if (d && d.mode === spec.mode && d.orderId === (spec.orderId || null) && d.noteId === (spec.noteId || null)) return d;
    d = {
      mode: spec.mode,
      orderId: spec.orderId || null,
      noteId: spec.noteId || null,
      step: "customer",
      customerId: null,
      customerName: "",
      deliveryDate: today(),
      lines: [],
      comment: "",
      open: null,
      search: "",
      dirty: false,
    };
    if (spec.mode === "note") {
      var order = store.get("orders/" + spec.orderId);
      if (!order) return null;
      d.step = "products";
      d.customerId = order.customerId || null;
      d.customerName = order.customerName || "";
      d.deliveryDate = null;
      if (spec.noteId) {
        var n = store.get("notes/" + spec.noteId);
        if (n) {
          d.customerId = n.customerId || null;
          d.customerName = n.customerName || "";
          d.deliveryDate = n.deliveryDate || null;
          d.comment = n.comment || "";
          d.lines = (n.lines || []).map(function (l) {
            return Object.assign({}, l);
          });
        }
      }
    }
    ui.draft = d;
    return d;
  }

  function draftView(spec) {
    var d = startDraft(spec);
    if (!d) return '<p class="empty">' + esc(t("order.missing")) + "</p>";
    return d.step === "customer" ? draftCustomer(d) : draftProducts(d);
  }

  function dateChoices(selected, act, allowNone) {
    var d0 = today();
    var opts = [
      [d0, t("common.today")],
      [L.addDays(d0, 1), t("common.tomorrow")],
      [L.addDays(d0, 2), t("common.dayAfter")],
    ];
    var known = opts.some(function (o) {
      return o[0] === selected;
    });
    return (
      '<div class="chips">' +
      opts
        .map(function (o) {
          return (
            '<button type="button" data-act="' +
            act +
            '" data-v="' +
            o[0] +
            '"' +
            pressed(selected === o[0]) +
            ">" +
            esc(o[1]) +
            "<small>&nbsp;" +
            esc(fmtDate(o[0])) +
            "</small></button>"
          );
        })
        .join("") +
      (allowNone
        ? '<button type="button" data-act="' + act + '" data-v=""' + pressed(!selected) + ">" + esc(t("common.noDate")) + "</button>"
        : "") +
      '</div><div class="field"><label for="other-date">' +
      esc(t("common.pickDate")) +
      '</label><input id="other-date" type="date" data-input="' +
      act +
      '" value="' +
      (selected && !known ? esc(selected) : "") +
      '" /></div>'
    );
  }

  function draftCustomer(d) {
    var q = d.search.trim().toLowerCase();
    var list = customers().filter(function (c) {
      return !q || String(c.name).toLowerCase().indexOf(q) >= 0;
    });
    var exact = list.some(function (c) {
      return String(c.name).toLowerCase() === q;
    });
    var html = '<div class="stack"><h1>' + esc(t("draft.customerTitle")) + "</h1>";
    html +=
      '<input type="search" id="customer-search" data-input="draftSearch" value="' +
      esc(d.search) +
      '" placeholder="' +
      esc(t("draft.customerSearch")) +
      '" autocomplete="off" />';
    html += '<div class="choices" id="customer-choices">' + customerChoices(d, list.slice(0, 8), q, exact) + "</div>";
    html += "<h2>" + esc(t("draft.dateTitle")) + "</h2>" + dateChoices(d.deliveryDate, "draftDate", d.mode === "note");
    html += '<button type="button" class="primary big" data-act="draftNext">' + esc(t("draft.next")) + "</button>";
    if (d.mode === "note") html += '<button type="button" class="quiet" data-act="draftBack">' + esc(t("common.back")) + "</button>";
    else html += '<a class="btn quiet" href="#/pedidos">' + esc(t("common.cancel")) + "</a>";
    return html + "</div>";
  }
  function customerChoices(d, list, q, exact) {
    var html = "";
    if (q && !exact)
      html +=
        '<button type="button" class="primary" data-act="pickNewCustomer">' +
        esc(t("draft.newCustomer", { name: d.search.trim() })) +
        "</button>";
    list.forEach(function (c) {
      html +=
        '<button type="button" data-act="pickCustomer" data-id="' +
        esc(c.id) +
        '"' +
        pressed(d.customerId === c.id) +
        ">" +
        esc(c.name) +
        "</button>";
    });
    html +=
      '<button type="button" data-act="pickNoCustomer"' +
      pressed(!d.customerId && !d.customerName) +
      ">" +
      esc(t("draft.noName")) +
      "</button>";
    return html;
  }

  function draftTotal(d) {
    return L.noteTotal({ lines: d.lines });
  }

  var SEARCH_FROM = 12;

  /** Product tiles for the note editor: best sellers of the last 60 days first; filtered by the product search. */
  function draftTiles(d) {
    var ranking = L.productRanking(liveDocs("notes"), L.addDays(today(), -60));
    var q = L.normalize(d.productSearch || "");
    var list = products()
      .filter(function (p) {
        return p.active !== false && (!q || L.normalize(p.name).indexOf(q) >= 0);
      })
      .sort(function (a, b) {
        return (ranking[b.id] || 0) - (ranking[a.id] || 0) || (a.position || 0) - (b.position || 0);
      });
    var html = "";
    if (q && !list.length) return '<p class="hint" style="grid-column:1/-1">' + esc(t("draft.noMatch")) + "</p>";
    list.forEach(function (p) {
      var open = d.open === p.id;
      html +=
        '<button type="button" class="tile" data-act="openProduct" data-id="' +
        esc(p.id) +
        '" aria-expanded="' +
        (open ? "true" : "false") +
        '">' +
        esc(p.name) +
        "</button>";
      if (open) {
        var pres = (p.presentations || []).filter(function (x) {
          return x.active !== false;
        });
        html +=
          '<div class="presentations"><p>' +
          esc(t("draft.choosePresentation", { name: p.name })) +
          '</p><div class="chips">' +
          pres
            .map(function (x) {
              return (
                '<button type="button" data-act="addLine" data-id="' +
                esc(p.id) +
                '" data-pres="' +
                esc(x.id) +
                '">' +
                esc(x.label) +
                "<small>" +
                money(x.price) +
                "</small></button>"
              );
            })
            .join("") +
          "</div></div>";
      }
    });
    return html;
  }

  function draftProducts(d) {
    var list = products().filter(function (p) {
      return p.active !== false;
    });
    var html =
      '<div class="stack"><div class="who-line"><div><strong>' +
      esc(t("draft.for", { name: d.customerName || t("draft.noName") })) +
      "</strong><br />";
    var effective = d.deliveryDate || (d.orderId && (store.get("orders/" + d.orderId) || {}).deliveryDate);
    html +=
      '<span class="hint">' +
      esc(t("draft.delivery", { date: effective ? fmtDate(effective, "long") : t("common.noDate") })) +
      "</span></div>";
    html += '<button type="button" class="quiet" data-act="draftToCustomer">' + esc(t("draft.changeCustomer")) + "</button></div>";
    html += "<h1>" + esc(t("draft.productsTitle")) + "</h1>";
    if (!list.length)
      html += "<p>" + esc(t("draft.noProducts")) + '</p><a class="btn" href="#/producto/nuevo">' + esc(t("catalog.addProduct")) + "</a>";
    if (list.length > SEARCH_FROM)
      html +=
        '<div class="searchbox"><label class="visually-hidden" for="product-search">' +
        esc(t("draft.searchProduct")) +
        '</label><input id="product-search" type="search" autocomplete="off" data-input="productSearch" value="' +
        esc(d.productSearch || "") +
        '" placeholder="' +
        esc(t("draft.searchProduct")) +
        '" /></div>';
    html += '<div class="tiles" id="draft-tiles">' + draftTiles(d);
    html += "</div>";
    html += "<section><h2>" + esc(t("draft.lines")) + "</h2>";
    if (!d.lines.length) html += '<p class="hint">' + esc(t("draft.empty")) + "</p>";
    else {
      html += '<div class="pad ruled">';
      d.lines.forEach(function (l, i) {
        var changed = l.catalogPrice !== undefined && l.catalogPrice !== l.unitPrice;
        html +=
          '<div class="draft-line"><div class="name">' +
          esc(l.productName) +
          " " +
          esc(l.presentationLabel) +
          '</div><div class="stepper"><button type="button" data-act="qtyDown" data-i="' +
          i +
          '" aria-label="' +
          esc(t("draft.less")) +
          '">−</button><input type="number" inputmode="numeric" min="1" step="1" data-input="qty" data-i="' +
          i +
          '" value="' +
          l.qty +
          '" aria-label="' +
          esc(t("draft.qty")) +
          '" /><button type="button" data-act="qtyUp" data-i="' +
          i +
          '" aria-label="' +
          esc(t("draft.more")) +
          '">+</button></div><div class="price-row"><label class="hint" for="price-' +
          i +
          '">' +
          esc(t("draft.price")) +
          '</label><input id="price-' +
          i +
          '" type="text" inputmode="decimal" data-input="price" data-i="' +
          i +
          '" value="' +
          L.moneyInput(l.unitPrice) +
          '" /><span class="line-total money" data-line-total="' +
          i +
          '">' +
          money(L.lineTotal(l)) +
          '</span><button type="button" class="quiet" data-act="removeLine" data-i="' +
          i +
          '">' +
          esc(t("draft.remove")) +
          "</button>" +
          (changed
            ? '<span class="hint" style="flex-basis:100%">' + esc(t("draft.priceChanged", { price: money(l.catalogPrice) })) + "</span>"
            : "") +
          "</div></div>";
      });
      html += "</div>";
    }
    html +=
      '<div class="field"><label for="draft-comment">' +
      esc(t("draft.comment")) +
      ' <span class="hint">(' +
      esc(t("common.optional")) +
      ')</span></label><textarea id="draft-comment" data-input="draftComment">' +
      esc(d.comment) +
      "</textarea></div>";
    html += "</section>";
    html +=
      '<div class="dock"><div><span class="hint" style="color:inherit">' +
      esc(t("draft.total")) +
      '</span><br /><span class="money" id="draft-total">' +
      money(draftTotal(d)) +
      '</span></div><button type="button" class="primary" data-act="saveDraft"' +
      (d.lines.length ? "" : " disabled") +
      ">" +
      esc(t("draft.saveNote")) +
      "</button></div>";
    if (ui.confirm === "discard")
      html +=
        '<div class="notice"><p>' +
        esc(t("draft.discard")) +
        '</p><div class="row"><button type="button" class="danger primary" data-act="discardYes">' +
        esc(t("draft.discardYes")) +
        '</button><button type="button" class="quiet" data-act="confirmNo">' +
        esc(t("common.cancel")) +
        "</button></div></div>";
    else html += '<button type="button" class="quiet" data-act="discard">' + esc(t("common.cancel")) + "</button>";
    return html + "</div>";
  }

  function refreshDraftTotals() {
    var d = ui.draft;
    if (!d) return;
    d.lines.forEach(function (l, i) {
      var el = view.querySelector('[data-line-total="' + i + '"]');
      if (el) el.textContent = money(L.lineTotal(l));
    });
    var tot = document.getElementById("draft-total");
    if (tot) tot.textContent = money(draftTotal(d));
    var save = view.querySelector('[data-act="saveDraft"]');
    if (save) save.disabled = !d.lines.length;
  }

  function saveDraft() {
    var d = ui.draft;
    var lines = d.lines.map(function (l) {
      var c = Object.assign({}, l);
      delete c.catalogPrice;
      return c;
    });
    var customer = Promise.resolve(d.customerId);
    if (!d.customerId && d.customerName) {
      customer = repo.saveCustomer(null, { name: d.customerName });
    }
    var orderId;
    return customer
      .then(function (cid) {
        d.customerId = cid || null;
        if (d.mode === "newOrder")
          return repo.createOrder({ customerId: d.customerId, customerName: d.customerName, deliveryDate: d.deliveryDate });
        return d.orderId;
      })
      .then(function (oid) {
        orderId = oid;
        var order = store.get("orders/" + oid);
        var noteDate = d.mode === "note" && d.deliveryDate && d.deliveryDate !== order.deliveryDate ? d.deliveryDate : null;
        return repo.saveNote(d.noteId, {
          orderId: oid,
          customerId: d.customerId,
          customerName: d.customerName,
          deliveryDate: noteDate,
          lines: lines,
          comment: d.comment,
        });
      })
      .then(function () {
        ui.draft = null;
        ui.confirm = null;
        toast(t("common.saved"));
        go("#/pedido/" + encodeURIComponent(orderId));
      })
      .catch(failToast);
  }

  // ---------- one order ----------
  function orderView(id) {
    var order = store.get("orders/" + id);
    if (!order || order.deletedAt)
      return '<p class="empty">' + esc(t("order.missing")) + '</p><a class="btn" href="#/pedidos">' + esc(t("common.back")) + "</a>";
    var snap = snapshot();
    var notes = (snap.notesOf[id] || []).sort(function (a, b) {
      return a.number - b.number;
    });
    var pays = (snap.paysOf[id] || []).sort(function (a, b) {
      return a.paidAt < b.paidAt ? -1 : 1;
    });
    var s = L.orderSummary(notes, pays);
    var html = '<div class="split"><div class="stack">';
    html +=
      '<article class="pad"><div class="pad-head"><h1>' +
      esc(order.customerName || t("orders.noCustomer")) +
      '</h1><span class="folio">' +
      esc(order.folio) +
      "</span>";
    html +=
      '<p class="hint" style="margin:0">' +
      esc(t("print.delivery")) +
      ": <strong>" +
      esc(order.deliveryDate ? fmtDate(order.deliveryDate, "long") : t("common.noDate")) +
      "</strong> · " +
      esc(fmtTime(order.createdAt)) +
      "</p></div>";
    html +=
      '<div class="sums"><div><span>' +
      esc(t("order.total")) +
      '</span><span class="money">' +
      money(s.total) +
      "</span></div><div><span>" +
      esc(t("order.paid")) +
      '</span><span class="money">' +
      money(s.paid) +
      '</span></div><div class="balance' +
      (s.balance <= 0 ? " zero" : "") +
      '"><span>' +
      esc(t("order.balance")) +
      '</span><span class="money">' +
      money(Math.max(0, s.balance)) +
      "</span></div></div>";
    html +=
      '<div class="ruled"><div>' +
      pill(s.status) +
      (order.comment ? '<p style="margin:0.5rem 0 0">' + esc(order.comment) + "</p>" : "") +
      "</div>";
    html +=
      "<div><h3>" +
      esc(t("order.stage")) +
      '</h3><div class="chips small">' +
      stageChips("orders/" + id, order.stage) +
      "</div></div></div></article>";

    html +=
      '<div class="row stretch"><a class="btn primary" href="#/nota/' +
      encodeURIComponent(id) +
      '/nueva">' +
      esc(t("order.addNote")) +
      '</a><button type="button" class="primary" data-act="openPayment">' +
      esc(t("order.addPayment")) +
      "</button></div>";
    html +=
      '<div class="row stretch"><button type="button" data-act="printLetter" data-id="' +
      esc(id) +
      '">' +
      esc(t("order.printLetter")) +
      '</button><button type="button" data-act="printTicket" data-id="' +
      esc(id) +
      '">' +
      esc(t("order.printTicket")) +
      '</button><button type="button" data-act="share" data-id="' +
      esc(id) +
      '">' +
      esc(t("order.share")) +
      "</button></div>";
    if (ui.panel === "payment") html += paymentPanel(id, notes, s);
    if (ui.panel === "share" && ui.share) html += sharePanel(id);
    if (ui.panel === "editOrder") html += editOrderPanel(order);

    html += '</div><div class="stack sticky-not">';
    html += '<div class="section-head"><h2>' + esc(t("order.notes")) + "</h2></div>";
    notes.forEach(function (n) {
      html += noteBlock(id, order, n);
    });

    html += '<div class="section-head"><h2>' + esc(t("order.payments")) + "</h2></div>";
    if (!pays.length) html += '<p class="hint">' + esc(t("order.noPayments")) + "</p>";
    else {
      html += '<div class="pad ruled">';
      pays.forEach(function (p) {
        var forNote = p.noteId && store.get("notes/" + p.noteId);
        html +=
          '<div class="row" style="justify-content:space-between"><span>' +
          esc(fmtTime(p.paidAt)) +
          " · " +
          esc(t("pay.method." + p.method)) +
          (forNote ? " · " + esc(t("order.note", { n: forNote.number })) : "") +
          (p.comment ? '<br /><span class="hint">' + esc(p.comment) + "</span>" : "") +
          '</span><strong class="money">' +
          money(p.amount) +
          "</strong>" +
          confirmButton("pay:" + p.id, "deletePayment", p.id, t("common.delete")) +
          "</div>";
      });
      html += "</div>";
    }
    html += historyBlock(id, notes, pays);
    html +=
      '<div class="row"><button type="button" class="quiet" data-act="openEditOrder">' +
      esc(t("order.editData")) +
      "</button>" +
      confirmButton("order:" + id, "deleteOrder", id, t("order.deleteOrder")) +
      "</div>";
    html += "</div></div>";
    return html;
  }

  function stageChips(path, current) {
    return L.STAGES.map(function (st) {
      return (
        '<button type="button" data-act="stage" data-path="' +
        esc(path) +
        '" data-v="' +
        st +
        '"' +
        pressed(current === st) +
        ">" +
        esc(t("stage." + st)) +
        "</button>"
      );
    }).join("");
  }
  function confirmButton(key, act, id, label) {
    if (ui.confirm === key)
      return (
        '<span class="row"><button type="button" class="danger primary" data-act="' +
        act +
        '" data-id="' +
        esc(id) +
        '">' +
        esc(t("common.confirmDelete")) +
        '</button><button type="button" class="quiet" data-act="confirmNo">' +
        esc(t("common.cancel")) +
        "</button></span>"
      );
    return '<button type="button" class="danger" data-act="confirm" data-key="' + esc(key) + '">' + esc(label) + "</button>";
  }

  function noteBlock(orderId, order, n) {
    var cancelled = n.stage === "cancelled";
    var html =
      '<article class="pad note-block' +
      (cancelled ? " cancelled" : "") +
      '"><div class="ruled"><div class="note-title"><h3 style="margin:0">' +
      esc(t("order.note", { n: n.number }));
    if (n.customerName && n.customerName !== order.customerName) html += " · " + esc(n.customerName);
    html += "</h3>";
    if (n.deliveryDate && n.deliveryDate !== order.deliveryDate)
      html += '<span class="hint">' + esc(t("print.delivery")) + " " + esc(fmtDate(n.deliveryDate)) + "</span>";
    html += '</div><div><table class="lines"><tbody>';
    (n.lines || []).forEach(function (l) {
      html +=
        '<tr><td class="num" style="padding-left:0;padding-right:0.75rem;text-align:left">' +
        l.qty +
        " ×</td><td>" +
        esc(l.productName) +
        " " +
        esc(l.presentationLabel) +
        '<br /><span class="hint">' +
        money(l.unitPrice) +
        '</span></td><td class="num">' +
        money(L.lineTotal(l)) +
        "</td></tr>";
    });
    html +=
      '</tbody></table><div class="subtotal"><span>' +
      esc(t("print.subtotal")) +
      '</span><span class="money">' +
      money(L.noteTotal(n)) +
      "</span></div>";
    if (cancelled) html += '<p class="hint">' + esc(t("order.cancelledNote")) + "</p>";
    if (n.comment) html += '<p class="hint">' + esc(n.comment) + "</p>";
    html +=
      "</div><div><h3>" +
      esc(t("order.noteStage")) +
      '</h3><div class="chips small">' +
      stageChips("notes/" + n.id, n.stage) +
      "</div></div>";
    html +=
      '<div class="row"><a class="btn" href="#/nota/' +
      encodeURIComponent(orderId) +
      "/" +
      encodeURIComponent(n.id) +
      '">' +
      esc(t("common.edit")) +
      '</a><button type="button" class="quiet" data-act="printNote" data-id="' +
      esc(orderId) +
      '" data-n="' +
      n.number +
      '">' +
      esc(t("order.printNote")) +
      "</button>" +
      confirmButton("note:" + n.id, "deleteNote", n.id, t("common.delete")) +
      "</div></div></article>";
    return html;
  }

  function paymentPanel(orderId, notes, s) {
    var live = notes.filter(function (n) {
      return n.stage !== "cancelled";
    });
    var html = '<form class="sheet stack" data-form="payment" data-id="' + esc(orderId) + '"><h2>' + esc(t("payment.title")) + "</h2>";
    html +=
      '<div class="field"><label for="pay-amount">' +
      esc(t("payment.amount")) +
      '</label><input id="pay-amount" name="amount" type="text" inputmode="decimal" autocomplete="off" required /></div>';
    if (s.balance > 0)
      html +=
        '<button type="button" class="quiet" data-act="payAll" data-v="' +
        s.balance +
        '">' +
        esc(t("payment.payAll", { amount: money(s.balance) })) +
        "</button>";
    html +=
      "<div><h3>" +
      esc(t("payment.method")) +
      '</h3><div class="chips">' +
      L.METHODS.map(function (m, i) {
        return (
          '<button type="button" data-act="payMethod" data-v="' + m + '"' + pressed(i === 0) + ">" + esc(t("pay.method." + m)) + "</button>"
        );
      }).join("") +
      '</div><input type="hidden" name="method" value="cash" /></div>';
    if (live.length > 1) {
      html +=
        "<div><h3>" +
        esc(t("payment.forNote")) +
        '</h3><div class="chips"><button type="button" data-act="payNote" data-v=""' +
        pressed(true) +
        ">" +
        esc(t("payment.allNotes")) +
        "</button>" +
        live
          .map(function (n) {
            return (
              '<button type="button" data-act="payNote" data-v="' +
              esc(n.id) +
              '"' +
              pressed(false) +
              ">" +
              esc(t("order.note", { n: n.number })) +
              "</button>"
            );
          })
          .join("") +
        '</div><input type="hidden" name="noteId" value="" /></div>';
    }
    html +=
      '<div class="field"><label for="pay-comment">' +
      esc(t("payment.comment")) +
      ' <span class="hint">(' +
      esc(t("common.optional")) +
      ')</span></label><input id="pay-comment" name="comment" type="text" /></div>';
    html +=
      '<div class="row stretch"><button type="submit" class="primary">' +
      esc(t("payment.save")) +
      '</button><button type="button" class="quiet" data-act="closePanel">' +
      esc(t("common.cancel")) +
      "</button></div></form>";
    return html;
  }

  function sharePanel() {
    var text = ui.share.text;
    return (
      '<div class="sheet stack"><h2>' +
      esc(ui.share.title) +
      '</h2><a class="btn primary" target="_blank" rel="noopener" href="' +
      esc(NT.printers.whatsappUrl(text)) +
      '">' +
      esc(t("share.whatsapp")) +
      '</a><button type="button" data-act="copyShare">' +
      esc(t("share.copy")) +
      '</button><button type="button" data-act="printLetter" data-id="' +
      esc(ui.share.orderId) +
      '">' +
      esc(t("share.pdf")) +
      '</button><p class="hint">' +
      esc(t("share.pdfHelp")) +
      '</p><button type="button" class="quiet" data-act="closePanel">' +
      esc(t("common.close")) +
      "</button></div>"
    );
  }

  function editOrderPanel(order) {
    var names = customers()
      .map(function (c) {
        return '<option value="' + esc(c.name) + '"></option>';
      })
      .join("");
    return (
      '<form class="sheet stack" data-form="editOrder" data-id="' +
      esc(order.id || route().a) +
      '"><h2>' +
      esc(t("order.editData")) +
      '</h2><div class="field"><label for="eo-name">' +
      esc(t("print.customer")) +
      '</label><input id="eo-name" name="customerName" type="text" list="eo-customers" value="' +
      esc(order.customerName || "") +
      '" /><datalist id="eo-customers">' +
      names +
      '</datalist></div><div class="field"><label for="eo-date">' +
      esc(t("print.delivery")) +
      '</label><input id="eo-date" name="deliveryDate" type="date" value="' +
      esc(order.deliveryDate || "") +
      '" /></div><div class="field"><label for="eo-comment">' +
      esc(t("order.comment")) +
      '</label><textarea id="eo-comment" name="comment">' +
      esc(order.comment || "") +
      '</textarea></div><div class="row stretch"><button type="submit" class="primary">' +
      esc(t("common.save")) +
      '</button><button type="button" class="quiet" data-act="closePanel">' +
      esc(t("common.cancel")) +
      "</button></div></form>"
    );
  }

  function historyBlock(orderId, notes, pays) {
    var paths = ["orders/" + orderId]
      .concat(
        notes.map(function (n) {
          return "notes/" + n.id;
        })
      )
      .concat(
        pays.map(function (p) {
          return "payments/" + p.id;
        })
      );
    // Deleted notes and payments of this order still have history.
    store.list("notes").forEach(function (d) {
      if (d.data.orderId === orderId && paths.indexOf(d.path) < 0) paths.push(d.path);
    });
    store.list("payments").forEach(function (d) {
      if (d.data.orderId === orderId && paths.indexOf(d.path) < 0) paths.push(d.path);
    });
    var list = repo.historyOf(paths);
    var html = "<details><summary>" + esc(t("order.history")) + " (" + list.length + ")</summary>";
    if (!list.length) return html + '<p class="hint">' + esc(t("order.historyEmpty")) + "</p></details>";
    html += '<ul class="history">';
    list.forEach(function (h) {
      var what =
        h.path.indexOf("orders/") === 0
          ? t("history.order")
          : h.path.indexOf("notes/") === 0
            ? t("history.note", { n: (h.ref || h.after || h.before || {}).number || "" })
            : t("history.paymentDoc");
      var action =
        h.action === "stage"
          ? t("history.stage", { stage: t("stage." + (h.changes && h.changes.stage ? h.changes.stage[1] : (h.after || {}).stage || "")) })
          : h.action === "payment"
            ? t("history.payment", { amount: money((h.ref || h.after || {}).amount || 0) })
            : t("history." + h.action);
      html +=
        "<li><strong>" +
        esc(what) +
        "</strong>: " +
        esc(action) +
        '<br /><span class="hint">' +
        esc(fmtTime(h.at)) +
        " " +
        esc(t("history.by", { by: h.by })) +
        "</span>";
      if ((h.changes || h.before) && (h.action === "update" || h.action === "delete" || h.action === "stage" || h.action === "restore"))
        html +=
          '<br /><button type="button" class="quiet" data-act="restore" data-id="' +
          esc(h.id) +
          '">' +
          esc(t("order.restore")) +
          "</button>";
      html += "</li>";
    });
    return html + "</ul></details>";
  }

  // ---------- printing and sharing ----------
  function modelFor(orderId, scope, noteNumber) {
    var order = store.get("orders/" + orderId);
    var snap = snapshot();
    var m = L.printModel(repo.settings(), order, snap.notesOf[orderId] || [], snap.paysOf[orderId] || [], {
      scope: scope,
      noteNumber: noteNumber,
    });
    m.localDate = order.localDate;
    return m;
  }
  function printOpts() {
    return {
      formatDate: function (d) {
        return fmtDate(d, "print");
      },
      width: ticketWidth(),
      printer: printerId(),
    };
  }
  function printFailed(e) {
    NT.log.error("print.failed", { error: e });
    toast(t("print.failed", { error: (e && (e.message || e.name)) || "" }));
  }

  // ---------- production ----------
  function prodRange() {
    var p = ui.prod;
    var d0 = today();
    if (p.mode === "week" || p.mode === "nextWeek") {
      var base = L.addDays(d0, (p.mode === "nextWeek" ? 7 : 0) + p.offset * 7);
      return L.weekRange(base);
    }
    var day = L.addDays(d0, (p.mode === "tomorrow" ? 1 : 0) + p.offset);
    return { from: day, to: day };
  }
  function productionView() {
    var r = prodRange();
    var html = "<h1>" + esc(t("production.title")) + '</h1><div class="chips">';
    ["today", "tomorrow", "week", "nextWeek"].forEach(function (m) {
      html +=
        '<button type="button" data-act="prodMode" data-v="' +
        m +
        '"' +
        pressed(ui.prod.mode === m && ui.prod.offset === 0) +
        ">" +
        esc(t("production." + m)) +
        "</button>";
    });
    html += "</div>";
    html +=
      '<div class="pager"><button type="button" class="quiet" data-act="prodShift" data-v="-1" aria-label="' +
      esc(t("production.prev")) +
      '">‹</button><strong>' +
      esc(r.from === r.to ? fmtDate(r.from, "long") : t("production.range", { from: fmtDate(r.from), to: fmtDate(r.to) })) +
      '</strong><button type="button" class="quiet" data-act="prodShift" data-v="1" aria-label="' +
      esc(t("production.next")) +
      '">›</button></div>';
    return html + searchBox("produccion") + '<div id="results" aria-live="polite">' + productionResults() + "</div>";
  }

  /** What to prepare in the chosen days, narrowed by the search (whole orders, or only the matching lines). */
  function productionResults() {
    var r = prodRange();
    var snap = snapshot();
    var found = L.filterBySearch(query("produccion"), snap.byId, snap.notes, customersById());
    var rows = L.production(snap.byId, found.notes, r);
    var html = filterBanner("produccion");
    if (!rows.length) return html + '<p class="empty">' + esc(t(found.active ? "search.nothing" : "production.empty")) + "</p>";
    html += '<div class="pad ruled">';
    rows.forEach(function (p) {
      html += '<div class="make"><h2 style="margin:0">' + esc(p.productName) + "</h2><div>";
      if (p.grams) html += '<div class="weight">' + esc(L.formatWeight(p.grams)) + "</div>";
      html +=
        '<div class="pieces' +
        (p.grams ? "" : " weight") +
        '">' +
        esc(p.pieces === 1 ? t("common.piece") : t("common.pieces", { n: p.pieces })) +
        "</div></div><ul>";
      p.presentations.forEach(function (x) {
        if (!x.qty) return;
        html +=
          "<li><span>" + x.qty + " × " + esc(x.label) + "</span><span>" + (x.grams ? esc(L.formatWeight(x.grams)) : "") + "</span></li>";
      });
      html += "</ul>";
      if (p.donePieces)
        html +=
          '<p class="hint" style="grid-column:1/-1;margin:0">' +
          esc(t("production.done", { qty: p.doneGrams ? L.formatWeight(p.doneGrams) : t("common.pieces", { n: p.donePieces }) })) +
          "</p>";
      if (p.folios.length)
        html +=
          '<p class="hint" style="grid-column:1/-1;margin:0">' + esc(t("production.orders", { list: p.folios.sort().join(", ") })) + "</p>";
      html += "</div>";
    });
    html += '</div><p class="hint" style="margin-top:0.75rem">' + esc(t("production.weightNote")) + "</p>";
    return html;
  }
  RESULTS.produccion = productionResults;

  // ---------- reports ----------
  function reportRange() {
    var r = ui.report;
    var d0 = today();
    if (r.mode === "today") return { from: d0, to: d0 };
    if (r.mode === "week") return L.weekRange(d0);
    if (r.mode === "lastMonth") return L.monthRange(L.addDays(L.monthRange(d0).from, -1));
    if (r.mode === "custom" && r.from && r.to) return { from: r.from <= r.to ? r.from : r.to, to: r.from <= r.to ? r.to : r.from };
    return L.monthRange(d0);
  }
  function reportsView() {
    var range = reportRange();
    var key = range.from + "/" + range.to;
    var src;
    var note = t("reports.local");
    if (ui.report.online && store.sync) {
      if (ui.report.data && ui.report.data.key === key) {
        src = ui.report.data;
        note = t("reports.onlineUsed");
      } else if (!ui.report.loading) loadOnlineReport(range, key);
    }
    if (!src) {
      var snap = snapshot();
      src = { orders: snap.byId, notes: snap.notes, payments: snap.payments };
      if (ui.report.online && ui.report.loading) note = t("reports.onlineLoading");
      if (ui.report.online && ui.report.error) note = t("reports.onlineFailed");
    }
    ui.reportSrc = { src: src, range: range };
    var html = "<h1>" + esc(t("reports.title")) + '</h1><div class="chips">';
    ["today", "week", "month", "lastMonth", "custom"].forEach(function (m) {
      html +=
        '<button type="button" data-act="reportMode" data-v="' +
        m +
        '"' +
        pressed(ui.report.mode === m) +
        ">" +
        esc(t("reports." + m)) +
        "</button>";
    });
    html += "</div>";
    if (ui.report.mode === "custom")
      html +=
        '<div class="row stretch" style="margin-top:0.75rem"><div class="field"><label for="rep-from">' +
        esc(t("reports.from")) +
        '</label><input id="rep-from" type="date" data-input="reportFrom" value="' +
        esc(ui.report.from || range.from) +
        '" /></div><div class="field" style="margin-top:0"><label for="rep-to">' +
        esc(t("reports.to")) +
        '</label><input id="rep-to" type="date" data-input="reportTo" value="' +
        esc(ui.report.to || range.to) +
        '" /></div></div>';
    html +=
      '<p style="margin:0.75rem 0"><strong>' +
      esc(t("production.range", { from: fmtDate(range.from), to: fmtDate(range.to) })) +
      "</strong></p>";
    if (store.sync)
      html +=
        '<div class="chips"><button type="button" data-act="reportOnline"' +
        pressed(ui.report.online) +
        ">" +
        esc(t("reports.online")) +
        "</button></div>";
    html += '<p class="hint">' + esc(note) + "</p>";
    return html + searchBox("reportes") + '<div id="results" aria-live="polite">' + reportsResults() + "</div>";
  }

  /**
   * Figures and sections for the period, narrowed by the search. Money collected and pending only make sense for whole orders, so
   * they are hidden when the search keeps only some lines (a product).
   */
  function reportsResults() {
    var src = ui.reportSrc.src,
      range = ui.reportSrc.range;
    var found = L.filterBySearch(query("reportes"), src.orders, src.notes, customersById());
    var keep = {};
    found.orderIds.forEach(function (id) {
      keep[id] = true;
    });
    var payments = found.active
      ? (src.payments || []).filter(function (p) {
          return keep[p.orderId];
        })
      : src.payments;
    var r = L.report(src.orders, found.notes, payments, range);
    var showMoney = found.ordersOnly;
    var html = filterBanner("reportes");
    html +=
      '<div class="figures"><div class="figure"><span>' +
      esc(t("reports.sold")) +
      '</span><span class="money">' +
      money(r.sold) +
      '</span><span class="hint">' +
      esc(t("reports.ordersNotes", { orders: r.orders, notes: r.notes })) +
      "</span></div>" +
      (showMoney
        ? '<div class="figure"><span>' +
          esc(t("reports.collected")) +
          '</span><span class="money">' +
          money(r.collected) +
          '</span></div><div class="figure pending"><span>' +
          esc(t("reports.pending")) +
          '</span><span class="money">' +
          money(r.pending) +
          "</span></div>"
        : "") +
      "</div>";
    if (!showMoney) html += '<p class="hint">' + esc(t("reports.moneyHidden")) + "</p>";
    if (!r.notes) return html + '<p class="empty">' + esc(t(found.active ? "search.nothing" : "reports.empty")) + "</p>";
    // While searching, everything with results is shown open.
    var open = found.active ? allOpen(r) : reportOpen();
    html +=
      '<div class="row" style="margin-top:1.25rem"><button type="button" class="quiet" data-act="reportExpand" data-v="1">' +
      esc(t("reports.expandAll")) +
      '</button><button type="button" class="quiet" data-act="reportExpand" data-v="0">' +
      esc(t("reports.collapseAll")) +
      "</button></div>";

    // By product: one row per product; its presentations open under it.
    var prod = '<div class="pad ruled">';
    r.byProduct.forEach(function (p) {
      var head =
        '<span class="fold-name">' +
        esc(p.productName) +
        '</span><span class="fold-figs"><span>' +
        esc(t("common.pieces", { n: p.qty })) +
        (p.grams ? " · " + esc(L.formatWeight(p.grams)) : "") +
        "</span><strong>" +
        money(p.amount) +
        "</strong></span>";
      if (p.presentations.length < 2) {
        prod += '<div class="fold-row">' + head + "</div>";
        return;
      }
      prod +=
        '<details class="fold" data-fold="p:' +
        esc(p.productId) +
        '"' +
        (open["p:" + p.productId] ? " open" : "") +
        "><summary>" +
        head +
        '</summary><table class="data"><tbody>' +
        p.presentations
          .map(function (x) {
            return (
              '<tr class="sub"><td>' +
              esc(x.presentationLabel) +
              '</td><td class="num">' +
              x.qty +
              '</td><td class="num">' +
              (x.grams ? esc(L.formatWeight(x.grams)) : "") +
              '</td><td class="num">' +
              money(x.amount) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></details>";
    });
    prod += "</div>";
    html += reportSection("product", t("reports.byProduct"), r.byProduct.length, prod, open);

    var cust =
      '<div class="table-wrap"><table class="data"><thead><tr><th>' +
      esc(t("print.customer")) +
      '</th><th class="num">' +
      esc(t("reports.colOrders")) +
      '</th><th class="num">' +
      esc(t("reports.colAmount")) +
      "</th>" +
      (showMoney ? '<th class="num">' + esc(t("reports.colBalance")) + "</th>" : "") +
      "</tr></thead><tbody>";
    r.byCustomer.forEach(function (c) {
      cust +=
        "<tr><td>" +
        esc(c.name || t("orders.noCustomer")) +
        '</td><td class="num">' +
        c.orders +
        '</td><td class="num">' +
        money(c.amount) +
        "</td>" +
        (showMoney ? '<td class="num">' + money(Math.max(0, c.balance)) + "</td>" : "") +
        "</tr>";
    });
    cust += "</tbody></table></div>";
    html += reportSection("customer", t("reports.byCustomer"), r.byCustomer.length, cust, open);

    var max = r.byDay.reduce(function (m, d) {
      return Math.max(m, d.amount);
    }, 1);
    var days = '<table class="data"><tbody>';
    r.byDay.forEach(function (d) {
      days +=
        '<tr><td style="white-space:nowrap">' +
        esc(fmtDate(d.date)) +
        '</td><td style="width:50%"><div class="bar" style="width:' +
        Math.round((d.amount / max) * 100) +
        '%"></div></td><td class="num">' +
        money(d.amount) +
        "</td></tr>";
    });
    days += "</tbody></table>";
    html += reportSection("day", t("reports.byDay"), r.byDay.length, days, open);
    return html;
  }

  RESULTS.reportes = reportsResults;
  /** Every section and product open: used while a search is active. */
  function allOpen(r) {
    var o = { product: true, customer: true, day: true };
    r.byProduct.forEach(function (p) {
      o["p:" + p.productId] = true;
    });
    return o;
  }

  /** Which report sections and products are open: { product, customer, day, "p:<id>" }. Sections start open. */
  function reportOpen() {
    if (!ui.reportOpen) {
      var saved = null;
      try {
        saved = JSON.parse(NT.prefs.get("reportOpen") || "null");
      } catch {
        // catch-ok: an unreadable preference starts with every section open.
        saved = null;
      }
      ui.reportOpen = saved || { product: true, customer: true, day: true };
    }
    return ui.reportOpen;
  }
  function saveFolds(set) {
    if (set === "orders") NT.prefs.set("ordersFold", JSON.stringify(ui.ordersFold));
    else saveReportOpen();
  }
  function saveReportOpen() {
    NT.prefs.set("reportOpen", JSON.stringify(ui.reportOpen));
  }
  function reportSection(key, title, count, body, open) {
    return (
      '<details class="report-section" data-fold="' +
      key +
      '"' +
      (open[key] ? " open" : "") +
      "><summary><h2>" +
      esc(title) +
      ' <span class="hint">(' +
      count +
      ")</span></h2></summary>" +
      body +
      "</details>"
    );
  }

  function loadOnlineReport(range, key) {
    ui.report.loading = true;
    ui.report.error = false;
    store.sync.fetchRange(range.from, range.to).then(
      function (data) {
        ui.report.loading = false;
        ui.report.data = Object.assign({ key: key }, data);
        if (route().name === "reportes") render();
      },
      function (e) {
        NT.log.warn("reports.online_failed", { error: e });
        ui.report.loading = false;
        ui.report.error = true;
        ui.report.online = false;
        if (route().name === "reportes") render();
      }
    );
  }

  // ---------- catalog ----------
  function catalogView() {
    var html =
      '<div class="section-head" style="margin-top:0"><h1 style="margin:0">' +
      esc(t("nav.catalog")) +
      '</h1><div class="row"><a class="btn primary" href="#/producto/nuevo">' +
      esc(t("catalog.addProduct")) +
      '</a><a class="btn" href="#/cliente/nuevo">' +
      esc(t("catalog.addCustomer")) +
      "</a></div></div>";
    return html + searchBox("catalogo") + '<div id="results" aria-live="polite">' + catalogResults() + "</div>";
  }

  /** Products (name or presentation) and customers (name or phone) that match the search; empty sections hide while searching. */
  function catalogResults() {
    var q = query("catalogo");
    var all = products();
    var list = all.filter(function (p) {
      return !q || L.matchesSearch(q, L.productText(p));
    });
    var cs = customers().filter(function (c) {
      return !q || L.matchesSearch(q, L.customerText(c));
    });
    var html = filterBanner("catalogo");
    if (q && !list.length && !cs.length) return html + '<p class="empty">' + esc(t("search.nothing")) + "</p>";
    if (!q || list.length) {
      html += '<div class="section-head"><h2>' + esc(t("catalog.products")) + " (" + list.length + ")</h2></div>";
      if (!all.length) html += '<p class="sheet">' + esc(t("catalog.empty")) + "</p>";
      else {
        html += '<ul class="stubs">';
        list.forEach(function (p) {
          html +=
            '<li><a class="stub" style="grid-template-columns:1fr" href="#/producto/' +
            encodeURIComponent(p.id) +
            '"><span class="who' +
            (p.active === false ? " inactive" : "") +
            '">' +
            esc(p.name) +
            (p.active === false ? " · " + esc(t("catalog.inactive")) : "") +
            '</span><span class="meta" style="grid-column:1">' +
            (p.presentations || [])
              .filter(function (x) {
                return x.active !== false;
              })
              .map(function (x) {
                return "<span>" + esc(x.label) + " " + money(x.price) + "</span>";
              })
              .join("") +
            "</span></a></li>";
        });
        html += "</ul>";
      }
    }
    if (!q || cs.length) {
      html += '<div class="section-head"><h2>' + esc(t("catalog.customers")) + " (" + cs.length + ")</h2></div>";
      if (!cs.length) html += '<p class="hint">' + esc(t("common.none")) + "</p>";
      else {
        html += '<ul class="stubs">';
        cs.forEach(function (c) {
          html +=
            '<li><a class="stub" style="grid-template-columns:1fr" href="#/cliente/' +
            encodeURIComponent(c.id) +
            '"><span class="who">' +
            esc(c.name) +
            "</span>" +
            (c.phone ? '<span class="meta" style="grid-column:1">' + esc(c.phone) + "</span>" : "") +
            "</a></li>";
        });
        html += "</ul>";
      }
    }
    return html;
  }
  RESULTS.catalogo = catalogResults;

  function productView(id) {
    var f = ui.productForm;
    if (!f || f.id !== id) {
      var p = id ? store.get("products/" + id) : null;
      f = ui.productForm = {
        id: id,
        name: p ? p.name : "",
        active: p ? p.active !== false : true,
        presentations: p
          ? p.presentations.map(function (x) {
              return {
                id: x.id,
                label: x.label,
                grams: x.grams ? String(x.grams) : "",
                price: L.moneyInput(x.price),
                active: x.active !== false,
              };
            })
          : [{ id: null, label: "", grams: "", price: "", active: true }],
      };
    }
    var html = '<form class="stack" data-form="product"><h1>' + esc(t("product.title")) + "</h1>";
    html +=
      '<div class="field"><label for="pf-name">' +
      esc(t("product.name")) +
      '</label><input id="pf-name" type="text" data-bind="name" value="' +
      esc(f.name) +
      '" autocomplete="off" /></div>';
    html +=
      "<h2>" + esc(t("product.presentations")) + '</h2><p class="hint">' + esc(t("product.presentationHelp")) + '</p><div class="sheet">';
    f.presentations.forEach(function (x, i) {
      html +=
        '<div class="pres-edit' +
        (x.active ? "" : " inactive") +
        '"><div class="field"><label for="pl-' +
        i +
        '">' +
        esc(t("product.label")) +
        '</label><input id="pl-' +
        i +
        '" type="text" data-bind="presentations.' +
        i +
        '.label" value="' +
        esc(x.label) +
        '" placeholder="' +
        esc(t("product.labelPlaceholder")) +
        '" /></div><div class="field" style="margin-top:0"><label for="pg-' +
        i +
        '">' +
        esc(t("product.grams")) +
        '</label><input id="pg-' +
        i +
        '" type="number" inputmode="numeric" min="1" step="1" data-bind="presentations.' +
        i +
        '.grams" value="' +
        esc(x.grams) +
        '" placeholder="' +
        esc(t("common.optional")) +
        '" /></div><div class="field" style="margin-top:0"><label for="pp-' +
        i +
        '">' +
        esc(t("product.price")) +
        '</label><input id="pp-' +
        i +
        '" type="text" inputmode="decimal" data-bind="presentations.' +
        i +
        '.price" value="' +
        esc(x.price) +
        '" /></div><div class="row">' +
        (x.id
          ? '<button type="button" class="quiet" data-act="togglePresentation" data-i="' +
            i +
            '">' +
            esc(x.active ? t("product.deactivate") : t("product.activate")) +
            "</button>"
          : '<button type="button" class="quiet" data-act="removePresentation" data-i="' +
            i +
            '">' +
            esc(t("draft.remove")) +
            "</button>") +
        "</div></div>";
    });
    html +=
      '<button type="button" style="margin-top:0.75rem" data-act="addPresentation">' +
      esc(t("product.addPresentation")) +
      "</button></div>";
    if (id)
      html +=
        '<div class="chips"><button type="button" data-act="toggleProduct"' +
        pressed(f.active) +
        ">" +
        esc(t("product.active")) +
        "</button></div>";
    html +=
      '<div class="row stretch"><button type="submit" class="primary big">' +
      esc(t("common.save")) +
      '</button><a class="btn quiet" href="#/catalogo">' +
      esc(t("common.cancel")) +
      "</a></div></form>";
    return html;
  }

  function customerView(id) {
    var c = id ? store.get("customers/" + id) || {} : {};
    var html = '<form class="stack" data-form="customer" data-id="' + esc(id || "") + '"><h1>' + esc(t("customer.title")) + "</h1>";
    html +=
      '<div class="field"><label for="cf-name">' +
      esc(t("customer.name")) +
      '</label><input id="cf-name" name="name" type="text" value="' +
      esc(c.name || "") +
      '" required /></div>';
    html +=
      '<div class="field"><label for="cf-phone">' +
      esc(t("customer.phone")) +
      ' <span class="hint">(' +
      esc(t("common.optional")) +
      ')</span></label><input id="cf-phone" name="phone" type="tel" value="' +
      esc(c.phone || "") +
      '" /></div>';
    html +=
      '<div class="field"><label for="cf-comment">' +
      esc(t("customer.comment")) +
      ' <span class="hint">(' +
      esc(t("common.optional")) +
      ')</span></label><textarea id="cf-comment" name="comment">' +
      esc(c.comment || "") +
      "</textarea></div>";
    html +=
      '<div class="row stretch"><button type="submit" class="primary big">' +
      esc(t("common.save")) +
      '</button><a class="btn quiet" href="#/catalogo">' +
      esc(t("common.cancel")) +
      "</a></div>";
    if (id) html += '<div class="row">' + confirmButton("customer:" + id, "deleteCustomer", id, t("common.delete")) + "</div>";
    return html + "</form>";
  }

  // ---------- settings ----------
  function settingsView() {
    var s = repo.settings();
    var html =
      '<form class="sheet stack" data-form="business"><h2>' +
      esc(t("settings.business")) +
      '</h2><p class="hint">' +
      esc(t("settings.businessHelp")) +
      "</p>";
    [
      ["name", "settings.name", "text"],
      ["phone", "settings.phone", "tel"],
      ["address", "settings.address", "text"],
      ["ticketFooter", "settings.footer", "text"],
    ].forEach(function (f) {
      html +=
        '<div class="field"><label for="b-' +
        f[0] +
        '">' +
        esc(t(f[1])) +
        '</label><input id="b-' +
        f[0] +
        '" name="' +
        f[0] +
        '" type="' +
        f[2] +
        '" value="' +
        esc(s[f[0]] || "") +
        '"' +
        (f[0] === "ticketFooter" ? ' placeholder="' + esc(t("settings.footerPlaceholder")) + '"' : "") +
        " /></div>";
    });
    html += '<button type="submit" class="primary">' + esc(t("common.save")) + "</button></form>";

    var counter = store.get("counters/" + deviceCode()) || { next: 1 };
    html += '<section class="sheet stack"><h2>' + esc(t("settings.device")) + "</h2>";
    html +=
      '<form data-form="device" class="stack"><div class="field"><label for="dev-code">' +
      esc(t("settings.deviceCode")) +
      '</label><div class="row"><input id="dev-code" name="code" type="text" maxlength="2" style="width:6rem;text-transform:uppercase" value="' +
      esc(deviceCode()) +
      '" /><span class="hint">' +
      esc(L.folio(deviceCode(), counter.next)) +
      '</span><button type="submit">' +
      esc(t("common.save")) +
      '</button></div><p class="hint">' +
      esc(t("settings.deviceCodeHelp")) +
      "</p></div></form>";
    html +=
      "<div><h3>" +
      esc(t("settings.ticketWidth")) +
      '</h3><div class="chips"><button type="button" data-act="ticketWidth" data-v="80"' +
      pressed(ticketWidth() === 80) +
      '>80 mm</button><button type="button" data-act="ticketWidth" data-v="58"' +
      pressed(ticketWidth() === 58) +
      ">58 mm</button></div></div>";
    html +=
      "<div><h3>" + esc(t("settings.printer")) + '</h3><p class="hint">' + esc(t("settings.printerHelp")) + '</p><div class="choices">';
    NT.printers.choices().forEach(function (c) {
      html +=
        '<button type="button" data-act="printer" data-v="' +
        c.id +
        '"' +
        pressed(printerId() === c.id) +
        (c.available ? "" : " disabled") +
        ">" +
        esc(t("printer." + c.id)) +
        (c.available ? "" : " (" + esc(t("printer.unavailable")) + ")") +
        "</button>";
    });
    html +=
      '</div><button type="button" style="margin-top:0.6rem" data-act="testPrinter">' +
      esc(t("settings.testPrinter")) +
      "</button></div></section>";

    html += backupSection();
    html += dbSection();

    html += '<section class="sheet stack"><h2>' + esc(t("settings.data")) + "</h2>";
    if (ui.space)
      html +=
        '<p class="hint">' +
        esc(
          t("space.used", {
            used: mb(ui.space.used),
            total: mb(ui.space.total),
            engine: t("space.engine." + (store.engine || "localStorage")),
          })
        ) +
        "</p>";
    html +=
      '<p class="hint">' +
      esc(t("settings.exportFullHelp")) +
      "</p>" +
      (ui.exporting
        ? '<p class="notice">' + esc(t("settings.exporting")) + "</p>"
        : '<button type="button" class="primary" data-act="exportCsv">' +
          esc(t("settings.exportCsv")) +
          '</button><button type="button" data-act="exportSql">' +
          esc(t("settings.exportSql")) +
          "</button>");
    html += '<p class="hint">' + esc(t("settings.exportHelp")) + "</p>";
    html += '<button type="button" data-act="export">' + esc(t("settings.export")) + "</button>";
    if (ui.importDocs)
      html +=
        '<div class="notice stack"><div class="row stretch"><button type="button" class="primary" data-act="importMerge">' +
        esc(t("settings.importMerge")) +
        '</button><button type="button" class="danger" data-act="importReplace">' +
        esc(t("settings.importReplace")) +
        '</button><button type="button" class="quiet" data-act="importCancel">' +
        esc(t("common.cancel")) +
        "</button></div></div>";
    else html += '<button type="button" data-act="import">' + esc(t("settings.import")) + "</button>";
    if (!store.sync) {
      var days = NT.connection.settings().windowDays;
      html += '<p class="hint">' + esc(t("settings.cleanupHelp", { date: fmtDate(L.addDays(today(), -days)) })) + "</p>";
      if (ui.cleanup)
        html +=
          '<div class="row"><button type="button" class="danger primary" data-act="cleanupConfirm">' +
          esc(t("settings.cleanupConfirm", { n: ui.cleanup.length })) +
          '</button><button type="button" class="quiet" data-act="cleanupCancel">' +
          esc(t("common.cancel")) +
          "</button></div>";
      else html += '<button type="button" class="quiet" data-act="cleanup">' + esc(t("settings.cleanup")) + "</button>";
    }
    html +=
      '</section><section class="sheet stack"><h2>' +
      esc(t("settings.demo")) +
      '</h2><p class="hint">' +
      esc(t("settings.demoHelp")) +
      "</p>";
    var demoCount = NT.demo.paths(store).length;
    html += '<button type="button" data-act="demoLoad">' + esc(t("settings.demoLoad")) + "</button>";
    if (demoCount) {
      if (ui.confirm === "demo")
        html +=
          '<div class="row"><button type="button" class="danger primary" data-act="demoRemove">' +
          esc(t("settings.demoRemoveConfirm", { n: demoCount })) +
          '</button><button type="button" class="quiet" data-act="confirmNo">' +
          esc(t("common.cancel")) +
          "</button></div>";
      else html += '<button type="button" class="danger" data-act="confirm" data-key="demo">' + esc(t("settings.demoRemove")) + "</button>";
    }
    html += "</section>";

    html += '<section class="sheet stack"><h2>' + esc(t("settings.diagnostics")) + '</h2><div class="chips small">';
    NT.log.LEVELS.forEach(function (lv) {
      html += '<button type="button" data-act="logLevel" data-v="' + lv + '"' + pressed(NT.log.level() === lv) + ">" + lv + "</button>";
    });
    html +=
      '</div><button type="button" class="quiet" data-act="downloadLog">' +
      esc(t("settings.downloadLog")) +
      '</button><p class="hint">' +
      esc(t("settings.version", { v: VERSION })) +
      "</p></section>";
    return html;
  }

  function backupSection() {
    if (!backup) return "";
    var b = backup.status();
    var last = b.lastAt ? t("backup.last", { when: fmtTime(b.lastAt) }) : t("backup.never");
    var html = '<section class="sheet stack"><h2>' + esc(t("backup.title")) + "</h2>";
    if (b.state === "manual") {
      html +=
        '<p class="hint">' +
        esc(t("backup.manualHelp")) +
        "</p><p>" +
        esc(last) +
        '</p><button type="button" class="primary" data-act="backupNow">' +
        esc(t("backup.saveNow")) +
        "</button>" +
        (b.canShare ? '<button type="button" data-act="backupShare">' + esc(t("backup.share")) + "</button>" : "");
    } else if (b.state === "off") {
      html +=
        '<p class="hint">' +
        esc(t("backup.offHelp")) +
        '</p><button type="button" class="primary" data-act="backupChoose">' +
        esc(t("backup.choose")) +
        "</button>";
    } else {
      html += "<p>" + esc(t("backup.folder", { folder: b.folder || "" })) + "</p><p>" + esc(last) + "</p>";
      if (b.lastError) html += '<p class="notice">' + esc(t("backup.failed", { error: b.lastError })) + "</p>";
      if (b.state === "needs-permission")
        html +=
          '<p class="notice">' +
          esc(t("backup.permissionText")) +
          '</p><button type="button" class="primary" data-act="backupReactivate">' +
          esc(t("backup.reactivate")) +
          "</button>";
      else html += '<button type="button" class="primary" data-act="backupWrite">' + esc(t("backup.writeNow")) + "</button>";
      html += '<button type="button" data-act="backupChoose">' + esc(t("backup.change")) + "</button>";
      if (ui.confirm === "backupForget")
        html +=
          '<div class="row"><button type="button" class="danger primary" data-act="backupForget">' +
          esc(t("backup.forgetConfirm")) +
          '</button><button type="button" class="quiet" data-act="confirmNo">' +
          esc(t("common.cancel")) +
          "</button></div>";
      else
        html += '<button type="button" class="quiet" data-act="confirm" data-key="backupForget">' + esc(t("backup.forget")) + "</button>";
      html += '<p class="hint">' + esc(t("backup.folderHelp", { keep: NT.backup.KEEP })) + "</p>";
    }
    return html + "</section>";
  }

  function dbSection() {
    var c = NT.connection.settings();
    var session = NT.connection.session();
    var html = '<section class="sheet stack"><h2>' + esc(t("db.title")) + "</h2>";
    if (ui.db.error) html += '<p class="notice">' + esc(ui.db.error) + "</p>";
    if (ui.db.info) html += '<p class="notice">' + esc(ui.db.info) + "</p>";

    if (store.sync) {
      var st = store.sync.status();
      html += "<p><strong>" + esc(t("db.connectedNow", { name: c.businessName || "" })) + "</strong></p>";
      if (session && session.email) html += '<p class="hint">' + esc(t("db.account", { email: session.email })) + "</p>";
      if (c.joinCode) html += "<p>" + esc(t("db.joinCodeShow", { code: "" })) + ' <span class="code">' + esc(c.joinCode) + "</span></p>";
      html +=
        '<p class="hint">' +
        esc(t("db.pending", { n: st.pending })) +
        (st.lastSyncAt ? "<br />" + esc(t("db.lastSync", { when: fmtTime(st.lastSyncAt) })) : "") +
        "</p>";
      if (st.state === "needs-choice")
        html +=
          '<div class="notice stack"><h3>' +
          esc(t("db.choiceTitle")) +
          '</h3><p class="hint">' +
          esc(t("db.choiceHelp")) +
          '</p><button type="button" data-act="chooseServer">' +
          esc(t("db.keepServer")) +
          '</button><button type="button" data-act="chooseDevice">' +
          esc(t("db.keepDevice")) +
          "</button></div>";
      if (st.state === "needs-schema") html += schemaSteps();
      if (st.state === "needs-business") html += businessStep();
      if (st.state === "signed-out") html += signInForm(c);
      html += '<button type="button" class="primary" data-act="syncNow">' + esc(t("db.syncNow")) + "</button>";
      html +=
        '<form data-form="window" class="row"><div class="field" style="flex:1"><label for="win-days">' +
        esc(t("settings.window")) +
        '</label><input id="win-days" name="days" type="number" min="1" max="3650" value="' +
        c.windowDays +
        '" /></div><button type="submit">' +
        esc(t("common.save")) +
        '</button></form><p class="hint">' +
        esc(t("settings.windowHelp")) +
        "</p>";
      if (ui.confirm === "disconnect")
        html +=
          '<div class="notice stack">' +
          (st.pending ? "<p>" + esc(t("db.disconnectPending", { n: st.pending })) + "</p>" : "") +
          '<div class="row"><button type="button" class="danger primary" data-act="disconnect">' +
          esc(t("db.disconnectConfirm")) +
          '</button><button type="button" class="quiet" data-act="confirmNo">' +
          esc(t("common.cancel")) +
          "</button></div></div>";
      else html += '<button type="button" class="quiet" data-act="confirm" data-key="disconnect">' + esc(t("db.disconnect")) + "</button>";
      return html + "</section>";
    }

    html += '<p class="hint">' + esc(t("db.liteNow")) + "</p>";
    if (!session) return html + '<p class="hint">' + esc(t("db.help")) + "</p>" + signInForm(c) + "</section>";
    if (session.email) html += '<p class="hint">' + esc(t("db.account", { email: session.email })) + "</p>";
    if (ui.db.schema === "missing") return html + schemaSteps() + "</section>";
    if (ui.db.schema !== "ok") {
      if (!ui.db.busy) setTimeout(checkSchema, 0);
      return html + "<p>…</p></section>";
    }
    if (!c.businessId) return html + businessStep() + "</section>";
    html += "<p><strong>" + esc(c.businessName) + "</strong></p>";
    html += '<button type="button" class="primary big" data-act="connectNow">' + esc(t("db.connectNow")) + "</button>";
    html += '<button type="button" class="quiet" data-act="signOut">' + esc(t("db.disconnect")) + "</button>";
    return html + "</section>";
  }
  function signInForm(c) {
    return (
      '<form data-form="signIn" class="stack"><div class="field"><label for="db-url">' +
      esc(t("db.url")) +
      '</label><input id="db-url" name="url" type="url" inputmode="url" placeholder="https://xxxx.supabase.co" value="' +
      esc(c.url) +
      '" required /></div><div class="field"><label for="db-key">' +
      esc(t("db.key")) +
      '</label><input id="db-key" name="key" type="text" autocomplete="off" value="' +
      esc(c.anonKey) +
      '" required /></div><div class="field"><label for="db-email">' +
      esc(t("db.email")) +
      '</label><input id="db-email" name="email" type="email" autocomplete="username" value="' +
      esc(ui.db.email) +
      '" required /></div><div class="field"><label for="db-pass">' +
      esc(t("db.password")) +
      '</label><input id="db-pass" name="password" type="password" autocomplete="current-password" required minlength="6" /></div><div class="row stretch"><button type="submit" class="primary" name="mode" value="in"' +
      (ui.db.busy ? " disabled" : "") +
      ">" +
      esc(t("db.signIn")) +
      '</button><button type="submit" name="mode" value="up"' +
      (ui.db.busy ? " disabled" : "") +
      ">" +
      esc(t("db.signUp")) +
      "</button></div></form>"
    );
  }
  function schemaSteps() {
    return (
      '<div class="notice stack"><h3>' +
      esc(t("db.schemaTitle")) +
      "</h3><p>" +
      esc(t("db.schemaSteps")) +
      '</p><button type="button" class="primary" data-act="copySql">' +
      esc(t("db.copySql")) +
      '</button><a class="btn" target="_blank" rel="noopener" href="' +
      esc(sqlEditorUrl()) +
      '">' +
      esc(t("db.openEditor")) +
      '</a><button type="button" data-act="checkSchema">' +
      esc(t("db.checkAgain")) +
      "</button></div>"
    );
  }
  function sqlEditorUrl() {
    var m = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(NT.connection.settings().url);
    return m ? NT.config.supabaseSqlEditor.replace("{ref}", m[1]) : "https://supabase.com/dashboard";
  }
  function businessStep() {
    return (
      '<div class="stack"><h3>' +
      esc(t("db.businessTitle")) +
      '</h3><form data-form="bootstrap" class="row"><div class="field" style="flex:1"><label for="biz-name">' +
      esc(t("db.businessName")) +
      '</label><input id="biz-name" name="name" type="text" value="' +
      esc(repo.settings().name) +
      '" /></div><button type="submit" class="primary">' +
      esc(t("db.createBusiness")) +
      '</button></form><form data-form="join" class="row"><div class="field" style="flex:1"><label for="biz-code">' +
      esc(t("db.joinCode")) +
      '</label><input id="biz-code" name="code" type="text" maxlength="6" style="text-transform:uppercase" autocomplete="off" /></div><button type="submit">' +
      esc(t("db.joinBusiness")) +
      "</button></form></div>"
    );
  }
  function checkSchema() {
    ui.db.busy = true;
    return NT.connection
      .checkSchema()
      .then(
        function (r) {
          ui.db.schema = r;
          ui.db.error = "";
          if (r === "ok" && !NT.connection.settings().businessId) return NT.connection.membership();
        },
        function (e) {
          ui.db.schema = "error";
          ui.db.error = e && e.code === "offline" ? t("db.offline") : t("db.signInFailed", { error: (e && e.message) || "" });
        }
      )
      .then(function () {
        ui.db.busy = false;
        if (route().name === "ajustes") render();
      });
  }

  // ---------- actions ----------
  function withDraft(fn) {
    return function (el) {
      if (ui.draft) fn(ui.draft, el);
    };
  }
  function addLine(d, el) {
    var pid = el.getAttribute("data-id"),
      presId = el.getAttribute("data-pres");
    var p = store.get("products/" + pid);
    var pres =
      p &&
      p.presentations.find(function (x) {
        return x.id === presId;
      });
    if (!pres) return;
    var existing = d.lines.find(function (l) {
      return l.productId === pid && l.presentationId === presId;
    });
    if (existing) existing.qty += 1;
    else {
      var line = L.lineFrom(pid, p, pres, 1, null);
      line.catalogPrice = pres.price;
      d.lines.push(line);
    }
    d.open = null;
    d.dirty = true;
    render();
  }

  var actions = {
    filter: function (el) {
      ui.filter = el.getAttribute("data-v");
      ui.shown = PAGE_SIZE;
      render();
    },
    clearSearch: function (el) {
      var screen = el.getAttribute("data-screen");
      ui.searches[screen] = "";
      ui.shown = PAGE_SIZE;
      render();
      document.getElementById(SEARCH_IDS[screen]).focus();
    },
    showMore: function (el) {
      var g = el.getAttribute("data-group");
      if (g) {
        ui.shownByGroup = ui.shownByGroup || {};
        ui.shownByGroup[g] = (ui.shownByGroup[g] || PAGE_SIZE) + PAGE_SIZE;
      } else ui.shown = (ui.shown || PAGE_SIZE) + PAGE_SIZE;
      if (route().name === "pedidos") document.getElementById("results").innerHTML = ordersResults();
      else render();
    },
    demoLoad: function () {
      NT.demo.load(repo, store, today()).then(function () {
        toast(t("settings.demoLoaded"));
        render();
      }, failToast);
    },
    demoRemove: function () {
      ui.confirm = null;
      NT.demo.remove(repo, store).then(function () {
        toast(t("settings.demoRemoved"));
        render();
      }, failToast);
    },
    pickCustomer: withDraft(function (d, el) {
      var c = store.get("customers/" + el.getAttribute("data-id"));
      d.customerId = el.getAttribute("data-id");
      d.customerName = c ? c.name : "";
      d.search = d.customerName;
      render();
    }),
    pickNewCustomer: withDraft(function (d) {
      d.customerId = null;
      d.customerName = d.search.trim();
      d.step = "products";
      render();
    }),
    pickNoCustomer: withDraft(function (d) {
      d.customerId = null;
      d.customerName = "";
      d.search = "";
      render();
    }),
    draftDate: withDraft(function (d, el) {
      d.deliveryDate = el.getAttribute("data-v") || null;
      render();
    }),
    draftNext: withDraft(function (d) {
      // Typed a name but did not pick: use it as a new customer.
      if (!d.customerId && !d.customerName && d.search.trim()) d.customerName = d.search.trim();
      d.step = "products";
      render();
      view.focus();
    }),
    draftBack: withDraft(function (d) {
      d.step = "products";
      render();
    }),
    draftToCustomer: withDraft(function (d) {
      d.step = "customer";
      d.search = d.customerName;
      render();
    }),
    openProduct: withDraft(function (d, el) {
      var id = el.getAttribute("data-id");
      var p = store.get("products/" + id);
      var pres = (p.presentations || []).filter(function (x) {
        return x.active !== false;
      });
      if (pres.length === 1) {
        el.setAttribute("data-pres", pres[0].id);
        return addLine(d, el);
      }
      d.open = d.open === id ? null : id;
      render();
    }),
    addLine: withDraft(addLine),
    qtyUp: withDraft(function (d, el) {
      d.lines[+el.getAttribute("data-i")].qty += 1;
      syncQtyInput(+el.getAttribute("data-i"));
    }),
    qtyDown: withDraft(function (d, el) {
      var l = d.lines[+el.getAttribute("data-i")];
      if (l.qty > 1) l.qty -= 1;
      syncQtyInput(+el.getAttribute("data-i"));
    }),
    removeLine: withDraft(function (d, el) {
      d.lines.splice(+el.getAttribute("data-i"), 1);
      render();
    }),
    saveDraft: function () {
      saveDraft();
    },
    discard: function () {
      if (ui.draft && (ui.draft.lines.length || ui.draft.dirty)) {
        ui.confirm = "discard";
        render();
      } else actions.discardYes();
    },
    discardYes: function () {
      var d = ui.draft;
      ui.draft = null;
      ui.confirm = null;
      go(d && d.orderId ? "#/pedido/" + encodeURIComponent(d.orderId) : "#/pedidos");
    },
    confirm: function (el) {
      ui.confirm = el.getAttribute("data-key");
      render();
    },
    confirmNo: function () {
      ui.confirm = null;
      render();
    },
    stage: function (el) {
      var path = el.getAttribute("data-path");
      repo.setStage(path, el.getAttribute("data-v")).then(function () {
        toast(t("common.saved"), lastHistoryId(path));
        render();
      }, failToast);
    },
    openPayment: function () {
      ui.panel = ui.panel === "payment" ? null : "payment";
      render();
      var input = document.getElementById("pay-amount");
      if (input) input.focus();
    },
    openEditOrder: function () {
      ui.panel = "editOrder";
      render();
    },
    closePanel: function () {
      ui.panel = null;
      ui.share = null;
      render();
    },
    payAll: function (el) {
      document.getElementById("pay-amount").value = L.moneyInput(+el.getAttribute("data-v"));
    },
    payMethod: function (el) {
      choose(el, "method");
    },
    payNote: function (el) {
      choose(el, "noteId");
    },
    deletePayment: function (el) {
      softDelete("payments/" + el.getAttribute("data-id"));
    },
    deleteNote: function (el) {
      softDelete("notes/" + el.getAttribute("data-id"));
    },
    deleteOrder: function (el) {
      var path = "orders/" + el.getAttribute("data-id");
      ui.confirm = null;
      repo.remove(path).then(function () {
        toast(t("common.deleted"), lastHistoryId(path));
        go("#/pedidos");
      }, failToast);
    },
    deleteCustomer: function (el) {
      var path = "customers/" + el.getAttribute("data-id");
      ui.confirm = null;
      repo.remove(path).then(function () {
        toast(t("common.deleted"), lastHistoryId(path));
        go("#/catalogo");
      }, failToast);
    },
    restore: function (el) {
      repo.restore(el.getAttribute("data-id")).then(function () {
        toast(t("order.restored"));
        render();
      }, failToast);
    },
    undo: function () {
      var id = ui.undo;
      document.getElementById("toast").hidden = true;
      if (!id) return;
      repo.restore(id).then(function () {
        toast(t("order.restored"));
        render();
      }, failToast);
    },
    printLetter: function (el) {
      NT.printers.printLetter(modelFor(el.getAttribute("data-id"), "order"), t, printOpts()).catch(printFailed);
    },
    printTicket: function (el) {
      NT.printers.printTicket(modelFor(el.getAttribute("data-id"), "order"), t, printOpts()).catch(printFailed);
    },
    printNote: function (el) {
      NT.printers.printLetter(modelFor(el.getAttribute("data-id"), "note", +el.getAttribute("data-n")), t, printOpts()).catch(printFailed);
    },
    share: function (el) {
      var id = el.getAttribute("data-id");
      var m = modelFor(id, "order");
      var text = L.shareText(m, {
        folio: t("print.folio"),
        customer: t("print.customer"),
        delivery: t("print.delivery"),
        note: t("print.note"),
        total: t("print.total"),
        paid: t("print.paid"),
        balance: t("print.balance"),
        status: t("pay.status." + m.status),
        formatDate: function (d) {
          return fmtDate(d, "long");
        },
      });
      var title = t("share.title", { folio: m.folio });
      NT.printers.shareText(text, title).then(function (r) {
        if (r === "shared" || r === "cancelled") return;
        ui.share = { text: text, title: title, orderId: id };
        ui.panel = "share";
        render();
      });
    },
    copyShare: function () {
      NT.printers.copyText(ui.share.text).then(function () {
        toast(t("share.copied"));
      }, failToast);
    },
    prodMode: function (el) {
      ui.prod = { mode: el.getAttribute("data-v"), offset: 0 };
      render();
    },
    prodShift: function (el) {
      ui.prod.offset += +el.getAttribute("data-v");
      render();
    },
    reportMode: function (el) {
      ui.report.mode = el.getAttribute("data-v");
      render();
    },
    foldAll: function (el) {
      var on = el.getAttribute("data-v") === "1";
      var set = el.getAttribute("data-set");
      var state = set === "orders" ? ordersFold() : reportOpen();
      view.querySelectorAll('details[data-fold-set="' + set + '"]').forEach(function (d) {
        d.open = on;
        state[d.getAttribute("data-fold")] = on;
      });
      saveFolds(set);
    },
    reportExpand: function (el) {
      var on = el.getAttribute("data-v") === "1";
      var open = reportOpen();
      view.querySelectorAll("details[data-fold]:not([data-fold-set])").forEach(function (d) {
        d.open = on;
        open[d.getAttribute("data-fold")] = on;
      });
      saveReportOpen();
    },
    reportOnline: function () {
      ui.report.online = !ui.report.online;
      ui.report.error = false;
      render();
    },
    addPresentation: function () {
      ui.productForm.presentations.push({ id: null, label: "", grams: "", price: "", active: true });
      render();
      var inputs = view.querySelectorAll('[data-bind$=".label"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    },
    removePresentation: function (el) {
      ui.productForm.presentations.splice(+el.getAttribute("data-i"), 1);
      render();
    },
    togglePresentation: function (el) {
      var x = ui.productForm.presentations[+el.getAttribute("data-i")];
      x.active = !x.active;
      render();
    },
    toggleProduct: function () {
      ui.productForm.active = !ui.productForm.active;
      render();
    },
    ticketWidth: function (el) {
      NT.prefs.set("ticketWidth", el.getAttribute("data-v"));
      render();
    },
    printer: function (el) {
      NT.prefs.set("printer", el.getAttribute("data-v"));
      render();
    },
    testPrinter: function () {
      var m = L.printModel(
        repo.settings(),
        {
          folio: L.folio(deviceCode(), 0),
          customerName: t("print.testTitle"),
          deliveryDate: today(),
          stage: "ordered",
          createdAt: new Date().toISOString(),
        },
        [
          {
            number: 1,
            stage: "ordered",
            lines: [{ productName: "Prueba ñ á é í ó ú", presentationLabel: "250 g", qty: 2, unitPrice: 3500 }],
          },
        ],
        [],
        { scope: "order" }
      );
      NT.printers.printTicket(m, t, printOpts()).catch(printFailed);
    },
    export: function () {
      download(
        "notas-respaldo-" + today() + ".json",
        JSON.stringify({ app: "notas", schemaVersion: 1, exportedAt: new Date().toISOString(), data: store.exportAll() }, null, 1)
      );
    },
    backupChoose: function () {
      backup.chooseFolder().then(afterBackup, backupFailed);
    },
    backupReactivate: function () {
      backup.reactivate().then(afterBackup, backupFailed);
    },
    backupWrite: function () {
      backup.writeNow().then(afterBackup, backupFailed);
    },
    backupNow: function () {
      backup.saveNow().then(afterBackup, backupFailed);
    },
    backupShare: function () {
      backup.shareNow().then(afterBackup, backupFailed);
    },
    backupForget: function () {
      ui.confirm = null;
      backup.forget().then(afterBackup, backupFailed);
    },
    exportCsv: function () {
      fullExport(function (tables, stamp) {
        download(
          "notas-exportacion-" + today() + ".zip",
          NT.exporter.zip(NT.exporter.csvFiles(tables), new Date(stamp)),
          "application/zip"
        );
      });
    },
    exportSql: function () {
      fullExport(function (tables, stamp) {
        download("notas-exportacion-" + today() + ".sql", NT.exporter.sql(tables, stamp), "application/sql");
      });
    },
    import: function () {
      document.getElementById("import-file").click();
    },
    importMerge: function () {
      runImport("merge");
    },
    importReplace: function () {
      runImport("replace");
    },
    importCancel: function () {
      ui.importDocs = null;
      render();
    },
    cleanup: function () {
      var days = NT.connection.settings().windowDays;
      var from = L.addDays(today(), -days);
      var old = Object.keys(store.exportAll()).filter(function (p) {
        var d = NT.rows.docDate(p, store.get(p), store.get);
        return d && d < from;
      });
      if (!old.length) {
        toast(t("settings.cleanupNone", { days: days }));
        return;
      }
      actions.export();
      ui.cleanup = old;
      render();
    },
    cleanupConfirm: function () {
      var list = ui.cleanup || [];
      ui.cleanup = null;
      store
        .batch(
          list.map(function (p) {
            return { path: p, value: null };
          })
        )
        .then(function () {
          toast(t("settings.cleanupDone", { n: list.length }));
          render();
        }, failToast);
    },
    cleanupCancel: function () {
      ui.cleanup = null;
      render();
    },
    logLevel: function (el) {
      NT.prefs.set("logLevel", el.getAttribute("data-v"));
      NT.log.setLevel(el.getAttribute("data-v"));
      render();
    },
    downloadLog: function () {
      download("notas-registro-" + today() + ".txt", NT.log.dump(), "text/plain");
    },
    copySql: function () {
      NT.printers.copyText(NT.schemaSql).then(function () {
        toast(t("db.sqlCopied"));
      }, failToast);
    },
    checkSchema: function () {
      ui.db.schema = null;
      checkSchema().then(function () {
        if (ui.db.schema === "missing") toast(t("db.schemaStill"));
        if (store.sync) store.sync.syncNow().then(render);
      });
    },
    connectNow: function () {
      NT.connection.setConnected();
      location.reload();
    },
    signOut: function () {
      NT.connection.disconnect().then(function () {
        ui.db = { busy: false, error: "", schema: null, info: "", email: "" };
        render();
      });
    },
    syncNow: function () {
      store.sync.syncNow().then(render);
    },
    chooseServer: function () {
      store.sync.choose("server").then(render);
    },
    chooseDevice: function () {
      store.sync.choose("device").then(render);
    },
    disconnect: function () {
      NT.connection.disconnect().then(function () {
        location.reload();
      });
    },
  };

  function choose(el, field) {
    var group = el.parentNode;
    group.querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-pressed", b === el ? "true" : "false");
    });
    var hidden = group.parentNode.querySelector('input[name="' + field + '"]');
    if (hidden) hidden.value = el.getAttribute("data-v");
  }
  function syncQtyInput(i) {
    var input = view.querySelector('[data-input="qty"][data-i="' + i + '"]');
    if (input) input.value = ui.draft.lines[i].qty;
    ui.draft.dirty = true;
    refreshDraftTotals();
  }
  function softDelete(path) {
    ui.confirm = null;
    repo.remove(path).then(function () {
      toast(t("common.deleted"), lastHistoryId(path));
      render();
    }, failToast);
  }
  function failToast(e) {
    NT.log.error("ui.action_failed", { error: e });
    toast(problemText(e));
  }
  function afterBackup(st) {
    if (st && st.lastAt && st.state !== "needs-permission" && !st.lastError) toast(t("backup.done"));
    render();
  }
  function backupFailed(e) {
    // A closed folder picker or share sheet is not an error.
    if (e && e.name === "AbortError") return;
    failToast(e);
  }

  /** Builds the complete export: in Connected mode from the whole database (falling back to this device), else from this device. */
  function fullExport(save) {
    if (ui.exporting) return;
    ui.exporting = true;
    render();
    var localOnly = false;
    var source = store.sync
      ? store.sync.fetchAll().catch(function (e) {
          NT.log.warn("export.fetch_all_failed", { error: e });
          localOnly = true;
          return store.exportAll();
        })
      : Promise.resolve(store.exportAll());
    source
      .then(function (docs) {
        var tables = NT.exporter.tables(docs);
        save(tables, new Date().toISOString());
        toast(localOnly ? t("settings.exportLocalOnly") : t("settings.exportDone", { n: tables.renglones.length }));
      })
      .catch(failToast)
      .then(function () {
        ui.exporting = false;
        if (route().name === "ajustes") render();
      });
  }

  function runImport(mode) {
    var docs = ui.importDocs;
    ui.importDocs = null;
    store.importAll(docs, mode).then(function (r) {
      toast(t("settings.importDone", r));
      render();
    }, failToast);
  }

  // ---------- inputs and forms ----------
  var inputs = {
    search: function (el) {
      var screen = el.getAttribute("data-screen");
      ui.searches[screen] = el.value;
      ui.shown = PAGE_SIZE;
      document.getElementById("results").innerHTML = RESULTS[screen]();
      view.querySelector('[data-act="clearSearch"][data-screen="' + screen + '"]').hidden = !el.value;
      var filters = document.getElementById("order-filters");
      if (filters) filters.hidden = !!el.value.trim();
    },
    draftSearch: function (el) {
      var d = ui.draft;
      d.search = el.value;
      if (d.customerName && d.search !== d.customerName) {
        d.customerId = null;
        d.customerName = "";
      }
      var q = d.search.trim().toLowerCase();
      var list = customers().filter(function (c) {
        return !q || String(c.name).toLowerCase().indexOf(q) >= 0;
      });
      var exact = list.some(function (c) {
        return String(c.name).toLowerCase() === q;
      });
      document.getElementById("customer-choices").innerHTML = customerChoices(d, list.slice(0, 8), q, exact);
    },
    draftDate: function (el) {
      if (!el.value) return;
      ui.draft.deliveryDate = el.value;
      render();
    },
    productSearch: function (el) {
      ui.draft.productSearch = el.value;
      document.getElementById("draft-tiles").innerHTML = draftTiles(ui.draft);
    },
    draftComment: function (el) {
      ui.draft.comment = el.value;
      ui.draft.dirty = true;
    },
    qty: function (el) {
      var n = parseInt(el.value, 10);
      if (isFinite(n) && n >= 1) {
        ui.draft.lines[+el.getAttribute("data-i")].qty = n;
        ui.draft.dirty = true;
        refreshDraftTotals();
      }
    },
    price: function (el) {
      var c = L.parseMoney(el.value);
      if (c !== null) {
        ui.draft.lines[+el.getAttribute("data-i")].unitPrice = c;
        ui.draft.dirty = true;
        refreshDraftTotals();
      }
    },
    reportFrom: function (el) {
      ui.report.from = el.value;
      render();
    },
    reportTo: function (el) {
      ui.report.to = el.value;
      render();
    },
  };
  var CHANGE_ONLY = { draftDate: 1, reportFrom: 1, reportTo: 1 };

  function bindValue(path, value) {
    var parts = path.split(".");
    var obj = ui.productForm;
    for (var i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
  }

  var forms = {
    payment: function (form, data) {
      var amount = L.parseMoney(data.get("amount"));
      repo
        .addPayment({
          orderId: form.getAttribute("data-id"),
          amount: amount === null ? 0 : amount,
          method: data.get("method") || "cash",
          noteId: data.get("noteId") || null,
          comment: data.get("comment") || "",
        })
        .then(function () {
          ui.panel = null;
          toast(t("payment.saved"));
          render();
        }, failToast);
    },
    editOrder: function (form, data) {
      var name = String(data.get("customerName") || "").trim();
      var match = customers().find(function (c) {
        return c.name.toLowerCase() === name.toLowerCase();
      });
      var id = route().a;
      var ready = match || !name ? Promise.resolve(match ? match.id : null) : repo.saveCustomer(null, { name: name });
      ready
        .then(function (cid) {
          return repo.updateOrder(id, {
            customerId: cid,
            customerName: name,
            deliveryDate: data.get("deliveryDate") || null,
            comment: String(data.get("comment") || ""),
          });
        })
        .then(function () {
          ui.panel = null;
          toast(t("common.saved"));
          render();
        }, failToast);
    },
    product: function () {
      var f = ui.productForm;
      var product = {
        name: f.name,
        active: f.active,
        presentations: f.presentations.map(function (x) {
          var grams = String(x.grams || "").trim();
          var price = L.parseMoney(x.price);
          return { id: x.id, label: x.label, grams: grams ? Number(grams) : null, price: price === null ? -1 : price, active: x.active };
        }),
      };
      repo.saveProduct(f.id, product).then(function () {
        ui.productForm = null;
        toast(t("product.saved"));
        go("#/catalogo");
      }, failToast);
    },
    customer: function (form, data) {
      var id = form.getAttribute("data-id") || null;
      repo
        .saveCustomer(id, {
          name: String(data.get("name") || ""),
          phone: String(data.get("phone") || ""),
          comment: String(data.get("comment") || ""),
        })
        .then(function () {
          toast(t("customer.saved"));
          go("#/catalogo");
        }, failToast);
    },
    business: function (form, data) {
      repo
        .saveSettings({
          name: String(data.get("name") || "").trim(),
          phone: String(data.get("phone") || "").trim(),
          address: String(data.get("address") || "").trim(),
          ticketFooter: String(data.get("ticketFooter") || "").trim(),
        })
        .then(function () {
          toast(t("common.saved"));
          render();
        }, failToast);
    },
    device: function (form, data) {
      var code = String(data.get("code") || "").trim();
      if (!L.validDeviceCode(code)) return toast(t("settings.deviceCodeInvalid"));
      NT.prefs.set("deviceCode", code.toUpperCase());
      toast(t("common.saved"));
      render();
    },
    window: function (form, data) {
      var n = parseInt(data.get("days"), 10);
      if (!(n > 0)) return;
      NT.connection.saveSettings({ windowDays: n });
      store.sync.syncNow().then(render);
    },
    signIn: function (form, data, submitter) {
      var signUp = submitter && submitter.value === "up";
      ui.db.busy = true;
      ui.db.error = "";
      ui.db.info = "";
      ui.db.email = String(data.get("email") || "");
      render();
      NT.connection
        .signIn(
          String(data.get("url") || "").trim(),
          String(data.get("key") || "").trim(),
          ui.db.email.trim(),
          String(data.get("password") || ""),
          signUp
        )
        .then(
          function (r) {
            ui.db.busy = false;
            if (r.confirmEmail) ui.db.info = t("db.confirmEmail");
            ui.db.schema = null;
            if (store.sync) return store.sync.syncNow();
          },
          function (e) {
            ui.db.busy = false;
            ui.db.error = e && e.code === "offline" ? t("db.offline") : t("db.signInFailed", { error: (e && e.message) || "" });
          }
        )
        .then(render);
    },
    bootstrap: function (form, data) {
      NT.connection.bootstrap(String(data.get("name") || "")).then(afterBusiness, businessFailed);
    },
    join: function (form, data) {
      NT.connection.join(String(data.get("code") || "")).then(afterBusiness, function () {
        ui.db.error = t("db.joinFailed");
        render();
      });
    },
  };
  function afterBusiness() {
    ui.db.error = "";
    if (store.sync) return store.sync.syncNow().then(render);
    render();
  }
  function businessFailed(e) {
    ui.db.error = e && e.code === "offline" ? t("db.offline") : t("db.signInFailed", { error: (e && e.message) || "" });
    render();
  }

  // ---------- start ----------
  function wire() {
    view.addEventListener("click", function (e) {
      var el = e.target.closest("[data-act]");
      if (!el || el.disabled) return;
      var fn = actions[el.getAttribute("data-act")];
      if (fn) {
        e.preventDefault();
        fn(el);
      }
    });
    document.getElementById("toast").addEventListener("click", function (e) {
      if (e.target.closest('[data-act="undo"]')) actions.undo();
    });
    view.addEventListener("input", function (e) {
      var el = e.target;
      var name = el.getAttribute("data-input");
      if (name && inputs[name] && !CHANGE_ONLY[name]) inputs[name](el);
      var bind = el.getAttribute("data-bind");
      if (bind && ui.productForm) bindValue(bind, el.value);
    });
    view.addEventListener("change", function (e) {
      var name = e.target.getAttribute("data-input");
      if (name && CHANGE_ONLY[name]) inputs[name](e.target);
    });
    view.addEventListener("submit", function (e) {
      var form = e.target.closest("[data-form]");
      if (!form) return;
      e.preventDefault();
      var fn = forms[form.getAttribute("data-form")];
      if (fn) fn(form, new FormData(form), e.submitter);
    });
    // <details> toggles do not bubble: listen in the capture phase to remember what is open.
    view.addEventListener(
      "toggle",
      function (e) {
        var key = e.target && e.target.getAttribute && e.target.getAttribute("data-fold");
        if (!key) return;
        var set = e.target.getAttribute("data-fold-set") || "report";
        (set === "orders" ? ordersFold() : reportOpen())[key] = e.target.open;
        saveFolds(set);
      },
      true
    );
    view.addEventListener("focusout", function () {
      if (ui.dirty)
        setTimeout(function () {
          var a = document.activeElement;
          if (!a || !/INPUT|TEXTAREA|SELECT/.test(a.tagName)) render();
        }, 0);
    });
    document.getElementById("import-file").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      file.text().then(function (text) {
        var parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          // catch-ok: not JSON is reported to the person below.
          parsed = null;
        }
        var ok =
          parsed &&
          parsed.app === "notas" &&
          parsed.data &&
          typeof parsed.data === "object" &&
          Object.keys(parsed.data).every(function (p) {
            return /^[a-z]+\/[^/]+$/.test(p) && parsed.data[p] && typeof parsed.data[p] === "object";
          });
        if (!ok) return toast(t("settings.importInvalid"));
        ui.importDocs = parsed.data;
        render();
      });
    });
    window.addEventListener("hashchange", function () {
      ui.confirm = null;
      ui.panel = null;
      ui.share = null;
      var r = route();
      if (r.name !== "nuevo" && r.name !== "nota") ui.draft = null;
      if (r.name !== "producto") ui.productForm = null;
      ui.shown = PAGE_SIZE;
      render();
      view.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    });
    store.onChange(function (changes) {
      var remote = changes.some(function (c) {
        return c.remote;
      });
      if (!remote) return;
      var a = document.activeElement;
      if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) ui.dirty = true;
      else render();
    });
    if (store.sync) {
      store.sync.onStatus(statusLine);
      window.addEventListener("online", function () {
        store.sync.syncNow();
      });
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") store.sync.syncNow();
      });
    }
  }

  /** The automatic backup: a folder where the browser allows it (Chrome, Edge), otherwise a daily reminder (js/backup.js). */
  function startBackup() {
    var canPick = typeof window.showDirectoryPicker === "function" && window.self === window.top;
    var canShareFiles = false;
    try {
      canShareFiles =
        typeof navigator !== "undefined" &&
        !!navigator.canShare &&
        navigator.canShare({ files: [new File(["{}"], "x.json", { type: "application/json" })] });
    } catch {
      // catch-ok: browsers without File or canShare simply cannot share files.
      canShareFiles = false;
    }
    backup = NT.backup.create({
      now: NT.clock.now,
      today: NT.clock.today,
      exportAll: function () {
        return store.exportAll();
      },
      prefs: NT.prefs,
      handles: NT.idbKeyval ? NT.idbKeyval() : null,
      pickFolder: canPick
        ? function () {
            return window.showDirectoryPicker({ id: "notas-respaldo", mode: "readwrite", startIn: "documents" });
          }
        : null,
      setTimeout: function (fn, ms) {
        return setTimeout(fn, ms);
      },
      clearTimeout: function (id) {
        clearTimeout(id);
      },
      download: function (name, text) {
        download(name, text);
      },
      share: canShareFiles
        ? function (name, text) {
            var file = new File([text], name, { type: "application/json" });
            return navigator.share({ files: [file], title: name }).then(
              function () {
                return true;
              },
              function (e) {
                if (e && e.name === "AbortError") return false;
                throw e;
              }
            );
          }
        : null,
      onStatus: function () {
        statusLine();
        var el = document.getElementById("backup-banner");
        if (el) el.innerHTML = backupBanner();
      },
    });
    backup.init().then(statusLine, function (e) {
      NT.log.warn("backup.init_failed", { error: e });
    });
    store.onChange(function () {
      backup.noteChange();
    });
  }

  /** Asks the browser to keep this site's data (not clear it under pressure) and checks how full storage is. */
  function protectStorage() {
    var st = typeof navigator !== "undefined" && navigator.storage;
    if (st && st.persist && store.engine === "indexeddb")
      st.persist().then(
        function (granted) {
          NT.log.info("app.persist", { granted: granted });
        },
        function (e) {
          NT.log.warn("app.persist_failed", { error: e });
        }
      );
    checkSpace();
    var writes = 0;
    store.onChange(function () {
      writes++;
      if (writes % 25 === 0) checkSpace();
    });
  }
  /** { used, total } in bytes for the storage in use; IndexedDB asks the browser, localStorage is about 5 million characters. */
  function storageUse() {
    var st = typeof navigator !== "undefined" && navigator.storage;
    if (store.engine === "indexeddb" && st && st.estimate)
      return st.estimate().then(function (e) {
        return { used: e.usage || 0, total: e.quota || 0 };
      });
    return Promise.resolve({ used: JSON.stringify(store.exportAll()).length, total: 5000000 });
  }
  function checkSpace() {
    return storageUse().then(
      function (u) {
        ui.space = u;
        var full = u.total > 0 && u.used / u.total >= 0.8;
        if (full && !ui.spaceWarned) toast(t("space.warning", { pct: Math.round((u.used / u.total) * 100) }));
        ui.spaceWarned = full;
        statusLine();
      },
      function (e) {
        NT.log.warn("app.space_failed", { error: e });
      }
    );
  }
  function mb(bytes) {
    return (Math.round((bytes / 1048576) * 10) / 10).toLocaleString("es-MX");
  }

  function registerWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
    navigator.serviceWorker.register("sw.js").catch(function (e) {
      // catch-ok: without the worker the app still works online; it only cannot open offline.
      NT.log.warn("app.worker_failed", { error: e });
    });
  }

  /** Stops the app over data it cannot read, offering the raw data for download (raw null: data that cannot be opened at all). */
  function failClosed(raw) {
    view.innerHTML =
      '<div class="sheet stack"><h1>' +
      esc(t(raw === null ? "corrupt.unavailableTitle" : "corrupt.title")) +
      "</h1><p>" +
      esc(t(raw === null ? "corrupt.unavailableBody" : "corrupt.body")) +
      "</p>" +
      (raw === null ? "" : '<button type="button" class="primary" id="corrupt-download">' + esc(t("corrupt.download")) + "</button>") +
      "</div>";
    var button = document.getElementById("corrupt-download");
    if (button)
      button.addEventListener("click", function () {
        download("notas-datos-guardados-" + today() + ".json", raw);
      });
  }

  function start() {
    view = document.getElementById("view");
    var level = (/[?&]debug=(\w+)/.exec(location.search) || [])[1] || NT.prefs.get("logLevel") || "off";
    NT.log.setLevel(level);
    NT.log.setBufferSize(NT.config.logBufferSize);
    window.addEventListener("error", function (e) {
      NT.log.error("ui.uncaught", { message: e.message });
    });
    window.addEventListener("unhandledrejection", function (e) {
      NT.log.error("ui.unhandled_rejection", { error: e.reason });
    });
    NT.i18n.init();
    NT.createStore().then(function (opened) {
      store = opened;
      if (!store) {
        view.innerHTML = '<p class="sheet">' + esc(t("status.noStorage")) + "</p>";
        return;
      }
      if (store.corrupt) return failClosed(store.raw);
      if (store.failed) return failClosed(null);
      repo = NT.repo.create(store, { now: NT.clock.now, today: NT.clock.today, uuid: NT.clock.uuid, by: by, deviceCode: deviceCode });
      startBackup();
      wire();
      render();
      registerWorker();
      protectStorage();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  return { render: render, ui: ui, version: VERSION };
})();
