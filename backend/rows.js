/*
 * Purpose: Translate between the app's documents and rows of public.documents (db/schema.sql), and decide each document's window date.
 * Responsibilities: Build the row for one document, read a document back from a pulled row, and give the date the cache window uses
 * (orders and their notes and payments share one date, so they stay or go together). It is pure: no storage, network or clock.
 */
window.NT = window.NT || {};

NT.rows = (function () {
  "use strict";

  var KEY = ["business_id", "path"];
  var DATED = { orders: 1, notes: 1, payments: 1, history: 1 };

  function collectionOf(path) {
    return String(path).split("/")[0];
  }
  function orderDate(order) {
    if (!order) return null;
    var made = order.localDate || NT.logic.dateOf(order.createdAt);
    var due = order.deliveryDate || "";
    return due > made ? due : made || null;
  }

  /** The window date of a document, or null for documents always kept (catalog, customers, settings, counters). */
  function docDate(path, doc, get) {
    var c = collectionOf(path);
    if (!DATED[c] || !doc) return null;
    if (c === "orders") return orderDate(doc);
    if (c === "history") return doc.localDate || NT.logic.dateOf(doc.at) || null;
    var order = get ? get("orders/" + doc.orderId) : null;
    return order ? orderDate(order) : doc.orderDate || null;
  }

  /** The row for one document. `at` is the time of the change when the document carries none. */
  function toRow(path, doc, businessId, at, get) {
    return {
      business_id: businessId,
      path: path,
      collection: collectionOf(path),
      doc_date: docDate(path, doc, get),
      data: doc,
      deleted_at: doc.deletedAt || null,
      client_updated_at: doc.updatedAt || at,
    };
  }

  /** [path, document] from a pulled row. */
  function fromRow(row) {
    var doc = Object.assign({}, row.data || {});
    if (row.deleted_at && !doc.deletedAt) doc.deletedAt = row.deleted_at;
    return [row.path, doc];
  }

  function isNewer(a, b) {
    return Date.parse(a || 0) > Date.parse(b || 0);
  }

  return { KEY: KEY, collectionOf: collectionOf, docDate: docDate, toRow: toRow, fromRow: fromRow, isNewer: isNewer };
})();
