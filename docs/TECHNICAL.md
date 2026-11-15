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
history/<id>        { path, at, localDate, by, action: create|update|stage|payment|delete|restore, before, after }
```

Internal: `_sync/state` (outbox, cursor, setup, window), `_sync/before-connect`, `_import/before`.

## 2. Rules (js/logic.js)

Prices are frozen in each line. Order total = notes not cancelled. Payment status is computed: pending, partial, paid, credit.
A note's work date = its delivery date, else its order's, else the day the order was made. Production sums kg (lines with weight)
and pieces per presentation, separating delivered notes. Stages are informative: any stage may follow any other.

## 3. Store contract

See `backend/store.js`: `get`, `list`, `set`, `batch`, `onChange`, `isEmpty`, `exportAll`, `importAll(docs, "merge"|"replace")`,
and `sync` in Connected mode. Backups: `{ app: "notas", schemaVersion: 1, exportedAt, data: { path: document } }`.

## 4. Sync (Connected mode)

Device first; every change marks its path pending in the same write. One sync: first-connection setup (upload, download or ask),
push in chunks of 100 (a refused chunk is retried one by one and refused documents are flagged), pull rows changed since the cursor
whose `doc_date` is null or inside the window, then drop non-pending documents whose window date is before `today − windowDays`.
Orders, their notes and payments share one window date (the later of made and delivery). Runs 1.5 s after a change, on open, on
`online`, when visible, and from "Sincronizar ahora"; retries from 15 s doubling to 5 min. States: idle, syncing, offline,
signed-out, needs-business, needs-schema, needs-choice, error. Full-history reports read a period with `fetchRange` without storing it.

## 5. Printing

`NT.logic.printModel` builds the data; `js/print.js` renders letter and ticket HTML (css/print.css: black on white, no fills);
`js/printers.js` prints through the browser (letter always; ticket by default) or sends `NT.escpos.encode` bytes over Web Bluetooth
(chunks of 180 bytes), Web Serial (9600 baud) or Web USB (first bulk OUT endpoint). To support a chosen printer: test it with
"Imprimir prueba"; if it needs a specific Bluetooth service, baud rate or code page, change it in `js/printers.js` / `js/escpos.js`.
Sharing uses the Web Share API, else a WhatsApp link and copy; PDF is the browser's "Save as PDF" on the letter layout.

## 6. Offline

`sw.js` caches the app files cache-first under `VERSION`. Bump `VERSION` on every release so devices pick up the new files on
their next open.

## 7. Diagnostics

Levels off (default), error, warn, info, debug; memory only; redacted by key name (`js/log.js`). `?debug=debug` for one visit.
