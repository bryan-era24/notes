/*
 * Purpose: The data contract between the app and wherever the data lives, plus the backend selector.
 * Responsibilities: Document the store interface every backend implements and build the right one: "synced" when this device is
 * connected to a database, otherwise "local". It must not read or write data itself and must not touch the DOM.
 *
 * The app (js/app.js, js/repo.js) uses only what is listed here; it never touches localStorage or a server.
 *
 *   store.get(path)              a copy of the document at "collection/id", or undefined
 *   store.list(collection)       [{ id, path, data }] sorted by path
 *   store.set(path, value)       save one document                                   -> Promise
 *   store.batch([{ path, value }])  save several documents in one write; value null removes it from this device -> Promise
 *   store.onChange(fn)           fn(changes) after every write, local or pulled; returns an unsubscribe function
 *   store.isEmpty()              true when there is no document at all
 *   store.exportAll()            { "collection/id": document }
 *   store.importAll(docs, mode)  mode "merge" | "replace"                            -> Promise<{ added, updated, kept }>
 *   store.sync                   Connected mode only (backend/sync.js): syncNow(), choose("server" | "device"), status(),
 *                                onStatus(fn), failedPaths(), fetchRange(from, to), fetchAll()
 *
 * Collections: settings/business, counters/<deviceCode>, products, customers, orders, notes, payments, history (docs/TECHNICAL.md §1).
 * Backends open asynchronously (IndexedDB). A backend that cannot start gives null (no storage), { corrupt: true, raw } (unreadable
 * data: the app stops and offers a download) or { failed: "indexeddb" } (moved data that cannot be opened: the app stops).
 */
window.NT = window.NT || {};
NT.backends = NT.backends || {};

/**
 * Resolves with the store for this device's mode, null when data cannot be saved here, { corrupt: true, raw } for unreadable data,
 * or { failed: "indexeddb" } when data moved to IndexedDB cannot be opened.
 */
NT.createStore = function () {
  "use strict";
  var connected = NT.connection && NT.connection.isConnected() && NT.backends.synced;
  var name = connected ? "synced" : "local";
  NT.log.info("store.create", { backend: name });
  return Promise.resolve()
    .then(function () {
      return NT.backends[name](NT.config || {});
    })
    .catch(function (e) {
      // catch-ok: a backend that cannot start means "no saving here"; the app then shows status.noStorage.
      NT.log.error("store.create_failed", { backend: name, error: e });
      return null;
    });
};
