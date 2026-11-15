# 0003. Local first, one documents table, access by business

Status: Accepted. Date: 2026-11-15.

Context: up to 10 people share one business's data, often offline.
Decision: Budget's guarantees (pending mark in the same write, never drop or overwrite pending, copy before replacing). One generic
table public.documents (jsonb) instead of one table per collection; RLS by membership; businesses created and joined through
security-definer functions with a six-letter code. The browser cannot create tables with the public key, so a missing schema is
detected and the setup screen offers the SQL to copy.
Consequences: one mapping and one sync path; new fields need no migration; SQL reporting reads jsonb.
Enforced by: tests/sync.test.js, tests/schema.test.js, tests/app_connect.test.js.
