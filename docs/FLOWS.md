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
- **New order**: 1) customer (search, pick, type a new name, or "Sin nombre") and delivery date (Hoy, Mañana, Pasado mañana, other); 2) products: tap a product (one presentation adds it at once; several show buttons), adjust with − / + or type the quantity, adjust
  the price per piece if needed; 3) "Guardar nota". A new name creates the customer.
- **Order**: totals, paid, balance and payment status; stage chips; "Agregar nota", "Registrar pago" (amount, "Liquidar saldo",
  method, optional note); print letter, print ticket, share; each note with its lines, stage, edit, print alone, delete (two taps);
  payments; history with "Volver a esta versión"; change customer/date/comment; delete the order (two taps). Changes show a toast with
  "Deshacer" for stages and deletes.
- **Producción**: today, tomorrow, this week, next week, with ‹ › to move; per product kg and pieces, presentations, folios; the search
  narrows to a product, a customer or a folio and recalculates.
- **Reportes**: today, week, month, last month, custom dates; sold, collected, pending; sections by product (each product with several
  presentations opens to show them), by customer and by day fold and unfold, with "Expandir todo" / "Contraer todo"; what is open is
  remembered on the device; the search narrows to a product, customer or folio (sections open; money collected and pending
  hidden when a product is searched); in Connected mode "Usar todo el historial (en línea)".
- **Catálogo**: one search for products (name, presentation) and customers (name, phone); products (name, presentations with label, optional grams, price; deactivate instead of delete) and customers.
- **Ajustes**: business data; this device (folio letter, ticket width, printer, test print); database (sign in/up, setup screen,
  create or join a business, connect, status, window, back to Lite); space used; "Exportar todo para Excel (CSV en .zip)", "Exportar todo para PostgreSQL (.sql)"; backup (JSON export, import merge/replace, download and clean old);
  demo data (load, remove); diagnostics.
