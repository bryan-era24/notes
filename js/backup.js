/*
 * Purpose: Automatic local backup, so the data can be recovered from the phone's ordinary storage if the app or the phone stops working.
 * Responsibilities: Where the browser can write to a folder (Chrome and Edge on Android and computers), write notas-respaldo-actual.json a
 * minute after changes plus one copy per day, keeping the newest 14; ask again with one tap when the browser drops the permission. Where it
 * cannot (iPhone, Firefox, other browsers), remind once a day after changes and save or share the backup with one tap. The pure helpers
 * (file names, what to delete, when to remind) are tested on their own; the folder, timers and preferences come in through env.
 */
window.NT = window.NT || {};

NT.backup = (function () {
  "use strict";

  var CURRENT = "notas-respaldo-actual.json";
  var DAILY = /^notas-respaldo-(\d{4}-\d{2}-\d{2})\.json$/;
  var KEEP = 14;
  var DELAY_MS = 60000;
  var OVERDUE_DAYS = 3;

  function fileNames(today) {
    return { current: CURRENT, daily: "notas-respaldo-" + today + ".json" };
  }
  /** Daily copies beyond the newest `keep`, oldest first. Other files are never touched. */
  function toDelete(names, keep) {
    var dailies = names
      .filter(function (n) {
        return DAILY.test(n);
      })
      .sort();
    return dailies.slice(0, Math.max(0, dailies.length - keep));
  }
  /**
   * "none" when nothing changed since the last backup or a backup was made today; otherwise "today", or "overdue" once changes have
   * waited more than three days without a backup (pendingSince = the first change after the last backup).
   */
  function reminder(s) {
    if (!s.lastChangeAt) return "none";
    var change = new Date(s.lastChangeAt).getTime();
    var last = s.lastBackupAt ? new Date(s.lastBackupAt).getTime() : null;
    if (last !== null && last >= change) return "none";
    var now = s.now;
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (last !== null && last >= startOfToday) return "none";
    var since = new Date(s.pendingSince || s.lastChangeAt).getTime();
    return now.getTime() - since > OVERDUE_DAYS * 86400000 ? "overdue" : "today";
  }

  /**
   * env: { now(), today(), exportAll(), prefs: { get, set }, handles: { get, set, del } | null, pickFolder: (() => Promise<handle>) | null,
   * setTimeout, clearTimeout, download(name, text), share: ((file) => Promise) | null, onStatus?(status) }
   */
  function create(env) {
    var state = "off"; // off | ready | needs-permission | manual | writing
    var dir = null,
      timer = null,
      lastError = null,
      memoryHandle = null;

    function pref(name) {
      return env.prefs.get("backup." + name) || null;
    }
    function setPref(name, value) {
      env.prefs.set("backup." + name, value === null ? "" : value);
    }
    function status() {
      return {
        state: state,
        folder: dir ? dir.name : pref("folder"),
        lastAt: pref("lastAt"),
        lastError: lastError,
        reminder: reminder({
          lastChangeAt: pref("lastChangeAt"),
          lastBackupAt: pref("lastAt"),
          pendingSince: pref("pendingSince"),
          now: env.now(),
        }),
        canShare: !!env.share,
      };
    }
    function changed() {
      if (env.onStatus) env.onStatus(status());
    }
    function payload() {
      return JSON.stringify({ app: "notas", schemaVersion: 1, exportedAt: env.now().toISOString(), data: env.exportAll() });
    }
    function saveHandle(h) {
      memoryHandle = h;
      if (!env.handles) return Promise.resolve();
      return env.handles.set("backupFolder", h).catch(function (e) {
        // Some handles cannot be stored (tests, old browsers): the folder is then kept for this session only.
        NT.log.warn("backup.handle_not_saved", { error: e });
      });
    }
    function loadHandle() {
      if (memoryHandle || !env.handles) return Promise.resolve(memoryHandle);
      return env.handles.get("backupFolder").catch(function (e) {
        NT.log.warn("backup.handle_not_read", { error: e });
        return null;
      });
    }

    function writeFile(name, text) {
      return dir.getFileHandle(name, { create: true }).then(function (fh) {
        return fh.createWritable().then(function (w) {
          return Promise.resolve(w.write(text)).then(function () {
            return w.close();
          });
        });
      });
    }
    function listNames() {
      var names = [];
      var it = dir.values();
      function step() {
        return it.next().then(function (r) {
          if (r.done) return names;
          if (r.value && r.value.kind === "file") names.push(r.value.name);
          return step();
        });
      }
      return step();
    }

    /** Writes the backup into the folder now. Resolves with the status. */
    function writeNow() {
      if (!dir) return Promise.resolve(status());
      var text = payload();
      var names = fileNames(env.today());
      state = "writing";
      return Promise.resolve(dir.queryPermission ? dir.queryPermission({ mode: "readwrite" }) : "granted")
        .then(function (perm) {
          if (perm !== "granted") {
            var denied = new Error("permission");
            denied.name = "NotAllowedError";
            throw denied;
          }
          return writeFile(names.current, text);
        })
        .then(function () {
          return writeFile(names.daily, text);
        })
        .then(listNames)
        .then(function (all) {
          return toDelete(all, KEEP).reduce(function (chain, n) {
            return chain.then(function () {
              return dir.removeEntry(n);
            });
          }, Promise.resolve());
        })
        .then(
          function () {
            state = "ready";
            lastError = null;
            setPref("lastAt", env.now().toISOString());
            NT.log.info("backup.written", {});
            changed();
            return status();
          },
          function (e) {
            state = e && e.name === "NotAllowedError" ? "needs-permission" : "ready";
            lastError = state === "needs-permission" ? null : String((e && e.message) || e);
            NT.log.warn("backup.write_failed", { error: e });
            changed();
            return status();
          }
        );
    }

    function init() {
      return loadHandle().then(function (h) {
        if (!h) {
          state = env.pickFolder ? "off" : "manual";
          return status();
        }
        dir = h;
        return Promise.resolve(h.queryPermission ? h.queryPermission({ mode: "readwrite" }) : "granted").then(
          function (perm) {
            state = perm === "granted" ? "ready" : "needs-permission";
            if (state === "ready" && status().reminder !== "none") schedule(1000);
            changed();
            return status();
          },
          function (e) {
            NT.log.warn("backup.permission_unknown", { error: e });
            state = "needs-permission";
            return status();
          }
        );
      });
    }

    function schedule(ms) {
      if (timer) env.clearTimeout(timer);
      timer = env.setTimeout(function () {
        timer = null;
        return writeNow();
      }, ms);
    }

    /** Called after every change to the data. */
    function noteChange() {
      var last = pref("lastAt");
      var lastChange = pref("lastChangeAt");
      // The first change after a backup starts the wait that makes a reminder "overdue".
      if (!lastChange || (last && last >= lastChange)) setPref("pendingSince", env.now().toISOString());
      setPref("lastChangeAt", env.now().toISOString());
      if (state === "ready" || state === "writing") schedule(DELAY_MS);
      changed();
    }

    /** Must run from a tap: opens the folder picker, remembers the folder and writes the first backup. */
    function chooseFolder() {
      if (!env.pickFolder) return Promise.resolve(status());
      return env.pickFolder().then(function (h) {
        dir = h;
        setPref("folder", h.name || "");
        return saveHandle(h).then(writeNow);
      });
    }
    /** Must run from a tap: asks the browser again for the folder, then writes. */
    function reactivate() {
      if (!dir) return Promise.resolve(status());
      return Promise.resolve(dir.requestPermission ? dir.requestPermission({ mode: "readwrite" }) : "granted").then(function (perm) {
        state = perm === "granted" ? "ready" : "needs-permission";
        changed();
        return state === "ready" ? writeNow() : status();
      });
    }
    /** Stops writing to the folder (the files already there stay). */
    function forget() {
      dir = null;
      memoryHandle = null;
      setPref("folder", null);
      state = env.pickFolder ? "off" : "manual";
      var done = env.handles ? env.handles.del("backupFolder") : Promise.resolve();
      return Promise.resolve(done).then(function () {
        changed();
        return status();
      });
    }

    /** Manual backup: saves the file through the browser's download. */
    function saveNow() {
      var names = fileNames(env.today());
      env.download(names.daily, payload());
      setPref("lastAt", env.now().toISOString());
      changed();
      return Promise.resolve(status());
    }
    /** Manual backup to another app (Drive, WhatsApp, mail) through the share sheet. */
    function shareNow() {
      if (!env.share) return saveNow();
      var names = fileNames(env.today());
      return env.share(names.daily, payload()).then(function (shared) {
        if (shared) setPref("lastAt", env.now().toISOString());
        changed();
        return status();
      });
    }

    return {
      init: init,
      status: status,
      noteChange: noteChange,
      chooseFolder: chooseFolder,
      reactivate: reactivate,
      forget: forget,
      writeNow: writeNow,
      saveNow: saveNow,
      shareNow: shareNow,
    };
  }

  return { create: create, fileNames: fileNames, toDelete: toDelete, reminder: reminder, KEEP: KEEP };
})();
