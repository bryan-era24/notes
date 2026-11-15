# 0011. Everything that groups folds the same way

Status: Accepted. Date: 2026-11-15.

Decision: every group of every screen is a <details> with data-fold-set and data-fold, and each screen has 'Expandir todo' /
'Contraer todo' (foldTools): Pedidos (date groups), Producción (each product, the title keeps kg and pieces), Reportes (sections and
products), Catálogo (Productos, Clientes) and an order (each note with its subtotal in the title, payments, history). Groups start open
except report products and an order's history. What is folded is remembered on the device for the list screens (preferences
ordersFold, reportOpen, fold.production, fold.catalog); an order's folds last while the app is open. While a search is active, results
show open.
Enforced by: tests/app_flows.test.js (TC-PED-05-01, TC-REP-03-01, TC-NFR-06-01).
