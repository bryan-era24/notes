/*
 * Purpose: Diagnostics with levels, so problems can be traced on a phone without writing anything by default.
 * Responsibilities: Keep the current level (off by default), record entries at or below it in a bounded in-memory buffer and the console, mask personal values before they are recorded, and start the downloaded record with a header line (version, browser, mode) that the app supplies. It is the only file allowed to use the console; it never persists entries and never sends them anywhere.
 */
window.NT = window.NT || {};

NT.log = (function () {
  "use strict";

  var LEVELS = { off: 0, error: 1, warn: 2, info: 3, debug: 4 };
  var DEFAULT_BUFFER = 500;
  var MAX_STRING = 200;
  // Keys whose values are personal or secret. Matching is by key name, at any depth.
  var SENSITIVE =
    /^(amount|amounts|name|names|customerName|productName|phone|address|comment|price|unitPrice|total|paid|balance|lines|data|before|after|email|password|joinCode|join_code)$|token|secret|apikey|anonkey|authorization|key$/i;

  var level = LEVELS.off;
  var header = null; // function returning a first line (app version, browser...) for the downloaded record
  var limit = DEFAULT_BUFFER;
  var buffer = [];

  function setLevel(name) {
    level = Object.prototype.hasOwnProperty.call(LEVELS, name) ? LEVELS[name] : LEVELS.off;
    return levelName();
  }
  function levelName() {
    return (
      Object.keys(LEVELS).find(function (k) {
        return LEVELS[k] === level;
      }) || "off"
    );
  }
  function setBufferSize(n) {
    limit = Math.max(10, Math.round(Number(n)) || DEFAULT_BUFFER);
    if (buffer.length > limit) buffer = buffer.slice(-limit);
  }

  /** A copy of `value` with personal and secret fields replaced by "[redacted]". */
  function redact(value, depth) {
    depth = depth || 0;
    if (depth > 6) return "[deep]";
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "…" : value;
    if (typeof value !== "object") return value;
    if (value instanceof Error) return { error: value.name, message: redact(value.message, depth + 1) };
    if (Array.isArray(value))
      return value.slice(0, 50).map(function (v) {
        return redact(v, depth + 1);
      });
    var out = {};
    Object.keys(value).forEach(function (k) {
      out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(value[k], depth + 1);
    });
    return out;
  }

  function write(name, event, fields) {
    if (level === LEVELS.off || LEVELS[name] > level) return;
    var entry = { time: new Date().toISOString(), level: name, event: String(event), fields: redact(fields || {}) };
    buffer.push(entry);
    if (buffer.length > limit) buffer.shift();
    var method = name === "debug" ? "debug" : name === "info" ? "info" : name;
    if (typeof console !== "undefined" && typeof console[method] === "function") console[method]("[notas]", entry.event, entry.fields);
  }

  /** The recorded entries, one line each, ready to download; first the header line when one was set. */
  function dump() {
    var head = "";
    if (header)
      try {
        head = String(header()) + "\n";
      } catch {
        // catch-ok: a header that cannot be built leaves the record without it.
        head = "";
      }
    return (
      head +
      buffer
        .map(function (e) {
          return e.time + " " + e.level.toUpperCase() + " " + e.event + " " + JSON.stringify(e.fields);
        })
        .join("\n")
    );
  }

  return {
    LEVELS: Object.keys(LEVELS),
    setLevel: setLevel,
    level: levelName,
    setBufferSize: setBufferSize,
    redact: redact,
    error: function (event, fields) {
      write("error", event, fields);
    },
    warn: function (event, fields) {
      write("warn", event, fields);
    },
    info: function (event, fields) {
      write("info", event, fields);
    },
    debug: function (event, fields) {
      write("debug", event, fields);
    },
    entries: function () {
      return buffer.slice();
    },
    dump: dump,
    /** Sets the function that writes the record's first line. It must return no personal data. */
    setHeader: function (fn) {
      header = typeof fn === "function" ? fn : null;
    },
    clear: function () {
      buffer = [];
    },
  };
})();
