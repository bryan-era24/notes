/*
 * Purpose: Unit tests for the pure business rules in js/logic.js.
 * Covers: money parsing and formatting, line/note/order totals, payment status and balance, effective delivery dates,
 * production in kg and pieces, folios, date ranges, reports, validation and the share text.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModules } = require("./helpers/load_modules");

const NT = loadModules(["js/logic.js"]);
const L = NT.logic;

const line = (o) =>
  Object.assign(
    {
      id: "l",
      productId: "p1",
      presentationId: "x",
      productName: "Palomitas",
      presentationLabel: "250 g",
      grams: 250,
      unitPrice: 3500,
      qty: 1,
    },
    o
  );
const note = (o) => Object.assign({ orderId: "o1", number: 1, stage: "ordered", deliveryDate: null, lines: [] }, o);
const order = (o) =>
  Object.assign(
    { folio: "A-0001", customerName: "Ana", deliveryDate: "2026-11-20", stage: "ordered", createdAt: "2026-11-15T10:00:00.000Z" },
    o
  );

test("[TC-PAG-01-01] parses pesos into integer centavos", () => {
  assert.equal(L.parseMoney("35"), 3500);
  assert.equal(L.parseMoney("35.5"), 3550);
  assert.equal(L.parseMoney("$1,234.56"), 123456);
  assert.equal(L.parseMoney(" 0.1 "), 10);
  assert.equal(L.parseMoney("0.105"), 11);
  assert.equal(L.parseMoney(""), null);
  assert.equal(L.parseMoney("abc"), null);
  assert.equal(L.parseMoney("-5"), null);
});

test("[TC-PAG-01-02] formats centavos as Mexican pesos", () => {
  assert.equal(L.formatMoney(3500), "$35.00");
  assert.equal(L.formatMoney(123456), "$1,234.56");
  assert.equal(L.formatMoney(0), "$0.00");
  assert.equal(L.formatMoney(-2550), "-$25.50");
  assert.equal(L.formatMoney(100000000), "$1,000,000.00");
});

test("[TC-NOT-02-01] line, note and order totals", () => {
  const n1 = note({ lines: [line({ qty: 25, unitPrice: 3500 }), line({ id: "b", qty: 25, unitPrice: 3400 })] });
  assert.equal(L.lineTotal(n1.lines[0]), 87500);
  assert.equal(L.noteTotal(n1), 172500);
  const n2 = note({ number: 2, lines: [line({ qty: 2, unitPrice: 12000 })] });
  assert.equal(L.orderTotal([n1, n2]), 196500);
});

test("[TC-NOT-02-02] cancelled and deleted notes do not count in the order total", () => {
  const a = note({ lines: [line({ qty: 1, unitPrice: 1000 })] });
  const b = note({ stage: "cancelled", lines: [line({ qty: 1, unitPrice: 5000 })] });
  const c = note({ deletedAt: "2026-11-15T00:00:00Z", lines: [line({ qty: 1, unitPrice: 7000 })] });
  assert.equal(L.orderTotal([a, b, c]), 1000);
});

test("[TC-PAG-02-01] payment status and balance", () => {
  assert.equal(L.paymentStatus(10000, 0), "pending");
  assert.equal(L.paymentStatus(10000, 2500), "partial");
  assert.equal(L.paymentStatus(10000, 10000), "paid");
  assert.equal(L.paymentStatus(10000, 12000), "credit");
  assert.equal(L.paymentStatus(0, 0), "paid");
  const pays = [{ amount: 2500 }, { amount: 1500 }, { amount: 9999, deletedAt: "x" }];
  assert.equal(L.paidTotal(pays), 4000);
  const s = L.orderSummary([note({ lines: [line({ qty: 2, unitPrice: 5000 })] })], pays);
  assert.deepEqual(s, { total: 10000, paid: 4000, balance: 6000, status: "partial" });
});

test("[TC-PED-03-01] a note's delivery date is its own, else the order's", () => {
  const o = order({ deliveryDate: "2026-11-20" });
  assert.equal(L.effectiveDate(note({}), o), "2026-11-20");
  assert.equal(L.effectiveDate(note({ deliveryDate: "2026-11-22" }), o), "2026-11-22");
  assert.equal(L.effectiveDate(note({}), order({ deliveryDate: null })), null);
});

test("[TC-PRO-01-01] production adds kilograms by product and pieces by presentation", () => {
  const orders = { o1: order({}), o2: order({ folio: "A-0002", deliveryDate: "2026-11-21" }) };
  const notes = [
    note({
      lines: [
        line({ qty: 25, grams: 250 }),
        line({ id: "c", productId: "p2", productName: "Caramelo", presentationLabel: "245 g", grams: 245, qty: 25 }),
      ],
    }),
    note({ orderId: "o2", lines: [line({ presentationId: "k", presentationLabel: "1 kg", grams: 1000, qty: 4 })] }),
    note({ orderId: "o2", number: 2, lines: [line({ presentationId: "f", presentationLabel: "Bolsa fiesta", grams: null, qty: 12 })] }),
  ];
  const rows = L.production(orders, notes, { from: "2026-11-20", to: "2026-11-21" });
  const pal = rows.find((r) => r.productId === "p1");
  assert.equal(pal.grams, 25 * 250 + 4 * 1000);
  assert.equal(pal.pieces, 25 + 4 + 12);
  assert.deepEqual(
    pal.presentations.map((p) => [p.label, p.qty, p.grams]),
    [
      ["1 kg", 4, 4000],
      ["250 g", 25, 6250],
      ["Bolsa fiesta", 12, null],
    ]
  );
  assert.deepEqual(pal.folios.sort(), ["A-0001", "A-0002"]);
  const car = rows.find((r) => r.productId === "p2");
  assert.equal(car.grams, 6125);
});

test("[TC-PRO-01-02] production skips cancelled notes and orders, dates outside the range, and separates delivered", () => {
  const orders = { o1: order({}), o9: order({ stage: "cancelled" }) };
  const notes = [
    note({ lines: [line({ qty: 10 })] }),
    note({ number: 2, stage: "delivered", lines: [line({ qty: 3 })] }),
    note({ number: 3, stage: "cancelled", lines: [line({ qty: 100 })] }),
    note({ number: 4, deliveryDate: "2026-12-01", lines: [line({ qty: 100 })] }),
    note({ orderId: "o9", lines: [line({ qty: 100 })] }),
  ];
  const [row] = L.production(orders, notes, { from: "2026-11-20", to: "2026-11-20" });
  assert.equal(row.pieces, 10);
  assert.equal(row.grams, 2500);
  assert.equal(row.donePieces, 3);
  assert.equal(row.doneGrams, 750);
});

test("[TC-PRO-01-03] weights are shown in kilograms or grams", () => {
  assert.equal(L.formatWeight(6250), "6.25 kg");
  assert.equal(L.formatWeight(10000), "10 kg");
  assert.equal(L.formatWeight(750), "750 g");
  assert.equal(L.formatWeight(0), "0 g");
});

test("[TC-PED-01-01] folios join the device code and a four-digit counter", () => {
  assert.equal(L.folio("A", 42), "A-0042");
  assert.equal(L.folio("bc", 12345), "BC-12345");
  assert.equal(L.validDeviceCode("A"), true);
  assert.equal(L.validDeviceCode("AB"), true);
  assert.equal(L.validDeviceCode("ABC"), false);
  assert.equal(L.validDeviceCode("1"), false);
});

test("[TC-PRO-02-01] date helpers: add days, week range (Monday to Sunday), month range", () => {
  assert.equal(L.addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(L.addDays("2026-03-01", -1), "2026-02-28");
  assert.deepEqual(L.weekRange("2026-11-15"), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(L.weekRange("2026-11-16"), { from: "2026-11-16", to: "2026-11-22" });
  assert.deepEqual(L.monthRange("2026-02-10"), { from: "2026-02-01", to: "2026-02-28" });
  assert.equal(L.dateOf("2026-11-15T23:10:00.000Z"), "2026-11-15");
});

test("[TC-REP-01-01] reports by product, customer and money for a period", () => {
  const orders = {
    o1: order({ customerId: "c1", customerName: "Ana" }),
    o2: order({ folio: "A-0002", customerId: null, customerName: "", deliveryDate: "2026-11-21" }),
    o3: order({ folio: "A-0003", deliveryDate: "2026-12-30" }),
  };
  const notes = [
    note({ lines: [line({ qty: 2, unitPrice: 3500 })] }),
    note({ orderId: "o2", lines: [line({ qty: 1, unitPrice: 12000, presentationLabel: "1 kg", grams: 1000, presentationId: "k" })] }),
    note({ orderId: "o3", lines: [line({ qty: 50 })] }),
  ];
  const payments = [
    { orderId: "o1", amount: 7000, paidAt: "2026-11-20T12:00:00Z" },
    { orderId: "o2", amount: 2000, paidAt: "2026-11-21T12:00:00Z" },
    { orderId: "o3", amount: 500, paidAt: "2026-10-01T12:00:00Z" },
  ];
  const r = L.report(orders, notes, payments, { from: "2026-11-20", to: "2026-11-30" });
  assert.equal(r.sold, 19000);
  assert.equal(r.collected, 9000);
  assert.equal(r.pending, 10000);
  assert.equal(r.orders, 2);
  assert.equal(r.notes, 2);
  const p = r.byProduct.find((x) => x.productId === "p1");
  assert.equal(p.qty, 3);
  assert.equal(p.amount, 19000);
  assert.equal(p.grams, 1500);
  const ana = r.byCustomer.find((c) => c.name === "Ana");
  assert.deepEqual([ana.orders, ana.amount, ana.paid, ana.balance], [1, 7000, 7000, 0]);
  assert.ok(r.byCustomer.find((c) => c.name === ""));
  assert.deepEqual(
    r.byDay.map((d) => d.date),
    ["2026-11-20", "2026-11-21"]
  );
});

test("[TC-CAT-01-01] product validation", () => {
  assert.deepEqual(L.validateProduct({ name: "Palomitas", presentations: [{ id: "a", label: "250 g", grams: 250, price: 3500 }] }), []);
  assert.ok(L.validateProduct({ name: " ", presentations: [] }).includes("product.name"));
  assert.ok(L.validateProduct({ name: "X", presentations: [] }).includes("product.presentations"));
  assert.ok(
    L.validateProduct({ name: "X", presentations: [{ id: "a", label: "", grams: null, price: 1 }] }).includes("presentation.label")
  );
  assert.ok(L.validateProduct({ name: "X", presentations: [{ id: "a", label: "a", grams: -3, price: 1 }] }).includes("presentation.grams"));
  assert.ok(
    L.validateProduct({ name: "X", presentations: [{ id: "a", label: "a", grams: null, price: 1.5 }] }).includes("presentation.price")
  );
});

test("[TC-NOT-01-01] note and payment validation", () => {
  assert.deepEqual(L.validateNote(note({ lines: [line({})] })), []);
  assert.ok(L.validateNote(note({ lines: [] })).includes("note.lines"));
  assert.ok(L.validateNote(note({ lines: [line({ qty: 0 })] })).includes("line.qty"));
  assert.ok(L.validateNote(note({ lines: [line({ qty: 1.5 })] })).includes("line.qty"));
  assert.ok(L.validateNote(note({ lines: [line({ unitPrice: -1 })] })).includes("line.unitPrice"));
  assert.ok(L.validateNote(note({ stage: "x", lines: [line({})] })).includes("note.stage"));
  assert.deepEqual(L.validatePayment({ orderId: "o1", amount: 100, method: "cash", paidAt: "2026-11-15T00:00:00Z" }), []);
  assert.ok(L.validatePayment({ orderId: "o1", amount: 0, method: "cash", paidAt: "x" }).includes("payment.amount"));
  assert.ok(L.validatePayment({ orderId: "o1", amount: 5, method: "gold", paidAt: "x" }).includes("payment.method"));
});

test("[TC-NOT-03-01] a catalog presentation becomes a line with the price frozen", () => {
  const product = { name: "Palomitas de mantequilla", presentations: [{ id: "a", label: "250 g", grams: 250, price: 3500 }] };
  const l = L.lineFrom("p1", product, product.presentations[0], 25, "id1");
  assert.deepEqual(l, {
    id: "id1",
    productId: "p1",
    presentationId: "a",
    productName: "Palomitas de mantequilla",
    presentationLabel: "250 g",
    grams: 250,
    unitPrice: 3500,
    qty: 25,
  });
  product.presentations[0].price = 9900;
  assert.equal(l.unitPrice, 3500);
});

test("[TC-IMP-02-01] print model of an order with its notes, payments and status", () => {
  const o = order({ deliveryDate: "2026-11-20" });
  const notes = [
    note({ number: 2, lines: [line({ qty: 1, unitPrice: 1000 })] }),
    note({ number: 1, lines: [line({ qty: 2, unitPrice: 1000 })] }),
    note({ number: 3, stage: "cancelled", lines: [line({ qty: 9, unitPrice: 1000 })] }),
  ];
  const pays = [{ amount: 1000, method: "cash", paidAt: "2026-11-15T10:00:00Z" }];
  const m = L.printModel({ name: "Palomitas Lupita", phone: "33 1234 5678" }, o, notes, pays, { scope: "order" });
  assert.deepEqual(
    m.notes.map((n) => n.number),
    [1, 2]
  );
  assert.equal(m.total, 3000);
  assert.equal(m.paid, 1000);
  assert.equal(m.balance, 2000);
  assert.equal(m.status, "partial");
  assert.equal(m.notes[0].lines[0].amount, 2000);
  const one = L.printModel({}, o, notes, pays, { scope: "note", noteNumber: 2 });
  assert.equal(one.notes.length, 1);
  assert.equal(one.noteTotal, 1000);
  const summary = L.printModel({}, o, notes, pays, { scope: "summary" });
  assert.equal(summary.notes[0].lines.length, 0);
  assert.equal(summary.notes[0].total, 2000);
});

test("[TC-IMP-03-01] share text is plain and complete", () => {
  const o = order({ deliveryDate: "2026-11-20" });
  const m = L.printModel({ name: "Palomitas Lupita" }, o, [note({ lines: [line({ qty: 25, unitPrice: 3500 })] })], [], { scope: "order" });
  const labels = {
    folio: "Folio",
    customer: "Cliente",
    delivery: "Entrega",
    note: "Nota",
    total: "Total",
    paid: "Pagado",
    balance: "Saldo",
    status: "Pendiente de pago",
  };
  const text = L.shareText(m, labels);
  assert.match(text, /Palomitas Lupita/);
  assert.match(text, /Folio: A-0001/);
  assert.match(text, /25 x Palomitas 250 g/);
  assert.match(text, /\$875\.00/);
  assert.match(text, /Saldo: \$875\.00/);
  assert.match(text, /Pendiente de pago/);
});

test("[TC-PED-04-01] search ignores accents and case, needs every word, and finds folios by their number", () => {
  const order = { folio: "A-0042", customerName: "Doña Pérez", deliveryDate: "2026-11-20", comment: "Entregar en la escuela" };
  const notes = [
    { customerName: "Maestra Lupita", comment: "", lines: [{ productName: "Palomitas de caramelo", presentationLabel: "245 g" }] },
    { customerName: "", deletedAt: "x", lines: [{ productName: "Charola secreta", presentationLabel: "x" }] },
  ];
  const text = L.searchText(order, notes, { phone: "33 1234 5678" });
  const hit = (q) => L.matchesSearch(q, text);
  assert.ok(hit("dona perez"));
  assert.ok(hit("PÉREZ caramelo"));
  assert.ok(hit("42"));
  assert.ok(hit("a-42"));
  assert.ok(hit("A-0042"));
  assert.ok(hit("lupita"));
  assert.ok(hit("escuela"));
  assert.ok(hit("1234"));
  assert.ok(hit("2026-11-20"));
  assert.ok(hit(""));
  assert.ok(!hit("perez mantequilla"), "every word must match");
  assert.ok(!hit("charola"), "deleted notes are not searched");
  assert.ok(!hit("4200"));
});

test("[TC-CAT-03-01] products ranked by how much they sold since a date", () => {
  const notes = [
    {
      orderDate: "2026-11-10",
      lines: [
        { productId: "a", qty: 5 },
        { productId: "b", qty: 50 },
      ],
    },
    { orderDate: "2026-09-01", lines: [{ productId: "c", qty: 999 }] },
    { orderDate: "2026-11-12", stage: "cancelled", lines: [{ productId: "c", qty: 999 }] },
    { orderDate: "2026-11-12", lines: [{ productId: "a", qty: 60 }] },
  ];
  assert.deepEqual(L.productRanking(notes, "2026-10-01"), { a: 65, b: 50 });
});
