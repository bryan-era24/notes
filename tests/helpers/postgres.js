/*
 * Purpose: A real PostgreSQL (PGlite, in memory) with db/schema.sql applied, for tests that must run offline.
 * Responsibilities: Create the Supabase pieces the schema expects (auth.uid() and the authenticated and anon roles), apply the schema, and run SQL as a given user inside a transaction so row-level security applies. It never connects to a network database.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const SCHEMA = fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8");

// What Supabase provides and the schema relies on.
const SUPABASE_STANDINS = `
  create role authenticated;
  create role anon;
  create schema auth;
  grant usage on schema auth to authenticated;
  grant usage on schema public to authenticated;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
`;

/** Opens a fresh database with the schema applied. */
async function openDatabase() {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(SUPABASE_STANDINS);
  await db.exec(SCHEMA);
  let queue = Promise.resolve();

  /** Runs `fn(tx)` as `userId` (role authenticated), or as the owner when userId is null. Serialised. */
  function as(userId, fn) {
    const run = queue.then(() =>
      db.transaction(async (tx) => {
        if (userId) {
          await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
          await tx.exec("set local role authenticated");
        }
        return fn(tx);
      })
    );
    queue = run.catch(() => {});
    return run;
  }

  return { db, as, schema: SCHEMA };
}

module.exports = { openDatabase, SCHEMA };
