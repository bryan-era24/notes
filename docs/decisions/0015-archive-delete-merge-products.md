# 0015. Products are archived, deleted only when unused, and merged when duplicated

Status: Accepted. Date: 2026-11-15.

Context: a product added twice by mistake ("Palomitas Natural" and "Palomitas Naturales") could not be removed, and "desactivar" did
not say where the product went. Notes depend on products, but each note line keeps the name and price it was sold with.
Decision: "Archivar" (the existing `active: false`) moves a product to a folded "Archivados" section of Catálogo with "Restaurar"; it
leaves the note editor, and old notes and reports keep it. "Eliminar" is offered only when no note uses the product (soft delete, two
taps); otherwise the screen explains why and offers to archive or merge. "Unir con otro producto" moves every line of the duplicate to
the chosen product (product id and name; presentation matched by label or added to it) without touching quantities, prices or amounts,
archives the duplicate with `mergedInto`, and saves all of it in one batch with a history entry per changed document. Renaming changes
the product from then on; notes already written keep their names.
Consequences: Producción and Reportes count merged products as one. A merge is undone document by document from history (LIM-019).
The new optional product field `mergedInto` needs no migration.
Enforced by: tests/repo.test.js (TC-CAT-06-01 to 03) and tests/app_fixes.test.js (TC-CAT-06-04).
