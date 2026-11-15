/*
 * Purpose: The database setup as the person sees it, in the real page against the fake Supabase (no network).
 * Covers: creating an account from Ajustes, the "prepare the database" screen with the SQL to copy when the tables are missing, checking
 * again once the SQL was run, creating the business, and switching the device to Connected.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { openApp } = require("./helpers/open_app");
const { createFakeSupabase, BASE, ANON_KEY } = require("./helpers/fake_supabase");

test("[TC-SYN-07-01] account, missing tables, SQL to copy, business, connect", async () => {
  const server = await createFakeSupabase();
  server.schemaMissing = true;
  const app = await openApp({ remote: server });
  const copied = [];
  Object.defineProperty(app.window.navigator, "clipboard", { value: { writeText: async (s) => copied.push(s) }, configurable: true });
  await app.go("#/ajustes");
  await app.type("#db-url", BASE);
  await app.type("#db-key", ANON_KEY);
  await app.type("#db-email", "dueña@example.test");
  await app.type("#db-pass", "secreto123");
  const form = app.window.document.querySelector('[data-form="signIn"]');
  const up = form.querySelector('button[value="up"]');
  form.dispatchEvent(Object.assign(new app.window.Event("submit", { bubbles: true, cancelable: true }), { submitter: up }));
  await app.waitFor(() => /Falta preparar la base de datos/.test(app.text()));
  await app.click('[data-act="copySql"]');
  assert.match(copied[0], /create table if not exists public\.documents/);
  assert.match(app.window.document.querySelector('a[href*="supabase.com/dashboard"]').href, /supabase\.com\/dashboard/);

  server.schemaMissing = false;
  await app.click('[data-act="checkSchema"]');
  await app.waitFor(() => /Crear mi negocio/.test(app.text()));
  await app.type("#biz-name", "Palomitas Lupita");
  app.window.document
    .querySelector('[data-form="bootstrap"]')
    .dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await app.waitFor(() => /Conectar este equipo/.test(app.text()));
  assert.match(app.text(), /Palomitas Lupita/);
  await app.click('[data-act="connectNow"]');
  const conn = JSON.parse(app.window.localStorage.getItem("notas:pref:connection"));
  assert.equal(conn.mode, "connected");
  assert.match(conn.joinCode, /^[A-Z]{6}$/);
  assert.equal(JSON.stringify(conn).includes("secreto123"), false, "the password is never stored");
});
