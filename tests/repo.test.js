/*
 * Purpose: Tests for js/repo.js, the only place that changes data.
 * Covers: history written in the same batch as each change, folios per device, note numbering, frozen prices, informative stages,
 * payments and balances, soft delete, restore from history, validation refusals that save nothing, and deleting or merging products.
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
  assert.equal(h.changes, null, "a creation stores no copy: the document itself is the record");
});

test("[TC-SYN-03-04] history keeps only the fields that changed, and a reference to show", async () => {
  const { store, repo } = setup();
  const o = await repo.createOrder({ customerName: "Ana" });
  const line = { productId: "p", presentationId: "a", productName: "P", presentationLabel: "1", grams: null, unitPrice: 100, qty: 5 };
  const n = await repo.saveNote(null, { orderId: o, lines: [line] });
  await repo.setStage("notes/" + n, "delivered");
  const stage = repo.historyOf(["notes/" + n]).find((h) => h.action === "stage");
  assert.deepEqual(stage.changes, { stage: ["ordered", "delivered"] });
  assert.equal(stage.ref.number, 1);
  await repo.addPayment({ orderId: o, amount: 2500, method: "cash" });
  const pay = store
    .list("history")
    .map((d) => d.data)
    .find((h) => h.action === "payment");
  assert.equal(pay.ref.amount, 2500);
  assert.equal(pay.changes, null);
});

test("[TC-SYN-03-05] entries written in the older full-copy format can still be restored", async () => {
  const { store, repo } = setup();
  const c = await repo.saveCustomer(null, { name: "Ana" });
  const now = store.get("customers/" + c);
  await store.set("history/old1", {
    path: "customers/" + c,
    at: "2026-11-01T00:00:00Z",
    by: "x",
    action: "update",
    before: Object.assign({}, now, { name: "Ana vieja" }),
    after: now,
  });
  await repo.restore("old1");
  assert.equal(store.get("customers/" + c).name, "Ana vieja");
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
  await repo.restore(del.id);
  assert.equal(store.get("customers/" + c).deletedAt, undefined);
  assert.equal(store.get("customers/" + c).name, "Ana");
});

test("[TC-SYN-03-02] an overwritten note change can be undone from history", async () => {
  const { store, repo } = setup();
  const o = await repo.createOrder({});
  const line = { productId: "p", presentationId: "a", productName: "P", presentationLabel: "1", grams: null, unitPrice: 100, qty: 5 };
  const n = await repo.saveNote(null, { orderId: o, lines: [line] });
  await repo.saveNote(n, { orderId: o, lines: [Object.assign({}, line, { qty: 1 })] });
  const upd = repo.historyOf(["notes/" + n]).find((h) => h.action === "update");
  await repo.restore(upd.id);
  assert.equal(store.get("notes/" + n).lines[0].qty, 5);
});

test("[TC-SYN-03-03] settings are kept and merged", async () => {
  const { repo } = setup();
  await repo.saveSettings({ name: "Palomitas Lupita" });
  await repo.saveSettings({ phone: "33" });
  assert.equal(repo.settings().name, "Palomitas Lupita");
  assert.equal(repo.settings().phone, "33");
});

/** Two products that are really the same, and an order with a note that uses the duplicate. */
async function duplicates(repo, store) {
  const good = await repo.saveProduct(null, { name: "Palomitas Naturales", presentations: [{ label: "Bolsa", price: 2500 }] });
  const dup = await repo.saveProduct(null, {
    name: "Palomitas Natural",
    presentations: [
      { label: "bolsa ", price: 2400 },
      { label: "Charola", price: 9000 },
    ],
  });
  const p = store.get("products/" + dup);
  const o = await repo.createOrder({ customerName: "Ana" });
  const lines = p.presentations.map((x, i) => NT_line(p, dup, x, i + 2));
  const n = await repo.saveNote(null, { orderId: o, lines });
  return { good, dup, o, n };
}
function NT_line(p, pid, x, qty) {
  return { productId: pid, presentationId: x.id, productName: p.name, presentationLabel: x.label, qty, unitPrice: x.price };
}

test("[TC-CAT-06-01] a product never used in a note can be deleted; one already used is refused", async () => {
  const { store, repo } = setup();
  const unused = await repo.saveProduct(null, product);
  await repo.deleteProduct(unused);
  assert.ok(store.get("products/" + unused).deletedAt, "soft deleted");
  const { dup } = await duplicates(repo, store);
  await assert.rejects(repo.deleteProduct(dup), (e) => e.problems && e.problems.includes("product.inUse"));
  assert.ok(!store.get("products/" + dup).deletedAt);
  assert.equal(repo.productUse(dup), 1);
});

test("[TC-CAT-06-02] merging a duplicate moves its notes to the right product without changing amounts, and archives it", async () => {
  const { store, repo, batches } = setup();
  const { good, dup, n } = await duplicates(repo, store);
  const before = store.get("notes/" + n);
  batches.length = 0;
  await repo.mergeProduct(dup, good);
  assert.equal(batches.length, 1, "one batch: saved together or not at all");
  const note = store.get("notes/" + n);
  const target = store.get("products/" + good);
  assert.deepEqual(
    note.lines.map((l) => [l.productId, l.productName, l.presentationLabel, l.qty, l.unitPrice]),
    before.lines.map((l) => [good, "Palomitas Naturales", l.presentationLabel, l.qty, l.unitPrice])
  );
  // "bolsa " matches the target's "Bolsa"; "Charola" did not exist there and is added.
  assert.equal(note.lines[0].presentationId, target.presentations[0].id);
  assert.deepEqual(
    target.presentations.map((x) => x.label),
    ["Bolsa", "Charola"]
  );
  assert.equal(note.lines[1].presentationId, target.presentations[1].id);
  assert.equal(store.get("products/" + dup).active, false, "the duplicate is archived");
  const hist = batches[0].filter((c) => c.path.startsWith("history/")).length;
  assert.equal(hist, 3, "history for the note and both products");
  assert.equal(repo.productUse(dup), 0);
  assert.equal(repo.productUse(good), 1);
});

test("[TC-CAT-06-03] a product cannot be merged into itself or into one that does not exist", async () => {
  const { store, repo } = setup();
  const { good, dup } = await duplicates(repo, store);
  await assert.rejects(repo.mergeProduct(dup, dup));
  await assert.rejects(repo.mergeProduct(dup, "nope"));
  assert.equal(store.get("products/" + good).presentations.length, 1);
});
