# 0010. One search box on every screen, filtering note lines

Status: Accepted. Date: 2026-11-15.

Decision: Pedidos, Producción, Reportes and Catálogo share one search box (same place, same × , accents optional, every word must
match) and a band 'Solo se muestra: ... · Quitar filtro' while it is active. Each screen keeps its own search while the app is open.
In Producción and Reportes the search filters note lines (NT.logic.filterBySearch): words that all describe the order (customer,
folio, phone, comment) keep whole orders; otherwise only the matching lines are kept and the figures are recalculated. Money collected
and pending, and the customers' balance, are hidden when only some lines are kept, because a payment cannot be split by product.
Catálogo filters products (name, presentations) and customers (name, phone) together.
Enforced by: tests/logic.test.js (TC-PRO-03-01, TC-CAT-03-02), tests/app_flows.test.js (TC-PRO-03-02, TC-PED-04-02).
