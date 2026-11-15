# 0013. Every colour carries one meaning, and the main action is ink

Status: Accepted. Date: 2026-11-15.

Context: several buttons and labels used the same blue for everything (actions, selection, arrows, bars), the folio red also meant "owes"
and "delete", every notice looked like a warning, and stages had no colour at all, so colour said nothing.
Decision: follow the Relieve standard. Colours exist only as tokens in `:root`, each with one meaning written in `docs/DESIGN.md`: ink
for writing and the main action, blue only for what you chose or where you are, violet for work under way, green for finished, amber for
what needs you (money owed, reminders), teal for information, red for delete, discard or failure, grey for what no longer counts, and the
folio red only for the folio. Stages and payment statuses get their own pills; notices always carry a tone; text passes 4.5:1.
Consequences: the order list can be read from afar (stage and payment side by side); a new colour needs a row in `docs/DESIGN.md`.
Enforced by: tests/design.test.js (TC-NFR-07-01 to TC-NFR-07-06).
