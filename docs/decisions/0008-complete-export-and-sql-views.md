# 0008. Complete export (CSV, SQL) and readable views from one table definition

Status: Accepted. Date: 2026-11-15.

Context: the data must open in Excel and in any PostgreSQL, completely, and the documents table (jsonb) is awkward for SQL clients.
Decision: js/export.js defines eight tables (productos, presentaciones, clientes, pedidos, notas, renglones, pagos, historial) and
produces a ZIP of CSVs (UTF-8 with BOM, formula-safe text) and an idempotent SQL script (schema notas_export, upserts). db/schema.sql
defines v_* views with the same columns (security_invoker, so access rules apply). In Connected mode the export reads every document
from the server (sync.fetchAll), merged with this device's pending changes.
Consequences: a column change touches both js/export.js and the views; tests/views.test.js fails until they agree.
Enforced by: tests/export.test.js, tests/views.test.js, tests/sync.test.js (TC-EXP-03-01).
