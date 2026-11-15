# Database (Connected mode)

Last verified: 2026-11-15. Status: current.

1. Create a free project at supabase.com. In Project Settings > API copy the URL and the anon (public) key.
2. In the app: Ajustes > Base de datos, paste them, write an email and password, tap "Crear cuenta" (or "Entrar").
   If the project asks to confirm emails, confirm and then "Entrar" (or turn confirmation off in Authentication > Providers > Email).
3. If the tables are missing the app shows "Falta preparar la base de datos": "Copiar instrucciones", "Abrir editor SQL", paste, Run,
   then "Ya lo hice, revisar". The SQL is `db/schema.sql`; it is idempotent and safe to run again.
4. "Crear mi negocio" on the first device; other devices "Unirme con código" with the six letters shown in Ajustes.
5. "Conectar este equipo". If the device and the database both have data, the app asks which to keep.

Schema: `businesses`, `members`, `documents` (one row per device document, `data jsonb`), RLS by membership, no DELETE grant,
last-write-wins trigger, history rows immutable, functions `notas_bootstrap`, `notas_join`, `notas_membership`.
To change it: edit `db/schema.sql` keeping it idempotent, add tests in `tests/schema.test.js`, run `node scripts/build_schema_js.js`.
