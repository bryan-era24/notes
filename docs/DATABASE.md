# Database (Connected mode)

Last verified: 2026-11-15. Status: current.

1. Create a free project at supabase.com. In Project Settings > API copy the URL and the anon (public) key.
2. In the app: Ajustes > Base de datos, paste them, write an email and password, tap "Crear cuenta" (or "Entrar").
   If the project asks to confirm emails, confirm and then "Entrar" (or turn confirmation off in Authentication > Providers > Email).
3. If the tables are missing the app shows "Falta preparar la base de datos": "Copiar instrucciones", "Abrir editor SQL", paste, Run,
   then "Ya lo hice, revisar". The SQL is `db/schema.sql`; it is idempotent and safe to run again.
4. "Crear mi negocio" on the first device; other devices "Unirme con código" with the six letters shown in Ajustes.
5. "Conectar este equipo". If the device and the database both have data, the app asks which to keep.

Readable views (schema version 2): `v_productos`, `v_presentaciones`, `v_clientes`, `v_pedidos`, `v_notas`, `v_renglones`,
`v_pagos`, `v_historial`, with the same columns as the CSV export, money in pesos and states in Spanish. They respect the access rules.
To open the data in DBeaver, pgAdmin, Excel or Power BI: Supabase > Connect > connection string (PostgreSQL), sign in with the
database password, and read the `v_*` views (filter by `negocio_id` if the project holds several businesses). The Supabase table
editor can also export any view to CSV. Projects created before version 2: run `db/schema.sql` again (idempotent).

Schema version 3 (decision 0017) adds the `rev` column and the function `notas_push`. A project on version 2 keeps its data; the app
shows "Falta preparar la base de datos" until the SQL is run again: "Copiar instrucciones", "Abrir editor SQL", paste, Run, "Ya lo hice,
revisar". Changes wait on the devices meanwhile.

To move the data to another PostgreSQL without Supabase: Ajustes > "Exportar todo para PostgreSQL (.sql)" and run the file there
(`psql -f notas-exportacion-AAAA-MM-DD.sql`); it creates schema `notas_export` and can be run again to update.

Schema: `businesses`, `members`, `documents` (one row per device document, `data jsonb`), RLS by membership, no DELETE grant,
a trigger that raises `rev` on every change (and keeps the old clock rule for plain updates from apps before version 3), history
rows immutable, functions `notas_bootstrap`, `notas_join`, `notas_membership` and `notas_push` (versioned changes, conflicts returned).
To change it: edit `db/schema.sql` keeping it idempotent, add tests in `tests/schema.test.js` (including an update from the previous
version: keep a frozen copy in `tests/fixtures/`), run `node scripts/build_schema_js.js`.
