/*
 * Purpose: Write the letter note as a real PDF file inside the app, so it can be shared, saved or printed from the phone's share sheet
 * (iPhone Safari stops calling the print dialog after it is cancelled a few times) and named after the customer, folio and date.
 * Responsibilities: Turn a print model (NT.logic.printModel) into the bytes of a one- or many-page US Letter PDF that uses the standard
 * Helvetica fonts, black only, with the same content as the printed letter page (js/print.js). It writes bytes only: it must not read
 * data, touch the page, download or share; js/app.js decides what to do with the file. No libraries (decision 0001).
 */
window.NT = window.NT || {};

NT.pdf = (function () {
  "use strict";

  var PAGE_W = 612; // US Letter in points (72 per inch)
  var PAGE_H = 792;
  var MARGIN = 54;
  var BOTTOM = 64;
  // Helvetica widths (per 1000 units) for the characters that appear in amounts; other characters use an average.
  var WIDTHS = { " ": 278, $: 556, ",": 278, ".": 278, "-": 333, ":": 278, "(": 333, ")": 333 };
  var AVERAGE = 540;
  var AVERAGE_BOLD = 590;
  // Characters outside Latin-1 that the standard fonts' WinAnsiEncoding still has.
  var CP1252 = { "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97 };

  function money(c) {
    return NT.logic.formatMoney(c);
  }

  /** One string of single-byte characters in WinAnsiEncoding; what the fonts cannot show becomes "?". */
  function encode(s) {
    var out = "";
    String(s === null || s === undefined ? "" : s)
      .normalize("NFC")
      .split("")
      .forEach(function (ch) {
        var code = ch.charCodeAt(0);
        if (CP1252[ch]) out += String.fromCharCode(CP1252[ch]);
        else if ((code >= 32 && code < 127) || (code >= 160 && code < 256)) out += ch;
        else if (code === 9) out += " ";
        else out += "?";
      });
    return out;
  }
  /** A PDF string literal: encoded, with backslash and parentheses escaped. */
  function literal(s) {
    return "(" + encode(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)") + ")";
  }
  function width(s, size, bold) {
    var total = 0;
    String(s)
      .split("")
      .forEach(function (ch) {
        if (/[0-9]/.test(ch)) total += 556;
        else if (WIDTHS[ch]) total += WIDTHS[ch];
        else total += bold ? AVERAGE_BOLD : AVERAGE;
      });
    return (total * size) / 1000;
  }
  /** Splits text into lines that fit `max` points (by an average letter width; words longer than a line are cut). */
  function wrap(s, size, max, bold) {
    var words = String(s || "")
      .split(/\s+/)
      .filter(Boolean);
    var lines = [];
    var current = "";
    words.forEach(function (w) {
      var next = current ? current + " " + w : w;
      if (width(next, size, bold) <= max) current = next;
      else {
        if (current) lines.push(current);
        while (width(w, size, bold) > max) {
          var n = Math.max(1, Math.floor((max * 1000) / ((bold ? AVERAGE_BOLD : AVERAGE) * size)));
          lines.push(w.slice(0, n));
          w = w.slice(n);
        }
        current = w;
      }
    });
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  }

  /** Collects drawing commands page by page; y counts from the top of the page. */
  function canvas(continued) {
    var pages = [];
    var ops = null;
    var y = 0;
    function newPage() {
      ops = [];
      pages.push(ops);
      y = MARGIN;
      if (pages.length > 1 && continued) {
        text(continued, MARGIN, 9, false);
        y += 18;
      }
    }
    function text(s, x, size, bold, align) {
      var w = width(s, size, bold);
      var left = align === "right" ? x - w : x;
      ops.push(
        "BT /" +
          (bold ? "F2" : "F1") +
          " " +
          size +
          " Tf " +
          left.toFixed(2) +
          " " +
          (PAGE_H - y).toFixed(2) +
          " Td " +
          literal(s) +
          " Tj ET"
      );
    }
    function rule(x1, x2, thick) {
      ops.push((thick || 0.6) + " w " + x1 + " " + (PAGE_H - y).toFixed(2) + " m " + x2 + " " + (PAGE_H - y).toFixed(2) + " l S");
    }
    /** Starts a new page when `h` points do not fit. */
    function room(h) {
      if (y + h > PAGE_H - BOTTOM) newPage();
    }
    newPage();
    return {
      pages: pages,
      text: text,
      rule: rule,
      room: room,
      down: function (h) {
        y += h;
      },
      y: function () {
        return y;
      },
    };
  }

  /** The PDF file around the pages' drawing commands. Returns a Uint8Array. */
  function assemble(pages, title) {
    var objects = [];
    function add(body) {
      objects.push(body);
      return objects.length;
    }
    add("<< /Type /Catalog /Pages 2 0 R >>");
    add(null); // the page tree, written once the pages exist
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    var kids = [];
    pages.forEach(function (ops) {
      var stream = ops.join("\n");
      var content = add("<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream");
      kids.push(
        add(
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " +
            PAGE_W +
            " " +
            PAGE_H +
            "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " +
            content +
            " 0 R >>"
        )
      );
    });
    objects[1] =
      "<< /Type /Pages /Kids [" +
      kids
        .map(function (k) {
          return k + " 0 R";
        })
        .join(" ") +
      "] /Count " +
      kids.length +
      " >>";
    var info = add("<< /Title " + literal(title || "") + " /Producer (Notas) >>");
    var out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    var offsets = [];
    objects.forEach(function (body, i) {
      offsets.push(out.length);
      out += i + 1 + " 0 obj\n" + body + "\nendobj\n";
    });
    var xref = out.length;
    out += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
    offsets.forEach(function (o) {
      out += String(o).padStart(10, "0") + " 00000 n \n";
    });
    out += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R /Info " + info + " 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
    var bytes = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }

  /**
   * The letter page of an order or of one note, as PDF bytes.
   * t: translate function; opts: { formatDate?(date), title? }.
   */
  function letter(m, t, opts) {
    opts = opts || {};
    var fmt = opts.formatDate || String;
    var right = PAGE_W - MARGIN;
    var c = canvas(m.folio + " · " + (m.customerName || "") + " (" + t("pdf.continued") + ")");
    var b = m.business;

    // Header: business on the left, folio on the right.
    if (b.name) c.text(b.name, MARGIN, 18, true);
    c.text(t("print.folio") + " " + m.folio, right, 16, true, "right");
    c.down(18);
    var contact = [b.phone, b.address].filter(Boolean).join(" · ");
    if (contact) {
      c.text(contact, MARGIN, 10, false);
      c.down(14);
    }
    c.down(6);
    [
      [t("print.created"), fmt(NT.logic.dateOf(m.localDate || m.createdAt))],
      m.customerName ? [t("print.customer"), m.customerName] : null,
      m.deliveryDate ? [t("print.delivery"), fmt(m.deliveryDate)] : null,
    ]
      .filter(Boolean)
      .forEach(function (r) {
        c.text(r[0] + ":", MARGIN, 11, true);
        c.text(r[1], MARGIN + 70, 11, false);
        c.down(15);
      });
    if (m.comment) {
      wrap(m.comment, 10, right - MARGIN).forEach(function (l) {
        c.text(l, MARGIN, 10, false);
        c.down(13);
      });
    }
    c.down(4);
    c.rule(MARGIN, right, 1);
    c.down(18);

    // Notes: one table each.
    var colQty = MARGIN + 28;
    var colName = MARGIN + 40;
    var colUnit = right - 90;
    var nameWidth = colUnit - 70 - colName;
    m.notes.forEach(function (n) {
      c.room(60);
      var title = t("print.note") + " " + n.number;
      if (n.customerName && n.customerName !== m.customerName) title += " · " + n.customerName;
      if (n.deliveryDate && n.deliveryDate !== m.deliveryDate) title += " · " + t("print.delivery") + " " + fmt(n.deliveryDate);
      if (n.cancelled) title += " · " + t("print.cancelled");
      c.text(title, MARGIN, 12, true);
      c.down(16);
      if (n.lines.length) {
        c.text(t("print.qty"), colQty, 9, true, "right");
        c.text(t("print.product"), colName, 9, true);
        c.text(t("print.unit"), colUnit, 9, true, "right");
        c.text(t("print.amount"), right, 9, true, "right");
        c.down(5);
        c.rule(MARGIN, right, 0.5);
        c.down(13);
        n.lines.forEach(function (l) {
          var name = wrap(l.productName + " " + l.presentationLabel, 10, nameWidth);
          c.room(14 * name.length + 4);
          c.text(String(l.qty), colQty, 10, false, "right");
          c.text(money(l.unitPrice), colUnit, 10, false, "right");
          c.text(money(l.amount), right, 10, false, "right");
          name.forEach(function (part, i) {
            if (i) c.down(13);
            c.text(part, colName, 10, false);
          });
          c.down(15);
        });
        c.rule(colName, right, 0.5);
        c.down(13);
      }
      c.text(t("print.subtotal"), colUnit, 10, true, "right");
      c.text(money(n.total), right, 10, true, "right");
      c.down(16);
      if (n.comment) {
        wrap(n.comment, 10, right - MARGIN).forEach(function (l) {
          c.room(13);
          c.text(l, MARGIN, 10, false);
          c.down(13);
        });
      }
      c.down(8);
    });

    // Payments and totals.
    if (m.payments.length) {
      c.room(30 + 14 * m.payments.length);
      c.text(t("print.payments"), MARGIN, 11, true);
      c.down(15);
      m.payments.forEach(function (p) {
        c.room(14);
        c.text(fmt(p.date) + " · " + t("pay.method." + p.method), MARGIN, 10, false);
        c.text(money(p.amount), MARGIN + 260, 10, false, "right");
        c.down(14);
      });
      c.down(6);
    }
    var bl = NT.logic.balanceLine(m.balance);
    var rows = [[t("print.total"), money(m.total)]];
    if (m.paid) rows.push([t("print.paid"), money(m.paid)]);
    rows.push([t(bl.kind === "credit" ? "print.credit" : "print.balance"), money(bl.amount)]);
    c.room(18 * rows.length + 30);
    c.rule(right - 220, right, 1);
    c.down(16);
    rows.forEach(function (r, i) {
      var bold = i === 0 || i === rows.length - 1;
      c.text(r[0], right - 100, i === 0 ? 13 : 11, bold, "right");
      c.text(r[1], right, i === 0 ? 13 : 11, bold, "right");
      c.down(17);
    });
    c.text(t("print.status") + ": " + t("pay.status." + m.status), right, 11, true, "right");
    c.down(46);

    // Signature and footer.
    c.room(50);
    c.rule(MARGIN, MARGIN + 260, 0.6);
    c.down(13);
    c.text(t("print.signature"), MARGIN, 9, false);
    c.down(24);
    if (b.footer) {
      c.room(14);
      c.text(b.footer, MARGIN, 10, false);
    }
    return assemble(c.pages, opts.title || m.folio);
  }

  return { letter: letter, encode: encode };
})();
