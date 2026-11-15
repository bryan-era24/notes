# Known limitations

Last verified: 2026-11-15. Status: current.

| ID      | Limitation                                                                                       | Effect                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| LIM-001 | In Lite mode the browser can clear the data (cleared site data, unused installed app, new phone) | Download a backup often, or use Connected mode                                                 |
| LIM-002 | localStorage holds about 5 MB                                                                    | Thousands of notes fit; use the window or "Descargar y limpiar lo viejo"                       |
| LIM-003 | Direct thermal printing (ESC/POS) is untested on real printers                                   | Use browser printing until a printer is chosen and tested                                      |
| LIM-004 | Connected mode is tested against a stand-in of Supabase, not a live project                      | Differences show up only when connecting for real                                              |
| LIM-005 | Last write wins by device clock, per whole document                                              | Two people editing the same note at once: the later save wins; the other version is in history |
| LIM-006 | A note's window date follows its order's dates at the time it was sent                           | Changing an order's delivery date does not move already-synced notes until they are edited     |
| LIM-007 | Sync runs only while the app is open                                                             | Changes wait on the device until it is opened with internet                                    |
| LIM-008 | No PDF file is generated inside the app                                                          | Use "Guardar como PDF" in the print dialog                                                     |
| LIM-009 | Folios are unique per device letter; two devices with the same letter repeat folios              | Give each device its own letter in Ajustes                                                     |
| LIM-010 | Spanish only                                                                                     | Texts are keys, so a language can be added                                                     |
