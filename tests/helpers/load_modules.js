/*
 * Purpose: Load browser modules (js/, backend/) into a plain sandbox so they can be unit-tested without a page.
 * Responsibilities: Evaluate the given files in order against a sandbox object where browser globals exist only if the test passes them in, and return the SP namespace. A module that reaches for a browser global it should not use fails here.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

/** A minimal in-memory localStorage. `blocked: true` makes every call throw, like private mode can. */
function fakeStorage(initial = {}, { blocked = false } = {}) {
  const data = new Map(Object.entries(initial));
  const guard = () => {
    if (blocked) throw new Error("storage blocked");
  };
  return {
    getItem: (key) => (guard(), data.has(key) ? data.get(key) : null),
    setItem: (key, value) => (guard(), void data.set(key, String(value))),
    removeItem: (key) => (guard(), void data.delete(key)),
    dump: () => Object.fromEntries(data),
  };
}

// Browser globals a module could reach for. They are undefined in the sandbox unless a test provides
// them, so a module that uses one it should not own fails here instead of touching Node's own.
const BROWSER_GLOBALS = ["localStorage", "document", "navigator", "fetch", "location", "XMLHttpRequest"];

/**
 * Evaluates project files (relative paths) against a sandbox object and returns its NT namespace.
 * The code runs in this realm (so results compare with deepEqual) with the sandbox as its global scope.
 */
function loadModules(files, globals = {}) {
  const sandbox = {};
  for (const name of BROWSER_GLOBALS) sandbox[name] = undefined;
  Object.assign(sandbox, globals);
  sandbox.window = sandbox;
  for (const file of files) {
    const code = fs.readFileSync(path.join(ROOT, file), "utf8");
    new Function("window", "with (window) {\n" + code + "\n}\n//# sourceURL=" + file)(sandbox);
  }
  return sandbox.NT;
}

module.exports = { loadModules, fakeStorage, ROOT };
