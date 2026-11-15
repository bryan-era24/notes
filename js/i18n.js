/*
 * Purpose: The language engine: one map of key -> text per language, and the functions that apply it.
 * Responsibilities: Register languages, pick the first-run language, translate a key (t) and paint the fixed texts of the HTML (apply). It must not contain any user-facing text itself (texts live in js/lang/) and it does not repaint what app.js draws.
 */
window.NT = window.NT || {};

NT.i18n = (function () {
  "use strict";
  var languages = {}; // code -> { name, dict }
  var current = null;

  function register(code, name, dict) {
    languages[code] = { name: name, dict: dict };
  }

  function list() {
    return Object.keys(languages).map(function (code) {
      return { code: code, name: languages[code].name };
    });
  }

  function fallback() {
    var code = NT.config && NT.config.fallbackLang;
    return languages[code] ? code : Object.keys(languages)[0];
  }

  function own(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  /**
   * Text of a key in the current language; if missing, in the fallback language; if missing, the key.
   * Replaces {name} with vars.name. Lists (month names) are returned as they are.
   */
  function t(key, vars) {
    var dict = (languages[current] || {}).dict || {};
    var base = (languages[fallback()] || {}).dict || {};
    var value = own(dict, key) ? dict[key] : own(base, key) ? base[key] : key;
    if (typeof value !== "string" || !vars) return value;
    return value.replace(/\{(\w+)\}/g, function (match, name) {
      return own(vars, name) ? String(vars[name]) : match;
    });
  }

  /**
   * Paints the fixed texts of the HTML:
   *   data-i18n="key"                     -> textContent
   *   data-i18n-attr="attribute:key;..."  -> attributes (aria-label, placeholder)
   */
  function apply(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr")
        .split(";")
        .forEach(function (pair) {
          var i = pair.indexOf(":");
          if (i > 0) el.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim()));
        });
    });
    document.documentElement.lang = current;
    document.title = t("app.title");
  }

  /** Saved choice first; then NT.config.defaultLang ("auto" = browser language); then the fallback. */
  function pick() {
    var saved = NT.prefs.get("lang");
    if (saved && languages[saved]) return saved;
    var wanted = (NT.config && NT.config.defaultLang) || "auto";
    if (wanted === "auto") {
      var browser = String((typeof navigator !== "undefined" && navigator.language) || "")
        .slice(0, 2)
        .toLowerCase();
      return languages[browser] ? browser : fallback();
    }
    return languages[wanted] ? wanted : fallback();
  }

  function setLang(code) {
    if (!languages[code]) return false;
    current = code;
    NT.prefs.set("lang", code);
    apply(document);
    return true;
  }

  function init() {
    current = pick();
    apply(document);
    return current;
  }

  return {
    register: register,
    list: list,
    t: t,
    apply: apply,
    setLang: setLang,
    init: init,
    get current() {
      return current;
    },
    keys: function (code) {
      return Object.keys((languages[code] || {}).dict || {});
    },
  };
})();
