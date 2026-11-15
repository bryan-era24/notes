# Testing

Last verified: 2026-11-15. Status: current.

`npm test` runs every `tests/*.test.js` with `node --test`, offline.

| File                | Covers                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| logic.test.js       | money, totals, payment status, dates, production, reports, validation, print model, share text                |
| print.test.js       | letter and ticket HTML, ESC/POS encoding, Bluetooth chunks                                                    |
| store_local.test.js | the store contract, atomic batches, fail closed, import/export                                                |
| repo.test.js        | history in the same write, folios, note numbers, frozen prices, stages, payments, soft delete, restore        |
| demo.test.js        | demo data load and removal                                                                                    |
| schema.test.js      | db/schema.sql on PGlite: business creation/joining, isolation, last write wins, immutable history, no deletes |
| sync.test.js        | Connected mode against the fake Supabase                                                                      |
| app_flows.test.js   | the real page in jsdom: first run, note in three steps, payments, stages, printing, production, reports       |
| app_connect.test.js | database setup from Ajustes                                                                                   |
| rules.test.js       | project rules: text keys, layers, purity, headers, catches, offline worker, hygiene                           |

Helpers: `helpers/load_modules.js` (modules in a sandbox), `helpers/open_app.js` (jsdom with an offline guard),
`helpers/postgres.js` (PGlite with Supabase stand-ins), `helpers/fake_supabase.js` (Auth + PostgREST + rpc stand-in).
Not covered by tests: real printers, real Supabase, browser storage limits, iOS install (LIM-003, LIM-004).
