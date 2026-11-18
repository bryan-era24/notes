/*
 * Purpose: Regressions found on an iPhone with Safari, and the payment and catalog behaviour asked for after trying the app.
 * Covers: the product form saves what the fields show even when the keyboard changed them without an input event; "Cambiar cliente/
 * fecha" opens where it was tapped; the customer picker (list of names, "Sin nombre", new customer) when creating and when editing;
 * picking a date does not redraw the date field; paying more than the balance shows the change and records only what is owed, or leaves
 * it in favour of the customer; the letter PDF file and its name; archiving, deleting an unused product, merging a duplicate and
 * renaming; diagnostics carry the screen, the button and the version.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { openApp } = require("./helpers/open_app");

/** Sets a field the way an iPhone keyboard suggestion can: the value changes but no input event fires. */
function setSilently(app, selector, value) {
  app.window.document.querySelector(selector).value = value;
}

test("[TC-CAT-05-01] the product form saves what the fields show, even without input events", async () => {
  const app = await openApp();
  await app.go("#/producto/nuevo");
  setSilently(app, "#pf-name", "Palomitas Naturales");
  setSilently(app, "#pl-0", "Bolsa chica");
  setSilently(app, "#pp-0", "25");
  await app.click('[data-act="addPresentation"]');
  // The first presentation survived the redraw that adding a second one causes.
  assert.equal(app.window.document.querySelector("#pf-name").value, "Palomitas Naturales");
  assert.equal(app.window.document.querySelector("#pl-0").value, "Bolsa chica");
  setSilently(app, "#pl-1", "Bolsa grande");
  setSilently(app, "#pp-1", "60");
  app.submit("product-form");
  await app.waitFor(() => /#\/catalogo/.test(app.window.location.hash));
  const product = Object.values(app.stored().docs || app.stored()).find((d) => d && d.name === "Palomitas Naturales");
  assert.ok(product, "the product was saved");
  assert.deepEqual(
    product.presentations.map((p) => [p.label, p.price]),
    [
      ["Bolsa chica", 2500],
      ["Bolsa grande", 6000],
    ]
  );
});

/** Loads the demo data and opens the first order of the list. */
async function openDemoOrder(app) {
  await app.click('[data-act="demoLoad"]');
  await app.waitFor(() => app.window.document.querySelectorAll(".stub").length > 3);
  await app.click(".stub");
  await app.waitFor(() => app.window.document.querySelector('[data-act="openEditOrder"]'));
}
const names = (app, key) =>
  [...app.window.document.querySelectorAll("#picker-" + key + " [data-act^='picker']")]
    .filter((b) => b.getAttribute("data-act") !== "pickerToggle")
    .map((b) => b.textContent.trim());

test("[TC-PED-06-01] 'Cambiar cliente/fecha' opens right where it was tapped and takes the focus", async () => {
  const app = await openApp();
  await openDemoOrder(app);
  const button = app.window.document.querySelector('[data-act="openEditOrder"]');
  await app.click(button);
  const form = app.window.document.querySelector('[data-form="editOrder"]');
  assert.ok(form, "the form is shown");
  // It replaces the button at the end of the order, after the history, instead of opening near the print buttons at the top.
  const history = [...app.window.document.querySelectorAll("details.foldable")].pop();
  assert.ok(history.compareDocumentPosition(form) & app.window.Node.DOCUMENT_POSITION_FOLLOWING, "form after the history");
  assert.ok(!app.window.document.querySelector('[data-act="openEditOrder"]'), "the button gave its place to the form");
  assert.ok(form.contains(app.window.document.activeElement), "focus moved into the form");
});

test("[TC-PED-06-02] new order: the customer picker lists existing names, offers 'Sin nombre' and a new customer", async () => {
  const app = await openApp();
  await app.click('[data-act="demoLoad"]');
  await app.waitFor(() => app.window.document.querySelectorAll(".stub").length > 3);
  await app.go("#/nuevo");
  assert.ok(app.window.document.querySelector("#picker-draft-q"), "the list is open on a new order");
  assert.equal(names(app, "draft")[0], "Sin nombre");
  assert.ok(names(app, "draft").length > 3, "existing customers are listed");
  await app.type("#picker-draft-q", "esc");
  assert.deepEqual(names(app, "draft"), ["Sin nombre", "Nuevo cliente: «esc»", "Escuela Primaria Ejemplo"]);
  await app.click(app.byText("#picker-draft [data-act='pickerChoose']", /Escuela/));
  assert.ok(!app.window.document.querySelector("#picker-draft-q"), "the list closes after choosing");
  assert.match(app.window.document.querySelector("#picker-draft .picker-toggle").textContent, /Escuela Primaria Ejemplo/);
  await app.click("#picker-draft .picker-toggle");
  await app.click(app.byText("#picker-draft [data-act='pickerChoose']", /^Sin nombre$/));
  assert.match(app.window.document.querySelector("#picker-draft .picker-toggle").textContent, /Sin nombre/);
});

test("[TC-PED-06-03] editing an order: pick an existing customer or 'Sin nombre' and change the date", async () => {
  const app = await openApp();
  await openDemoOrder(app);
  const orderId = decodeURIComponent(app.window.location.hash.split("/")[2]);
  await app.click('[data-act="openEditOrder"]');
  await app.click("#picker-edit .picker-toggle");
  await app.type("#picker-edit-q", "café");
  await app.click(app.byText("#picker-edit [data-act='pickerChoose']", /Café de Prueba/));
  await app.type("#eo-date", "2026-12-24");
  app.window.document
    .querySelector('[data-form="editOrder"]')
    .dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await app.waitFor(() => !app.window.document.querySelector('[data-form="editOrder"]'));
  let order = app.stored()["orders/" + orderId];
  assert.equal(order.customerName, "Café de Prueba");
  assert.ok(order.customerId, "linked to the existing customer");
  assert.equal(order.deliveryDate, "2026-12-24");
  await app.click('[data-act="openEditOrder"]');
  await app.click("#picker-edit .picker-toggle");
  await app.click(app.byText("#picker-edit [data-act='pickerChoose']", /^Sin nombre$/));
  app.window.document
    .querySelector('[data-form="editOrder"]')
    .dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await app.waitFor(() => !app.window.document.querySelector('[data-form="editOrder"]'));
  order = app.stored()["orders/" + orderId];
  assert.equal(order.customerName, "");
  assert.equal(order.customerId, null);
});

test("[TC-PED-06-04] picking another date keeps the date field in place (the iPhone calendar stays open)", async () => {
  const app = await openApp();
  await app.go("#/nuevo");
  const field = app.window.document.querySelector("#other-date");
  await app.type(field, "2026-12-31");
  assert.equal(app.window.document.querySelector("#other-date"), field, "the same field, not redrawn");
  const pressedChips = [...app.window.document.querySelectorAll('[data-act="draftDate"][aria-pressed="true"]')];
  assert.deepEqual(pressedChips, [], "no quick-date chip stays chosen");
  await app.click('[data-act="draftNext"]');
  assert.match(app.text(), /31 de diciembre/);
});

/** A product of $80 and an order of one piece, opened. Returns the order id. */
async function orderOf80(app) {
  await app.go("#/producto/nuevo");
  await app.type("#pf-name", "Palomitas");
  await app.type("#pl-0", "Bolsa");
  await app.type("#pp-0", "80");
  app.submit("product-form");
  await app.waitFor(() => /#\/catalogo/.test(app.window.location.hash));
  await app.go("#/nuevo");
  await app.click('[data-act="draftNext"]');
  await app.click(app.byText('[data-act="openProduct"]', /Palomitas/));
  await app.click('[data-act="saveDraft"]');
  await app.waitFor(() => /#\/pedido\//.test(app.window.location.hash));
  return decodeURIComponent(app.window.location.hash.split("/")[2]);
}
const payments = (app) => Object.values(app.stored()).filter((d) => d && d.orderId && typeof d.amount === "number" && !d.deletedAt);

test("[TC-PAG-05-03] receiving $500 for $80 shows $420 of change and records only the $80 owed", async () => {
  const app = await openApp();
  await orderOf80(app);
  await app.click('[data-act="openPayment"]');
  await app.type("#pay-amount", "500");
  assert.match(app.$("pay-change").textContent, /Cambio a entregar: \$420\.00/);
  assert.ok(!app.$("pay-over").hidden, "the overpay choice is shown");
  app.window.document
    .querySelector('[data-form="payment"]')
    .dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await app.waitFor(() => payments(app).length === 1);
  const p = payments(app)[0];
  assert.equal(p.amount, 8000);
  assert.match(p.comment, /Recibido \$500\.00.*cambio \$420\.00/);
  await app.waitFor(() => /Pagado/.test(app.text()));
  assert.doesNotMatch(app.text(), /A favor del cliente/);
});

test("[TC-PAG-05-04] 'Dejar a favor' records all $500 and the order shows $420 in favour of the customer", async () => {
  const app = await openApp();
  await orderOf80(app);
  await app.click('[data-act="openPayment"]');
  await app.type("#pay-amount", "500");
  const credit = app.window.document.querySelector('#pay-over button[value="credit"]');
  assert.match(credit.textContent, /Dejar \$420\.00 a favor/);
  const form = app.window.document.querySelector('[data-form="payment"]');
  const ev = new app.window.Event("submit", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "submitter", { value: credit });
  form.dispatchEvent(ev);
  await app.waitFor(() => payments(app).length === 1);
  assert.equal(payments(app)[0].amount, 50000);
  await app.waitFor(() => /A favor del cliente/.test(app.text()));
  assert.match(app.window.document.querySelector(".sums .balance").textContent, /A favor del cliente\s*\$420\.00/);
  assert.match(app.window.document.querySelector(".pill.pay-credit").textContent, /Saldo a favor/);
});

test("[TC-PDF-02-01] 'PDF' saves the note as a PDF named customer, folio and delivery date", async () => {
  const app = await openApp();
  await openDemoOrder(app);
  const orderId = decodeURIComponent(app.window.location.hash.split("/")[2]);
  const order = app.stored()["orders/" + orderId];
  await app.click('[data-act="pdf"]');
  await app.waitFor(() => app.downloads.length === 1);
  const file = app.downloads[0];
  assert.equal(file.name, (order.customerName || "Sin nombre") + " " + order.folio + " " + order.deliveryDate + ".pdf");
  const head = Buffer.from(await file.blob.arrayBuffer())
    .toString("latin1")
    .slice(0, 8);
  assert.equal(head, "%PDF-1.4");
});

test("[TC-PDF-02-02] printing the letter names the page after the file, so 'Guardar como PDF' uses that name", async () => {
  const app = await openApp();
  await openDemoOrder(app);
  const orderId = decodeURIComponent(app.window.location.hash.split("/")[2]);
  const order = app.stored()["orders/" + orderId];
  const before = app.window.document.title;
  await app.click('[data-act="printLetter"]');
  assert.equal(app.prints.length, 1);
  assert.equal(app.prints[0].title, (order.customerName || "Sin nombre") + " " + order.folio + " " + order.deliveryDate);
  app.window.dispatchEvent(new app.window.Event("afterprint"));
  assert.equal(app.window.document.title, before, "the title comes back after printing");
});

test("[TC-PDF-02-03] on an iPhone, 'Imprimir hoja' opens the share sheet with the PDF instead of Safari's print dialog", async () => {
  const shared = [];
  const app = await openApp({
    setup(window) {
      Object.defineProperty(window.navigator, "userAgent", {
        value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari",
        configurable: true,
      });
      window.navigator.canShare = (data) => !!(data && data.files && data.files.length);
      window.navigator.share = (data) => {
        shared.push(data);
        return Promise.resolve();
      };
    },
  });
  await openDemoOrder(app);
  await app.click('[data-act="printLetter"]');
  await app.waitFor(() => shared.length === 1);
  assert.equal(app.prints.length, 0, "Safari's print dialog is not used");
  assert.match(shared[0].files[0].name, / A-\d{4} .*\.pdf$/);
  assert.equal(shared[0].files[0].type, "application/pdf");
});

async function newProduct(app, name, label, price) {
  await app.go("#/producto/nuevo");
  await app.type("#pf-name", name);
  await app.type("#pl-0", label);
  await app.type("#pp-0", price);
  app.submit("product-form");
  await app.waitFor(() => /#\/catalogo/.test(app.window.location.hash));
  return Object.entries(app.stored())
    .find(([k, d]) => k.startsWith("products/") && d.name === name)[0]
    .split("/")[1];
}

test("[TC-CAT-06-04] Catálogo: archive and restore, delete an unused product, merge a used duplicate", async () => {
  const app = await openApp();
  const good = await newProduct(app, "Palomitas Naturales", "Bolsa", "25");
  const dup = await newProduct(app, "Palomitas Natural", "Bolsa", "25");
  const spare = await newProduct(app, "Prueba borrar", "Bolsa", "10");
  // A note that uses the duplicate.
  await app.go("#/nuevo");
  await app.click('[data-act="draftNext"]');
  await app.click(app.byText('[data-act="openProduct"]', /^Palomitas Natural$/));
  await app.click('[data-act="saveDraft"]');
  await app.waitFor(() => /#\/pedido\//.test(app.window.location.hash));

  // Unused: can be deleted (two taps).
  await app.go("#/producto/" + spare);
  await app.click('[data-act="confirm"][data-key="product"]');
  await app.click('[data-act="deleteProduct"]');
  await app.waitFor(() => app.stored()["products/" + spare].deletedAt);

  // Used: no delete button, an explanation, archive and merge instead.
  await app.go("#/producto/" + dup);
  assert.ok(!app.window.document.querySelector('[data-key="product"]'), "no delete for a product in use");
  assert.match(app.text(), /Se usa en 1 nota/);
  await app.click('[data-act="archiveProduct"]');
  await app.waitFor(() => app.stored()["products/" + dup].active === false);
  await app.go("#/catalogo");
  const archived = app.window.document.querySelector('[data-fold="archived"]');
  assert.ok(archived && !archived.open, "Archivados is a folded section");
  assert.match(archived.textContent, /Archivados \(1\)/);
  assert.match(archived.textContent, /Palomitas Natural/);
  await app.click(archived.querySelector('[data-act="restoreProduct"]'));
  await app.waitFor(() => app.stored()["products/" + dup].active === true);

  // Merge into the right product, with a confirmation.
  await app.go("#/producto/" + dup);
  await app.click('[data-act="mergeStart"]');
  await app.click(app.byText('[data-act="mergePick"]', /Palomitas Naturales/));
  assert.match(app.text(), /1 nota pasará a «Palomitas Naturales»/);
  await app.click('[data-act="mergeConfirm"]');
  await app.waitFor(() => app.stored()["products/" + dup].active === false);
  const note = Object.values(app.stored()).find((d) => d && d.lines && d.lines.length);
  assert.equal(note.lines[0].productId, good);
});

test("[TC-NFR-08-01] the diagnostics say the version, the browser, the screen and the button, never the typed values", async () => {
  const app = await openApp();
  app.window.NT.log.setLevel("debug");
  await app.go("#/producto/nuevo");
  await app.type("#pf-name", "Palomitas secretas");
  await app.type("#pp-0", "abc");
  app.submit("product-form");
  await app.wait(60);
  const dump = app.window.NT.log.dump();
  const first = dump.split("\n")[0];
  assert.match(first, /^Notas \d+\.\d+\.\d+ · /, "a header line with the version");
  assert.match(first, /navegador: \w+/);
  const failed = dump.split("\n").find((l) => l.includes("ui.action_failed"));
  assert.match(failed, /"screen":"producto"/);
  assert.match(failed, /"action":"product"/);
  assert.match(failed, /"problems":\["presentation\.label","presentation\.price"\]/);
  assert.doesNotMatch(dump, /secretas|abc/);
});

const iphone = (standalone) => (window) => {
  Object.defineProperty(window.navigator, "userAgent", {
    value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari",
    configurable: true,
  });
  Object.defineProperty(window.navigator, "standalone", { value: standalone, configurable: true });
};

test("[TC-NFR-08-02] in a Safari tab Pedidos asks to install the app; installed it does not; Ajustes has the steps for each device", async () => {
  const tab = await openApp({ setup: iphone(false) });
  assert.match(tab.text(), /Instala la app/);
  await tab.click('[data-act="installHide"]');
  assert.doesNotMatch(tab.text(), /Instala la app/, "it can be hidden");
  const installed = await openApp({ setup: iphone(true) });
  assert.doesNotMatch(installed.text(), /Instala la app/);
  await installed.go("#/ajustes");
  for (const device of [/iPhone o iPad/, /Android/, /computadora/]) assert.match(installed.text(), device);
});
