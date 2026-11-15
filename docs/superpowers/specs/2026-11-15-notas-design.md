# Notas: design

Status: Approved 2026-11-15 (built in one pass: all phases)
Date: 2026-11-15
Owner: Bryan

## 1. Intent

A phone and tablet web app for a small food business (popcorn and similar products sold by weight
or by piece) to take orders and print or send clear order notes.

The main user is an older person who sells and takes orders. The mission, in order of priority:

1. Making a note is fast and hard to get wrong.
2. The printed or shared note is easy to read for the seller and for the customer.
3. Every order and payment is kept: nothing is lost, nothing is duplicated.
4. From the orders, the business knows how much product to prepare (kg or pieces) per day or week,
   and can see what was sold, to whom, and when.

The app follows the rules of `personal-budget` (Budget) as its base, plus selected rules from
`relieve-web` and `volaris-bot` (section 5).

## 2. Goals, non-goals, anti-goals

Goals

- Catalog: any number of products, each with any number of presentations; each presentation has a
  price and an optional weight.
- Customers are optional.
- Orders hold any number of notes; notes hold any number of lines.
- Informative stages on orders and notes that never block an action.
- Payments: full or any number of partial payments; the balance is computed.
- Print every order (all notes, one note, or a summary) on letter paper and on an 80 mm ticket, with
  the current payment status. Share it digitally (PDF via the browser, or text via WhatsApp).
- Production view: kg and pieces needed per product, by delivery day or week.
- Reports: by customer, by product, by day, week and month.
- Lite mode (device only, offline) and Connected mode (Supabase), like Budget.
- Up to 10 people using it at the same time on different devices.
- History of every change to orders, notes, payments and prices.

Non-goals (v1)

- Inventory or stock control, purchases, costs or profit.
- Invoicing (CFDI), taxes, or a payment terminal.
- Per-customer price lists (a price can be adjusted on each line; see section 12).
- Generating a PDF file inside the app (the browser's "Save as PDF" is used).
- Roles and permissions beyond "member of the business".
- English interface (texts are behind keys, so it can be added later).

Anti-goals (a failure even if it technically works)

- A screen the main user cannot complete without help: small buttons, hidden menus, dropdowns,
  jargon, or more than three steps to make a note.
- A note that wastes ink: filled backgrounds, color blocks, logos, heavy borders.
- Losing an order or a payment, or the same order showing twice after a sync.
- A locked state ("you cannot edit a delivered note").
- Customer names or amounts appearing in logs.

## 3. Constraints

- Any device with a modern web browser: Android, iPhone and iPad, Huawei (Petal/Huawei Browser,
  Chrome), Windows, Mac. Mostly phones and tablets; checked at 390 px, tablet and desktop. Features
  a browser lacks (sharing, Bluetooth) degrade to a working alternative (copy text, WhatsApp link,
  browser print).
- Must open and work with no internet once installed.
- The thermal printer is not chosen yet. Printing goes through a printer adapter layer (section 8)
  so a specific printer can be added later without touching the screens. Recommended hardware: an
  80 mm printer with USB + Bluetooth + Wi-Fi (Volteck PDV-81i; Epson TM-m30III if budget allows).
- One maintainer. No build step, no runtime dependencies (Budget decision 0001).
- Code, comments, docs, commits and stored field names in English; interface in Spanish (es-MX).

## 4. Approaches

Considered:

- **A. Budget's architecture with localStorage (chosen by Bryan).** Static site, vanilla JS, a
  store contract with a local and a synced backend, Supabase over its HTTP API. Reuses known code
  and rules. Limit: about 5 MB per device, enough for thousands of notes inside a one-month window;
  the storage core is one module, so it can move to IndexedDB later.
- B. Budget's architecture with IndexedDB. More room, but more code and tests, async everywhere, and
  further from what already works.
- C. Next.js as in Relieve, made offline-capable. Powerful, but offline-first in Next.js is much more
  complex and a heavy stack for a point-of-sale notebook.

## 5. Rules adopted

From Budget (base): no build, no runtime deps, no remote scripts; views reach data only through the
store; device-first writes with the pending mark in the same write; pending changes never dropped by
the cache window and never overwritten by pulled data; PostgreSQL through Supabase HTTP with RLS on
every table, no DELETE grant (tombstones), last-write-wins trigger; pure logic module with tests;
every text behind a language key; diagnostics off by default and redacted; tests first and offline
(jsdom, PGlite, fake Supabase); `Purpose:`/`Responsibilities:` headers; every `catch` re-throws or
carries `// catch-ok:`; the same `docs/` layout (ARCHITECTURE, TECHNICAL, FLOWS, CONFIG, DATABASE,
TESTING, CHANGING, LIMITATIONS, decisions, plans); destructive actions need a second deliberate
action; no personal data in the repository.

From Relieve: requirement IDs and test case IDs (`[TC-NOT-03-02] ...`) traced in tests, commits and
PRs; validation at the boundary (one validator per document type in the pure layer, used before
every write and on import); accessibility review; checked at 390 px and desktop.

From the bot: fail closed on corrupt state (if stored data cannot be read, the app stops and offers
to download it, instead of starting empty); nothing is retried or replayed in a way that could
duplicate an order or payment.

Differences from Budget, each with its own decision record:

| #   | Change                                                                             | Why                                                                                |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| D1  | Service worker caching the app shell; local fonts instead of Google Fonts          | Must open offline (Budget LIM-009)                                                 |
| D2  | Access by business membership, not by user                                         | Up to 10 people share the same data                                                |
| D3  | Money stored as integer centavos on the device and `numeric(12,2)` in the database | A point of sale must not be off by a cent (Budget LIM-012)                         |
| D4  | Folios built from a device code plus a per-device counter                          | Unique numbers while offline on several devices                                    |
| D5  | Append-only history collection                                                     | Change history was requested                                                       |
| D6  | Lite never deletes old data automatically                                          | Lite has no server copy; dropping would lose data (section 9)                      |
| D7  | One generic `documents` table instead of one table per collection                  | One mapping and one sync path; new fields need no migration                        |
| D8  | Store contract gains `batch()` (several documents in one write)                    | An order, its folio counter and its history entry are saved together or not at all |

## 6. Data model (device documents)

Paths follow Budget's `collection/id`. Ids are UUIDs made on the device. Every document carries
`updatedAt` (ISO, device clock), `updatedBy` (member id or "lite") and, when deleted, `deletedAt`.
Money is integer centavos. Weights are integer grams.

```
settings/business   { name, phone, address, ticketFooter }
counters/<CODE>     { next }   (device letter, ticket width and printer are per-device preferences)
products/<id>       { name, position, active,
                      presentations: [ { id, label, grams|null, price, active, position } ] }
customers/<id>      { name, phone?, comment? }
orders/<id>         { folio, customerId|null, customerName, deliveryDate|null, stage, comment, createdAt }
notes/<id>          { orderId, number, customerId|null, customerName, deliveryDate|null, stage, comment,
                      lines: [ { id, productId, presentationId, productName, presentationLabel,
                                 grams|null, unitPrice, qty } ],
                      createdAt }
payments/<id>       { orderId, noteId|null, amount, method, paidAt, comment }
history/<id>        { path, at, by, action, before|null, after|null }
```

Rules (all in the pure logic module):

- **Price frozen in the note.** A line copies product name, presentation label, grams and price at
  the time it is added. The line's price can be edited; the catalog price does not change. Editing a
  catalog price later never changes existing notes.
- **Presentations.** A product has one or more presentations. `grams` is optional. Example:
  Palomitas de mantequilla: "250 g" (250 g, $35), "1 kg" (1000 g, $120), "Bolsa fiesta" (no weight,
  $60). A presentation used in a note can be deactivated but not deleted.
- **Line total** = `unitPrice × qty`. **Note total** = sum of its lines. **Order total** = sum of its
  notes. Quantities are whole numbers above zero.
- **Customer.** Optional. The order's customer is copied as the default owner of each new note; a
  note can name a different customer or none. The name is copied (`customerName`) so a renamed or
  removed customer does not change printed notes.
- **Delivery date.** On the order; a note may override it. The effective date of a note is its own,
  or else the order's.
- **Stages** (informative, any change allowed, every change goes to history): `ordered`,
  `preparing`, `delivered`, `received_signed`, `cancelled`. Shown in Spanish: Pedido, En
  preparación, Entregado, Firmado de recibido, Cancelado. A cancelled note is excluded from totals,
  production and reports, and printed crossed out only if printed on its own.
- **Payments.** Belong to the order; `noteId` is optional, for when one note is paid separately.
  Method: efectivo, transferencia, otro. **Paid** = sum of payments. **Balance** = order total −
  paid. **Payment status** (computed, never stored): Pendiente (paid = 0), Pago parcial
  (0 < paid < total), Pagado (paid = total), Saldo a favor (paid > total).
- **Folios.** Order folio = `deviceCode` + `-` + four-digit counter (`A-0042`); note number is its
  position in the order (`A-0042 / Nota 2`). The counter is advanced in the same write as the order.
  The device letter (one or two letters, "A" by default) is set in Ajustes; each device should use its
  own (LIM-009). Folios are for people, not keys: existing folios never change.
- **History.** Every create, update, stage change, payment and delete writes one history document in
  the same write as the change, with `before` and `after`. History is never edited or deleted.

## 7. Screens and flows

Visual rules: base text 18 px, key numbers 28 px or more, touch targets at least 56 px, high
contrast, one column on phones, two on tablets. No dropdowns for frequent choices: big buttons.
Confirmation only for deleting. A small status line always visible: "Guardado en este equipo" /
"Sincronizado" / "Sin conexión, se enviará después".

Tabs: **Pedidos**, **Producción**, **Reportes**, **Catálogo**, **Ajustes**.

- **Pedidos** (home). Big "Nuevo pedido" button. List grouped by delivery date (today, tomorrow,
  this week, later, no date), each row: folio, customer, total, payment status, stage. Search by
  customer or folio.
- **New order / new note** (the main flow, three steps):
  1. Customer: type to search, tap one, or "Sin nombre". Delivery date with quick buttons (Hoy,
     Mañana, pick a date).
  2. Products: product list as large tiles; tapping one shows its presentations as buttons; each
     added line shows `− qty +`, unit price (tap to adjust) and line total. The note total is always
     visible at the bottom.
  3. Guardar. Returns to the order.
- **Order**: header with folio, customer, delivery date, stage buttons; its notes (each expandable,
  "Agregar nota", "Editar"); totals; payments with "Registrar pago" (amount, method; quick button
  "Liquidar saldo"); history of the order; actions: Imprimir hoja, Imprimir ticket, Compartir.
- **Producción**: by day (default today) or by week. Per product: total kg (sum of
  `qty × grams` for lines with weight) and pieces per presentation; lines without weight count only
  pieces. Tapping a product lists the orders that need it. Excludes cancelled notes; delivered notes
  shown apart.
- **Reportes**: period selector (day, week, month, custom). Units and amount sold per product and
  presentation; per customer (orders, notes, amount, balance); collected vs pending. In Lite and
  offline, reports cover the data on the device; in Connected mode with a connection, they query the
  database for the full history.
- **Catálogo**: add product (name, then presentations: label, optional weight, price), reorder,
  deactivate. Customers list (add, rename) lives here too.
- **Ajustes**: business data printed on notes; mode (Lite / Connected, sign in, sync status, "Sync
  now"); cache window (default 30 days back and all future deliveries); export JSON / import JSON;
  device code; diagnostics.

## 8. Printing and sharing

Two print layouts from the same data, with print CSS, chosen by the button pressed:

- **Letter** (`@page size: letter`): business name and phone in text, folio, dates, customer,
  delivery date, payment status in words. One table per note: Producto | Presentación | Cant. |
  P. unit. | Importe; note subtotal. Order summary: total, payments listed, balance. Line for
  "Recibí de conformidad: nombre y firma". Black text on white, thin rules, no fills, system font,
  footer with page numbers.
- **Ticket 80 mm** (`@page size: 80mm auto; margin: 0`, 72 mm printable): same content stacked:
  product and presentation on one line, `qty × price = amount` under it; totals, balance and status
  in larger type.
- Print scope: whole order (default), one note, or summary only (totals per note, no lines).
- **Printer adapter layer.** Screens never print directly. They build a print model (pure: header,
  notes, lines, totals, payments, status) and hand it to the chosen adapter:
  - `browser-letter` and `browser-ticket` (default, work everywhere): render the model to HTML and
    call the browser's print dialog. On Android a Bluetooth or Wi-Fi thermal printer can be reached
    through a print-service app (for example RawBT).
  - `escpos-*` (prepared, off until a printer is chosen): a pure ESC/POS encoder turns the same
    model into printer bytes (Spanish accents through code page 850, bold, double size, cut), and
    small transports send them over Web Bluetooth, Web Serial or Web USB where the browser has
    them. Adding a printer is one adapter file plus a choice in Ajustes.
  - The ticket width (58 or 80 mm, characters per line) is a setting used by both paths.
- **Share**: "Compartir" uses the Web Share API (or a `wa.me` link where it is not available) with a
  plain-text version of the note. The PDF is made with the browser's "Save as PDF" on the letter
  layout and shared from there.

## 9. Storage, modes and sync

- **Store contract** (simplified from Budget's): `get`, `list`, `set`, `batch`, `onChange`, `isEmpty`,
  `exportAll`, `importAll(docs, "merge" | "replace")`, and `store.sync` in Connected mode.
- **Lite**: all data in localStorage on the device. The window does **not** delete anything. When
  data outside the window takes space (or monthly), Ajustes offers "Exportar y limpiar": first a
  JSON download, then a second deliberate action removes documents older than the window. This keeps
  "only a date range on the device" without silent loss (D6).
- **Connected**: the same device-first writes plus Budget's sync engine: outbox in `_sync/state`
  in the same write, push then pull, cursors by `server_updated_at`, retries with backoff, refused
  changes flagged and kept. The cache window (configurable, default 30 days back plus every future
  delivery) drops only documents that are not pending. First connection with data on both sides
  asks, and keeps a copy of the device's data aside.
- **No duplicates**: UUIDs made on the device are the primary key on the server; sending the same
  change twice is an upsert of the same row.
- **Concurrent edits**: last write wins per document by `updatedAt`. Two people editing the same note
  at once: the later save wins; the other version stays in history and can be restored from there.
- **Export format**: `{ app: "notas", schemaVersion, exportedAt, data: { "<path>": object } }`.
  Import validates every document; it either merges (new and newer documents) or replaces, and
  replacing keeps a copy of the device's data aside.
- **Corrupt state**: if stored data cannot be parsed, the app shows a full-screen message with
  "Descargar datos" and does not write anything.
- **Offline shell**: a versioned service worker caches the app files; a new version is applied on the
  next open, never in the middle of editing.

## 10. Database (Connected mode)

- Tables: `businesses (id, name, join_code)`, `members (business_id, user_id, role)`, and one
  `documents (business_id, path, collection, doc_date, data jsonb, deleted_at, client_updated_at,
server_updated_at)` table holding every device document as is (D7). One generic mapping means a
  new field never needs a schema change, and sync has one code path.
- The last-write-wins trigger from Budget on `documents`; no DELETE grant (deletions are
  `deleted_at` on the device and on the server).
- RLS: a row is visible and writable only if `business_id` is one of the caller's memberships.
  History documents can be inserted but never updated (trigger).
- **Automatic setup.** A browser holding only the public key cannot create tables, so "create the
  database if it does not exist" works like this: on connecting, the app checks for the tables. If
  they are missing it shows one screen: "Copiar instrucciones" (the whole idempotent `schema.sql`),
  a button that opens the project's SQL editor, and "Ya lo pegué, revisar". After that, everything
  else is automatic: the first person to sign in creates the business (RPC `notas_bootstrap`), and
  the others join with a six-letter code shown in Ajustes (RPC `notas_join`). Accounts are created
  from the app (sign-up) or the Supabase dashboard.
- Full-history reports in Connected mode read the documents of the chosen period from the server
  (without storing them on the device) and run the same report logic (D8).

## 11. Requirements, phases and tests

Requirement prefixes: `CAT` catalog, `CLI` customers, `PED` orders, `NOT` notes, `PAG` payments,
`PRO` production, `REP` reports, `IMP` printing and sharing, `SYN` storage, export and sync, `NFR`
usability, accessibility, performance and privacy. Test titles carry case IDs `TC-<ID>-nn`
(docs/TESTING.md lists the files).

All three planned phases (Lite core, reports, Connected) were built in one pass at Bryan's request.

Tests: pure logic (totals, balances, payment status, kg and pieces, folios, validation) in
`tests/logic.test.js`; flows in jsdom with the offline guard; print layouts checked by snapshot of
the print markup and by hand on paper; schema and RLS on PGlite; sync against the fake Supabase.

## 12. Calls made by Claude (please check)

- Payments belong to the order, optionally to one note.
- Stages list: Pedido, En preparación, Entregado, Firmado de recibido, Cancelado. Payment status is
  computed separately.
- Cancelled notes are excluded from totals, production and reports.
- Delivery date on the order, with an optional override per note.
- Lite never deletes by itself; "Exportar y limpiar" instead (D6).
- Prices are adjusted per line; no per-customer price list in v1.
- Members join with a six-letter code; all members have the same permissions.
- Interface in Spanish only for now, behind keys.
- Light theme only for v1 (better contrast on paper-like screens); tokens allow a dark theme later.

## 13. Demo data and delivery

- **Demo data**: Ajustes > "Cargar datos de demostración" (also offered on the empty first screen)
  writes a made-up catalog, customers, orders over the last and next weeks, notes and partial
  payments, through the store like any change, so in Connected mode it populates the database. Every
  demo document carries `demo: true`; "Quitar datos de demostración" removes them (soft delete, with
  a second confirmation).
- **Preview in Claude**: one self-contained HTML file generated from the source by a development
  script (the app itself still has no build step), published as an artifact.
- **Phone**: the static folder, ready for any HTTPS static host (GitHub Pages, Netlify, Cloudflare
  Pages). HTTPS is needed for install and offline use.

## 14. Left to the builder

File and module names, exact colors and spacing within the visual rules above, sync timings (start
from Budget's), the wording of each text, and the order of tasks inside each phase.
