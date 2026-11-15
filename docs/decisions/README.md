# Decisions

| #                                             | Decision                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| [0001](0001-static-site-offline.md)           | Static site, no build, no runtime dependencies, local fonts, offline worker |
| [0002](0002-store-contract-and-repo.md)       | Data only through the store; changes only through the repo, with history    |
| [0003](0003-local-first-sync.md)              | Local first; one generic documents table; business membership               |
| [0004](0004-fail-closed-and-soft-delete.md)   | Fail closed on unreadable data; soft delete; Lite never deletes by itself   |
| [0005](0005-money-folios-printing.md)         | Integer centavos; device folios; printer adapter layer                      |
| [0006](0006-history-keeps-changed-fields.md)  | History keeps only the fields that changed                                  |
| [0007](0007-indexeddb-device-storage.md)      | IndexedDB on the device, localStorage as fallback                           |
| [0008](0008-complete-export-and-sql-views.md) | Complete export (CSV, SQL) and readable views from one table definition     |
