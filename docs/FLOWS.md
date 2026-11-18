# Flows

Last verified: 2026-11-15. Status: current.

- **Every screen with groups** (Pedidos, Producción, Reportes, Catálogo, an order): each group folds and unfolds by tapping its title,
  with "Expandir todo" / "Contraer todo" (decision 0011).
- **Every screen with a list** (Pedidos, Producción, Reportes, Catálogo): the same search box under the title, × to clear, and the band
  "Solo se muestra: … · Quitar filtro" while a search is active; each screen keeps its search while the app is open.
- **Colours** (docs/DESIGN.md): each order row shows its stage and payment status as pills with words: Pedido (plain),
  En preparación (violet), Entregado and Recibido y firmado (green), Cancelado (grey, struck); Pendiente and Pago parcial (amber),
  Pagado (green), Saldo a favor (teal). The chosen stage chip takes the stage's colour. The main button of each block is dark ink, blue
  marks only what is chosen, red only deletes or failures; notices are amber (needs you), teal (information), red (failed or about to
  delete) or green (done).
- **Pedidos**: a backup band when needed (reactivate the folder, choose a folder, or save today's backup); "Nuevo pedido"; one search box (name, folio number, product, phone; accents optional; × clears) that searches every
  order and hides the filters while in use; filters Por entregar (default), Con saldo, Todos; groups by delivery date with counts, each group folds and unfolds (with "Expandir todo" / "Contraer todo", remembered on
  the device) and pages on its own with "Ver más";
  40 orders per group at a time. Empty first run offers the catalog and demo data.
- **Note editor products**: best sellers first; with more than 12 products a search box filters the tiles. Catálogo has the same search.
- **New order**: 1) customer: one drop-down field ("Cliente ▾") that opens a search box and a list with "Sin nombre" first, "Nuevo cliente: «…»" for a new name, then the existing customers that match (8 at a time); and delivery date (Hoy, Mañana, Pasado mañana, other); 2) products: tap a product (one presentation adds it at once; several show buttons), adjust with − / + or type the quantity, adjust
  the price per piece if needed; 3) "Guardar nota". A new name creates the customer.
- **Order**: totals, paid, balance (or "A favor del cliente" when more was paid) and payment status; stage chips; "Agregar nota",
  "Registrar pago" (amount, "Liquidar saldo", method, optional note; an amount above the balance shows "Cambio a entregar" and records
  only what is owed, or "Dejar … a favor del cliente" records all, decision 0016); print letter (on iPhone, the PDF and the share
  sheet), print ticket, "PDF" (the file "cliente folio fecha.pdf", shared or downloaded, decision 0014), share; "Cambiar cliente/fecha" opens
  in place of its button at the end of the order, with the same customer drop-down; each note with its lines, stage, edit, print alone, delete (two taps);
  payments; history with "Volver a esta versión"; change customer/date/comment; delete the order (two taps). Changes show a toast with
  "Deshacer" for stages and deletes.
- **Producción**: today, tomorrow, this week, next week, with ‹ › to move; per product kg and pieces, presentations, folios; the search
  narrows to a product, a customer or a folio and recalculates.
- **Reportes**: today, week, month, last month, custom dates; sold, collected, pending; sections by product (each product with several
  presentations opens to show them), by customer and by day fold and unfold, with "Expandir todo" / "Contraer todo"; what is open is
  remembered on the device; the search narrows to a product, customer or folio (sections open; money collected and pending
  hidden when a product is searched); in Connected mode "Usar todo el historial (en línea)".
- **Catálogo**: one search for products (name, presentation) and customers (name, phone); products (name, presentations with label,
  optional grams, price) and customers; a folded "Archivados" section with "Restaurar". On a saved product: "Archivar (ya no se vende)"
  or "Restaurar"; "Eliminar producto" (two taps) only when no note uses it, otherwise "Se usa en N notas"; "Unir con otro producto":
  choose the one that stays, confirm, and its notes move without changing amounts (decision 0015).
- **Two people, same thing** (Connected, decision 0017): if someone changed a note, an order, a product or a customer first, every
  screen shows "Otra persona cambió lo mismo que tú" with a table of what differs ("Tu versión" / "La que se quedó"). "Usar la mía"
  saves yours on top; "Quedarme con la otra" discards yours after a second tap. The status line says "1 cambio por revisar".
  Opening an order that someone else changed in the last 15 minutes shows who and how long ago.
- **Install**: in a Safari tab on iPhone with data only on the device, Pedidos shows "Instala la app…" with "Cómo instalar" and
  "Ocultar". Ajustes starts with "Instalar en este equipo": steps for iPhone o iPad, Android and the computer.
- **Ajustes**: business data; this device (folio letter, ticket width, printer, test print); database (sign in/up, setup screen,
  create or join a business, connect, status, window, back to Lite); space used; "Exportar todo para Excel (CSV en .zip)", "Exportar todo para PostgreSQL (.sql)"; backup (JSON export, import merge/replace, download and clean old);
  demo data (load, remove); diagnostics.
