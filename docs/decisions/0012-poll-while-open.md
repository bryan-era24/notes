# 0012. Check for other devices' changes every 90 seconds while the app is open

Status: Accepted. Date: 2026-11-15.

Context: a device open but untouched did not see other devices' changes until something triggered a sync.
Decision: after every successful sync, while the app is visible, the engine schedules the next one in pollMs (90 s, NT.config.pollMs).
A check never delays a pending send: scheduling keeps an earlier timer (a change's 1.5 s send) and only a sooner one replaces it. A hidden
app does not poll; becoming visible syncs at once. Supabase Realtime was considered and left out: more moving parts for a few seconds
gained.
Consequences: other devices' changes appear within about 90 s; each open device makes one small request per check.
Enforced by: tests/sync.test.js (TC-SYN-09-01).
