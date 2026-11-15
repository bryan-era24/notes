/*
 * Purpose: End-to-end flows of the real page in jsdom, with no network.
 * Covers: first run and demo data, adding a product with presentations, the three-step note (customer, products, save), quantities and
 * an adjusted price, partial payments and status, informative stages with undo, printing letter and ticket, production in kg,
 * reports, export, the fail-closed screen, and Lite mode never reaching the network or the console.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { openApp, STORAGE_KEY } = require("./helpers/open_app");

async function addProduct(app, name, presentations) {
  await app.go("#/producto/nuevo");
  await app.type("#pf-name", name);
  for (let i = 0; i < presentations.length; i++) {
    if (i > 0) await app.click('[data-act="addPresentation"]');
    await app.type("#pl-" + i, presentations[i][0]);
    if (presentations[i][1]) await app.type("#pg-" + i, String(presentations[i][1]));
    await app.type("#pp-" + i, presentations[i][2]);
  }
  app.window.document
    .querySelector('[data-form="product"]')
    .dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await app.wait(40);
}

test("[TC-NFR-01-01] first run offers the catalog and demo data; Lite never reaches the network or the console", async () => {
  const app = await openApp();
  assert.match(app.text(), /Todavía no hay pedidos/);
  assert.ok(app.$("view").querySelector('[data-act="demoLoad"]'));
  await app.click('[data-act="demoLoad"]');
  await app.waitFor(() => /Ejemplo|Prueba/.test(app.text()));
  assert.ok(app.window.document.querySelectorAll(".stub").length > 3);
  assert.deepEqual(app.blocked, []);
  assert.deepEqual(app.consoleCalls, []);
  assert.match(app.$("sync-status").textContent, /Guardado en este equipo/);
});

test("[TC-NOT-05-01] a whole note in three steps: customer, products with quantities and an adjusted price, save", async () => {
  const app = await openApp();
  await addProduct(app, "Palomitas de mantequilla", [
    ["250 g", 250, "35"],
    ["1 kg", 1000, "120"],
  ]);
  await addProduct(app, "Palomitas de caramelo", [["245 g", 245, "38"]]);
  assert.match(app.text(), /Palomitas de mantequilla/);

  await app.go("#/nuevo");
  await app.type("#customer-search", "Fulanita");
  await app.click('[data-act="pickNewCustomer"]');
  // Products step: tap a product with two presentations, then one of them.
  const tile = app.byText('[data-act="openProduct"]', /mantequilla/);
  await app.click(tile);
  await app.click(app.byText('[data-act="addLine"]', /250 g/));
  const qty = app.window.document.querySelector('[data-input="qty"]');
  await app.type(qty, "25");
  // Single-presentation product is added in one tap.
  await app.click(app.byText('[data-act="openProduct"]', /caramelo/));
  await app.type(app.window.document.querySelectorAll('[data-input="qty"]')[1], "24");
  await app.click(app.window.document.querySelectorAll('[data-act="qtyUp"]')[1]);
  await app.type("#price-1", "36.50");
  assert.equal(app.$("draft-total").textContent, "$1,787.50");
  await app.click('[data-act="saveDraft"]');
  await app.waitFor(() => /A-0001/.test(app.text()));
  assert.match(app.text(), /Fulanita/);
  assert.match(app.text(), /\$1,787\.50/);
  assert.match(app.text(), /Pendiente de pago/);

  const saved = JSON.parse(app.window.localStorage.getItem(STORAGE_KEY));
  const note = Object.entries(saved).find(([k]) => k.startsWith("notes/"))[1];
  assert.equal(note.lines[1].unitPrice, 3650);
  assert.equal(note.lines[1].catalogPrice, undefined);
  assert.ok(
    Object.keys(saved).some((k) => k.startsWith("customers/")),
    "new customer saved"
  );
  assert.ok(Object.keys(saved).filter((k) => k.startsWith("history/")).length >= 4);

  // Payments: partial, then the rest.
  await app.click('[data-act="openPayment"]');
  await app.type("#pay-amount", "500");
  app.window.document
    .querySelector('[data-form="payment"]')
    .dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await app.waitFor(() => /Pago parcial/.test(app.text()));
  assert.match(app.text(), /\$1,287\.50/);
  await app.click('[data-act="openPayment"]');
  await app.click('[data-act="payAll"]');
  app.window.document
    .querySelector('[data-form="payment"]')
    .dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await app.waitFor(() => /Pagado/.test(app.window.document.querySelector(".pill").textContent));

  // Stages are informative and can be undone.
  await app.click(app.byText('[data-act="stage"]', /^Entregado$/));
  assert.equal(app.byText('[data-act="stage"]', /^Entregado$/).getAttribute("aria-pressed"), "true");
  await app.click('#toast [data-act="undo"]');
  await app.wait(40);
  assert.equal(app.byText('[data-act="stage"]', /^Pedido$/).getAttribute("aria-pressed"), "true");

  // Printing.
  await app.click('[data-act="printLetter"]');
  assert.equal(app.prints.length, 1);
  assert.equal(app.prints[0].kind, "letter");
  assert.match(app.prints[0].page, /size: letter/);
  assert.match(app.prints[0].html, /Palomitas de caramelo 245 g/);
  assert.match(app.prints[0].html, /Pagado/);
  await app.click('[data-act="printTicket"]');
  assert.equal(app.prints[1].kind, "ticket");
  assert.match(app.prints[1].page, /80mm/);

  // Share falls back to WhatsApp and copy when the browser cannot share.
  await app.click('[data-act="share"]');
  await app.wait(30);
  const wa = app.window.document.querySelector('a[href^="https://wa.me/"]');
  assert.ok(wa);
  assert.match(decodeURIComponent(wa.href), /25 x Palomitas de mantequilla 250 g/);

  // Production: kilos by product for the delivery day (today by default).
  await app.go("#/produccion");
  assert.match(app.text(), /6\.25 kg/);
  assert.match(app.text(), /25 × 250 g/);
  assert.match(app.text(), /6\.12 kg|6\.13 kg/);

  // Reports.
  await app.go("#/reportes");
  assert.match(app.text(), /\$1,787\.50/);
  assert.match(app.text(), /Fulanita/);
  assert.deepEqual(app.blocked, []);
});

test("[TC-NOT-05-02] a second note is added to the same order and the order total adds both", async () => {
  const app = await openApp();
  await addProduct(app, "Palomitas", [["250 g", 250, "10"]]);
  await app.go("#/nuevo");
  await app.click('[data-act="pickNoCustomer"]');
  await app.click('[data-act="draftNext"]');
  await app.click(app.byText('[data-act="openProduct"]', /Palomitas/));
  await app.click('[data-act="saveDraft"]');
  await app.waitFor(() => /A-0001/.test(app.text()));
  const orderHash = app.window.location.hash;
  await app.click(app.byText("a", /Agregar nota/));
  await app.wait(40);
  await app.click(app.byText('[data-act="openProduct"]', /Palomitas/));
  await app.click('[data-act="qtyUp"]');
  await app.click('[data-act="saveDraft"]');
  await app.waitFor(() => app.window.location.hash === orderHash && /Nota 2/.test(app.text()));
  assert.match(app.text(), /\$30\.00/);
});

test("[TC-SYN-02-04] export downloads a backup with the app marker", async () => {
  const app = await openApp();
  await app.go("#/ajustes");
  await app.click('[data-act="demoLoad"]');
  await app.wait(200);
  await app.click('[data-act="export"]');
  const text = await app.downloadText(0);
  const parsed = JSON.parse(text);
  assert.equal(parsed.app, "notas");
  assert.ok(Object.keys(parsed.data).some((k) => k.startsWith("orders/")));
});

test("[TC-SYN-01-05] unreadable stored data shows the fail-closed screen and is not overwritten", async () => {
  const app = await openApp({ storage: { [STORAGE_KEY]: "{broken" } });
  assert.match(app.text(), /no se pueden leer/);
  await app.click("#corrupt-download");
  assert.equal(await app.downloadText(0), "{broken");
  assert.equal(app.window.localStorage.getItem(STORAGE_KEY), "{broken");
});

test("[TC-SYN-08-06] with IndexedDB the orders are still there after closing and opening the app", async () => {
  const { IDBFactory } = require("fake-indexeddb");
  const idb = new IDBFactory();
  const first = await openApp({ indexedDB: idb });
  await first.waitFor(() => first.window.document.querySelector('[data-act="demoLoad"]'));
  await first.click('[data-act="demoLoad"]');
  await first.waitFor(() => first.window.document.querySelectorAll(".stub").length > 3, 6000);
  assert.equal(first.window.localStorage.getItem(STORAGE_KEY), null, "nothing written to localStorage");
  const second = await openApp({ indexedDB: idb });
  await second.waitFor(() => second.window.document.querySelectorAll(".stub").length > 3, 6000);
  assert.deepEqual(second.blocked, []);
});

test("[TC-PED-04-02] the order search finds by name without accents, by folio number and by product, and clears in one tap", async () => {
  const app = await openApp();
  await app.click('[data-act="demoLoad"]');
  await app.waitFor(() => app.window.document.querySelectorAll(".stub").length > 3, 6000);
  const results = () => [...app.window.document.querySelectorAll("#order-results .stub .folio")].map((e) => e.textContent);
  app.$("order-search").focus();
  await app.type("#order-search", "esquina");
  assert.ok(results().length >= 1);
  assert.ok(app.byText("#order-results .stub", /Esquina/));
  await app.type("#order-search", "10");
  assert.deepEqual(results(), ["A-0010"]);
  await app.type("#order-search", "dona carmen");
  assert.ok(results().length >= 1, "accents are optional");
  await app.type("#order-search", "charola");
  assert.ok(results().length >= 2, "searches products inside notes");
  assert.equal(app.$("order-filters").hidden, true, "filters step aside while searching");
  assert.equal(app.window.document.activeElement.id, "order-search", "typing keeps the focus");
  await app.click('[data-act="clearSearch"]');
  assert.equal(app.$("order-search").value, "");
  assert.equal(app.$("order-filters").hidden, false);
});

test("[TC-REP-03-01] report sections fold and unfold one by one or all at once, and stay as left", async () => {
  const app = await openApp();
  await app.click('[data-act="demoLoad"]');
  await app.waitFor(() => app.window.document.querySelectorAll(".stub").length > 3, 6000);
  await app.go("#/reportes");
  const folds = () => [...app.window.document.querySelectorAll("details[data-fold]")];
  assert.ok(folds().length >= 4, "three sections plus products with several presentations");
  assert.ok(
    folds()
      .filter((d) => d.classList.contains("report-section"))
      .every((d) => d.open)
  );
  await app.click('[data-act="reportExpand"][data-v="0"]');
  assert.ok(folds().every((d) => !d.open));
  await app.click('[data-act="reportExpand"][data-v="1"]');
  assert.ok(folds().every((d) => d.open));
  const day = app.window.document.querySelector('details[data-fold="day"]');
  day.open = false;
  day.dispatchEvent(new app.window.Event("toggle"));
  await app.go("#/pedidos");
  await app.go("#/reportes");
  assert.equal(app.window.document.querySelector('details[data-fold="day"]').open, false);
  assert.equal(app.window.document.querySelector('details[data-fold="product"]').open, true);
});

test("[TC-EXP-04-01] Ajustes exports everything as a ZIP of CSVs and as a PostgreSQL script", async () => {
  const app = await openApp();
  await app.click('[data-act="demoLoad"]');
  await app.waitFor(() => app.window.document.querySelectorAll(".stub").length > 3, 6000);
  await app.go("#/ajustes");
  await app.click('[data-act="exportCsv"]');
  await app.waitFor(() => app.downloads.length === 1);
  assert.match(app.downloads[0].name, /^notas-exportacion-\d{4}-\d{2}-\d{2}\.zip$/);
  const bytes = new Uint8Array(await app.downloads[0].blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  await app.waitFor(() => app.window.document.querySelector('[data-act="exportSql"]'));
  await app.click('[data-act="exportSql"]');
  await app.waitFor(() => app.downloads.length === 2);
  const sql = await app.downloadText(1);
  assert.match(sql, /create schema if not exists notas_export;/);
  assert.match(sql, /insert into notas_export\.renglones/);
  assert.match(app.text(), /Espacio usado/);
});
