/*
 * Purpose: Tests for the automatic local backup (js/backup.js).
 * Covers: file names and which daily copies are kept, when to remind, writing the current and daily files into a chosen folder after a
 * change, keeping only the newest 14 daily copies, asking again when the browser drops the folder permission, and the manual fallback.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModules, fakeStorage } = require("./helpers/load_modules");

const B = loadModules(["js/log.js", "js/backup.js"]).backup;

/** An in-memory folder with the parts of FileSystemDirectoryHandle the backup uses. */
function fakeDir(names = []) {
  const files = new Map(names.map((n) => [n, "old"]));
  let perm = "granted";
  return {
    kind: "directory",
    name: "Notas-respaldo",
    files,
    setPermission: (p) => (perm = p),
    queryPermission: async () => perm,
    requestPermission: async () => (perm = "granted"),
    getFileHandle: async (name) => ({
      kind: "file",
      name,
      createWritable: async () => {
        if (perm !== "granted") throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
        let buf = "";
        return { write: async (d) => void (buf += d), close: async () => void files.set(name, buf) };
      },
    }),
    removeEntry: async (name) => void files.delete(name),
    values: async function* () {
      for (const name of [...files.keys()]) yield { kind: "file", name };
    },
  };
}

function controller(opts = {}) {
  const prefs = fakeStorage();
  let clock = Date.parse("2026-11-15T18:00:00Z");
  const timers = [];
  const env = Object.assign(
    {
      now: () => new Date(clock),
      today: () => new Date(clock).toISOString().slice(0, 10),
      exportAll: () => ({ "orders/1": { folio: "A-0001" } }),
      prefs: { get: (k) => prefs.getItem(k), set: (k, v) => prefs.setItem(k, String(v)) },
      handles: null,
      setTimeout: (fn) => timers.push(fn),
      clearTimeout: () => {},
      download: () => {},
      share: null,
    },
    opts
  );
  const c = B.create(env);
  return {
    c,
    env,
    timers,
    tick: (ms) => (clock += ms),
    flush: async () => {
      while (timers.length) await timers.shift()();
    },
  };
}

test("[TC-BAK-01-01] file names, and only the newest 14 daily copies are kept", () => {
  assert.deepEqual(B.fileNames("2026-11-15"), { current: "notas-respaldo-actual.json", daily: "notas-respaldo-2026-11-15.json" });
  const names = ["notas-respaldo-actual.json", "otra-cosa.json"];
  for (let d = 1; d <= 20; d++) names.push("notas-respaldo-2026-11-" + String(d).padStart(2, "0") + ".json");
  const gone = B.toDelete(names, 14);
  assert.deepEqual(gone, [
    "notas-respaldo-2026-11-01.json",
    "notas-respaldo-2026-11-02.json",
    "notas-respaldo-2026-11-03.json",
    "notas-respaldo-2026-11-04.json",
    "notas-respaldo-2026-11-05.json",
    "notas-respaldo-2026-11-06.json",
  ]);
});

test("[TC-BAK-01-02] reminders: nothing without changes, today after a change, overdue when changes waited three days", () => {
  const now = new Date("2026-11-15T18:00:00");
  assert.equal(B.reminder({ lastChangeAt: null, lastBackupAt: null, now }), "none");
  assert.equal(B.reminder({ lastChangeAt: "2026-11-15T10:00:00", lastBackupAt: "2026-11-15T11:00:00", now }), "none");
  assert.equal(
    B.reminder({ lastChangeAt: "2026-11-15T12:00:00", pendingSince: "2026-11-15T12:00:00", lastBackupAt: "2026-11-14T20:00:00", now }),
    "today"
  );
  assert.equal(
    B.reminder({ lastChangeAt: "2026-11-15T12:00:00", pendingSince: "2026-11-11T09:00:00", lastBackupAt: "2026-11-10T20:00:00", now }),
    "overdue"
  );
  assert.equal(
    B.reminder({ lastChangeAt: "2026-11-15T12:00:00", pendingSince: "2026-11-15T12:00:00", lastBackupAt: null, now }),
    "today",
    "first day of use"
  );
});

test("[TC-BAK-02-01] with a chosen folder, a change writes the current and today's file, and old daily copies are removed", async () => {
  const old = [];
  for (let d = 1; d <= 16; d++) old.push("notas-respaldo-2026-10-" + String(d).padStart(2, "0") + ".json");
  const dir = fakeDir(old);
  const { c, timers, flush } = controller({ pickFolder: async () => dir });
  await c.init();
  assert.equal(c.status().state, "off");
  await c.chooseFolder();
  assert.equal(c.status().state, "ready");
  assert.equal(c.status().folder, "Notas-respaldo");
  const saved = JSON.parse(dir.files.get("notas-respaldo-actual.json"));
  assert.equal(saved.app, "notas");
  assert.equal(saved.data["orders/1"].folio, "A-0001");
  assert.ok(dir.files.has("notas-respaldo-2026-11-15.json"));
  const dailies = [...dir.files.keys()].filter((n) => /\d{4}-\d{2}-\d{2}/.test(n));
  assert.equal(dailies.length, 14);
  assert.ok(!dir.files.has("notas-respaldo-2026-10-01.json"));
  assert.ok(c.status().lastAt);

  dir.files.delete("notas-respaldo-actual.json");
  c.noteChange();
  assert.equal(timers.length, 1, "waits for the changes to settle");
  await flush();
  assert.ok(dir.files.has("notas-respaldo-actual.json"));
});

test("[TC-BAK-02-02] when the browser drops the permission, the app asks with one tap and then writes", async () => {
  const dir = fakeDir();
  const handles = new Map();
  const store = { get: async (k) => handles.get(k), set: async (k, v) => void handles.set(k, v), del: async (k) => void handles.delete(k) };
  const first = controller({ pickFolder: async () => dir, handles: store });
  await first.c.init();
  await first.c.chooseFolder();
  // Next time the app opens, the browser wants the person to allow it again.
  dir.setPermission("prompt");
  const again = controller({ handles: store });
  await again.c.init();
  assert.equal(again.c.status().state, "needs-permission");
  dir.files.clear();
  await again.c.reactivate();
  assert.equal(again.c.status().state, "ready");
  assert.ok(dir.files.has("notas-respaldo-actual.json"));
});

test("[TC-BAK-03-01] without folder support the backup is a one-tap download or share, and the reminder clears", async () => {
  const downloads = [];
  const { c, tick } = controller({ pickFolder: null, download: (name, text) => downloads.push([name, text]) });
  await c.init();
  assert.equal(c.status().state, "manual");
  assert.equal(c.status().reminder, "none");
  c.noteChange();
  assert.equal(c.status().reminder, "today");
  tick(4 * 24 * 3600 * 1000);
  c.noteChange();
  assert.equal(c.status().reminder, "overdue", "changes waiting more than three days");
  await c.saveNow();
  assert.equal(downloads[0][0], "notas-respaldo-2026-11-19.json");
  assert.equal(JSON.parse(downloads[0][1]).app, "notas");
  assert.equal(c.status().reminder, "none");
  tick(3600 * 1000);
  c.noteChange();
  assert.equal(c.status().reminder, "none", "a backup today covers today's changes until tomorrow");
  tick(24 * 3600 * 1000);
  c.noteChange();
  assert.equal(c.status().reminder, "today");
});
