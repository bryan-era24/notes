/*
 * Purpose: Check the letter PDF that js/pdf.js writes byte by byte, and the file name rule in js/logic.js.
 * Covers: a valid PDF (header, objects, cross-reference offsets, trailer); Spanish letters encoded for the standard fonts and special
 * characters escaped; the note's content (business, folio, customer, lines, totals, credit); long notes continue on more pages; and the
 * file name "cliente folio fecha.pdf" with "Sin nombre" and without a date.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModules } = require("./helpers/load_modules");

const NT = loadModules(["js/logic.js", "js/i18n.js", "js/lang/es.js", "js/pdf.js"]);
const t = (k, v) => NT.i18n.t(k, v);
const latin1 = (bytes) => Buffer.from(bytes).toString("latin1");

function model(lines, extra) {
  return Object.assign(
    {
      scope: "order",
      business: { name: "Palomitas (Doña Rosa)", phone: "33 0000 0000", address: "", footer: "¡Gracias por su compra!" },
      folio: "A-0005",
      customerName: "Fiestas Ñandú",
      deliveryDate: "2026-11-20",
      createdAt: "2026-11-15T18:00:00.000Z",
      localDate: "2026-11-15",
      comment: "",
      notes: [
        { number: 1, customerName: "", deliveryDate: "2026-11-20", stage: "ordered", cancelled: false, comment: "", total: 0, lines },
      ],
      total: 0,
      paid: 50000,
      balance: -42000,
      status: "credit",
      payments: [{ amount: 50000, method: "cash", date: "2026-11-15" }],
    },
    extra || {}
  );
}
const line = (i) => ({ productName: "Palomitas naturales " + i, presentationLabel: "Bolsa", qty: 1, unitPrice: 8000, amount: 8000 });

test("[TC-PDF-01-01] the letter PDF is valid: header, objects, cross-reference offsets and trailer", () => {
  const bytes = NT.pdf.letter(model([line(1)]), t, {});
  const text = latin1(bytes);
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  const startxref = Number(text.match(/startxref\s+(\d+)\s+%%EOF\s*$/)[1]);
  assert.equal(text.slice(startxref, startxref + 4), "xref");
  const xref = text.slice(startxref).split("\n");
  const count = Number(xref[1].split(" ")[1]);
  for (let i = 1; i < count; i++) {
    const offset = Number(xref[2 + i].slice(0, 10));
    assert.equal(text.slice(offset, offset + String(i).length + 6), i + " 0 obj", "object " + i + " starts at its offset");
  }
  assert.match(text, /\/Type \/Catalog/);
  assert.match(text, /\/BaseFont \/Helvetica\b/);
  assert.match(text, /\/Encoding \/WinAnsiEncoding/);
  assert.match(text, /\/MediaBox \[0 0 612 792\]/);
});

test("[TC-PDF-01-02] Spanish letters use the standard font encoding and parentheses are escaped", () => {
  const text = latin1(NT.pdf.letter(model([line(1)]), t, {}));
  assert.ok(text.includes("(Palomitas \\(Do\xf1a Rosa\\))"), "ñ as one byte, parentheses escaped");
  assert.ok(text.includes("Fiestas \xd1and\xfa"), "Ñ and ú");
  assert.ok(text.includes("\xa1Gracias por su compra!"), "¡");
});

test("[TC-PDF-01-03] the PDF carries the folio, the lines, the totals and the credit in favour of the customer", () => {
  const text = latin1(NT.pdf.letter(model([line(1), line(2)], { total: 16000, balance: -34000 }), t, {}));
  for (const s of [
    "A-0005",
    "Palomitas naturales 1 Bolsa",
    "Palomitas naturales 2 Bolsa",
    "$160.00",
    "$500.00",
    "A favor del cliente",
    "$340.00",
    "Saldo a favor",
  ])
    assert.ok(text.includes(s), s);
});

test("[TC-PDF-01-04] a long note continues on more pages", () => {
  const lines = Array.from({ length: 90 }, (_, i) => line(i + 1));
  const text = latin1(NT.pdf.letter(model(lines), t, {}));
  const pages = Number(text.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)[1]);
  assert.ok(pages >= 2, "pages: " + pages);
  assert.ok(text.includes("Palomitas naturales 90 Bolsa"), "the last line is printed");
});

test("[TC-PDF-01-05] the file is named customer, folio and delivery date", () => {
  const L = NT.logic;
  assert.equal(
    L.pdfFileName({ customerName: "Fiestas Ejemplo", folio: "A-0005", deliveryDate: "2026-11-20" }, "Sin nombre"),
    "Fiestas Ejemplo A-0005 2026-11-20.pdf"
  );
  assert.equal(
    L.pdfFileName({ customerName: "", folio: "A-0006", deliveryDate: "2026-11-21" }, "Sin nombre"),
    "Sin nombre A-0006 2026-11-21.pdf"
  );
  assert.equal(
    L.pdfFileName({ customerName: "Café / Té: ¿sí?", folio: "B-0001", deliveryDate: null }, "Sin nombre"),
    "Café Té ¿sí B-0001.pdf"
  );
});
