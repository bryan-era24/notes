# 0002. Store contract and a single writer

Status: Accepted. Date: 2026-11-15.

Context: history of every change was requested, and an order, its folio counter and its history entry must never be saved apart.
Decision: the store contract (backend/store.js) adds batch() for atomic multi-document writes, plus synchronous get/list. Only
js/repo.js changes data; each change and its history entry go in one batch.
Consequences: any version can be restored from history; the UI never writes documents directly.
Enforced by: tests/store_local.test.js, tests/repo.test.js, tests/rules.test.js.
