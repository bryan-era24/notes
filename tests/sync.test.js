/*
 * Purpose: Prove that Connected mode never loses or duplicates a change and converges between devices, against the real schema.
 * Covers: sign-up, creating and joining a business, the first upload, a second device downloading, changes queued offline, last write wins,
 * pending documents never overwritten nor dropped, the cache window, a database not set up yet, the first-connection choice with a copy kept,
 * refused changes flagged, sending the same change twice, full-history reads, nothing personal in the diagnostics, and version numbers:
 * a change made on the latest version is kept whatever the clocks say, simultaneous changes to one document are kept aside and reported,
 * separate documents never conflict, and a database on schema version 2 asks to be updated.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModules, fakeStorage } = require("./helpers/load_modules");
const { createFakeSupabase, BASE, ANON_KEY } = require("./helpers/fake_supabase");

const FILES = [
  "js/config.js",
  "js/log.js",
  "js/logic.js",
  "js/prefs.js",
  "js/clock.js",
  "backend/remote.js",
  "backend/rows.js",
  "backend/sync.js",
  "backend/connection.js",
  "backend/store.js",
  "backend/store.local.js",
  "backend/store.synced.js",
  "js/repo.js",
];
const noop = () => 0;

function device(server, { today = "2026-11-15", code = "A" } = {}) {
  const storage = fakeStorage();
  const clock = { t: Date.parse(today + "T18:00:00Z"), today };
  const NT = loadModules(FILES, {
    localStorage: storage,
    fetch: server.fetch,
    setTimeout: noop,
    clearTimeout: noop,
    console: { log: noop },
  });
  let engine = null;
  const opened = NT.openLocalStore(NT.config, { afterWrite: (data, changes) => engine && engine.recordChanges(data, changes) });
  let n = 0;
  const env = {
    now: () => new Date((clock.t += 1000)),
    today: () => clock.today,
    uuid: () => code + "-id-" + ++n,
    by: () => "u",
    deviceCode: () => code,
  };
  const repo = NT.repo.create(opened.store, env);
  const sync = () => {
    engine = NT.sync.create(opened.core, NT.connection.remote(), {
      session: NT.connection.session,
      businessId: () => NT.connection.settings().businessId,
      windowDays: () => NT.connection.settings().windowDays,
      now: () => new Date((clock.t += 1000)),
      today: () => clock.today,
      setTimeout: noop,
      clearTimeout: noop,
    });
    opened.store.sync = engine.api;
    return engine.api;
  };
  return { NT, store: opened.store, core: opened.core, storage, repo, clock, sync };
}

async function owner(server, opts) {
  const d = device(server, opts);
  const r = await d.NT.connection.signIn(BASE, ANON_KEY, "ana@example.test", "secreto123", true);
  assert.ok(r.session);
  assert.equal(await d.NT.connection.checkSchema(), "ok");
  const m = await d.NT.connection.bootstrap("Palomitas de prueba");
  d.NT.connection.setConnected();
  return Object.assign(d, { membership: m });
}
async function member(server, code, opts) {
  const d = device(server, Object.assign({ code: "B" }, opts));
  await d.NT.connection.signIn(BASE, ANON_KEY, "luis@example.test", "secreto123", true);
  await d.NT.connection.join(code);
  d.NT.connection.setConnected();
  return d;
}
const line = {
  productId: "p",
  presentationId: "a",
  productName: "Palomitas",
  presentationLabel: "250 g",
  grams: 250,
  unitPrice: 3500,
  qty: 25,
};

test("[TC-SYN-04-01] first upload from the owner's device, then a second device joins and downloads", async () => {
  const server = await createFakeSupabase();
  const a = device(server);
  // Data made in Lite before connecting.
  const o = await a.repo.createOrder({ customerName: "Ana", deliveryDate: "2026-11-20" });
  await a.repo.saveNote(null, { orderId: o, lines: [line] });
  await a.NT.connection.signIn(BASE, ANON_KEY, "ana@example.test", "secreto123", true);
  const m = await a.NT.connection.bootstrap("Palomitas de prueba");
  a.NT.connection.setConnected();
  const st = await a.sync().syncNow();
  assert.equal(st.state, "idle");
  assert.equal(st.pending, 0);

  const b = await member(server, m.join_code);
  const sb = await b.sync().syncNow();
  assert.equal(sb.state, "idle");
  assert.equal(b.store.get("orders/" + o).folio, "A-0001");
  assert.equal(b.store.list("notes").length, 1);
  assert.equal(b.NT.connection.settings().businessName, "Palomitas de prueba");
});

test("[TC-SYN-04-02] changes made offline wait on the device and are sent once the connection is back", async () => {
  const server = await createFakeSupabase();
  const a = await owner(server);
  const s = a.sync();
  await s.syncNow();
  server.offline = true;
  const o = await a.repo.createOrder({ customerName: "Ana" });
  let st = await s.syncNow();
  assert.equal(st.state, "offline");
  assert.ok(st.pending >= 3);
  server.offline = false;
  st = await s.syncNow();
  assert.equal(st.state, "idle");
  assert.equal(st.pending, 0);
  const rows = await server.rows("documents", a.NT.connection.session().userId);
  assert.ok(rows.find((r) => r.path === "orders/" + o));
});

test("[TC-SYN-04-03] the same change sent twice is one row; the newest change wins across devices", async () => {
  const server = await createFakeSupabase();
  const a = await owner(server);
  const sa = a.sync();
  const c = await a.repo.saveCustomer(null, { name: "Ana" });
  await sa.syncNow();
  const b = await member(server, a.membership.join_code);
  const sb = b.sync();
  await sb.syncNow();
  // Both edit; B edits later.
  await a.repo.saveCustomer(c, { name: "Ana A" });
  b.clock.t = a.clock.t + 60000;
  await b.repo.saveCustomer(c, { name: "Ana B" });
  await sb.syncNow();
  await sa.syncNow(); // A's older change is skipped by the server and A pulls B's
  await sb.syncNow();
  assert.equal(a.store.get("customers/" + c).name, "Ana B");
  assert.equal(b.store.get("customers/" + c).name, "Ana B");
  const rows = (await server.rows("documents", a.NT.connection.session().userId)).filter((r) => r.path === "customers/" + c);
  assert.equal(rows.length, 1);
});

test("[TC-SYN-04-04] a pending document is never overwritten by pulled data", async () => {
  const server = await createFakeSupabase();
  const a = await owner(server);
  const sa = a.sync();
  const c = await a.repo.saveCustomer(null, { name: "Ana" });
  await sa.syncNow();
  const b = await member(server, a.membership.join_code);
  const sb = b.sync();
  await sb.syncNow();
  b.clock.t = a.clock.t + 60000;
  await b.repo.saveCustomer(c, { name: "From B" });
  await sb.syncNow();
  // A changes offline (older clock), then a pull must not overwrite the pending local edit before it is pushed.
  server.offline = true;
  await a.repo.saveCustomer(c, { name: "Pending on A" });
  await sa.syncNow();
  assert.equal(a.store.get("customers/" + c).name, "Pending on A");
  assert.equal(sa.status().pending > 0, true);
});

test("[TC-SYN-04-05] the window drops old documents only once they are on the server, never pending ones", async () => {
  const server = await createFakeSupabase();
  const a = await owner(server, { today: "2026-09-01" });
  const sa = a.sync();
  const old = await a.repo.createOrder({ deliveryDate: "2026-09-02" });
  await a.repo.saveNote(null, { orderId: old, lines: [line] });
  const old2 = await a.repo.createOrder({ deliveryDate: "2026-09-03" });
  const pid = await a.repo.saveProduct(null, { name: "Palomitas", presentations: [{ label: "250 g", grams: 250, price: 3500 }] });
  await sa.syncNow();
  // Two and a half months later the second old order is edited while offline: it is pending.
  a.clock.today = "2026-11-15";
  server.offline = true;
  await a.repo.setStage("orders/" + old2, "received_signed");
  await sa.syncNow();
  server.offline = false;
  const recent = await a.repo.createOrder({ deliveryDate: "2026-11-16" });
  const state = JSON.parse(a.storage.getItem("notas:v1"))["_sync/state"];
  assert.ok(state.outbox["orders/" + old2], "edited old order is pending");
  await sa.syncNow();
  assert.equal(a.store.get("orders/" + old), undefined, "old synced order dropped");
  assert.equal(a.store.list("notes").length, 0, "its note dropped with it");
  assert.equal(a.store.get("orders/" + old2), undefined, "dropped once its change reached the server");
  assert.ok(a.store.get("orders/" + recent), "recent order kept");
  assert.ok(a.store.get("products/" + pid), "catalog always kept");
  const rows = await server.rows("documents", a.NT.connection.session().userId);
  const row = rows.find((r) => r.path === "orders/" + old2);
  assert.equal(row.data.stage, "received_signed");
});

test("[TC-SYN-04-06] a pending old document survives a pull that cannot send it", async () => {
  const server = await createFakeSupabase();
  const a = await owner(server, { today: "2026-09-01" });
  const sa = a.sync();
  const old = await a.repo.createOrder({ deliveryDate: "2026-09-02" });
  await sa.syncNow();
  a.clock.today = "2026-11-15";
  // Mark the old order as a change the server refused: it stays pending until edited again.
  const raw = JSON.parse(a.storage.getItem("notas:v1"));
  raw["_sync/state"].outbox["orders/" + old] = { at: "2026-11-15T00:00:00Z", failed: true };
  a.storage.setItem("notas:v1", JSON.stringify(raw));
  // Reopen the device's store from storage so the flagged entry is seen.
  const NT = a.NT;
  const reopened = NT.openLocalStore(NT.config, {});
  const engine = NT.sync.create(reopened.core, NT.connection.remote(), {
    session: NT.connection.session,
    businessId: () => NT.connection.settings().businessId,
    windowDays: () => 30,
    now: () => new Date(),
    today: () => "2026-11-15",
    setTimeout: noop,
    clearTimeout: noop,
  });
  await engine.api.syncNow();
  assert.ok(reopened.store.get("orders/" + old), "a refused (still pending) document is never dropped");
});

test("[TC-SYN-06-01] a database that is not set up is detected, and works after running the SQL", async () => {
  const server = await createFakeSupabase();
  server.schemaMissing = true;
  const d = device(server);
  await d.NT.connection.signIn(BASE, ANON_KEY, "ana@example.test", "secreto123", true);
  assert.equal(await d.NT.connection.checkSchema(), "missing");
  server.schemaMissing = false;
  assert.equal(await d.NT.connection.checkSchema(), "ok");
});

test("[TC-SYN-06-02] sync reports needs-business, then needs-schema, without losing pending changes", async () => {
  const server = await createFakeSupabase();
  const d = device(server);
  await d.NT.connection.signIn(BASE, ANON_KEY, "ana@example.test", "secreto123", true);
  d.NT.connection.setConnected();
  const s = d.sync();
  await d.repo.saveCustomer(null, { name: "Ana" });
  assert.equal((await s.syncNow()).state, "needs-business");
  await d.NT.connection.bootstrap("X");
  server.schemaMissing = true;
  const st = await s.syncNow();
  assert.equal(st.state, "needs-schema");
  assert.ok(st.pending > 0);
});

test("[TC-SYN-06-03] when both sides have data the person chooses; keeping the server's saves a copy of the device", async () => {
  const server = await createFakeSupabase();
  const a = await owner(server);
  await a.repo.saveCustomer(null, { name: "En el servidor" });
  await a.sync().syncNow();
  const b = device(server, { code: "B" });
  await b.repo.saveCustomer(null, { name: "Solo en B" });
  await b.NT.connection.signIn(BASE, ANON_KEY, "luis@example.test", "secreto123", true);
  await b.NT.connection.join(a.membership.join_code);
  b.NT.connection.setConnected();
  const sb = b.sync();
  assert.equal((await sb.syncNow()).state, "needs-choice");
  await sb.choose("server");
  const names = b.store.list("customers").map((d) => d.data.name);
  assert.deepEqual(names, ["En el servidor"]);
  const saved = JSON.parse(b.storage.getItem("notas:v1"));
  assert.ok(Object.values(saved["_sync/before-connect"].documents).some((d) => d.name === "Solo en B"));
});

test("[TC-SYN-06-04] a change the server refuses is flagged and the others still go", async () => {
  const server = await createFakeSupabase();
  const a = await owner(server);
  const s = a.sync();
  await a.store.batch([
    { path: "customers/bad/path", value: { name: "x", updatedAt: "2026-11-15T10:00:00Z" } },
    { path: "customers/good", value: { name: "y", updatedAt: "2026-11-15T10:00:00Z" } },
  ]);
  const st = await s.syncNow();
  assert.equal(st.failed, 1);
  assert.deepEqual(s.failedPaths(), ["customers/bad/path"]);
  const rows = await server.rows("documents", a.NT.connection.session().userId);
  assert.ok(rows.find((r) => r.path === "customers/good"));
});

test("[TC-REP-02-01] full-history reads bring orders, notes and payments of a period without storing them", async () => {
  const server = await createFakeSupabase();
  const a = await owner(server, { today: "2026-06-01" });
  const s = a.sync();
  const o = await a.repo.createOrder({ deliveryDate: "2026-06-02" });
  await a.repo.saveNote(null, { orderId: o, lines: [line] });
  await a.repo.addPayment({ orderId: o, amount: 1000, method: "cash" });
  await s.syncNow();
  a.clock.today = "2026-11-15";
  await s.syncNow();
  assert.equal(a.store.get("orders/" + o), undefined);
  const got = await s.fetchRange("2026-06-01", "2026-06-30");
  assert.equal(Object.keys(got.orders).length, 1);
  assert.equal(got.notes.length, 1);
  assert.equal(got.payments.length, 1);
  const r = a.NT.logic.report(got.orders, got.notes, got.payments, { from: "2026-06-01", to: "2026-06-30" });
  assert.equal(r.sold, 87500);
  assert.equal(a.store.get("orders/" + o), undefined);
});

test("[TC-NFR-04-01] diagnostics at debug level never record names, amounts, emails or keys", async () => {
  const server = await createFakeSupabase();
  const a = await owner(server);
  a.NT.log.setLevel("debug");
  const s = a.sync();
  const o = await a.repo.createOrder({ customerName: "Ana Secreta" });
  await a.repo.addPayment({ orderId: o, amount: 123456, method: "cash" });
  await s.syncNow();
  const dump = a.NT.log.dump();
  assert.ok(dump.length > 0);
  assert.doesNotMatch(dump, /Ana Secreta|123456|ana@example|test-anon-key|access-/);
});

test("[TC-EXP-03-01] the complete export reads every document from the server, deleted and old ones included, and keeps newer local changes", async () => {
  const server = await createFakeSupabase();
  const a = await owner(server, { today: "2026-06-01" });
  const s = a.sync();
  const old = await a.repo.createOrder({ deliveryDate: "2026-06-02" });
  const c = await a.repo.saveCustomer(null, { name: "Ana" });
  await a.repo.remove("customers/" + c);
  await s.syncNow();
  a.clock.today = "2026-11-15";
  await s.syncNow();
  assert.equal(a.store.get("orders/" + old), undefined, "old order left the device");
  server.offline = true;
  const fresh = await a.repo.createOrder({ customerName: "Pendiente" });
  await assert.rejects(s.fetchAll());
  server.offline = false;
  const all = await s.fetchAll();
  assert.ok(all["orders/" + old], "old order exported from the server");
  assert.ok(all["customers/" + c].deletedAt, "deleted customer exported and marked");
  assert.equal(all["orders/" + fresh].customerName, "Pendiente", "pending local order included");
  assert.equal(a.store.get("orders/" + old), undefined, "nothing stored on the device");
});

test("[TC-SYN-09-01] while the app is open and visible, it checks for other devices' changes every 90 seconds; a pending change is never delayed by it", async () => {
  const server = await createFakeSupabase();
  const a = await owner(server);
  await a.repo.saveCustomer(null, { name: "Ana" });
  await a.sync().syncNow();
  const b = await member(server, a.membership.join_code);
  // A device whose timers we can see and run.
  const timers = [];
  let visible = true;
  const engine = b.NT.sync.create(b.core, b.NT.connection.remote(), {
    session: b.NT.connection.session,
    businessId: () => b.NT.connection.settings().businessId,
    windowDays: () => 30,
    now: () => new Date(),
    today: () => "2026-11-15",
    pollMs: 90000,
    isActive: () => visible,
    setTimeout: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimeout: (id) => (timers[id - 1] = null),
  });
  const due = () => timers.filter(Boolean).map((t) => t.ms);
  await engine.api.syncNow();
  assert.deepEqual(due(), [90000], "next check scheduled");
  // A changes something; B picks it up on its next check without anyone touching B.
  const c2 = await a.repo.saveCustomer(null, { name: "Luis" });
  await a.sync().syncNow();
  const next = timers.filter(Boolean).pop();
  timers.length = 0;
  await next.fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(b.store.get("customers/" + c2).name, "Luis");
  // A local change right before a check: its 1.5 s send is not pushed back to 90 s.
  timers.length = 0;
  engine.recordChanges({}, [{ path: "customers/x", op: "upsert" }]);
  assert.deepEqual(due(), [1500]);
  // Hidden app: no polling.
  visible = false;
  timers.length = 0;
  await engine.api.syncNow();
  assert.deepEqual(due(), []);
});

test("[TC-SYN-10-01] a change made after seeing another device's version is kept, even if this phone's clock is behind", async () => {
  const server = await createFakeSupabase();
  const a = await owner(server);
  const sa = a.sync();
  const c = await a.repo.saveCustomer(null, { name: "Ana" });
  await sa.syncNow();
  const b = await member(server, a.membership.join_code);
  const sb = b.sync();
  await sb.syncNow();
  b.clock.t += 3600 * 1000; // B's clock is an hour ahead of A's
  await b.repo.saveCustomer(c, { name: "Ana (B)" });
  await sb.syncNow();
  await sa.syncNow();
  assert.equal(a.store.get("customers/" + c).name, "Ana (B)", "A sees B's change");
  await a.repo.saveCustomer(c, { name: "Ana (A)" }); // made later, on top of B's version, but A's clock says earlier
  const st = await sa.syncNow();
  assert.equal(st.pending, 0);
  await sb.syncNow();
  const rows = await server.rows("documents", a.NT.connection.session().userId);
  assert.equal(rows.find((r) => r.path === "customers/" + c).data.name, "Ana (A)", "the server keeps A's change");
  assert.equal(b.store.get("customers/" + c).name, "Ana (A)", "and B gets it");
});

test("[TC-SYN-10-02] two people change the same thing at once: nobody's change is lost and the second one is told", async () => {
  const server = await createFakeSupabase();
  const a = await owner(server);
  const sa = a.sync();
  const c = await a.repo.saveCustomer(null, { name: "Ana" });
  await sa.syncNow();
  const b = await member(server, a.membership.join_code);
  const sb = b.sync();
  await sb.syncNow();
  // Both edit version 1 before seeing each other's change.
  await a.repo.saveCustomer(c, { name: "Ana (A)" });
  await b.repo.saveCustomer(c, { name: "Ana (B)" });
  await sb.syncNow(); // B arrives first
  const st = await sa.syncNow();
  assert.equal(st.pending, 0, "nothing stays stuck");
  assert.equal(st.conflicts, 1, "A is told");
  const conflict = sa.conflicts()[0];
  assert.equal(conflict.path, "customers/" + c);
  assert.equal(conflict.mine.name, "Ana (A)", "A's version is kept aside");
  assert.equal(conflict.theirs.name, "Ana (B)");
  assert.equal(a.store.get("customers/" + c).name, "Ana (B)", "A shows what everybody else sees");
  const rows = await server.rows("documents", a.NT.connection.session().userId);
  assert.equal(rows.find((r) => r.path === "customers/" + c).data.name, "Ana (B)");
  // A decides to keep its own: it becomes a normal change on top of B's version and reaches everybody.
  await a.repo.useVersion("customers/" + c, conflict.mine);
  await sa.resolveConflict("customers/" + c);
  const after = await sa.syncNow();
  assert.equal(after.conflicts, 0);
  await sb.syncNow();
  assert.equal(b.store.get("customers/" + c).name, "Ana (A)");
});

test("[TC-SYN-10-03] payments and notes added to the same order at once by different devices are all kept", async () => {
  const server = await createFakeSupabase();
  const a = await owner(server);
  const sa = a.sync();
  const o = await a.repo.createOrder({ customerName: "Ana" });
  await sa.syncNow();
  const b = await member(server, a.membership.join_code);
  const sb = b.sync();
  await sb.syncNow();
  await a.repo.addPayment({ orderId: o, amount: 1000, method: "cash" });
  await b.repo.addPayment({ orderId: o, amount: 2000, method: "cash" });
  await a.repo.saveNote(null, { orderId: o, lines: [line] });
  await b.repo.saveNote(null, { orderId: o, lines: [line] });
  await sa.syncNow();
  const st = await sb.syncNow();
  await sa.syncNow();
  assert.equal(st.conflicts, 0);
  for (const d of [a, b]) {
    assert.equal(d.store.list("payments").length, 2);
    assert.equal(d.store.list("notes").length, 2);
  }
});

test("[TC-SYN-10-04] a database still on schema version 2 asks for the update instead of syncing the old way", async () => {
  const server = await createFakeSupabase({ withoutPush: true });
  const a = await owner(server);
  await a.repo.saveCustomer(null, { name: "Ana" });
  const st = await a.sync().syncNow();
  assert.equal(st.state, "needs-schema");
  assert.ok(st.pending > 0, "changes wait on the device");
});
