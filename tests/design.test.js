/*
 * Purpose: Keep the colour and control standard of docs/DESIGN.md from drifting.
 * Covers: colours only as tokens in :root; every token documented with a meaning and every used token defined; text contrast of 4.5:1
 * for the documented pairs; one distinct style per stage and payment status; no inline colours and a tone on every notice in the
 * markup; and the stage and payment pills shown on the real page.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModules, ROOT } = require("./helpers/load_modules");
const { openApp } = require("./helpers/open_app");

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const CSS = read("css/styles.css");
const ROOT_BLOCK = CSS.match(/:root\s*{([^}]*)}/)[1];
const TOKENS = {};
for (const m of ROOT_BLOCK.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)) TOKENS[m[1]] = m[2].toLowerCase();
const STATUSES = ["pending", "partial", "paid", "credit"];

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** The declarations of every rule whose selector list contains `selector` exactly. */
function rule(selector) {
  const out = [];
  for (const m of CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+){([^}]*)}/g)) {
    const sels = m[1].split(",").map((s) => s.trim());
    if (sels.includes(selector)) out.push(m[2]);
  }
  return out.join(";");
}
function prop(decls, name) {
  const m = decls.match(new RegExp("(?:^|;|\\s)" + name + "\\s*:\\s*([^;]+)"));
  return m ? m[1].trim() : "";
}

test("[TC-NFR-07-01] colours appear only as tokens in :root; outside it every colour is a var()", () => {
  const outside = CSS.replace(/:root\s*{[^}]*}/, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const found = outside.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi) || [];
  assert.deepEqual(found, []);
  for (const m of outside.matchAll(/(?:^|[;{\s])(color|background(?:-color)?|border(?:-[a-z]+)?-color|fill|stroke)\s*:\s*([^;}]+)/g)) {
    const v = m[2].trim();
    assert.ok(/var\(--|currentColor|transparent|none|inherit/.test(v), m[1] + ": " + v);
  }
  assert.ok(Object.keys(TOKENS).length >= 20, "tokens are read from :root");
});

test("[TC-NFR-07-02] every colour token is documented with a meaning, and every token used is defined", () => {
  const doc = read("docs/DESIGN.md");
  for (const [name, value] of Object.entries(TOKENS)) {
    const row = doc.split("\n").find((l) => new RegExp("^\\|\\s*`--" + name + "`\\s*\\|").test(l));
    assert.ok(row, "--" + name + " has a row in docs/DESIGN.md");
    assert.ok(row.includes("`" + value + "`"), "--" + name + " documents its value " + value);
  }
  const defined = new Set([...ROOT_BLOCK.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]));
  for (const f of ["css/styles.css"]) {
    for (const m of read(f).matchAll(/var\(--([a-z0-9-]+)/g)) assert.ok(defined.has(m[1]), "--" + m[1] + " is defined");
  }
});

test("[TC-NFR-07-03] text passes 4.5:1 on its background for every documented pair", () => {
  const T = TOKENS;
  const pairs = [
    ["ink", "sheet"],
    ["ink", "desk"],
    ["ink-soft", "sheet"],
    ["ink-soft", "desk"],
    ["on-ink", "ink"],
    ["on-ink", "done"],
    ["on-ink", "attention"],
    ["on-ink", "danger"],
    ["on-ink-soft", "ink"],
    ["on-ink-attention", "ink"],
    ["on-ink-danger", "ink"],
    ["select", "sheet"],
    ["select", "select-soft"],
    ["ink", "select-soft"],
    ["folio", "sheet"],
    ["progress", "progress-soft"],
    ["done", "done-soft"],
    ["attention", "attention-soft"],
    ["info", "info-soft"],
    ["danger", "danger-soft"],
    ["danger", "sheet"],
    ["muted", "muted-soft"],
    ["muted", "sheet"],
    ["ink", "attention-soft"],
    ["ink", "info-soft"],
    ["ink", "danger-soft"],
    ["ink", "done-soft"],
  ];
  for (const [fg, bg] of pairs) {
    assert.ok(T[fg] && T[bg], fg + " and " + bg + " exist");
    const r = contrast(T[fg], T[bg]);
    assert.ok(r >= 4.5, fg + " on " + bg + " is " + r.toFixed(2) + ":1");
  }
});

test("[TC-NFR-07-04] every stage and payment status has its own pill style, and stage chips show the stage colour", () => {
  const NT = loadModules(["js/logic.js"]);
  const seen = new Map();
  const check = (sel) => {
    const d = rule(sel);
    const look = prop(d, "color") + " on " + (prop(d, "background") || prop(d, "background-color"));
    assert.ok(/var\(--/.test(look), sel + " sets its colours from tokens");
    assert.ok(!seen.has(look), sel + " looks different from " + seen.get(look));
    seen.set(look, sel);
  };
  for (const s of NT.logic.STAGES) {
    check(".stage-" + s);
    assert.ok(CSS.includes('.chips button[data-stage="' + s + '"][aria-pressed="true"]'), "pressed chip of " + s);
  }
  seen.clear();
  for (const s of STATUSES) check(".pay-" + s);
  assert.match(rule(".stage-cancelled"), /line-through/);
});

test("[TC-NFR-07-05] the markup has no inline colours and every notice carries a tone", () => {
  const code = read("js/app.js") + read("index.html");
  assert.deepEqual(code.match(/style="[^"]*(?:color|background)[^"]*"/g) || [], []);
  const notices = [...code.matchAll(/class="notice([^"]*)"/g)].map((m) => m[1].trim());
  assert.ok(notices.length > 5);
  for (const n of notices) assert.match(n, /^(warn|info|error|danger|ok)\b/, "notice tone: '" + n + "'");
  for (const tone of ["warn", "info", "error", "danger", "ok"]) assert.ok(rule(".notice." + tone), ".notice." + tone + " is styled");
});

test("[TC-NFR-07-06] the order list shows the stage and the payment status as coloured pills with words", async () => {
  const app = await openApp();
  await app.click('[data-act="demoLoad"]');
  await app.waitFor(() => app.window.document.querySelectorAll(".stub").length > 3);
  const doc = app.window.document;
  const stage = doc.querySelector(".stub .pill[class*='stage-']");
  const pay = doc.querySelector(".stub .pill[class*='pay-']");
  assert.ok(stage && stage.textContent.trim().length > 2, "stage pill with words");
  assert.ok(pay && pay.textContent.trim().length > 2, "payment pill with words");
  await app.click(".stub");
  await app.waitFor(() => doc.querySelector('[data-act="stage"]'));
  const chip = doc.querySelector('[data-act="stage"][aria-pressed="true"]');
  assert.ok(chip.getAttribute("data-stage"), "the pressed stage chip names its stage");
});
