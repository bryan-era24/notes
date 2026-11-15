/*
 * Purpose: Encode a print model as ESC/POS bytes, the command language of most thermal ticket printers, ready for when a printer is chosen.
 * Responsibilities: Lay out the ticket in a fixed number of columns (48 for 80 mm, 32 for 58 mm), encode text in code page 850 so Spanish
 * accents print, and add the init, alignment, bold, size, feed and cut commands. It is pure: no device access (transports live in js/printers.js).
 */
window.NT = window.NT || {};

NT.escpos = (function () {
  "use strict";

  var ESC = 0x1b,
    GS = 0x1d,
    LF = 0x0a;
  // Code page 850 for the characters Spanish needs; everything else outside ASCII becomes "?".
  var CP850 = {
    "á": 0xa0,
    "é": 0x82,
    "í": 0xa1,
    "ó": 0xa2,
    "ú": 0xa3,
    "Á": 0xb5,
    "É": 0x90,
    "Í": 0xd6,
    "Ó": 0xe0,
    "Ú": 0xe9,
    "ñ": 0xa4,
    "Ñ": 0xa5,
    "ü": 0x81,
    "Ü": 0x9a,
    "¿": 0xa8,
    "¡": 0xad,
    "°": 0xf8,
    "ç": 0x87,
    "Ç": 0x80,
    "·": 0xfa,
    "×": 0x9e,
  };
  var REVERSE = {};
  Object.keys(CP850).forEach(function (k) {
    REVERSE[CP850[k]] = k;
  });

  /** Text -> code page 850 bytes. */
  function text(s) {
    var out = [];
    Array.from(String(s)).forEach(function (ch) {
      var code = ch.charCodeAt(0);
      if (code >= 0x20 && code < 0x7f) out.push(code);
      else if (ch === "\n") out.push(LF);
      else if (Object.prototype.hasOwnProperty.call(CP850, ch)) out.push(CP850[ch]);
      else {
        var base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
        out.push(base.length === 1 && base.charCodeAt(0) < 0x7f ? base.charCodeAt(0) : 0x3f);
      }
    });
    return Uint8Array.from(out);
  }

  /** Left text and right text on one row of `cols` characters. */
  function row(left, right, cols) {
    left = String(left);
    right = String(right);
    var space = cols - left.length - right.length;
    if (space < 1) {
      left = left.slice(0, Math.max(0, cols - right.length - 1));
      space = cols - left.length - right.length;
    }
    return left + " ".repeat(Math.max(1, space)) + right;
  }

  /** Word wrap to `cols` characters; words longer than a line are cut. */
  function wrap(s, cols) {
    var lines = [],
      current = "";
    String(s)
      .split(/\s+/)
      .filter(Boolean)
      .forEach(function (word) {
        while (word.length > cols) {
          if (current) {
            lines.push(current);
            current = "";
          }
          lines.push(word.slice(0, cols));
          word = word.slice(cols);
        }
        if (!current) current = word;
        else if (current.length + 1 + word.length <= cols) current += " " + word;
        else {
          lines.push(current);
          current = word;
        }
      });
    if (current) lines.push(current);
    return lines;
  }

  function Builder() {
    var parts = [];
    var api = {
      raw: function () {
        parts.push(Uint8Array.from(arguments));
        return api;
      },
      line: function (s) {
        parts.push(text(s));
        parts.push(Uint8Array.of(LF));
        return api;
      },
      align: function (where) {
        return api.raw(ESC, 0x61, where === "center" ? 1 : where === "right" ? 2 : 0);
      },
      bold: function (on) {
        return api.raw(ESC, 0x45, on ? 1 : 0);
      },
      size: function (double) {
        return api.raw(GS, 0x21, double ? 0x11 : 0x00);
      },
      bytes: function () {
        var total = parts.reduce(function (n, p) {
          return n + p.length;
        }, 0);
        var out = new Uint8Array(total),
          at = 0;
        parts.forEach(function (p) {
          out.set(p, at);
          at += p.length;
        });
        return out;
      },
    };
    return api;
  }

  /**
   * The ticket for a print model. options: { cols: 48 | 32, formatDate?(date), cut?: true }
   */
  function encode(m, t, options) {
    options = options || {};
    var cols = options.cols === 32 ? 32 : 48;
    var half = Math.floor(cols / 2);
    var fmt = options.formatDate || String;
    var money = NT.logic.formatMoney;
    var b = Builder().raw(ESC, 0x40).raw(ESC, 0x74, 0x02);
    var rule = "-".repeat(cols);

    b.align("center");
    if (m.business.name) {
      b.bold(true).size(true);
      wrap(m.business.name, half).forEach(b.line);
      b.size(false).bold(false);
    }
    [m.business.phone, m.business.address].filter(Boolean).forEach(function (s) {
      wrap(s, cols).forEach(b.line);
    });
    b.align("left").line(rule);
    b.bold(true)
      .line(row(t("print.folio"), m.folio, cols))
      .bold(false);
    b.line(row(t("print.created"), fmt(NT.logic.dateOf(m.localDate || m.createdAt)), cols));
    if (m.customerName) wrap(t("print.customer") + ": " + m.customerName, cols).forEach(b.line);
    if (m.deliveryDate) b.line(row(t("print.delivery"), fmt(m.deliveryDate), cols));

    m.notes.forEach(function (n) {
      b.line(rule);
      var title = t("print.note") + " " + n.number + (n.cancelled ? " " + t("print.cancelled") : "");
      b.bold(true);
      wrap(title, cols).forEach(b.line);
      b.bold(false);
      if (n.customerName && n.customerName !== m.customerName) wrap(n.customerName, cols).forEach(b.line);
      n.lines.forEach(function (l) {
        wrap(l.productName + " " + l.presentationLabel, cols).forEach(b.line);
        b.line(row("  " + l.qty + " x " + money(l.unitPrice), money(l.amount), cols));
      });
      b.line(row(t("print.subtotal"), money(n.total), cols));
    });

    b.line(rule);
    b.bold(true)
      .line(row(t("print.total"), money(m.total), cols))
      .bold(false);
    if (m.paid) b.line(row(t("print.paid"), money(m.paid), cols));
    b.bold(true)
      .size(true)
      .line(row(t("print.balance"), money(Math.max(0, m.balance)), half))
      .size(false)
      .bold(false);
    b.align("center").line(t("pay.status." + m.status));
    if (m.business.footer) {
      b.line("");
      wrap(m.business.footer, cols).forEach(b.line);
    }
    b.raw(ESC, 0x64, 4); // feed 4 lines
    if (options.cut !== false) b.raw(GS, 0x56, 0x42, 0x00);
    return b.bytes();
  }

  /** Bytes back to readable text, dropping commands. For tests and the "preview" in diagnostics. */
  function decodeForTest(bytes) {
    var out = "",
      i = 0;
    while (i < bytes.length) {
      var c = bytes[i];
      if (c === ESC) {
        i += bytes[i + 1] === 0x40 ? 2 : 3;
        continue;
      }
      if (c === GS) {
        i += bytes[i + 1] === 0x56 ? 4 : 3;
        continue;
      }
      out += c === LF ? "\n" : c < 0x80 ? String.fromCharCode(c) : REVERSE[c] || "?";
      i++;
    }
    return out;
  }

  return { encode: encode, text: text, row: row, wrap: wrap, decodeForTest: decodeForTest };
})();
