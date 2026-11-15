/*
 * Purpose: The offline worker: keeps the app's own files on the device so it opens and works with no internet (decision 0001).
 * Responsibilities: Cache the app shell on install, serve it cache-first, and replace the cache when VERSION changes (the new version is used
 * on the next open, never in the middle of editing). It never caches or touches requests to other origins (the database).
 */
"use strict";
var VERSION = "notas-1.4.0";
var FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/styles.css",
  "css/print.css",
  "fonts/atkinson-hyperlegible-latin-400-normal.woff2",
  "fonts/atkinson-hyperlegible-latin-700-normal.woff2",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "js/config.js",
  "js/log.js",
  "js/prefs.js",
  "js/clock.js",
  "js/i18n.js",
  "js/lang/es.js",
  "js/logic.js",
  "js/print.js",
  "js/escpos.js",
  "js/printers.js",
  "backend/remote.js",
  "backend/rows.js",
  "backend/sync.js",
  "backend/connection.js",
  "backend/store.js",
  "backend/store.local.js",
  "backend/store.idb.js",
  "backend/store.synced.js",
  "backend/schema_sql.js",
  "js/repo.js",
  "js/demo.js",
  "js/export.js",
  "js/backup.js",
  "js/app.js",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return cache.addAll(FILES);
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) {
            return k !== VERSION;
          })
          .map(function (k) {
            return caches.delete(k);
          })
      );
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return (
        hit ||
        fetch(req).then(function (res) {
          return res;
        })
      );
    })
  );
});
