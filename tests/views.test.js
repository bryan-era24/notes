/*
 * Purpose: Prove that the readable SQL views (db/schema.sql) and the app's CSV export (js/export.js) give the same tables.
 * Covers: every v_* view returns exactly the export's rows and columns for the same documents (business column aside), the views
 * respect the access rules, and anonymous callers cannot read them.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { openDatabase } = require("./helpers/postgres");
const { loadModules, fakeStorage } = require("./helpers/load_modules");

const ANA = "11111111-1111-1111-1111-111111111111";
const EVE = "33333333-3333-3333-3333-333333333333";

async function setup() {
  const NT = loadModules(
    ["js/log.js", "js/logic.js", "backend/store.local.js", "backend/rows.js", "js/repo.js", "js/demo.js", "js/export.js"],
    { localStorage: fakeStorage() }
  );
  const { store } = NT.openLocalStore({ storageKey: "t" });
  let n = 0;
  const env = {
    now: () => new Date(Date.parse("2026-11-15T18:00:00Z") + n * 1000),
    today: () => "2026-11-15",
    uuid: () => "00000000-0000-4000-8000-" + String(++n).padStart(12, "0"),
    by: () => "maria",
    deviceCode: () => "A",
  };
  const repo = NT.repo.create(store, env);
  await NT.demo.load(repo, store, "2026-11-15");
  const o = await repo.createOrder({ customerName: "Con nota cancelada" });
  const p = store.list("products")[0];
  await repo.saveNote(null, { orderId: o, lines: [NT.logic.lineFrom(p.id, p.data, p.data.presentations[0], 3)] });
  await repo.saveNote(null, { orderId: o, stage: "cancelled", lines: [NT.logic.lineFrom(p.id, p.data, p.data.presentations[1], 7)] });
  await repo.addPayment({ orderId: o, amount: 999, method: "other", comment: 'a, "b"' });
  await repo.remove("payments/" + store.list("payments").slice(-1)[0].id);
  await repo.setStage("notes/" + store.list("notes").slice(-1)[0].id, "delivered");
  const docs = store.exportAll();

  const pg = await openDatabase();
  const [b] = (await pg.as(ANA, (tx) => tx.query("select * from public.notas_bootstrap('X')"))).rows;
  await pg.as(ANA, async (tx) => {
    for (const [path, doc] of Object.entries(docs)) {
      const row = NT.rows.toRow(path, doc, b.business_id, doc.updatedAt, (q) => docs[q]);
      await tx.query(
        "insert into public.documents (business_id, path, collection, doc_date, data, deleted_at, client_updated_at) values ($1,$2,$3,$4,$5,$6,$7)",
        [row.business_id, row.path, row.collection, row.doc_date, JSON.stringify(row.data), row.deleted_at, row.client_updated_at]
      );
    }
  });
  return { NT, docs, pg };
}

/** SQL values back to the export's raw values (centavos, grams, ISO times, YYYY-MM-DD). */
function raw(type, v) {
  if (v === null || v === undefined) return null;
  if (type === "money") return Math.round(Number(v) * 100);
  if (type === "grams_kg") return Math.round(Number(v) * 1000);
  if (type === "int") return Number(v);
  if (type === "ts") return new Date(v).toISOString();
  if (type === "date") return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  return v;
}
const VIEWS = ["productos", "presentaciones", "clientes", "pedidos", "notas", "renglones", "pagos", "historial"];

test("[TC-EXP-02-01] each v_* view equals the CSV export of the same documents", async () => {
  const { NT, docs, pg } = await setup();
  const js = NT.exporter.tables(docs);
  for (const name of VIEWS) {
    const cols = NT.exporter.COLUMNS[name];
    const res = await pg.as(ANA, (tx) => tx.query(`select * from public.v_${name}`));
    assert.deepEqual(
      res.fields.map((f) => f.name),
      ["negocio_id", ...cols.map((c) => c[0])],
      name + ": columns"
    );
    const fromSql = res.rows.map((r) => Object.fromEntries(cols.map(([c, type]) => [c, raw(type, r[c])])));
    const norm = (rows) =>
      rows
        .map((r) => (name === "historial" && r.campos ? Object.assign({}, r, { campos: r.campos.split(" ").sort().join(" ") }) : r))
        .map((r) => NT.exporter.csv(name, [r]).split("\r\n")[1])
        .sort();
    assert.deepEqual(norm(fromSql), norm(js[name]), name + ": rows");
  }
});

test("[TC-EXP-02-02] the views follow the access rules", async () => {
  const { pg } = await setup();
  const rows = await pg.as(EVE, (tx) => tx.query("select count(*)::int as n from public.v_renglones"));
  assert.equal(rows.rows[0].n, 0);
  await assert.rejects(
    pg.db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await tx.query("select * from public.v_pedidos");
    }),
    /permission denied/
  );
});
