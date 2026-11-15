/*
 * Purpose: Remember small per-device choices (language, last open view, connection) between visits.
 * Responsibilities: Read and write single string values in localStorage and never throw when storage is blocked. It holds conveniences only: orders, notes, payments and the catalog go through the store, never through here.
 */
window.NT = window.NT || {};

NT.prefs = (function () {
  "use strict";
  var PREFIX = "notas:pref:";

  function get(name) {
    try {
      return localStorage.getItem(PREFIX + name);
    } catch {
      // catch-ok: blocked storage behaves as if nothing was remembered.
      return null;
    }
  }

  function set(name, value) {
    try {
      localStorage.setItem(PREFIX + name, String(value));
      return true;
    } catch {
      // catch-ok: with blocked storage the choice simply does not persist.
      return false;
    }
  }

  return { get: get, set: set };
})();
