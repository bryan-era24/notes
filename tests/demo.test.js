/*
 * Purpose: Tests for the demonstration data (js/demo.js).
 * Covers: loading a complete, valid data set around today, production and reports working on it, and removing exactly the demo documents.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModules, fakeStorage } = require("./helpers/load_modules");

test("[TC-SYS-01-01] demo data loads, feeds production and reports, and can be removed", async () => {
  const NT = loadModules(["js/log.js", "js/logic.js", "backend/store.local.js", "js/repo.js", "js/demo.js"], {
    localStorage: fakeStorage(),
  });
  const { store } = NT.openLocalStore({ storageKey: "t" });
  let n = 0;
  const env = {
    now: () => new Date(Date.parse("2026-11-15T18:00:00Z") + n * 1000),
    today: () => "2026-11-15",
    uuid: () => "id" + ++n,
    by: () => "lite",
    deviceCode: () => "A",
  };
  const repo = NT.repo.create(store, env);
  await repo.saveCustomer(null, { name: "Cliente real" });
  const count = await NT.demo.load(repo, store, "2026-11-15");
  assert.equal(count, 10);
  const orders = Object.fromEntries(store.list("orders").map((d) => [d.id, d.data]));
  const notes = store.list("notes").map((d) => d.data);
  const payments = store.list("payments").map((d) => d.data);
  assert.ok(notes.every((x) => NT.logic.validateNote(x).length === 0));
  const prod = NT.logic.production(orders, notes, NT.logic.weekRange("2026-11-15"));
  assert.ok(prod.length >= 3);
  assert.ok(prod.some((r) => r.grams > 0));
  const rep = NT.logic.report(orders, notes, payments, { from: "2026-11-01", to: "2026-11-30" });
  assert.ok(rep.sold > 0 && rep.collected > 0 && rep.pending > 0);
  const removed = await NT.demo.remove(repo, store);
  assert.ok(removed > 20);
  assert.equal(NT.demo.paths(store).length, 0);
  assert.equal(store.list("customers").filter((d) => !d.data.deletedAt).length, 1);
});
