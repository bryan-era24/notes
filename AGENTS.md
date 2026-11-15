# Notas Agent Guide

Short entrypoint for agents. The app takes orders and prints order notes for a small point of sale; it holds a business's **real
orders and payments** on its devices and, in Connected mode, in its own PostgreSQL database. Its data comes first: never lose it, never
duplicate it, never log it. The main user is an older person: big targets, plain Spanish, no hidden steps. Deeper docs live in `docs/`.

## Start Here

- `README.md`: what the app does, how to run and host it.
- `docs/README.md`: the documentation map, with what to read before each kind of change.
- `docs/superpowers/specs/2026-11-15-notas-design.md`: the approved design (intent, goals, anti-goals, data model, screens).
- `docs/ARCHITECTURE.md`, `docs/TECHNICAL.md`, `docs/FLOWS.md`, `docs/DATABASE.md`, `docs/TESTING.md`, `docs/LIMITATIONS.md`, `docs/decisions/`.

## Safety Rules

- Never put personal data in the repository: backups (`notas-*.json`, `respaldo-*.json`) are ignored by Git; demo data is invented.
- Never lose stored data. A change to a stored field name or shape needs a decision record and a migration with tests first.
- The app reaches data only through the store contract (`backend/store.js`) and changes it only through `js/repo.js`. Only
  `backend/store.local.js` and `js/prefs.js` use `localStorage`; only `backend/remote.js` uses `fetch`; only `js/log.js` uses the console;
  only `js/clock.js` uses the clock and randomness (`tests/rules.test.js`).
- Every change and its history entry (and a new order's folio counter) are saved in one `store.batch`. Deletion is soft (`deletedAt`).
- Do not weaken the sync guarantees (decision 0003): device first with the pending mark in the same write; a pending change leaves the
  queue only after the server accepted it; pulled data never overwrites a pending document; the window never drops a pending document;
  replacing the device's data keeps a copy in `_sync/before-connect`.
- Unreadable stored data fails closed: the app never writes over it (decision 0004).
- `db/schema.sql` keeps RLS on every table, no DELETE grant, the last-write-wins trigger and immutable history. After changing it run
  `node scripts/build_schema_js.js`. The app never uses the `service_role` key and never stores the password.
- Diagnostics stay off by default and are redacted. Never log names, amounts, phones, emails, tokens or keys.
- Every user-facing text is a key in `js/lang/es.js`. Business rules live in `js/logic.js`, which stays pure.
- No runtime dependencies, no build step, no remote scripts (decision 0001). Fonts are local.
- Tests stay offline (jsdom through `tests/helpers/open_app.js`, PGlite, the fake Supabase).
- Every file starts with `Purpose:` and `Responsibilities:` (`Covers:` for tests). Every `catch` re-throws, rejects, logs, or says
  `// catch-ok: <reason>`.
- Deleting something the person entered takes a second deliberate tap. Stages never block anything.

## Commands

```bash
npm ci
npm test
npm run format:check
npm start
npm run preview      # dist/notas-preview.html and dist/notas-web/
```

## Working Rules

- Test first. Test titles carry a case ID: `[TC-NOT-03-02] ...`. Never weaken or skip a test to make a change pass.
- Behavior change: update the affected doc in `docs/` in the same change, and a decision record when you change one of those choices.
- Code, comments, docs, commits and stored field names in English; interface texts in Spanish.
- Check screens at 390 px and at tablet width, and print on paper (letter and ticket) when printing changes.
