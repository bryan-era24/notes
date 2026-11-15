# 0005. Centavos, device folios, printer adapters

Status: Accepted. Date: 2026-11-15.

Decision: money is integer centavos on the device (numeric in reports), so totals are exact. Folios are the device letter plus a
counter saved with the order. Screens build a print model; adapters print it (browser for letter and ticket; ESC/POS over
Bluetooth, Serial or USB prepared for when the printer is chosen).
Enforced by: tests/logic.test.js, tests/print.test.js, tests/repo.test.js.
