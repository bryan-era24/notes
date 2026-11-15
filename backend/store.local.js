/*
 * Purpose: The device store: every document of the app held in memory and saved to this browser's storage, and the core the synced
 * backend builds on. IndexedDB is used when the browser has it (backend/store.idb.js); localStorage otherwise.
 * Responsibilities: Implement the store contract of backend/store.js with atomic multi-document writes that are saved one after another
 * (a write resolves only once it is safely stored; a failed write is undone in memory), refuse to start over data it cannot read (fail
 * closed), and let the synced backend record pending changes inside the same write. It must not touch the DOM or the network.
 */
window.NT = window.NT || {};
NT.backends = NT.backends || {};

/**
 * The store over in-memory `data`. `persist(data, puts, removes)` saves the changed paths (puts: { path: document }, removes: [path])
 * and returns a Promise, or throws. hooks.afterWrite(data, changes) runs inside every user write, before saving; whatever it puts under
 * a path starting with "_" is saved in the same write. Returns { store, core }.
 */
NT.openStoreCore = function (data, persist, hooks) {
  "use strict";
  hooks = hooks || {};
  var listeners = [];
  var queue = Promise.resolve();

  function isInternal(path) {
    return path.charAt(0) === "_";
  }
  function own(path) {
    return Object.prototype.hasOwnProperty.call(data, path);
  }
  function userPaths() {
    return Object.keys(data).filter(function (k) {
      return !isInternal(k);
    });
  }
  function internalSnapshot() {
    var out = {};
    Object.keys(data)
      .filter(isInternal)
      .forEach(function (k) {
        out[k] = JSON.stringify(data[k]);
      });
    return out;
  }
  function notify(changes) {
    listeners.slice().forEach(function (fn) {
      fn(changes);
    });
  }
  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  /**
   * Runs `mutate()` (which changes `data` and returns the changes), the hook, and the save, as one step after the previous one.
   * On a failed save every path it touched is put back as it was, so memory never shows what storage does not hold.
   */
  function step(mutate, runHook) {
    var run = queue.then(function () {
      var previous = {};
      var internalBefore = internalSnapshot();
      var touched = [];
      function remember(path) {
        if (!Object.prototype.hasOwnProperty.call(previous, path)) previous[path] = own(path) ? data[path] : undefined;
      }
      var changes;
      try {
        changes = mutate(remember);
        if (runHook && hooks.afterWrite && changes.length) hooks.afterWrite(data, changes);
      } catch (e) {
        // catch-ok: memory is put back as it was and the error is returned to the caller as a rejection below.
        Object.keys(previous).forEach(function (p) {
          if (previous[p] === undefined) delete data[p];
          else data[p] = previous[p];
        });
        return Promise.reject(e);
      }
      var puts = {},
        removes = [];
      changes.forEach(function (c) {
        touched.push(c.path);
        if (own(c.path)) puts[c.path] = data[c.path];
        else removes.push(c.path);
      });
      var internalAfter = internalSnapshot();
      Object.keys(Object.assign({}, internalBefore, internalAfter)).forEach(function (k) {
        if (internalBefore[k] === internalAfter[k]) return;
        if (own(k)) puts[k] = data[k];
        else removes.push(k);
      });
      return Promise.resolve()
        .then(function () {
          return persist(data, puts, removes);
        })
        .then(
          function () {
            NT.log.debug("store.write", { paths: touched.length });
            if (changes.length) notify(changes);
          },
          function (e) {
            Object.keys(previous).forEach(function (p) {
              if (previous[p] === undefined) delete data[p];
              else data[p] = previous[p];
            });
            Object.keys(Object.assign({}, internalBefore, internalSnapshot())).forEach(function (k) {
              if (internalBefore[k] === undefined) delete data[k];
              else data[k] = JSON.parse(internalBefore[k]);
            });
            NT.log.error("store.write_failed", { error: e });
            throw e;
          }
        );
    });
    queue = run.catch(function () {
      // catch-ok: the failure is reported to the caller of this write; the next write still runs.
    });
    return run;
  }

  /** A user write: ops [{ path, value | null }], plus optional internal documents saved with it. */
  function write(ops, internal) {
    return step(function (remember) {
      var changes = ops.map(function (op) {
        if (!op.path || isInternal(op.path)) throw new Error("invalid path");
        remember(op.path);
        if (op.value === null) delete data[op.path];
        else data[op.path] = clone(op.value);
        return { path: op.path, op: op.value === null ? "remove" : "upsert" };
      });
      Object.keys(internal || {}).forEach(function (k) {
        data[k] = internal[k];
      });
      return changes;
    }, true);
  }

  var store = {
    get: function (path) {
      return clone(data[path]);
    },
    /** Documents of a collection: [{ id, path, data }], sorted by path. */
    list: function (collection) {
      var prefix = collection + "/";
      return Object.keys(data)
        .filter(function (k) {
          return k.indexOf(prefix) === 0;
        })
        .sort()
        .map(function (k) {
          return { id: k.slice(prefix.length), path: k, data: clone(data[k]) };
        });
    },
    set: function (path, value) {
      return write([{ path: path, value: value }]);
    },
    batch: function (ops) {
      return write(ops);
    },
    onChange: function (fn) {
      listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (f) {
          return f !== fn;
        });
      };
    },
    isEmpty: function () {
      return userPaths().length === 0;
    },
    exportAll: function () {
      var out = {};
      userPaths().forEach(function (k) {
        out[k] = clone(data[k]);
      });
      return out;
    },
    /**
     * mode "merge": adds documents that are new or newer (by updatedAt). mode "replace": the device holds exactly `docs`
     * afterwards, and its previous documents are kept in "_import/before". Returns a Promise of { added, updated, kept }.
     */
    importAll: function (docs, mode) {
      var ops = [],
        internal = {},
        result = { added: 0, updated: 0, kept: 0 };
      var incoming = Object.keys(docs).filter(function (k) {
        return !isInternal(k);
      });
      if (mode === "replace") {
        userPaths().forEach(function (k) {
          if (!Object.prototype.hasOwnProperty.call(docs, k)) ops.push({ path: k, value: null });
        });
        incoming.forEach(function (k) {
          ops.push({ path: k, value: docs[k] });
          result[own(k) ? "updated" : "added"]++;
        });
        internal["_import/before"] = { at: new Date().toISOString(), documents: store.exportAll() };
      } else {
        incoming.forEach(function (k) {
          if (!own(k)) {
            ops.push({ path: k, value: docs[k] });
            result.added++;
          } else if (String((docs[k] || {}).updatedAt || "") > String((data[k] || {}).updatedAt || "")) {
            ops.push({ path: k, value: docs[k] });
            result.updated++;
          } else result.kept++;
        });
      }
      return write(ops, internal).then(function () {
        return result;
      });
    },
  };

  /** Direct access for the synced backend: changes made here never create pending changes. */
  var core = {
    get: function (path) {
      return data[path];
    },
    paths: userPaths,
    /** Applies { path: document | null } and internal state in one saved write, then notifies. Returns a Promise. */
    apply: function (docs, internal) {
      return step(function (remember) {
        var changes = Object.keys(docs || {}).map(function (path) {
          remember(path);
          if (docs[path] === null) delete data[path];
          else data[path] = docs[path];
          return { path: path, op: docs[path] === null ? "remove" : "upsert", remote: true };
        });
        Object.keys(internal || {}).forEach(function (path) {
          data[path] = internal[path];
        });
        return changes;
      }, false);
    },
  };

  return { store: store, core: core };
};

/**
 * Opens the store over localStorage (one key holding every document). Synchronous.
 * Returns { store, core, engine: "localStorage" }, { corrupt: true, raw } when the saved data cannot be parsed, or null when storage
 * cannot be used.
 */
NT.openLocalStore = function (config, hooks) {
  "use strict";
  var KEY = config.storageKey || "notas:v1";
  var data = {};
  try {
    localStorage.setItem(KEY + ":probe", "1");
    localStorage.removeItem(KEY + ":probe");
  } catch (e) {
    // catch-ok: private mode or blocked storage means "cannot save here"; the app says so.
    NT.log.error("store.blocked", { error: e });
    return null;
  }
  var raw = localStorage.getItem(KEY);
  if (raw !== null) {
    try {
      data = JSON.parse(raw);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
    } catch (e) {
      // catch-ok: fail closed. Nothing is written over unreadable data; the app shows it for download.
      NT.log.error("store.corrupt", { error: e });
      return { corrupt: true, raw: raw };
    }
  }
  var opened = NT.openStoreCore(
    data,
    function (all) {
      localStorage.setItem(KEY, JSON.stringify(all));
    },
    hooks
  );
  opened.engine = "localStorage";
  return opened;
};

/** The saved localStorage data as text, or null; for the migration to IndexedDB and the fail-closed download. */
NT.readLocalStorageData = function (config) {
  "use strict";
  try {
    return localStorage.getItem(config.storageKey || "notas:v1");
  } catch {
    // catch-ok: blocked storage means there is nothing to read.
    return null;
  }
};
/** Marks that this device's data moved to IndexedDB, so a later IndexedDB failure never falls back to the old copy. */
NT.markMovedToIndexedDb = function (config) {
  "use strict";
  try {
    localStorage.setItem((config.storageKey || "notas:v1") + ":moved", "indexeddb");
  } catch (e) {
    // catch-ok: without the mark, the old copy stays untouched anyway; logged for diagnostics.
    NT.log.warn("store.mark_failed", { error: e });
  }
};
NT.movedToIndexedDb = function (config) {
  "use strict";
  try {
    return localStorage.getItem((config.storageKey || "notas:v1") + ":moved") === "indexeddb";
  } catch {
    // catch-ok: unreadable means not marked.
    return false;
  }
};

/**
 * Opens the best store this browser offers: IndexedDB when available (moving data saved earlier in localStorage into it),
 * otherwise localStorage. Resolves with what NT.openLocalStore returns, or { failed: "indexeddb" } when data moved to IndexedDB
 * cannot be opened (the app stops instead of showing the old copy).
 */
NT.openDeviceStore = function (config, hooks) {
  "use strict";
  if (!NT.idbAvailable || !NT.idbAvailable()) {
    if (NT.movedToIndexedDb(config)) return Promise.resolve({ failed: "indexeddb" });
    return Promise.resolve(NT.openLocalStore(config, hooks));
  }
  return NT.openIdbStore(config, hooks).catch(function (e) {
    NT.log.error("store.idb_open_failed", { error: e });
    if (NT.movedToIndexedDb(config)) return { failed: "indexeddb" };
    return NT.openLocalStore(config, hooks);
  });
};

NT.backends.local = function (config) {
  "use strict";
  return NT.openDeviceStore(config).then(function (opened) {
    if (!opened || opened.corrupt || opened.failed) return opened;
    opened.store.engine = opened.engine;
    return opened.store;
  });
};
