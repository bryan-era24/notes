/*
 * Purpose: Enforce the project rules adopted from Budget, Relieve and the bot, so they cannot drift silently.
 * Covers: every text key used exists in js/lang/es.js; who may use localStorage, fetch, the console, the clock and randomness; pure modules
 * stay pure; no runtime dependencies or remote scripts; every file starts with Purpose and Responsibilities (Covers for tests); every catch is
 * justified; the offline worker caches exactly the files the page loads; and no personal data file is tracked.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModules, ROOT } = require("./helpers/load_modules");
const { scriptPaths } = require("./helpers/open_app");

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const list = (dir, ext) =>
  fs
    .readdirSync(path.join(ROOT, dir), { recursive: true })
    .filter((f) => f.endsWith(ext))
    .map((f) => path.join(dir, f));
const SOURCES = [...list("js", ".js"), ...list("backend", ".js")];

test("[TC-NFR-02-01] every text key used in code and HTML exists in Spanish", () => {
  const NT = loadModules(["js/i18n.js", "js/lang/es.js"], { NT: undefined });
  const keys = new Set(NT.i18n.keys("es"));
  const used = new Set();
  for (const f of [...SOURCES.filter((x) => x !== "js/i18n.js"), "index.html"]) {
    const code = read(f);
    for (const m of code.matchAll(/\bt\(\s*"([a-zA-Z0-9_.-]+)"/g)) used.add(m[1]);
    for (const m of code.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
  }
  const NTL = loadModules(["js/logic.js"]);
  const dynamic = [
    ...NTL.logic.STAGES.map((s) => "stage." + s),
    ...["pending", "partial", "paid", "credit"].map((s) => "pay.status." + s),
    ...NTL.logic.METHODS.map((m) => "pay.method." + m),
    ...["browser", "escpos-bluetooth", "escpos-serial", "escpos-usb"].map((p) => "printer." + p),
    ...["create", "update", "delete", "restore"].map((h) => "history." + h),
    ...["open", "balance", "all"].map((f) => "orders.filter." + f),
    ...["late", "today", "tomorrow", "week", "later", "noDate", "past"].map((g) => "orders.group." + g),
    ...["today", "tomorrow", "week", "nextWeek"].map((m) => "production." + m),
    ...["today", "week", "month", "lastMonth", "custom"].map((m) => "reports." + m),
    "app.title",
  ];
  dynamic.forEach((k) => used.add(k));
  const missing = [...used].filter((k) => !k.endsWith(".") && !keys.has(k));
  assert.deepEqual(missing, []);
});

test("[TC-NFR-03-01] layers: storage, network, console, clock and randomness have one owner each; pure modules stay pure", () => {
  const owners = {
    "localStorage\\.": ["backend/store.local.js", "js/prefs.js"],
    "\\bfetch\\(": ["backend/remote.js"],
    "console\\.": ["js/log.js"],
    "Math\\.random|crypto\\.": ["js/clock.js"],
  };
  for (const [pattern, allowed] of Object.entries(owners)) {
    const offenders = SOURCES.filter(
      (f) => !allowed.includes(f) && new RegExp(pattern).test(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))
    );
    assert.deepEqual(offenders, [], pattern + " used outside " + allowed.join(", "));
  }
  for (const f of ["js/logic.js", "js/print.js", "js/escpos.js", "backend/rows.js"]) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(code, /new Date\(\)|Date\.now|document\.|window\.(?!NT)|navigator|localStorage|fetch\(/, f + " must stay pure");
  }
  // The app writes data only through the repo (store.batch only for the local cleanup and import).
  const app = read("js/app.js");
  assert.doesNotMatch(app, /store\.set\(/);
});

test("[TC-NFR-03-02] no runtime dependencies, no build step, no remote scripts", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies, undefined);
  const html = read("index.html");
  assert.doesNotMatch(html, /<script[^>]+src="(https?:)?\/\//);
  assert.doesNotMatch(html + read("css/styles.css"), /fonts\.googleapis|https?:\/\/[^"')]*\.(css|js|woff2?)/);
});

test("[TC-NFR-03-03] every source and test file starts with Purpose and Responsibilities (Covers for tests)", () => {
  const files = [...SOURCES, ...list("css", ".css"), "sw.js", "db/schema.sql", ...list("scripts", ".js")];
  for (const f of files) {
    const head = read(f).slice(0, 900);
    assert.match(head, /Purpose:/, f);
    assert.match(head, /Responsibilities:/, f);
  }
  for (const f of list("tests", ".js")) {
    const head = read(f).slice(0, 900);
    assert.match(head, /Purpose:/, f);
    assert.match(head, /Covers:|Responsibilities:/, f);
  }
});

test("[TC-NFR-03-04] every catch re-throws, rejects or says why it is safe", () => {
  for (const f of [...SOURCES, "sw.js"]) {
    const code = read(f);
    for (const m of code.matchAll(/catch\s*(\([^)]*\))?\s*\{([^}]*)/g)) {
      const body = m[2];
      assert.ok(/catch-ok:|throw|reject|NT\.log\.(error|warn)/.test(body), f + ": unexplained catch: " + body.slice(0, 80));
    }
  }
});

test("[TC-NFR-05-01] the offline worker caches exactly what the page loads", () => {
  const sw = read("sw.js");
  const cached = [...sw.matchAll(/"([^"]+\.(js|css|woff2|png|svg|webmanifest|html))"/g)].map((m) => m[1]);
  for (const src of scriptPaths()) assert.ok(cached.includes(src), "sw.js misses " + src);
  for (const href of [...read("index.html").matchAll(/href="([^"#]+\.(css|webmanifest|svg|png))"/g)].map((m) => m[1]))
    assert.ok(cached.includes(href), "sw.js misses " + href);
  for (const f of cached) assert.ok(fs.existsSync(path.join(ROOT, f)), "sw.js lists a missing file " + f);
});

test("[TC-NFR-04-02] no personal data or backups are tracked", () => {
  const ignore = read(".gitignore");
  assert.match(ignore, /respaldo-\*\.json/);
  assert.match(ignore, /notas-\*\.json/);
  const strays = fs.readdirSync(ROOT).filter((f) => /^(notas|respaldo)-.*\.json$/.test(f));
  assert.deepEqual(strays, []);
});
