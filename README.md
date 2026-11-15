# Notas

Order notes for a small point of sale (popcorn and similar products sold by weight or by piece): a catalog of products with
presentations, orders made of notes, informative stages, partial payments, what to prepare in kilos and pieces, reports, and notes
printed on letter paper or on a 58/80 mm ticket, or shared by WhatsApp. Made for an older seller: big buttons, three steps per note.

It works on any device with a modern browser (Android, iPhone and iPad, Huawei, computers), fully offline. Connected mode adds a
shared PostgreSQL database (Supabase) for up to about 10 people on different devices.

The interface is in Spanish (es-MX). Code, docs and stored field names are in English.

## Use it

1. Open the app. On the first screen, **Probar con datos de ejemplo** loads made-up data to try everything.
2. **Catálogo**: add products and their presentations (each with its price and an optional weight in grams).
3. **Pedidos > Nuevo pedido**: customer (or none) and delivery date, then tap products and adjust quantities, then **Guardar nota**.
4. In the order: add more notes, register payments (partial or full), change the stage, print or share.
5. **Producción** shows how many kilos and pieces to prepare by day or week. **Reportes** shows sales, money collected and pending.
6. **Ajustes**: business data printed on notes, the folio letter of this device, ticket width and printer, backup (export/import
   JSON), demo data, and the database.

## Modes

- **Lite** (default): everything stays in this browser (IndexedDB: hundreds of MB; the app warns if space runs low). Nothing is sent anywhere. Download a backup from time to time; "Descargar y
  limpiar lo viejo" downloads a backup and then removes old orders from the device (it never removes anything by itself).
- **Connected**: Ajustes > Base de datos. Create a free project at supabase.com, paste its URL and public (anon) key, and create an
  account. If the tables do not exist yet the app shows one screen: copy the SQL, open the project's SQL editor, paste, Run, and tap
  "Ya lo hice". The first person creates the business; others join with the six-letter code shown in Ajustes. Each device keeps the
  last 30 days (configurable) plus everything still to deliver; full history stays in the database and in Reportes.

## Automatic backup

Ajustes > Respaldo automático en el equipo. In Chrome or Edge (Android, computers) choose a folder once (for example Documentos): the
app writes `notas-respaldo-actual.json` a minute after changes and one copy per day (the last 14). If the phone or the app stops
working, copy those files from the phone to a computer and load one with Ajustes > Cargar respaldo on any device. On iPhone and other
browsers the app reminds you each day there were changes; one tap saves the file or shares it to Drive, WhatsApp or mail.
Connected mode is still the best protection: the data is also on the server.

## Export

Ajustes > Respaldo y exportación:

- **Exportar todo para Excel (CSV en .zip)**: one CSV per table (productos, presentaciones, clientes, pedidos, notas, renglones, pagos,
  historial), opens in Excel with accents. In Connected mode it reads the whole database, not only this device's 30 days.
- **Exportar todo para PostgreSQL (.sql)**: a script that creates schema `notas_export` in any PostgreSQL and loads every row; it can
  be run again to update.
- **Descargar respaldo (JSON)**: to load the data back into the app.

In Connected mode the same tables exist as views in the database (`v_pedidos`, `v_renglones`, ...) for DBeaver, pgAdmin or Power BI;
see docs/DATABASE.md.

## Printing

Letter and ticket printing go through the browser's print dialog, which works with any printer and also saves PDFs. A thermal
printer can be used through the system print service (on Android, for example the RawBT app). Direct ESC/POS printing over
Bluetooth, USB or serial is prepared (Ajustes > Impresora de tickets) for when a printer is chosen; see docs/TECHNICAL.md §5.

## Host it (for a phone or tablet)

It is a static site: any HTTPS static host works. HTTPS is required for installing it and for offline use.

- **Netlify Drop**: drag the `notas-web` folder to https://app.netlify.com/drop and open the address it gives you.
- **GitHub Pages**: push this repository, then Settings > Pages > Deploy from branch, root folder.
- On the phone, open the address and choose "Agregar a pantalla de inicio" / "Instalar app". From then on it opens without internet.

## Develop

```bash
npm ci                         # development tools only; the app has no dependencies
npm test                       # node --test "tests/*.test.js" (offline: jsdom, PGlite, a fake Supabase)
npm run format:check           # Prettier
npm start                      # http://127.0.0.1:8000/  (add ?debug=debug to trace)
node scripts/build_schema_js.js  # after changing db/schema.sql
npm run preview                # dist/notas-preview.html (single file) and dist/notas-web/ (deployable folder)
```

Read AGENTS.md before changing anything; the documentation map is docs/README.md.
