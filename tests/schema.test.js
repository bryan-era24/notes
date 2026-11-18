/*
 * Purpose: Prove db/schema.sql on a real PostgreSQL (PGlite in memory).
 * Covers: idempotency, creating and joining a business, isolation between businesses, last write wins for apps before schema version 3,
 * history that cannot change, no deletes, updating a version 2 database, and notas_push (versions, conflicts, history, strangers).
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { openDatabase } = require("./helpers/postgres");

const ANA = "11111111-1111-1111-1111-111111111111";
const LUIS = "22222222-2222-2222-2222-222222222222";
const EVE = "33333333-3333-3333-3333-333333333333";

async function upsert(pg, user, business, path, data, at) {
  return pg.as(user, (tx) =>
    tx.query(
      `insert into public.documents (business_id, path, collection, data, client_updated_at) values ($1, $2, split_part($2, '/', 1), $3, $4)
       on conflict (business_id, path) do update set data = excluded.data, client_updated_at = excluded.client_updated_at`,
      [business, path, JSON.stringify(data), at]
    )
  );
}

test("[TC-SYN-05-01] the schema runs twice without error", async () => {
  const pg = await openDatabase();
  await pg.db.exec(pg.schema);
});

test("[TC-SYN-05-02] bootstrap creates one business per owner; others join with the code; strangers see nothing", async () => {
  const pg = await openDatabase();
  const [own] = (await pg.as(ANA, (tx) => tx.query("select * from public.notas_bootstrap('Palomitas Lupita')"))).rows;
  assert.equal(own.role, "owner");
  assert.match(own.join_code, /^[A-HJ-NP-Z]{6}$/);
  const [again] = (await pg.as(ANA, (tx) => tx.query("select * from public.notas_bootstrap('Otro')"))).rows;
  assert.equal(again.business_id, own.business_id);
  await assert.rejects(
    pg.as(LUIS, (tx) => tx.query("select * from public.notas_join('ZZZZZZ')")),
    /join_code_not_found/
  );
  const [joined] = (await pg.as(LUIS, (tx) => tx.query("select * from public.notas_join($1)", [own.join_code.toLowerCase()]))).rows;
  assert.equal(joined.business_id, own.business_id);
  assert.equal(joined.role, "member");

  await upsert(pg, ANA, own.business_id, "orders/1", { folio: "A-0001" }, "2026-11-15T10:00:00Z");
  const luisSees = (await pg.as(LUIS, (tx) => tx.query("select * from public.documents"))).rows;
  assert.equal(luisSees.length, 1);
  assert.equal(luisSees[0].collection, "orders");
  const eveSees = (await pg.as(EVE, (tx) => tx.query("select * from public.documents"))).rows;
  assert.equal(eveSees.length, 0);
  await assert.rejects(upsert(pg, EVE, own.business_id, "orders/2", {}, "2026-11-15T10:00:00Z"), /row-level security/);
});

test("[TC-SYN-05-03] last write wins, history never changes, and nobody can delete", async () => {
  const pg = await openDatabase();
  const [b] = (await pg.as(ANA, (tx) => tx.query("select * from public.notas_bootstrap('X')"))).rows;
  await upsert(pg, ANA, b.business_id, "orders/1", { v: "new" }, "2026-11-15T12:00:00Z");
  await upsert(pg, ANA, b.business_id, "orders/1", { v: "old" }, "2026-11-15T11:00:00Z");
  await upsert(pg, ANA, b.business_id, "history/1", { v: 1 }, "2026-11-15T12:00:00Z");
  await upsert(pg, ANA, b.business_id, "history/1", { v: 2 }, "2026-11-15T13:00:00Z");
  const rows = (await pg.as(ANA, (tx) => tx.query("select path, data from public.documents order by path"))).rows;
  assert.deepEqual(
    rows.map((r) => [r.path, r.data.v]),
    [
      ["history/1", 1],
      ["orders/1", "new"],
    ]
  );
  await assert.rejects(
    pg.as(ANA, (tx) => tx.query("delete from public.documents")),
    /permission denied/
  );
  await assert.rejects(
    pg.as(ANA, (tx) => tx.query("insert into public.members (business_id, user_id) values ($1, $2)", [b.business_id, EVE])),
    /permission denied/
  );
});

test("[TC-SYN-05-04] the copy of the SQL shown in the app matches db/schema.sql", () => {
  const { loadModules } = require("./helpers/load_modules");
  const NT = loadModules(["backend/schema_sql.js"]);
  assert.equal(NT.schemaSql, require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "db", "schema.sql"), "utf8"));
});

const fs = require("node:fs");
const path = require("node:path");
const SCHEMA_V2 = fs.readFileSync(path.join(__dirname, "fixtures", "schema_v2.sql"), "utf8");

async function push(pg, user, business, rows) {
  const r = await pg.as(user, (tx) => tx.query("select * from public.notas_push($1, $2)", [business, JSON.stringify(rows)]));
  return r.rows;
}
const row = (path, data, base, at = "2026-11-17T18:00:00Z") => ({ path, data, base_rev: base, client_updated_at: at, doc_date: null });

test("[TC-SYN-10-07] a database on schema version 2 is updated by running the current schema: rows kept, versions start at 1", async () => {
  const pg = await openDatabase(SCHEMA_V2);
  const [own] = (await pg.as(ANA, (tx) => tx.query("select * from public.notas_bootstrap('Palomitas')"))).rows;
  await upsert(pg, ANA, own.business_id, "customers/c1", { name: "Ana" }, "2026-11-17T10:00:00Z");
  await pg.db.exec(pg.schema);
  const [before] = (await pg.as(ANA, (tx) => tx.query("select data, rev from public.documents where path = 'customers/c1'"))).rows;
  assert.deepEqual(before.data, { name: "Ana" });
  assert.equal(Number(before.rev), 1);
  const [ok] = await push(pg, ANA, own.business_id, [row("customers/c1", { name: "Ana B" }, 1)]);
  assert.equal(ok.status, "ok");
  assert.equal(Number(ok.rev), 2);
});

test("[TC-SYN-10-08] notas_push: new rows, identical rows, changes on the current version, conflicts, history and strangers", async () => {
  const pg = await openDatabase();
  const [own] = (await pg.as(ANA, (tx) => tx.query("select * from public.notas_bootstrap('Palomitas')"))).rows;
  const b = own.business_id;
  let [r] = await push(pg, ANA, b, [row("customers/c1", { name: "Ana" }, null)]);
  assert.deepEqual([r.status, Number(r.rev)], ["ok", 1]);
  [r] = await push(pg, ANA, b, [row("customers/c1", { name: "Ana" }, null)]);
  assert.deepEqual([r.status, Number(r.rev)], ["ok", 1], "sending the same document again changes nothing");
  [r] = await push(pg, ANA, b, [row("customers/c1", { name: "Ana 2" }, 1)]);
  assert.deepEqual([r.status, Number(r.rev)], ["ok", 2]);
  // Another device still on version 1, even with a later clock: a conflict, and the row is untouched.
  [r] = await push(pg, ANA, b, [row("customers/c1", { name: "Ana 3" }, 1, "2030-01-01T00:00:00Z")]);
  assert.equal(r.status, "conflict");
  assert.equal(Number(r.rev), 2);
  assert.deepEqual(r.data, { name: "Ana 2" });
  // History entries never change once written.
  await push(pg, ANA, b, [row("history/h1", { action: "create" }, null)]);
  [r] = await push(pg, ANA, b, [row("history/h1", { action: "tampered" }, 1)]);
  assert.equal(r.status, "ok");
  const [h] = (await pg.as(ANA, (tx) => tx.query("select data from public.documents where path = 'history/h1'"))).rows;
  assert.deepEqual(h.data, { action: "create" });
  // Someone who is not a member cannot send rows to the business.
  await assert.rejects(push(pg, EVE, b, [row("customers/x", { name: "Eve" }, null)]), /not_a_member/);
});
