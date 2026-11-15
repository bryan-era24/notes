/*
 * Purpose: Tests for the print renderers (js/print.js) and the ESC/POS encoder (js/escpos.js).
 * Covers: letter and ticket HTML content and escaping, ink-saving markup (no fills), cancelled notes, payment status words,
 * ESC/POS commands, code page 850 accents, column layout and the ticket width setting.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModules } = require("./helpers/load_modules");

const NT = loadModules(["js/logic.js", "js/print.js", "js/escpos.js"]);
const t = (key, vars) => {
  const dict = {
    "print.folio": "Folio",
    "print.customer": "Cliente",
    "print.delivery": "Entrega",
    "print.created": "Fecha",
    "print.note": "Nota",
    "print.qty": "Cant.",
    "print.product": "Producto",
    "print.unit": "P. unit.",
    "print.amount": "Importe",
    "print.subtotal": "Subtotal",
    "print.total": "Total",
    "print.paid": "Pagado",
    "print.balance": "Saldo",
    "print.payments": "Pagos",
    "print.signature": "Recibí de conformidad",
    "print.cancelled": "CANCELADA",
    "print.status": "Estado",
    "pay.status.pending": "Pendiente de pago",
    "pay.status.partial": "Pago parcial",
    "pay.status.paid": "Pagado",
    "pay.status.credit": "Saldo a favor",
    "pay.method.cash": "Efectivo",
    "pay.method.transfer": "Transferencia",
    "pay.method.other": "Otro",
    "stage.ordered": "Pedido",
    "stage.cancelled": "Cancelado",
  };
  return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
};

function model(extra = {}) {
  const order = {
    folio: "A-0042",
    customerName: "Ana <b>López</b>",
    deliveryDate: "2026-11-20",
    stage: "ordered",
    createdAt: "2026-11-15T10:00:00Z",
  };
  const notes = [
    {
      orderId: "o",
      number: 1,
      stage: "ordered",
      lines: [
        {
          id: "1",
          productId: "p",
          presentationId: "a",
          productName: "Palomitas de mantequilla",
          presentationLabel: "250 g",
          grams: 250,
          unitPrice: 3500,
          qty: 25,
        },
        {
          id: "2",
          productId: "q",
          presentationId: "b",
          productName: "Palomitas de caramelo",
          presentationLabel: "245 g",
          grams: 245,
          unitPrice: 3800,
          qty: 25,
        },
      ],
    },
  ];
  const payments = [{ amount: 50000, method: "cash", paidAt: "2026-11-15T12:00:00Z" }];
  return NT.logic.printModel(
    { name: "Palomitas Lupita", phone: "33 1234 5678", ticketFooter: "¡Gracias por su compra!" },
    order,
    notes,
    payments,
    Object.assign({ scope: "order" }, extra)
  );
}

test("[TC-IMP-01-01] letter layout shows the whole order with escaped text", () => {
  const html = NT.print.letterHtml(model(), t, { formatDate: (d) => d });
  assert.match(html, /Palomitas Lupita/);
  assert.match(html, /A-0042/);
  assert.match(html, /Ana &lt;b&gt;López&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>López/);
  assert.match(html, /Palomitas de mantequilla/);
  assert.match(html, /\$875\.00/);
  assert.match(html, /\$1,825\.00/);
  assert.match(html, /Pago parcial/);
  assert.match(html, /Saldo/);
  assert.match(html, /\$1,325\.00/);
  assert.match(html, /Recibí de conformidad/);
  assert.match(html, /Efectivo/);
});

test("[TC-IMP-01-02] print markup carries no inline colours or backgrounds (ink saving)", () => {
  const html = NT.print.letterHtml(model(), t, {}) + NT.print.ticketHtml(model(), t, {});
  assert.doesNotMatch(html, /style=|background|color:/i);
});

test("[TC-IMP-01-03] ticket layout stacks lines and uses the width class", () => {
  const html = NT.print.ticketHtml(model(), t, { width: 58 });
  assert.match(html, /ticket-58/);
  assert.match(html, /25 × \$35\.00/);
  assert.match(html, /¡Gracias por su compra!/);
});

test("[TC-IMP-01-04] a cancelled note printed alone is marked", () => {
  const order = { folio: "A-1", customerName: "", stage: "ordered", createdAt: "2026-11-15T10:00:00Z" };
  const notes = [
    { orderId: "o", number: 1, stage: "cancelled", lines: [{ productName: "X", presentationLabel: "1", qty: 1, unitPrice: 100 }] },
  ];
  const m = NT.logic.printModel({}, order, notes, [], { scope: "note", noteNumber: 1 });
  assert.match(NT.print.letterHtml(m, t, {}), /CANCELADA/);
});

test("[TC-IMP-04-01] ESC/POS: init, code page 850, cut, and accents encoded", () => {
  const bytes = NT.escpos.encode(model(), t, { cols: 48, formatDate: (d) => d });
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual([...bytes.slice(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 0x02]);
  const tail = [...bytes.slice(-4)];
  assert.deepEqual(tail, [0x1d, 0x56, 0x42, 0x00]);
  assert.deepEqual([...NT.escpos.text("áéíóúñÑ¡¿")], [0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xad, 0xa8]);
  assert.deepEqual([...NT.escpos.text("ç€")], [0x87, 0x3f]);
});

test("[TC-IMP-04-02] ESC/POS rows fit the column count", () => {
  assert.equal(NT.escpos.row("Total", "$1,825.00", 32), "Total" + " ".repeat(32 - 5 - 9) + "$1,825.00");
  assert.deepEqual(NT.escpos.wrap("Palomitas de mantequilla extra grande", 16), ["Palomitas de", "mantequilla", "extra grande"]);
  const decoded = NT.escpos.decodeForTest(NT.escpos.encode(model(), t, { cols: 32 }));
  decoded
    .split("\n")
    .filter((l) => l.length)
    .forEach((l) => assert.ok(l.length <= 32, "line too long: " + l));
  assert.match(decoded, /Palomitas Lupita/);
  assert.match(decoded, /25 x \$35\.00/);
});

test("[TC-IMP-04-03] Bluetooth sends ESC/POS bytes in small chunks, in order", async () => {
  const P = loadModules(["js/logic.js", "js/print.js", "js/escpos.js", "js/printers.js"], { navigator: {} });
  const writes = [];
  const ch = { properties: { writeWithoutResponse: true }, writeValueWithoutResponse: async (b) => writes.push(b) };
  const bytes = Uint8Array.from({ length: 500 }, (_, i) => i % 256);
  await P.printers.writeChunks(ch, bytes);
  assert.deepEqual(
    writes.map((w) => w.length),
    [180, 180, 140]
  );
  assert.deepEqual([...writes[2]].slice(-1), [499 % 256]);
  assert.deepEqual(
    P.printers.choices().map((c) => [c.id, c.available]),
    [
      ["browser", true],
      ["escpos-bluetooth", false],
      ["escpos-serial", false],
      ["escpos-usb", false],
    ]
  );
});
