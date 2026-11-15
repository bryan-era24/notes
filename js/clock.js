/*
 * Purpose: The one owner of the clock and of random ids, so every other module can stay pure and testable.
 * Responsibilities: Give the current time, today's local date ("YYYY-MM-DD" in this device's time zone) and new unique ids.
 */
window.NT = window.NT || {};

NT.clock = (function () {
  "use strict";
  function pad(n) {
    return String(n).padStart(2, "0");
  }
  return {
    now: function () {
      return new Date();
    },
    /** Local calendar date, not UTC: an order taken at 7 pm in Guadalajara belongs to that day. */
    today: function () {
      var d = new Date();
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    },
    uuid: function () {
      if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
      var b = new Uint8Array(16);
      if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
      else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      var h = Array.from(b, function (x) {
        return x.toString(16).padStart(2, "0");
      }).join("");
      return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
    },
  };
})();
