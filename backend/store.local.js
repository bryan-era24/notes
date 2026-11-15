/*
 * Purpose: The "local" backend: every document of the app kept in this browser's localStorage under one key, and the core the synced backend builds on.
 * Responsibilities: Implement the store contract of backend/store.js with atomic multi-document writes, refuse to start over data it cannot read
 * (fail closed: the app offers to download it instead), and let the synced backend record pending changes inside the same write.
 * It must not touch the DOM or the network.
 */
window.NT = window.NT || {};
NT.backends = NT.backends || {};

/**
 * Opens the local document store.
 * hooks.afterWrite(data, changes) runs inside every user write, before saving, with changes = [{ path, op: "upsert" | "remove" }];
 * whatever it puts under a path starting with "_" is saved in the same localStorage write.
 * Returns { store, core }, { corrupt: true, raw } when the saved data cannot be parsed, or null when storage cannot be used.
 */
NT.openLocalStore = function (config, hooks) {
  "use strict";
  hooks = hooks || {};
  var KEY = config.storageKey || "notas:v1";
  var listeners = [];
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
  function save() {
    localStorage.setItem(KEY, JSON.stringify(data));
  }
  function notify(changes) {
    listeners.slice().forEach(function (fn) {
      fn(changes);
    });
  }
  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  /** Applies all ops or none: on a failed save the previous data is restored. */
  function write(ops) {
    return new Promise(function (resolve, reject) {
      var before = JSON.stringify(data);
      try {
        var changes = ops.map(function (op) {
          if (!op.path || isInternal(op.path)) throw new Error("invalid path");
          if (op.value === null) delete data[op.path];
          else data[op.path] = clone(op.value);
          return { path: op.path, op: op.value === null ? "remove" : "upsert" };
        });
        if (hooks.afterWrite && changes.length) hooks.afterWrite(data, changes);
        save();
        NT.log.debug("store.write", { paths: changes.length });
        notify(changes);
        resolve();
      } catch (e) {
        data = JSON.parse(before);
        NT.log.error("store.write_failed", { error: e });
        reject(e);
      }
    });
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
        result = { added: 0, updated: 0, kept: 0 };
      var incoming = Object.keys(docs).filter(function (k) {
        return !isInternal(k);
      });
      if (mode === "replace") {
        var copy = store.exportAll();
        userPaths().forEach(function (k) {
          if (!Object.prototype.hasOwnProperty.call(docs, k)) ops.push({ path: k, value: null });
        });
        incoming.forEach(function (k) {
          ops.push({ path: k, value: docs[k] });
          result[own(k) ? "updated" : "added"]++;
        });
        data["_import/before"] = { at: new Date().toISOString(), documents: copy };
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
      return write(ops).then(function () {
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
    /** Applies { path: document | null } and internal state in one saved write, then notifies. */
    apply: function (docs, internal) {
      var changes = [];
      Object.keys(docs || {}).forEach(function (path) {
        if (docs[path] === null) delete data[path];
        else data[path] = docs[path];
        changes.push({ path: path, op: docs[path] === null ? "remove" : "upsert", remote: true });
      });
      Object.keys(internal || {}).forEach(function (path) {
        data[path] = internal[path];
      });
      save();
      if (changes.length) notify(changes);
    },
  };

  return { store: store, core: core };
};

NT.backends.local = function (config) {
  "use strict";
  var opened = NT.openLocalStore(config);
  if (!opened || opened.corrupt) return opened;
  return opened.store;
};
