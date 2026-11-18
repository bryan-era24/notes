/*
 * Purpose: Turn a print model (NT.logic.printModel) into printable HTML: a letter page and an 80 mm (or 58 mm) ticket.
 * Responsibilities: Build markup only, from the model and a translate function passed in, escaping every value. It must not
 * read data, call print or touch the page; styling lives in css/print.css (black on white, thin rules, no fills).
 */
window.NT = window.NT || {};

NT.print = (function () {
  "use strict";

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function money(c) {
    return NT.logic.formatMoney(c);
  }
  function statusText(m, t) {
    return t("pay.status." + m.status);
  }
  function date(opts, d) {
    return d ? esc((opts.formatDate || String)(d)) : "";
  }

  function header(m, t, opts, cls) {
    var b = m.business;
    var contact = [b.phone, b.address].filter(Boolean).map(esc).join(" · ");
    var meta = [
      [t("print.folio"), esc(m.folio)],
      [t("print.created"), date(opts, NT.logic.dateOf(m.localDate || m.createdAt))],
      m.customerName ? [t("print.customer"), esc(m.customerName)] : null,
      m.deliveryDate ? [t("print.delivery"), date(opts, m.deliveryDate)] : null,
    ].filter(Boolean);
    return (
      '<header class="' +
      cls +
      '-head">' +
      (b.name ? "<h1>" + esc(b.name) + "</h1>" : "") +
      (contact ? '<p class="contact">' + contact + "</p>" : "") +
      '<dl class="meta">' +
      meta
        .map(function (r) {
          return "<div><dt>" + esc(r[0]) + "</dt><dd>" + r[1] + "</dd></div>";
        })
        .join("") +
      "</dl></header>"
    );
  }

  function noteTitle(m, n, t, opts) {
    var parts = [t("print.note") + " " + n.number];
    if (n.customerName && n.customerName !== m.customerName) parts.push(esc(n.customerName));
    if (n.deliveryDate && n.deliveryDate !== m.deliveryDate) parts.push(t("print.delivery") + " " + date(opts, n.deliveryDate));
    return parts.join(" · ") + (n.cancelled ? ' <span class="cancel-mark">' + esc(t("print.cancelled")) + "</span>" : "");
  }

  function paymentsBlock(m, t, opts) {
    if (!m.payments.length) return "";
    return (
      '<div class="payments"><h3>' +
      esc(t("print.payments")) +
      "</h3><ul>" +
      m.payments
        .map(function (p) {
          return (
            "<li><span>" +
            date(opts, p.date) +
            " · " +
            esc(t("pay.method." + p.method)) +
            "</span><span>" +
            money(p.amount) +
            "</span></li>"
          );
        })
        .join("") +
      "</ul></div>"
    );
  }

  function totalsBlock(m, t) {
    var rows = [[t("print.total"), money(m.total), "total"]];
    if (m.paid) rows.push([t("print.paid"), money(m.paid), ""]);
    var bl = NT.logic.balanceLine(m.balance);
    rows.push([t(bl.kind === "credit" ? "print.credit" : "print.balance"), money(bl.amount), "balance"]);
    return (
      '<div class="totals">' +
      rows
        .map(function (r) {
          return '<div class="' + r[2] + '"><span>' + esc(r[0]) + "</span><span>" + r[1] + "</span></div>";
        })
        .join("") +
      '<p class="pay-status">' +
      esc(t("print.status")) +
      ": <strong>" +
      esc(statusText(m, t)) +
      "</strong></p></div>"
    );
  }

  /** Letter page: one table per note, totals, payments, signature line. */
  function letterHtml(m, t, opts) {
    opts = opts || {};
    var notes = m.notes
      .map(function (n) {
        var body = n.lines.length
          ? '<table class="lines"><thead><tr><th class="num">' +
            esc(t("print.qty")) +
            "</th><th>" +
            esc(t("print.product")) +
            '</th><th class="num">' +
            esc(t("print.unit")) +
            '</th><th class="num">' +
            esc(t("print.amount")) +
            "</th></tr></thead><tbody>" +
            n.lines
              .map(function (l) {
                return (
                  '<tr><td class="num">' +
                  l.qty +
                  "</td><td>" +
                  esc(l.productName) +
                  " " +
                  esc(l.presentationLabel) +
                  '</td><td class="num">' +
                  money(l.unitPrice) +
                  '</td><td class="num">' +
                  money(l.amount) +
                  "</td></tr>"
                );
              })
              .join("") +
            '</tbody><tfoot><tr><td colspan="3">' +
            esc(t("print.subtotal")) +
            '</td><td class="num">' +
            money(n.total) +
            "</td></tr></tfoot></table>"
          : '<p class="note-sum"><span>' + esc(t("print.subtotal")) + "</span><span>" + money(n.total) + "</span></p>";
        return (
          '<section class="note' +
          (n.cancelled ? " cancelled" : "") +
          '"><h2>' +
          noteTitle(m, n, t, opts) +
          "</h2>" +
          body +
          (n.comment ? '<p class="comment">' + esc(n.comment) + "</p>" : "") +
          "</section>"
        );
      })
      .join("");
    return (
      '<article class="print-doc letter">' +
      header(m, t, opts, "letter") +
      (m.comment ? '<p class="comment">' + esc(m.comment) + "</p>" : "") +
      notes +
      '<div class="letter-end">' +
      paymentsBlock(m, t, opts) +
      totalsBlock(m, t) +
      "</div>" +
      '<div class="signature"><span></span><p>' +
      esc(t("print.signature")) +
      "</p></div>" +
      (m.business.footer ? '<p class="footer">' + esc(m.business.footer) + "</p>" : "") +
      "</article>"
    );
  }

  /** Narrow ticket: each line stacked as "product presentation" then "qty × price = amount". */
  function ticketHtml(m, t, opts) {
    opts = opts || {};
    var width = opts.width === 58 ? 58 : 80;
    var notes = m.notes
      .map(function (n) {
        return (
          '<section class="note' +
          (n.cancelled ? " cancelled" : "") +
          '"><h2>' +
          noteTitle(m, n, t, opts) +
          "</h2>" +
          n.lines
            .map(function (l) {
              return (
                '<div class="tline"><div>' +
                esc(l.productName) +
                " " +
                esc(l.presentationLabel) +
                '</div><div class="calc"><span>' +
                l.qty +
                " × " +
                money(l.unitPrice) +
                "</span><span>" +
                money(l.amount) +
                "</span></div></div>"
              );
            })
            .join("") +
          '<div class="tsub"><span>' +
          esc(t("print.subtotal")) +
          "</span><span>" +
          money(n.total) +
          "</span></div></section>"
        );
      })
      .join("");
    return (
      '<article class="print-doc ticket ticket-' +
      width +
      '">' +
      header(m, t, opts, "ticket") +
      notes +
      totalsBlock(m, t) +
      paymentsBlock(m, t, opts) +
      (m.business.footer ? '<p class="footer">' + esc(m.business.footer) + "</p>" : "") +
      "</article>"
    );
  }

  return { letterHtml: letterHtml, ticketHtml: ticketHtml, escape: esc };
})();
