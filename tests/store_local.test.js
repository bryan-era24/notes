/*
 * Purpose: Tests for the local backend (backend/store.local.js), the contract every backend must meet.
 * Covers: get/list/set/batch, atomic batches, change listeners, blocked storage, fail-closed on corrupt data, export, and import (merge and replace).
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModules, fakeStorage } = require("./helpers/load_modules");

function open(initial, opts) {
  const localStorage = fakeStorage(initial, opts);
  const NT = loadModules(["js/log.js", "backend/store.local.js"], { localStorage });
  return { NT, localStorage, opened: NT.openLocalStore({ storageKey: "t" }) };
}

test("[TC-SYN-01-01] set, get and list documents; values are copies", async () => {
  const { opened } = open();
  const s = opened.store;
  assert.equal(s.isEmpty(), true);
  const doc = { name: "Palomitas", updatedAt: "1" };
  await s.set("products/b", doc);
  await s.set("products/a", { name: "Caramelo" });
  await s.set("customers/x", { name: "Ana" });
  doc.name = "changed";
  assert.equal(s.get("products/b").name, "Palomitas");
  assert.deepEqual(
    s.list("products").map((d) => d.id),
    ["a", "b"]
  );
  assert.equal(s.isEmpty(), false);
});

test("[TC-SYN-01-02] a batch is saved in one write and notifies once", async () => {
  const { opened, localStorage } = open();
  const calls = [];
  opened.store.onChange((c) => calls.push(c));
  await opened.store.batch([
    { path: "orders/1", value: { folio: "A-0001" } },
    { path: "settings/business", value: { nextFolio: 2 } },
    { path: "history/h1", value: { path: "orders/1" } },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 3);
  const saved = JSON.parse(localStorage.getItem("t"));
  assert.equal(saved["settings/business"].nextFolio, 2);
});

test("[TC-SYN-01-03] a failing batch changes nothing", async () => {
  const { opened } = open();
  await opened.store.set("orders/1", { folio: "A" });
  await assert.rejects(
    opened.store.batch([
      { path: "orders/1", value: { folio: "B" } },
      { path: "_internal", value: {} },
    ])
  );
  assert.equal(opened.store.get("orders/1").folio, "A");
});

test("[TC-SYN-01-04] blocked storage returns null; unreadable data fails closed and is left untouched", () => {
  assert.equal(open({}, { blocked: true }).opened, null);
  const { opened, localStorage } = open({ t: "{not json" });
  assert.equal(opened.corrupt, true);
  assert.equal(opened.raw, "{not json");
  assert.equal(localStorage.getItem("t"), "{not json");
});

test("[TC-SYN-02-01] export leaves out internal documents", async () => {
  const hooks = {
    afterWrite(data) {
      data["_sync/state"] = { outbox: {} };
    },
  };
  const localStorage = fakeStorage();
  const NT = loadModules(["js/log.js", "backend/store.local.js"], { localStorage });
  const { store } = NT.openLocalStore({ storageKey: "t" }, hooks);
  await store.set("orders/1", { a: 1 });
  assert.deepEqual(Object.keys(store.exportAll()), ["orders/1"]);
  assert.ok(JSON.parse(localStorage.getItem("t"))["_sync/state"]);
});

test("[TC-SYN-02-02] import merge adds new and newer documents only", async () => {
  const { opened } = open();
  const s = opened.store;
  await s.set("orders/1", { folio: "A", updatedAt: "2026-11-15T10:00:00Z" });
  await s.set("orders/2", { folio: "B", updatedAt: "2026-11-15T10:00:00Z" });
  const r = await s.importAll(
    {
      "orders/1": { folio: "A2", updatedAt: "2026-11-16T10:00:00Z" },
      "orders/2": { folio: "old", updatedAt: "2026-11-01T10:00:00Z" },
      "orders/3": { folio: "C", updatedAt: "2026-11-01T10:00:00Z" },
    },
    "merge"
  );
  assert.deepEqual(r, { added: 1, updated: 1, kept: 1 });
  assert.equal(s.get("orders/1").folio, "A2");
  assert.equal(s.get("orders/2").folio, "B");
});

test("[TC-SYN-02-03] import replace keeps a copy of what was on the device", async () => {
  const { opened, localStorage } = open();
  const s = opened.store;
  await s.set("orders/1", { folio: "A" });
  await s.importAll({ "orders/9": { folio: "Z" } }, "replace");
  assert.deepEqual(Object.keys(s.exportAll()), ["orders/9"]);
  const saved = JSON.parse(localStorage.getItem("t"));
  assert.equal(saved["_import/before"].documents["orders/1"].folio, "A");
});
