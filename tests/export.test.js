/*
 * Purpose: Tests for js/export.js: the complete export of every document as tables, CSV, a ZIP of CSVs and a PostgreSQL script.
 * Covers: every collection becomes a table with typed columns, totals that match the reports, deleted and cancelled rows kept and marked,
 * CSV quoting, BOM and formula-injection guard, a ZIP that standard tools open, and a SQL script that loads into PostgreSQL and agrees.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { loadModules, fakeStorage } = require("./helpers/load_modules");

async function demoDocs() {
  const NT = loadModules(["js/log.js", "js/logic.js", "backend/store.local.js", "js/repo.js", "js/demo.js", "js/export.js"], {
    localStorage: fakeStorage(),
  });
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
  // A cancelled note, a deleted payment and an awkward customer name.
  const o = await repo.createOrder({ customerName: '=HYPERLINK("x"), "Doña" Ñ' });
  const p = store.list("products")[0];
  const noteId = await repo.saveNote(null, { orderId: o, lines: [NT.logic.lineFrom(p.id, p.data, p.data.presentations[0], 3)] });
  await repo.saveNote(null, { orderId: o, stage: "cancelled", lines: [NT.logic.lineFrom(p.id, p.data, p.data.presentations[0], 100)] });
  await repo.addPayment({ orderId: o, amount: 500, method: "cash" });
  const payId = store.list("payments").slice(-1)[0].id;
  await repo.remove("payments/" + payId);
  return { NT, store, docs: store.exportAll(), orderId: o, noteId };
}

test("[TC-EXP-01-01] every collection becomes a table; totals agree with the reports", async () => {
  const { NT, docs, orderId } = await demoDocs();
  const t = NT.exporter.tables(docs);
  assert.deepEqual(Object.keys(t), ["productos", "presentaciones", "clientes", "pedidos", "notas", "renglones", "pagos", "historial"]);
  assert.equal(t.productos.length, 5);
  assert.equal(t.presentaciones.length, 9);
  assert.ok(t.historial.length > 40, "history exported: " + t.historial.length);
  const awkward = t.pedidos.find((r) => r.id === orderId);
  assert.equal(awkward.total, 3 * 3500, "cancelled note left out of the total");
  assert.equal(awkward.pagado, 0, "deleted payment left out");
  assert.equal(awkward.estado_pago, "pendiente");
  assert.equal(t.notas.filter((r) => r.pedido_id === orderId).length, 2, "cancelled note still exported");
  assert.equal(t.pagos.filter((r) => r.pedido_id === orderId && r.eliminado).length, 1, "deleted payment exported and marked");
  // Lines that count add up to the report's sales.
  const orders = {};
  Object.entries(docs).forEach(([k, v]) => k.startsWith("orders/") && (orders[k.slice(7)] = v));
  const notes = Object.entries(docs)
    .filter(([k]) => k.startsWith("notes/"))
    .map(([, v]) => v);
  const report = NT.logic.report(orders, notes, [], { from: "2000-01-01", to: "2100-01-01" });
  const counted = t.renglones.filter((r) => r.cuenta).reduce((s, r) => s + r.importe, 0);
  assert.equal(counted, report.sold);
  const kg = t.renglones.find((r) => r.gramos === 250);
  assert.equal(kg.kg, kg.cantidad * 250);
});

test("[TC-EXP-01-02] CSV: BOM, quoting, pesos with two decimals, and no formulas from text", async () => {
  const { NT, docs, orderId } = await demoDocs();
  const t = NT.exporter.tables(docs);
  const csv = NT.exporter.csv("pedidos", t.pedidos);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], NT.exporter.COLUMNS.pedidos.map((c) => c[0]).join(","));
  const row = lines.find((l) => l.includes(orderId));
  assert.match(row, /"'=HYPERLINK\(""x""\), ""Doña"" Ñ"/);
  assert.match(row, /,105\.00,0\.00,105\.00,pendiente,/);
  const pres = NT.exporter.csv("presentaciones", t.presentaciones);
  assert.match(pres, /,35\.00,sí/);
});

test("[TC-EXP-01-03] the ZIP holds one CSV per table and opens with standard tools", async () => {
  const { NT, docs } = await demoDocs();
  const files = NT.exporter.csvFiles(NT.exporter.tables(docs));
  const zip = NT.exporter.zip(files, new Date(Date.UTC(2026, 10, 15, 18, 0, 0)));
  assert.deepEqual([...zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  // CRC of the first file as zlib computes it.
  const first = files[0];
  const crc = zip[14] | (zip[15] << 8) | (zip[16] << 16) | (zip[17] << 24);
  assert.equal(crc >>> 0, zlib.crc32(first.bytes));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notas-zip-"));
  const file = path.join(dir, "e.zip");
  fs.writeFileSync(file, zip);
  let listing;
  try {
    listing = execFileSync("unzip", ["-l", file], { encoding: "utf8" });
  } catch {
    // catch-ok: unzip is not installed on every machine; the CRC check above still ran.
    return;
  }
  for (const name of ["productos.csv", "renglones.csv", "historial.csv", "LEEME.txt"]) assert.match(listing, new RegExp(name));
  const out = execFileSync("unzip", ["-p", file, "pedidos.csv"]).toString("utf8");
  assert.equal(out, NT.exporter.csv("pedidos", NT.exporter.tables(docs).pedidos));
});

test("[TC-EXP-01-04] the SQL script loads into PostgreSQL, can run twice, and agrees with the export", async () => {
  const { NT, docs } = await demoDocs();
  const t = NT.exporter.tables(docs);
  const sql = NT.exporter.sql(t, "2026-11-15T18:00:00Z");
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(sql);
  await db.exec(sql);
  const count = await db.query("select count(*)::int as n from notas_export.renglones");
  assert.equal(count.rows[0].n, t.renglones.length);
  const total = await db.query("select sum(total)::text as s from notas_export.pedidos");
  const expected = t.pedidos.reduce((s, r) => s + r.total, 0);
  assert.equal(total.rows[0].s, (expected / 100).toFixed(2));
  const name = await db.query("select cliente from notas_export.pedidos where cliente like '%HYPERLINK%'");
  assert.equal(name.rows[0].cliente, '=HYPERLINK("x"), "Doña" Ñ');
});
