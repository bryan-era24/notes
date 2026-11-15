# 0016. Paying more than the balance gives change by default, or leaves it in favour

Status: Accepted. Date: 2026-11-15.

Context: receiving $500 for an order of $80 recorded $500 and showed "Saldo a favor" with a balance of $0, so nobody knew that $420 had
to be given back.
Decision: while typing an amount above what is owed, the payment form shows "Cambio a entregar: $420" and records only what is owed,
writing "Recibido $500.00, cambio $420.00" in the payment comment. A second button, "Dejar $420.00 a favor del cliente", records all of
it. An order that was paid more than its total shows "A favor del cliente" with the amount, on screen, on paper, in the PDF and in the
shared text (`NT.logic.balanceLine`, `NT.logic.paymentSplit`).
Consequences: cash counts match what was recorded; credit is a deliberate choice. The change lives in the comment (LIM-021).
Enforced by: tests/logic.test.js (TC-PAG-05-01, 02) and tests/app_fixes.test.js (TC-PAG-05-03, 04).
