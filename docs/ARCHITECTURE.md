# Architecture

Last verified: 2026-11-15. Status: current.

A static site: plain HTML, CSS and JavaScript loaded with `<script src>` in layer order (index.html). Modules share one global, `NT`.

```
index.html, sw.js, manifest.webmanifest       page, offline worker, install data
js/config.js     constants                    js/log.js      redacted diagnostics (only console user)
js/prefs.js      per-device preferences       js/clock.js    time, local date, ids (only clock/random user)
js/i18n.js, js/lang/es.js   texts
js/logic.js      PURE business rules: money, totals, payment status, production, reports, folios, validation, print model, share text
js/print.js      PURE print model -> letter / ticket HTML
js/escpos.js     PURE print model -> ESC/POS bytes (code page 850)
js/printers.js   printer adapters (browser print, Bluetooth, Serial, USB) and sharing
backend/remote.js        Supabase Auth + PostgREST over fetch (only fetch user)
backend/rows.js          PURE document <-> row mapping and window dates
backend/sync.js          offline-first sync engine
backend/connection.js    mode, server, session, business; sign-up/in, schema check, create/join business
backend/store.js         store contract and backend selector
backend/store.local.js   the device store core (memory + queued atomic saves, fail closed), localStorage engine, engine choice
backend/store.idb.js     IndexedDB engine and the one-time move from localStorage (only indexedDB user)
backend/store.synced.js  local backend + sync engine
backend/schema_sql.js    copy of db/schema.sql for the setup screen (generated)
js/repo.js       the only writer: validation, stamps, history, folios, soft delete, restore
js/demo.js       demonstration data
js/export.js     PURE complete export: tables, CSV, ZIP, PostgreSQL script
js/app.js        screens and actions; starts the app
db/schema.sql    PostgreSQL schema for Connected mode
```

Rules (enforced in `tests/rules.test.js`): data only through the store; changes only through the repo; one owner each for storage,
network, console, clock and randomness; pure modules stay pure; no runtime dependencies or remote scripts; the offline worker caches
exactly what the page loads.
