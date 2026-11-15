# 0009. Automatic local backup to a folder, or a daily one-tap reminder

Status: Accepted. Date: 2026-11-15.

Context: if the phone or the app stops working, the browser's own storage (IndexedDB) cannot be read from outside without forensic tools.
A copy has to live in the phone's ordinary storage, or off the phone.
Decision: where the browser offers the File System Access API (Chrome and Edge on Android and computers), the person picks a folder once;
js/backup.js writes notas-respaldo-actual.json one minute after changes and notas-respaldo-AAAA-MM-DD.json, keeping the newest 14 daily
copies and never touching other files. The folder handle is kept in IndexedDB (notas-ajustes); when the browser asks again for
permission, Pedidos shows one button to reactivate it. Elsewhere (iPhone, Firefox, other browsers) Pedidos reminds after changes, once a
day, with one tap to save the file (download) or share it (Drive, WhatsApp, mail); the status line warns when changes waited more than
three days. The file is the same JSON backup that 'Cargar respaldo' restores. It is not encrypted, so it can be recovered without a password.
Consequences: Connected mode remains the real protection (a copy off the phone); the local backup is the second line. The backup
file holds customer names and phones in plain text.
Enforced by: tests/backup.test.js, tests/app_flows.test.js (TC-BAK-04-01, TC-BAK-04-02).
