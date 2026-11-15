/*
 * Purpose: Tests for the IndexedDB device store (backend/store.idb.js) and the choice of storage (backend/store.local.js).
 * Covers: documents and the pending mark saved together and still there after reopening, data moved once from localStorage with the old
 * copy kept, fail-closed on unreadable data and on moved data that cannot be opened, and a failed save undone in memory.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { IDBFactory } = require("fake-indexeddb");
const { loadModules, fakeStorage } = require("./helpers/load_modules");

function load(indexedDB, localStorage = fakeStorage()) {
  return { NT: loadModules(["js/log.js", "backend/store.local.js", "backend/store.idb.js"], { indexedDB, localStorage }), localStorage };
}

test("[TC-SYN-08-01] IndexedDB keeps documents and internal state written together, across reopening", async () => {
  const idb = new IDBFactory();
  const { NT } = load(idb);
  const hooks = { afterWrite: (data) => (data["_sync/state"] = { outbox: { "orders/1": { at: "x" } } }) };
  const first = await NT.openDeviceStore({ storageKey: "k" }, hooks);
  assert.equal(first.engine, "indexeddb");
  await first.store.batch([
    { path: "orders/1", value: { folio: "A-0001" } },
    { path: "history/1", value: { path: "orders/1" } },
  ]);
  const again = await load(idb).NT.openDeviceStore({ storageKey: "k" });
  assert.equal(again.store.get("orders/1").folio, "A-0001");
  assert.deepEqual(again.core.get("_sync/state"), { outbox: { "orders/1": { at: "x" } } });
  await again.store.batch([{ path: "orders/1", value: null }]);
  const third = await load(idb).NT.openDeviceStore({ storageKey: "k" });
  assert.equal(third.store.get("orders/1"), undefined);
});

test("[TC-SYN-08-02] data saved in localStorage moves to IndexedDB once; the old copy is kept untouched", async () => {
  const idb = new IDBFactory();
  const saved = JSON.stringify({ "orders/1": { folio: "A-0001" }, "_sync/state": { outbox: {} } });
  const { NT, localStorage } = load(idb, fakeStorage({ k: saved }));
  const opened = await NT.openDeviceStore({ storageKey: "k" });
  assert.equal(opened.engine, "indexeddb");
  assert.equal(opened.store.get("orders/1").folio, "A-0001");
  assert.equal(localStorage.getItem("k"), saved);
  assert.equal(localStorage.getItem("k:moved"), "indexeddb");
  await opened.store.set("orders/2", { folio: "A-0002" });
  // Reopening reads IndexedDB, not the old copy.
  const again = await load(idb, localStorage).NT.openDeviceStore({ storageKey: "k" });
  assert.equal(again.store.get("orders/2").folio, "A-0002");
  assert.ok(again.core.get("_meta/moved"));
});

test("[TC-SYN-08-03] unreadable localStorage data is never moved nor overwritten", async () => {
  const { NT, localStorage } = load(new IDBFactory(), fakeStorage({ k: "{bad" }));
  const opened = await NT.openDeviceStore({ storageKey: "k" });
  assert.equal(opened.corrupt, true);
  assert.equal(opened.raw, "{bad");
  assert.equal(localStorage.getItem("k:moved"), null);
});

test("[TC-SYN-08-04] after moving to IndexedDB, a browser without it stops instead of showing the old copy", async () => {
  const storage = fakeStorage({ k: "{}", "k:moved": "indexeddb" });
  const { NT } = load(undefined, storage);
  assert.deepEqual(await NT.openDeviceStore({ storageKey: "k" }), { failed: "indexeddb" });
  // Never moved: localStorage is used as before.
  const plain = load(undefined, fakeStorage()).NT;
  const opened = await plain.openDeviceStore({ storageKey: "k" });
  assert.equal(opened.engine, "localStorage");
});

test("[TC-SYN-08-05] a save that fails is undone in memory, rejected, and the next write still works", async () => {
  const NT = loadModules(["js/log.js", "backend/store.local.js"], {});
  let fail = true;
  const saved = [];
  const { store } = NT.openStoreCore(
    { "orders/1": { folio: "A" } },
    (all, puts) => (fail ? Promise.reject(new Error("QuotaExceededError")) : (saved.push(Object.keys(puts)), Promise.resolve())),
    {}
  );
  const seen = [];
  store.onChange((c) => seen.push(c));
  await assert.rejects(
    store.batch([
      { path: "orders/1", value: { folio: "B" } },
      { path: "orders/2", value: { folio: "C" } },
    ]),
    /Quota/
  );
  assert.equal(store.get("orders/1").folio, "A");
  assert.equal(store.get("orders/2"), undefined);
  assert.equal(seen.length, 0, "nobody is told about a change that was not saved");
  fail = false;
  await store.set("orders/3", { folio: "D" });
  assert.deepEqual(saved, [["orders/3"]]);
});
