# Plans

Last verified: 2026-11-15.

Done: everything in the design (Lite, Connected, printing, sharing, production, reports, demo data, offline install).

Done after: lighter history, IndexedDB storage with space warning, complete export (CSV zip, SQL) and v_* views, better order search,
folding reports, product search and best sellers first, 40 orders per page.

Next:

1. Choose the thermal printer; test "Imprimir prueba" with it and adjust js/printers.js / js/escpos.js if needed (LIM-003).
2. Try Connected mode against a real Supabase project (LIM-004) and note anything different.
3. Watch the main user make a few notes; adjust wording and sizes from what she struggles with.
4. Server-side report sums (SQL) when years of history make fetchRange slow.
5. Optional: per-customer prices, PDF file generation, roles.
