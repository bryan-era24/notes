/*
 * Purpose: Keep the device's documents in IndexedDB, which holds hundreds of megabytes (localStorage holds about 5 MB).
 * Responsibilities: Open the "notas" database, load every document into memory, save each write's changed paths in one transaction
 * (so a document and its pending mark are stored together or not at all), and move data saved earlier in localStorage into it the first
 * time, keeping the old copy untouched. It is the only file that uses indexedDB and must not touch the DOM or the network.
 */
window.NT = window.NT || {};

NT.idbAvailable = function () {
  "use strict";
  try {
    return typeof indexedDB !== "undefined" && !!indexedDB && typeof indexedDB.open === "function";
  } catch {
    // catch-ok: some private modes throw on access; that means "not available".
    return false;
  }
};

/**
 * Resolves with { store, core, engine: "indexeddb" }, or { corrupt: true, raw } when localStorage data to move cannot be read.
 * Rejects when the database cannot be opened.
 */
NT.openIdbStore = function (config, hooks) {
  "use strict";
  var NAME = config.idbName || "notas";
  var STORE = "docs";

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () {
        resolve(r.result);
      };
      r.onerror = function () {
        reject(r.error);
      };
    });
  }
  function done(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () {
        resolve();
      };
      tx.onerror = function () {
        reject(tx.error);
      };
      tx.onabort = function () {
        reject(tx.error || new Error("transaction aborted"));
      };
    });
  }
  function openDb() {
    return new Promise(function (resolve, reject) {
      var r = indexedDB.open(NAME, 1);
      r.onupgradeneeded = function () {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
      };
      r.onsuccess = function () {
        resolve(r.result);
      };
      r.onerror = function () {
        reject(r.error);
      };
      r.onblocked = function () {
        reject(new Error("blocked"));
      };
    });
  }
  function loadAll(db) {
    var tx = db.transaction(STORE, "readonly");
    var os = tx.objectStore(STORE);
    return Promise.all([req(os.getAllKeys()), req(os.getAll())]).then(function (r) {
      var data = {};
      r[0].forEach(function (k, i) {
        data[k] = r[1][i];
      });
      return data;
    });
  }
  function save(db, puts, removes) {
    var tx = db.transaction(STORE, "readwrite");
    var os = tx.objectStore(STORE);
    Object.keys(puts).forEach(function (k) {
      os.put(puts[k], k);
    });
    removes.forEach(function (k) {
      os.delete(k);
    });
    return done(tx);
  }

  return openDb().then(function (db) {
    return loadAll(db).then(function (data) {
      var empty = Object.keys(data).length === 0;
      var raw = empty ? NT.readLocalStorageData(config) : null;
      var ready = Promise.resolve(data);
      if (raw !== null && !NT.movedToIndexedDb(config)) {
        var old;
        try {
          old = JSON.parse(raw);
          if (!old || typeof old !== "object" || Array.isArray(old)) throw new Error("not an object");
        } catch (e) {
          // catch-ok: fail closed, as with localStorage: the unreadable data is offered for download, never overwritten.
          NT.log.error("store.corrupt", { error: e });
          return { corrupt: true, raw: raw };
        }
        old["_meta/moved"] = { from: "localStorage", at: new Date().toISOString() };
        ready = save(db, old, []).then(function () {
          NT.markMovedToIndexedDb(config);
          NT.log.info("store.moved_to_indexeddb", { documents: Object.keys(old).length });
          return old;
        });
      }
      return ready.then(function (loaded) {
        if (loaded.corrupt) return loaded;
        var opened = NT.openStoreCore(
          loaded,
          function (all, puts, removes) {
            return save(db, puts, removes);
          },
          hooks
        );
        opened.engine = "indexeddb";
        return opened;
      });
    });
  });
};

/**
 * A tiny key-value store in its own database ("notas-ajustes"), for things that are not data documents and cannot go to localStorage,
 * such as the backup folder handle. Returns null when IndexedDB is not available.
 */
NT.idbKeyval = function () {
  "use strict";
  if (!NT.idbAvailable()) return null;
  var opening = null;
  function db() {
    if (!opening)
      opening = new Promise(function (resolve, reject) {
        var r = indexedDB.open("notas-ajustes", 1);
        r.onupgradeneeded = function () {
          r.result.createObjectStore("kv");
        };
        r.onsuccess = function () {
          resolve(r.result);
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    return opening;
  }
  function run(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction("kv", mode);
        var r = fn(tx.objectStore("kv"));
        tx.oncomplete = function () {
          resolve(r && r.result);
        };
        tx.onerror = function () {
          reject(tx.error);
        };
        tx.onabort = function () {
          reject(tx.error || new Error("aborted"));
        };
      });
    });
  }
  return {
    get: function (key) {
      return run("readonly", function (os) {
        return os.get(key);
      });
    },
    set: function (key, value) {
      return run("readwrite", function (os) {
        return os.put(value, key);
      });
    },
    del: function (key) {
      return run("readwrite", function (os) {
        return os.delete(key);
      });
    },
  };
};
