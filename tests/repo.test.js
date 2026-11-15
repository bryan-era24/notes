/*
 * Purpose: Tests for js/repo.js, the only place that changes data.
 * Covers: history written in the same batch as each change, folios per device, note numbering, frozen prices, informative stages,
 * payments and balances, soft delete, restore from history, and validation refusals that save nothing.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModules, fakeStorage } = require("./helpers/load_modules");

function setup(code = "A") {
  const localStorage = fakeStorage();
  const NT = loadModules(["js/log.js", "js/logic.js", "backend/store.local.js", "js/repo.js"], { localStorage });
  const { store } = NT.openLocalStore({ storageKey: "t" });
  let n = 0,
    clock = Date.parse("2026-11-15T18:00:00Z");
  const env = {
    now: () => new Date((clock += 1000)),
    today: () => "2026-11-15",
    uuid: () => "id" + ++n,
    by: () => "lite",
    deviceCode: () => code,
  };
  const batches = [];
  store.onChange((c) => batches.push(c));
  return { NT, store, repo: NT.repo.create(store, env), batches, localStorage };
}
const product = {
  name: "Palomitas de mantequilla",
  presentations: [
    { label: "250 g", grams: 250, price: 3500 },
    { label: "1 kg", grams: 1000, price: 12000 },
  ],
};

test("[TC-CAT-02-01] saving a product writes it and its history entry in one batch", async () => {
  const { store, repo, batches } = setup();
  const id = await repo.saveProduct(null, product);
  assert.equal(batches.length, 1);
  assert.deepEqual(
    batches[0].map((c) => c.path.split("/")[0]),
    ["products", "history"]
  );
  const saved = store.get("products/" + id);
  assert.equal(saved.presentations.length, 2);
  assert.ok(saved.presentations[0].id);
  assert.equal(saved.updatedBy, "lite");
  const h = store.list("history")[0].data;
  assert.equal(h.action, "create");
  assert.equal(h.before, null);
});

test("[TC-CAT-02-02] an invalid product is refused and nothing is saved", async () => {
  const { store, repo } = setup();
  await assert.rejects(
    repo.saveProduct(null, { name: "", presentations: [] }),
    (e) => e.code === "invalid" && e.problems.includes("product.name")
  );
  assert.equal(store.isEmpty(), true);
});

test("[TC-PED-01-02] orders get consecutive folios of this device, saved with the counter", async () => {
  const { store, repo } = setup("b");
  const a = await repo.createOrder({ customerName: "Ana", deliveryDate: "2026-11-20" });
  const b = await repo.createOrder({});
  assert.equal(store.get("orders/" + a).folio, "B-0001");
  assert.equal(store.get("orders/" + b).folio, "B-0002");
  assert.equal(store.get("counters/B").next, 3);
  assert.equal(store.get("orders/" + a).localDate, "2026-11-15");
});

test("[TC-NOT-03-02] notes are numbered within their order and keep the price they were made with", async () => {
  const { NT, store, repo } = setup();
  const pid = await repo.saveProduct(null, product);
  const p = store.get("products/" + pid);
  const o = await repo.createOrder({ customerName: "Ana" });
  const line = NT.logic.lineFrom(pid, p, p.presentations[0], 25);
  const n1 = await repo.saveNote(null, { orderId: o, lines: [line] });
  const n2 = await repo.saveNote(null, { orderId: o, lines: [line] });
  assert.equal(store.get("notes/" + n1).number, 1);
  assert.equal(store.get("notes/" + n2).number, 2);
  assert.equal(store.get("notes/" + n1).customerName, "Ana");
  assert.equal(store.get("notes/" + n1).orderDate, "2026-11-15");
  p.presentations[0].price = 9900;
  await repo.saveProduct(pid, p);
  assert.equal(store.get("notes/" + n1).lines[0].unitPrice, 3500);
  // Editing keeps the number.
  await repo.saveNote(n1, { orderId: o, lines: [Object.assign({}, line, { qty: 30 })] });
  assert.equal(store.get("notes/" + n1).number, 1);
  assert.equal(store.get("notes/" + n1).lines[0].qty, 30);
});

test("[TC-NOT-04-01] stages never block: any stage can follow any other, each change in history", async () => {
  const { store, repo } = setup();
  const o = await repo.createOrder({});
  await repo.setStage("orders/" + o, "delivered");
  await repo.setStage("orders/" + o, "ordered");
  await repo.setStage("orders/" + o, "received_signed");
  assert.equal(store.get("orders/" + o).stage, "received_signed");
  const stages = repo.historyOf(["orders/" + o]).filter((h) => h.action === "stage");
  assert.equal(stages.length, 3);
  await assert.rejects(repo.setStage("orders/" + o, "lost"));
});

test("[TC-PAG-03-01] partial payments add up to the balance", async () => {
  const { NT, store, repo } = setup();
  const o = await repo.createOrder({});
  await repo.saveNote(null, {
    orderId: o,
    lines: [{ productId: "p", presentationId: "a", productName: "P", presentationLabel: "1", grams: null, unitPrice: 10000, qty: 3 }],
  });
  await repo.addPayment({ orderId: o, amount: 10000, method: "cash" });
  await repo.addPayment({ orderId: o, amount: 5000, method: "transfer" });
  const notes = store.list("notes").map((d) => d.data);
  const pays = store.list("payments").map((d) => d.data);
  assert.deepEqual(NT.logic.orderSummary(notes, pays), { total: 30000, paid: 15000, balance: 15000, status: "partial" });
  await assert.rejects(repo.addPayment({ orderId: o, amount: 0, method: "cash" }));
  await assert.rejects(repo.addPayment({ orderId: "nope", amount: 100, method: "cash" }));
});

test("[TC-SYN-03-01] delete is soft and can be undone from history", async () => {
  const { store, repo } = setup();
  const c = await repo.saveCustomer(null, { name: "Ana" });
  await repo.remove("customers/" + c);
  assert.ok(store.get("customers/" + c).deletedAt);
  const del = repo.historyOf(["customers/" + c]).find((h) => h.action === "delete");
  await repo.restore(del.id, "before");
  assert.equal(store.get("customers/" + c).deletedAt, undefined);
  assert.equal(store.get("customers/" + c).name, "Ana");
});

test("[TC-SYN-03-02] an overwritten note version can be restored from history", async () => {
  const { store, repo } = setup();
  const o = await repo.createOrder({});
  const line = { productId: "p", presentationId: "a", productName: "P", presentationLabel: "1", grams: null, unitPrice: 100, qty: 5 };
  const n = await repo.saveNote(null, { orderId: o, lines: [line] });
  await repo.saveNote(n, { orderId: o, lines: [Object.assign({}, line, { qty: 1 })] });
  const upd = repo.historyOf(["notes/" + n]).find((h) => h.action === "update");
  await repo.restore(upd.id, "before");
  assert.equal(store.get("notes/" + n).lines[0].qty, 5);
});

test("[TC-SYN-03-03] settings are kept and merged", async () => {
  const { repo } = setup();
  await repo.saveSettings({ name: "Palomitas Lupita" });
  await repo.saveSettings({ phone: "33" });
  assert.equal(repo.settings().name, "Palomitas Lupita");
  assert.equal(repo.settings().phone, "33");
});
