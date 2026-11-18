# Decisions

| #                                             | Decision                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [0001](0001-static-site-offline.md)           | Static site, no build, no runtime dependencies, local fonts, offline worker                |
| [0002](0002-store-contract-and-repo.md)       | Data only through the store; changes only through the repo, with history                   |
| [0003](0003-local-first-sync.md)              | Local first; one generic documents table; business membership                              |
| [0004](0004-fail-closed-and-soft-delete.md)   | Fail closed on unreadable data; soft delete; Lite never deletes by itself                  |
| [0005](0005-money-folios-printing.md)         | Integer centavos; device folios; printer adapter layer                                     |
| [0006](0006-history-keeps-changed-fields.md)  | History keeps only the fields that changed                                                 |
| [0007](0007-indexeddb-device-storage.md)      | IndexedDB on the device, localStorage as fallback                                          |
| [0008](0008-complete-export-and-sql-views.md) | Complete export (CSV, SQL) and readable views from one table definition                    |
| [0009](0009-automatic-local-backup.md)        | Automatic local backup to a folder, or a daily one-tap reminder                            |
| [0010](0010-one-search-everywhere.md)         | One search box on every screen, filtering note lines                                       |
| [0011](0011-everything-that-groups-folds.md)  | Everything that groups folds the same way                                                  |
| [0012](0012-poll-while-open.md)               | Check for other devices' changes every 90 seconds while the app is open                    |
| [0013](0013-colours-carry-meaning.md)         | Every colour carries one meaning, and the main action is ink                               |
| [0014](0014-pdf-inside-the-app.md)            | The letter note is also a PDF made inside the app                                          |
| [0015](0015-archive-delete-merge-products.md) | Products are archived, deleted only when unused, and merged when duplicated                |
| [0016](0016-change-and-credit.md)             | Paying more than the balance gives change by default, or leaves it in favour               |
| [0017](0017-versions-and-conflicts.md)        | Version numbers decide sync, and simultaneous changes become conflicts the person resolves |
