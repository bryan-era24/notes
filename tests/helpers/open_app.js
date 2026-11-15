/*
 * Purpose: Open the real index.html in a simulated browser (jsdom) for tests, with no network.
 * Responsibilities: Load the page's scripts from disk in their declared order, serve only the project files a test allows (and a fake database server when one is given), record console output, downloads and print calls (with the page title at that moment), and fail loudly if anything else tries to reach the network. It is the only file allowed to require jsdom (tests/architecture.test.js).
 */
"use strict";
const { JSDOM } = require("jsdom");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const STORAGE_KEY = "notas:v1";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Paths of the scripts index.html loads, in order. */
function scriptPaths() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
}

/**
 * Opens the app.
 *   storage  localStorage contents before the app starts: { key: string }
 *   files    project files fetch may serve (default: only the example seed, as in the public repo)
 *   extra    in-memory files: { "data/seed.json": "<json text>" }
 *   language navigator.language seen by the page
 *   remote   a fake database server (tests/helpers/fake_supabase.js); only its base URL is reachable
 *   query    the page's query string, for example "?debug=info"
 *   setup    a function given the window before the page's scripts run (to add browser features such as showDirectoryPicker)
 *   indexedDB  an IndexedDB factory (fake-indexeddb) to give the page; without it the page uses localStorage
 */
async function openApp({
  storage = {},
  files = [],
  extra = {},
  language = "es-MX",
  remote = null,
  query = "",
  indexedDB = null,
  setup = null,
} = {}) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://app.test/index.html" + query });
  const window = dom.window;
  const blocked = [];
  const consoleCalls = [];
  const downloads = [];

  // Console output is recorded, never printed: the app must stay silent unless logging is turned on.
  window.console = {};
  for (const method of ["log", "info", "warn", "error", "debug"])
    window.console[method] = (...args) => consoleCalls.push([method, ...args]);
  // Downloads are captured instead of saved.
  const blobs = new Map();
  window.URL.createObjectURL = (blob) => {
    const url = "blob:test/" + blobs.size;
    blobs.set(url, blob);
    return url;
  };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {
    if (this.download) downloads.push({ name: this.download, blob: blobs.get(this.href) });
  };

  Object.defineProperty(window.navigator, "language", { value: language, configurable: true });
  window.scrollTo = () => {};
  if (indexedDB) window.indexedDB = indexedDB;
  if (setup) setup(window);
  const prints = [];
  window.print = () =>
    prints.push({
      kind: window.document.body.getAttribute("data-printing"),
      html: window.document.getElementById("print-root").innerHTML,
      page: window.document.getElementById("page-size").textContent,
      title: window.document.title,
    });
  Object.entries(storage).forEach(([key, value]) => window.localStorage.setItem(key, value));

  // Offline guard: only relative project files are served; anything else is recorded and refused.
  window.fetch = async (url, init) => {
    url = String(url);
    if (remote && url.startsWith(remote.base)) return remote.fetch(url, init);
    if (/^[a-z]+:/i.test(url) || url.startsWith("//")) {
      blocked.push(url);
      throw new Error("offline guard: tests must not reach " + url);
    }
    if (Object.prototype.hasOwnProperty.call(extra, url)) return { ok: true, json: async () => JSON.parse(extra[url]) };
    if (url === "sw.js") return { ok: false };
    if (!files.includes(url)) return { ok: false };
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, url), "utf8")) };
  };
  window.XMLHttpRequest = function () {
    blocked.push("XMLHttpRequest");
    throw new Error("offline guard: XMLHttpRequest is not allowed in tests");
  };
  window.WebSocket = function () {
    blocked.push("WebSocket");
    throw new Error("offline guard: WebSocket is not allowed in tests");
  };

  for (const src of scriptPaths()) window.eval(fs.readFileSync(path.join(ROOT, src), "utf8"));
  await wait(120);

  const $ = (id) => window.document.getElementById(id);
  /** Waits until `check()` is true, up to `ms`. */
  const waitFor = async (check, ms = 4000) => {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error("timed out waiting for the page");
      await wait(20);
    }
  };
  return {
    window,
    $,
    blocked,
    consoleCalls,
    downloads,
    downloadText: async (i) => downloads[i].blob.text(),
    prints,
    click: async (selector) => {
      const el = typeof selector === "string" ? window.document.querySelector(selector) : selector;
      if (!el) throw new Error("not found: " + selector);
      el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
      await wait(30);
    },
    type: async (el, value) => {
      if (typeof el === "string") el = window.document.querySelector(el);
      el.value = value;
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
      el.dispatchEvent(new window.Event("change", { bubbles: true }));
      await wait(20);
    },
    go: async (hash) => {
      window.location.hash = hash;
      await wait(60);
    },
    text: () => window.document.getElementById("view").textContent,
    wait,
    waitFor,
    stored: () => JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}"),
    submit: (id) => $(id).dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true })),
    fire: (node, type) => node.dispatchEvent(new window.Event(type, { bubbles: true })),
    byText: (selector, pattern) => [...window.document.querySelectorAll(selector)].find((el) => pattern.test(el.textContent)),
  };
}

module.exports = { openApp, scriptPaths, ROOT, STORAGE_KEY, wait };
