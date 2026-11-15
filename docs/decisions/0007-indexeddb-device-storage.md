# 0007. IndexedDB on the device, localStorage as fallback

Status: Accepted. Date: 2026-11-15. Supersedes the storage part of 0003 (Budget kept localStorage).

Context: localStorage holds about 5 MB: roughly 1,700 orders, a month or two for a busy shop in Lite mode.
Decision: documents live in memory and are saved to IndexedDB (database 'notas', one object store keyed by path). Each write saves its
changed paths and the changed internal state in one transaction, after the previous write (a queue); a write resolves only once stored,
and a failed save is undone in memory and nobody is notified. On first open, data in localStorage is copied into IndexedDB and the old
key is left untouched; a 'moved' mark stops a later IndexedDB failure from showing that stale copy (fail closed). Browsers without
IndexedDB use localStorage as before. The app asks the browser to persist the site's storage and warns at 80% full.
Consequences: hundreds of MB available; opening is asynchronous (NT.createStore returns a Promise).
Enforced by: tests/store_idb.test.js, tests/app_flows.test.js (TC-SYN-08-06), tests/rules.test.js (only store.idb.js uses indexedDB).
