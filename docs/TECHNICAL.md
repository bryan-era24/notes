# Technical reference

Last verified: 2026-11-15. Status: current.

## 1. Data model (device documents, store key `notas:v1`)

Money is integer centavos; weights integer grams; dates `YYYY-MM-DD` (local); times ISO. Every document carries `updatedAt`,
`updatedBy`, and `deletedAt` when deleted (soft). Demo documents carry `demo: true`.

```
settings/business   { name, phone, address, ticketFooter }
counters/<CODE>     { next }                       folio counter of the device using that letter
products/<id>       { name, position, active, presentations: [{ id, label, grams|null, price, active, position }] }
customers/<id>      { name, phone, comment }
orders/<id>         { folio, customerId|null, customerName, deliveryDate|null, stage, comment, createdAt, localDate }
notes/<id>          { orderId, number, orderDate, customerId|null, customerName, deliveryDate|null, stage, comment, createdAt,
                      lines: [{ id, productId, presentationId, productName, presentationLabel, grams|null, unitPrice, qty }] }
payments/<id>       { orderId, noteId|null, amount, method: cash|transfer|other, comment, paidAt, localDate, orderDate }
history/<id>        { path, at, localDate, by, action: create|update|stage|payment|delete|restore, changes: { field: [old, new] } | null,
                      ref: { number | amount | folio | name } }      (entries before decision 0006 hold before/after copies)
```

Internal: `_sync/state` (outbox, cursor, setup, window), `_sync/before-connect`, `_import/before`, `_meta/moved`.

Storage (decision 0007): IndexedDB database `notas`, object store `docs` keyed by path; localStorage key `notas:v1` when IndexedDB is
missing. Writes are queued; each saves its changed paths and internal state in one transaction. `notas:v1:moved` marks a device whose
data moved to IndexedDB. Measured: about 2.9 KB per typical order (one note of three lines, a payment, a stage change).

## 2. Rules (js/logic.js)

Prices are frozen in each line. Order total = notes not cancelled. Payment status is computed: pending, partial, paid, credit.
A note's work date = its delivery date, else its order's, else the day the order was made. Production sums kg (lines with weight)
and pieces per presentation, separating delivered notes. Stages are informative: any stage may follow any other.

## 3. Store contract

See `backend/store.js`: `get`, `list`, `set`, `batch`, `onChange`, `isEmpty`, `exportAll`, `importAll(docs, "merge"|"replace")`,
and `sync` in Connected mode. Backups: `{ app: "notas", schemaVersion: 1, exportedAt, data: { path: document } }`.

## 4. Sync (Connected mode)

Device first; every change marks its path pending in the same write, with the version (`rev`) the change was made on. One sync:
first-connection setup (upload, download or ask), push in chunks of 100 through `notas_push` (a refused chunk is retried one by one
and refused documents are flagged), pull rows changed since the cursor whose `doc_date` is null or inside the window, then drop
non-pending documents whose window date is before `today − windowDays`.

Versions (decision 0017): the server applies a change only when it was made on the row's current version. Otherwise the answer is a
conflict with the server's row: the device shows that version, keeps its own in `_sync/state.conflicts` and the page shows both
("Otra persona cambió lo mismo que tú"); "Usar la mía" calls `NT.repo.useVersion` (a normal change with history) and then
`resolveConflict`; "Quedarme con la otra" only calls `resolveConflict`, after a second tap. A pulled row replaces any document that
is not pending, whatever the clocks say. Opening an order changed by someone else in the last 15 minutes shows a notice
(`NT.logic.recentChange`). The status line says "N cambios por revisar" while conflicts wait.
Orders, their notes and payments share one window date (the later of made and delivery). Runs 1.5 s after a change, every 90 s while the app is open and visible (decision 0012), on open, on
`online`, when visible, and from "Sincronizar ahora"; retries from 15 s doubling to 5 min. States: idle, syncing, offline,
signed-out, needs-business, needs-schema (also a database still on schema version 2), needs-choice, error. Full-history reports read a period with `fetchRange` without storing it.

## 5. Printing

`NT.logic.printModel` builds the data; `js/print.js` renders letter and ticket HTML (css/print.css: black on white, no fills);
`js/printers.js` prints through the browser (letter always; ticket by default) or sends `NT.escpos.encode` bytes over Web Bluetooth
(chunks of 180 bytes), Web Serial (9600 baud) or Web USB (first bulk OUT endpoint). To support a chosen printer: test it with
"Imprimir prueba"; if it needs a specific Bluetooth service, baud rate or code page, change it in `js/printers.js` / `js/escpos.js`.
Sharing uses the Web Share API, else a WhatsApp link and copy.

PDF (decision 0014): `js/pdf.js` writes the letter note as a real PDF (US Letter, Helvetica and Helvetica-Bold with WinAnsiEncoding,
black only, more pages when needed), named by `NT.logic.pdfFileName`: "cliente folio fecha.pdf" ("Sin nombre" without a customer,
no date when there is none). The "PDF" button shares the file where the browser can share files (iPhone, Android) and downloads it
elsewhere. On iPhone and iPad, "Imprimir hoja" goes through the PDF and the share sheet (which has "Imprimir"), because Safari stops
opening the print dialog for a page after it is cancelled a few times. Browser printing sets the page title to the same name while
printing, so "Guardar como PDF" proposes it.

## 6. Export (decision 0008)

`js/export.js` turns documents into eight tables (columns in `NT.exporter.COLUMNS`, the same as the `v_*` views): productos,
presentaciones, clientes, pedidos (with total, pagado, saldo, estado_pago), notas, renglones (one per line, with importe, kg and
`cuenta` = counts in sales), pagos, historial. Deleted rows are kept with `eliminado`. CSV: UTF-8 with BOM, commas, CRLF, pesos with
two decimals, kg with three, times in UTC, text starting with = + - @ prefixed with an apostrophe. ZIP: stored (no compression), UTF-8
names. SQL: `create schema if not exists notas_export`, one table per export table, upserts in chunks of 500, safe to run again.
In Connected mode the export reads every document through `store.sync.fetchAll()`; offline it falls back to this device and says so.

## 7. Search

`NT.logic.searchText` + `matchesSearch`: accents and case ignored, every word must match, a number alone matches a folio number exactly
("42" finds A-0042), four or more digits also match phones; searches folio, customer, phone, delivery date, comments, and the customers,
products and presentations of notes that are not deleted. Product tiles in the note editor are ordered by pieces sold in the last 60 days.
`NT.logic.filterBySearch` (Producción, Reportes, decision 0010) keeps whole orders when every word names the order, otherwise only the
matching lines; `ordersOnly` tells Reportes whether money collected and pending can be shown. `productText` and `customerText` serve
Catálogo.

## 8. Automatic local backup (decision 0009)

States: off (folder possible, none chosen), ready, writing, needs-permission, manual (no folder support). With a folder: write
`notas-respaldo-actual.json` 60 s after the last change and `notas-respaldo-AAAA-MM-DD.json` (overwritten during the day), then remove
daily copies beyond the newest 14. Preferences `backup.lastAt`, `backup.lastChangeAt`, `backup.pendingSince`, `backup.folder`; the folder
handle in IndexedDB `notas-ajustes`/`kv` under `backupFolder`. Reminder: none (no changes since the last backup, or a backup today),
today, or overdue (changes waiting more than three days). Content: the JSON backup format of §3.

## 9. Offline

`sw.js` caches the app files cache-first under `VERSION`. Bump `VERSION` on every release so devices pick up the new files on
their next open.

## 10. Diagnostics

Levels off (default), error, warn, info, debug; memory only; redacted by key name (`js/log.js`). `?debug=debug` for one visit.
The downloaded record starts with a header line: app version, browser family (`safari-ios`, `chrome-android`, ...; never the full
user agent), installed or tab, and Lite or Connected with its storage engine. Each tap and form is logged at debug as `ui.tap` /
`ui.submit` with the action and the screen; a refused change logs `ui.action_failed` with the action, the screen and the problem
codes (`presentation.price`), never the values typed.
