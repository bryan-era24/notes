# 0004. Fail closed, soft delete, Lite never deletes by itself

Status: Accepted. Date: 2026-11-15.

Decision: unreadable stored data stops the app and offers it for download, never writing over it (from the bot). Deletions set
deletedAt. In Lite, old data leaves the device only through 'Descargar y limpiar lo viejo' (backup first, second tap to confirm).
Enforced by: tests/store_local.test.js, tests/app_flows.test.js, tests/repo.test.js.
