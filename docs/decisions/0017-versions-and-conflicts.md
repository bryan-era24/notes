# 0017. Version numbers decide sync, and simultaneous changes become conflicts the person resolves

Status: Accepted. Date: 2026-11-17. Changes how decision 0003 resolves two versions of one document; its other guarantees stand.

Context: sync kept "the newest change wins" by each phone's clock, per whole document. Two problems were found: a phone with its
clock behind lost its change without any message (the server skipped it and the phone never read the server's version again, so the
two disagreed for good: TC-SYN-10-01 reproduced it), and two people editing the same note at once lost one of the edits silently.
Decision: every row of `public.documents` has a version, `rev` (1 when created, one more on every change). The device remembers the
version it last saw of each document and sends it with each change through `notas_push` (schema version 3). The server applies a
change only when it was made on the current version; otherwise it returns its own row as a conflict and changes nothing. The device
then shows the server's version, keeps its own aside in `_sync/state` and shows both on every screen ("Otra persona cambió lo mismo
que tú"): "Usar la mía" saves it again as a normal change with history; "Quedarme con la otra" discards it after a second tap.
Pulled rows always replace a document that is not pending, whatever the clocks say. Separate documents (each note, each payment, each
history entry) never conflict. Opening an order that someone else changed in the last 15 minutes says so. A database on schema
version 2 makes the app ask for the update (run `db/schema.sql` again); plain updates from older apps keep the old clock rule.
Consequences: no change is lost without the person seeing it, and phones with a wrong clock no longer decide. Two people editing the
same document must choose; the app does not merge line by line (LIM-005). The sync state grows by one number per document.
Enforced by: tests/sync.test.js (TC-SYN-10-01 to 04), tests/schema.test.js (TC-SYN-10-07, 08), tests/logic.test.js (TC-SYN-10-05, 06) and tests/app_connect.test.js (TC-SYN-07-02, 03).
