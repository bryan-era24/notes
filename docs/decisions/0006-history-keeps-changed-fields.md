# 0006. History keeps only the fields that changed

Status: Accepted. Date: 2026-11-15.

Context: full before/after copies made history about 60% of the stored size (4.7 KB per typical order).
Decision: a history entry stores changes = { field: [old, new] } for the fields that differ (stamps left out), plus a small ref (note
number, payment amount, folio or name) to show it. Creations and payments store no copy: the document itself is the record.
'Deshacer este cambio' puts back the old values of those fields; undoing a creation deletes softly. Entries in the earlier full-copy
format are still restored from before (tolerant reader).
Consequences: about 2.9 KB per typical order (39% less). Undo is per change, not 'jump to version N'.
Enforced by: tests/repo.test.js (TC-SYN-03-04, TC-SYN-03-05).
