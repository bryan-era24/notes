# Testing

Last verified: 2026-11-15. Status: current.

`npm test` runs every `tests/*.test.js` with `node --test`, offline.

| File                | Covers                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| logic.test.js       | money, totals, payment status, dates, production, reports, validation, print model, share text                                                                                                                                 |
| print.test.js       | letter and ticket HTML, ESC/POS encoding, Bluetooth chunks                                                                                                                                                                     |
| store_local.test.js | the store contract, atomic batches, fail closed, import/export                                                                                                                                                                 |
| store_idb.test.js   | IndexedDB: saved together, reopening, moving from localStorage, fail closed, failed save undone                                                                                                                                |
| export.test.js      | export tables, CSV, ZIP (opened with unzip), SQL script loaded into PGlite                                                                                                                                                     |
| backup.test.js      | automatic backup: names, 14 daily copies, reminders, folder writes, permission again, manual save                                                                                                                              |
| views.test.js       | each v_* view equals the export for the same documents; access rules                                                                                                                                                           |
| repo.test.js        | history in the same write, folios, note numbers, frozen prices, stages, payments, soft delete, restore                                                                                                                         |
| demo.test.js        | demo data load and removal                                                                                                                                                                                                     |
| schema.test.js      | db/schema.sql on PGlite: business creation/joining, isolation, old clock rule, immutable history, no deletes, update from version 2, notas_push                                                                                |
| sync.test.js        | Connected mode against the fake Supabase                                                                                                                                                                                       |
| app_fixes.test.js   | iPhone fixes and later requests: product form without input events, Cambiar cliente/fecha, customer picker, date field kept, change and credit, PDF button and name, catalog archive/delete/merge, diagnostics, install notice |
| pdf.test.js         | the letter PDF byte by byte: structure, offsets, Spanish letters, content, more pages, file name                                                                                                                               |
| app_flows.test.js   | the real page in jsdom: first run, note in three steps, payments, stages, printing, production, reports, search, folding reports, export, IndexedDB reopen                                                                     |
| app_connect.test.js | database setup from Ajustes                                                                                                                                                                                                    |
| rules.test.js       | project rules: text keys, layers, purity, headers, catches, offline worker, hygiene                                                                                                                                            |
| design.test.js      | colour standard: tokens only, documented meanings, 4.5:1 contrast, stage and payment pills, notice tones                                                                                                                       |

Helpers: `helpers/load_modules.js` (modules in a sandbox), `helpers/open_app.js` (jsdom with an offline guard),
`helpers/postgres.js` (PGlite with Supabase stand-ins), `helpers/fake_supabase.js` (Auth + PostgREST + rpc stand-in).
Not covered by tests: real printers, real Supabase, browser storage limits, iOS install (LIM-003, LIM-004).
