/*
 * Purpose: Export every document as plain tables: one CSV per table in a ZIP, and a PostgreSQL script, so the data can be opened in Excel
 * or loaded into any PostgreSQL.
 * Responsibilities: Flatten documents into typed rows (the same tables and columns as the SQL views in db/schema.sql), write CSV that
 * Excel opens correctly and that cannot inject formulas, build a ZIP without compression, and write an idempotent SQL script. It is pure:
 * no DOM, storage, network or clock (the export time is passed in).
 */
window.NT = window.NT || {};

NT.exporter = (function () {
  "use strict";
  var L = NT.logic;

  // [column, type]. Types: text, int, money (centavos -> pesos), grams_kg (grams -> kg), bool, date, ts.
  var COLUMNS = {
    productos: [
      ["id", "text"],
      ["nombre", "text"],
      ["activo", "bool"],
      ["posicion", "int"],
      ["actualizado", "ts"],
      ["eliminado", "ts"],
    ],
    presentaciones: [
      ["id", "text"],
      ["producto_id", "text"],
      ["producto", "text"],
      ["presentacion", "text"],
      ["gramos", "int"],
      ["precio", "money"],
      ["activa", "bool"],
    ],
    clientes: [
      ["id", "text"],
      ["nombre", "text"],
      ["telefono", "text"],
      ["comentario", "text"],
      ["actualizado", "ts"],
      ["eliminado", "ts"],
    ],
    pedidos: [
      ["id", "text"],
      ["folio", "text"],
      ["cliente_id", "text"],
      ["cliente", "text"],
      ["fecha_entrega", "date"],
      ["estado", "text"],
      ["comentario", "text"],
      ["creado", "ts"],
      ["fecha", "date"],
      ["total", "money"],
      ["pagado", "money"],
      ["saldo", "money"],
      ["estado_pago", "text"],
      ["eliminado", "ts"],
    ],
    notas: [
      ["id", "text"],
      ["pedido_id", "text"],
      ["folio", "text"],
      ["numero", "int"],
      ["cliente", "text"],
      ["fecha_entrega", "date"],
      ["estado", "text"],
      ["comentario", "text"],
      ["total", "money"],
      ["eliminado", "ts"],
    ],
    renglones: [
      ["nota_id", "text"],
      ["renglon", "int"],
      ["pedido_id", "text"],
      ["folio", "text"],
      ["numero_nota", "int"],
      ["fecha_entrega", "date"],
      ["cliente", "text"],
      ["producto_id", "text"],
      ["producto", "text"],
      ["presentacion_id", "text"],
      ["presentacion", "text"],
      ["gramos", "int"],
      ["cantidad", "int"],
      ["precio", "money"],
      ["importe", "money"],
      ["kg", "grams_kg"],
      ["estado_nota", "text"],
      ["cuenta", "bool"],
    ],
    pagos: [
      ["id", "text"],
      ["pedido_id", "text"],
      ["folio", "text"],
      ["nota_id", "text"],
      ["monto", "money"],
      ["forma", "text"],
      ["fecha", "date"],
      ["pagado_en", "ts"],
      ["comentario", "text"],
      ["eliminado", "ts"],
    ],
    historial: [
      ["id", "text"],
      ["documento", "text"],
      ["accion", "text"],
      ["fecha_hora", "ts"],
      ["por", "text"],
      ["campos", "text"],
    ],
  };
  var KEYS = { renglones: ["nota_id", "renglon"] };
  var STAGE = {
    ordered: "pedido",
    preparing: "en_preparacion",
    delivered: "entregado",
    received_signed: "firmado",
    cancelled: "cancelado",
  };
  var PAY = { pending: "pendiente", partial: "parcial", paid: "pagado", credit: "a_favor" };
  var METHOD = { cash: "efectivo", transfer: "transferencia", other: "otro" };

  function byCollection(docs) {
    var out = {};
    Object.keys(docs)
      .sort()
      .forEach(function (path) {
        var i = path.indexOf("/");
        var c = path.slice(0, i);
        (out[c] = out[c] || []).push(Object.assign({ id: path.slice(i + 1) }, docs[path]));
      });
    return out;
  }
  function nz(v) {
    return v === undefined || v === "" ? null : v;
  }

  /** { table: [row] } from { "collection/id": document }. Rows keep raw values (centavos, grams, ISO times). */
  function tables(docs) {
    var c = byCollection(docs);
    var orders = c.orders || [],
      notes = c.notes || [],
      payments = c.payments || [];
    var orderById = {};
    orders.forEach(function (o) {
      orderById[o.id] = o;
    });
    var liveNotes = {},
      livePays = {};
    notes.forEach(function (n) {
      (liveNotes[n.orderId] = liveNotes[n.orderId] || []).push(n);
    });
    payments.forEach(function (p) {
      (livePays[p.orderId] = livePays[p.orderId] || []).push(p);
    });

    var t = { productos: [], presentaciones: [], clientes: [], pedidos: [], notas: [], renglones: [], pagos: [], historial: [] };
    (c.products || []).forEach(function (p) {
      t.productos.push({
        id: p.id,
        nombre: p.name,
        activo: p.active !== false,
        posicion: nz(p.position),
        actualizado: nz(p.updatedAt),
        eliminado: nz(p.deletedAt),
      });
      (p.presentations || []).forEach(function (x) {
        t.presentaciones.push({
          id: x.id,
          producto_id: p.id,
          producto: p.name,
          presentacion: x.label,
          gramos: nz(x.grams),
          precio: x.price,
          activa: x.active !== false,
        });
      });
    });
    (c.customers || []).forEach(function (x) {
      t.clientes.push({
        id: x.id,
        nombre: x.name,
        telefono: nz(x.phone),
        comentario: nz(x.comment),
        actualizado: nz(x.updatedAt),
        eliminado: nz(x.deletedAt),
      });
    });
    orders.forEach(function (o) {
      var s = L.orderSummary(liveNotes[o.id] || [], livePays[o.id] || []);
      t.pedidos.push({
        id: o.id,
        folio: o.folio,
        cliente_id: nz(o.customerId),
        cliente: nz(o.customerName),
        fecha_entrega: nz(o.deliveryDate),
        estado: STAGE[o.stage] || o.stage,
        comentario: nz(o.comment),
        creado: nz(o.createdAt),
        fecha: nz(o.localDate) || L.dateOf(o.createdAt) || null,
        total: s.total,
        pagado: s.paid,
        saldo: s.balance,
        estado_pago: PAY[s.status],
        eliminado: nz(o.deletedAt),
      });
    });
    notes.forEach(function (n) {
      var o = orderById[n.orderId] || {};
      var counts = !n.deletedAt && n.stage !== "cancelled" && !o.deletedAt && o.stage !== "cancelled";
      var date = L.effectiveDate(n, o);
      t.notas.push({
        id: n.id,
        pedido_id: n.orderId,
        folio: nz(o.folio),
        numero: n.number,
        cliente: nz(n.customerName),
        fecha_entrega: date,
        estado: STAGE[n.stage] || n.stage,
        comentario: nz(n.comment),
        total: L.noteTotal(n),
        eliminado: nz(n.deletedAt),
      });
      (n.lines || []).forEach(function (l, i) {
        t.renglones.push({
          nota_id: n.id,
          renglon: i + 1,
          pedido_id: n.orderId,
          folio: nz(o.folio),
          numero_nota: n.number,
          fecha_entrega: date,
          cliente: nz(n.customerName),
          producto_id: l.productId,
          producto: l.productName,
          presentacion_id: l.presentationId,
          presentacion: l.presentationLabel,
          gramos: nz(l.grams),
          cantidad: l.qty,
          precio: l.unitPrice,
          importe: L.lineTotal(l),
          kg: l.grams ? l.grams * l.qty : null,
          estado_nota: STAGE[n.stage] || n.stage,
          cuenta: counts,
        });
      });
    });
    payments.forEach(function (p) {
      var o = orderById[p.orderId] || {};
      t.pagos.push({
        id: p.id,
        pedido_id: p.orderId,
        folio: nz(o.folio),
        nota_id: nz(p.noteId),
        monto: p.amount,
        forma: METHOD[p.method] || p.method,
        fecha: nz(p.localDate) || L.dateOf(p.paidAt) || null,
        pagado_en: nz(p.paidAt),
        comentario: nz(p.comment),
        eliminado: nz(p.deletedAt),
      });
    });
    (c.history || []).forEach(function (h) {
      t.historial.push({
        id: h.id,
        documento: h.path,
        accion: h.action,
        fecha_hora: nz(h.at),
        por: nz(h.by),
        campos: h.changes ? Object.keys(h.changes).join(" ") : null,
      });
    });
    return t;
  }

  // ---------- CSV ----------
  function pesos(cents, decimals) {
    var neg = cents < 0;
    var n = Math.abs(Math.round(cents));
    var s = Math.floor(n / Math.pow(10, decimals)) + "." + String(n % Math.pow(10, decimals)).padStart(decimals, "0");
    return (neg ? "-" : "") + s;
  }
  function tsText(iso) {
    // ISO (UTC) -> "YYYY-MM-DD HH:MM:SS", which Excel and PostgreSQL both read.
    return String(iso)
      .replace("T", " ")
      .replace(/\.\d+Z?$|Z$/, "");
  }
  function cellText(type, v) {
    if (v === null || v === undefined) return "";
    if (type === "money") return pesos(v, 2);
    if (type === "grams_kg") return pesos(v, 3);
    if (type === "bool") return v ? "sí" : "no";
    if (type === "ts") return tsText(v);
    return String(v);
  }
  function csvCell(type, v) {
    var s = cellText(type, v);
    // A text cell starting like a formula is shown as text, never run by a spreadsheet.
    if (type === "text" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  /** One table as CSV: UTF-8 BOM (so Excel reads accents), comma separated, CRLF lines. */
  function csv(table, rows) {
    var cols = COLUMNS[table];
    var out = [
      cols
        .map(function (c) {
          return c[0];
        })
        .join(","),
    ];
    rows.forEach(function (r) {
      out.push(
        cols
          .map(function (c) {
            return csvCell(c[1], r[c[0]]);
          })
          .join(",")
      );
    });
    return "﻿" + out.join("\r\n") + "\r\n";
  }

  var README =
    "Notas: exportación completa\r\n\r\n" +
    "Un archivo por tabla. Montos en pesos con dos decimales; kg con tres decimales; fechas AAAA-MM-DD;\r\n" +
    "fecha_hora en hora UTC. La columna 'eliminado' trae la fecha en que se eliminó (vacía si sigue vigente).\r\n" +
    "En renglones, 'cuenta' = sí cuando la nota y el pedido no están cancelados ni eliminados (súmalos para las ventas).\r\n" +
    "Las mismas tablas existen como vistas en la base de datos (v_productos, v_pedidos, v_renglones, ...).\r\n";

  function utf8(s) {
    return new TextEncoder().encode(s);
  }
  /** [{ name, bytes }] for the ZIP: one CSV per table plus a short README. */
  function csvFiles(t) {
    var files = Object.keys(COLUMNS).map(function (name) {
      return { name: name + ".csv", bytes: utf8(csv(name, t[name] || [])) };
    });
    files.push({ name: "LEEME.txt", bytes: utf8(README) });
    return files;
  }

  // ---------- ZIP (stored, no compression) ----------
  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  /** ZIP of files [{ name, bytes }]; `when` is a Date used for the file times (UTC). */
  function zip(files, when) {
    var time = (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | Math.floor(when.getUTCSeconds() / 2);
    var date = ((when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate();
    var parts = [],
      central = [],
      offset = 0;
    function header(size) {
      var b = new Uint8Array(size);
      return { b: b, v: new DataView(b.buffer) };
    }
    files.forEach(function (f) {
      var name = utf8(f.name);
      var crc = crc32(f.bytes);
      var h = header(30);
      h.v.setUint32(0, 0x04034b50, true);
      h.v.setUint16(4, 20, true);
      h.v.setUint16(6, 0x0800, true); // names in UTF-8
      h.v.setUint16(8, 0, true); // stored
      h.v.setUint16(10, time, true);
      h.v.setUint16(12, date, true);
      h.v.setUint32(14, crc, true);
      h.v.setUint32(18, f.bytes.length, true);
      h.v.setUint32(22, f.bytes.length, true);
      h.v.setUint16(26, name.length, true);
      parts.push(h.b, name, f.bytes);
      var c = header(46);
      c.v.setUint32(0, 0x02014b50, true);
      c.v.setUint16(4, 20, true);
      c.v.setUint16(6, 20, true);
      c.v.setUint16(8, 0x0800, true);
      c.v.setUint16(10, 0, true);
      c.v.setUint16(12, time, true);
      c.v.setUint16(14, date, true);
      c.v.setUint32(16, crc, true);
      c.v.setUint32(20, f.bytes.length, true);
      c.v.setUint32(24, f.bytes.length, true);
      c.v.setUint16(28, name.length, true);
      c.v.setUint32(42, offset, true);
      central.push(c.b, name);
      offset += 30 + name.length + f.bytes.length;
    });
    var cdSize = central.reduce(function (n, p) {
      return n + p.length;
    }, 0);
    var e = header(22);
    e.v.setUint32(0, 0x06054b50, true);
    e.v.setUint16(8, files.length, true);
    e.v.setUint16(10, files.length, true);
    e.v.setUint32(12, cdSize, true);
    e.v.setUint32(16, offset, true);
    var all = parts.concat(central, [e.b]);
    var out = new Uint8Array(offset + cdSize + 22);
    var at = 0;
    all.forEach(function (p) {
      out.set(p, at);
      at += p.length;
    });
    return out;
  }

  // ---------- PostgreSQL script ----------
  var SQL_TYPES = {
    text: "text",
    int: "integer",
    money: "numeric(12,2)",
    grams_kg: "numeric(12,3)",
    bool: "boolean",
    date: "date",
    ts: "timestamptz",
  };
  function sqlValue(type, v) {
    if (v === null || v === undefined) return "null";
    if (type === "int") return String(Math.round(Number(v)));
    if (type === "money") return pesos(v, 2);
    if (type === "grams_kg") return pesos(v, 3);
    if (type === "bool") return v ? "true" : "false";
    return "'" + String(v).replace(/'/g, "''") + "'";
  }
  /**
   * An idempotent script that creates schema notas_export with one table per export table and upserts every row.
   * Running it again updates the rows; it never drops or deletes anything.
   */
  function sql(t, exportedAt) {
    var out = [
      "-- Notas: exportación completa (" + exportedAt + ")",
      "-- Ejecuta este archivo en cualquier PostgreSQL. Puede ejecutarse varias veces.",
      "begin;",
      "create schema if not exists notas_export;",
    ];
    Object.keys(COLUMNS).forEach(function (name) {
      var cols = COLUMNS[name];
      var keys = KEYS[name] || ["id"];
      out.push(
        "create table if not exists notas_export." +
          name +
          " (" +
          cols
            .map(function (c) {
              return c[0] + " " + SQL_TYPES[c[1]];
            })
            .join(", ") +
          ", primary key (" +
          keys.join(", ") +
          "));"
      );
      var rows = t[name] || [];
      var names = cols.map(function (c) {
        return c[0];
      });
      var updates = names
        .filter(function (n) {
          return keys.indexOf(n) < 0;
        })
        .map(function (n) {
          return n + " = excluded." + n;
        })
        .join(", ");
      for (var i = 0; i < rows.length; i += 500) {
        var chunk = rows.slice(i, i + 500);
        out.push(
          "insert into notas_export." +
            name +
            " (" +
            names.join(", ") +
            ") values\n" +
            chunk
              .map(function (r) {
                return (
                  "(" +
                  cols
                    .map(function (c) {
                      return sqlValue(c[1], r[c[0]]);
                    })
                    .join(", ") +
                  ")"
                );
              })
              .join(",\n") +
            "\non conflict (" +
            keys.join(", ") +
            ") do update set " +
            updates +
            ";"
        );
      }
    });
    out.push("commit;");
    return out.join("\n") + "\n";
  }

  return { COLUMNS: COLUMNS, tables: tables, csv: csv, csvFiles: csvFiles, zip: zip, crc32: crc32, sql: sql };
})();
