# Known limitations

Last verified: 2026-11-15. Status: current.

| ID      | Limitation                                                                            | Effect                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| LIM-001 | In Lite mode the browser can clear the data (cleared site data, new phone)            | The app asks the browser to keep it; still download a backup often, or use Connected mode                                            |
| LIM-002 | Browsers without IndexedDB fall back to localStorage, about 5 MB (about 1,700 orders) | The app warns at 80%; use the window or "Descargar y limpiar lo viejo"                                                               |
| LIM-003 | Direct thermal printing (ESC/POS) is untested on real printers                        | Use browser printing until a printer is chosen and tested                                                                            |
| LIM-004 | Connected mode is tested against a stand-in of Supabase, not a live project           | Differences show up only when connecting for real                                                                                    |
| LIM-005 | Last write wins by device clock, per whole document                                   | Two people editing the same note at once: the later save wins; the other change is in history                                        |
| LIM-006 | A note's window date follows its order's dates at the time it was sent                | Changing an order's delivery date does not move already-synced notes until they are edited                                           |
| LIM-007 | Sync runs only while the app is open                                                  | Changes wait on the device until it is opened with internet; while open and visible, other devices' changes arrive within about 90 s |
| LIM-008 | No PDF file is generated inside the app                                               | Use "Guardar como PDF" in the print dialog                                                                                           |
| LIM-009 | Folios are unique per device letter; two devices with the same letter repeat folios   | Give each device its own letter in Ajustes                                                                                           |
| LIM-010 | Spanish only                                                                          | Texts are keys, so a language can be added                                                                                           |
| LIM-011 | The whole device data is held in memory while the app is open                         | Fine for tens of thousands of documents; the window keeps Connected devices small                                                    |
| LIM-012 | Undo from history puts back the fields of one change                                  | Undoing an older change after later edits to the same fields overwrites those later values                                           |
| LIM-013 | CSV times (creado, pagado_en, fecha_hora) are in UTC                                  | Excel shows them six hours ahead of Guadalajara; the date columns are local                                                          |
| LIM-014 | Search covers the orders on this device                                               | In Connected mode older orders outside the window are in the export or the v_* views                                                 |
| LIM-015 | Writing the backup to a folder works only in Chrome and Edge (Android, computers)     | iPhone, Firefox and others get a daily one-tap reminder instead                                                                      |
| LIM-016 | The browser may ask again for the backup folder permission when the app reopens       | Pedidos shows "Toca para reactivar el respaldo"; until tapped, nothing is written                                                    |
| LIM-017 | The local backup file is not encrypted                                                | Anyone with the phone's files can read customer names and phones in it                                                               |
| LIM-018 | A dead phone whose storage cannot be read also loses its local backup                 | Use Connected mode or share the backup off the phone                                                                                 |
