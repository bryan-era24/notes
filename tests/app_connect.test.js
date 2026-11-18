/*
 * Purpose: The database setup as the person sees it, in the real page against the fake Supabase (no network).
 * Covers: creating an account from Ajustes, the "prepare the database" screen with the SQL to copy when the tables are missing, checking
 * again once the SQL was run, creating the business, switching the device to Connected, and a sync conflict shown with both versions.
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

/** An app connected to a fresh business on the fake server, ready to sync. */
async function connectedApp() {
  const server = await createFakeSupabase();
  const app = await openApp({ remote: server });
  await app.go("#/ajustes");
  await app.type("#db-url", BASE);
  await app.type("#db-key", ANON_KEY);
  await app.type("#db-email", "duena@example.test");
  await app.type("#db-pass", "secreto123");
  const form = app.window.document.querySelector('[data-form="signIn"]');
  form.dispatchEvent(
    Object.assign(new app.window.Event("submit", { bubbles: true, cancelable: true }), {
      submitter: form.querySelector('button[value="up"]'),
    })
  );
  await app.waitFor(() => /Crear mi negocio/.test(app.text()));
  await app.type("#biz-name", "Palomitas Lupita");
  app.window.document
    .querySelector('[data-form="bootstrap"]')
    .dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await app.waitFor(() => /Conectar este equipo/.test(app.text()));
  await app.click('[data-act="connectNow"]');
  // "Conectar" reloads the page: open it again with what the first page saved.
  const saved = {};
  for (let i = 0; i < app.window.localStorage.length; i++) {
    const k = app.window.localStorage.key(i);
    saved[k] = app.window.localStorage.getItem(k);
  }
  app.window.close();
  const reopened = await openApp({ remote: server, storage: saved });
  await reopened.wait(200);
  return { server, app: reopened };
}
/** What another device does: changes the customer's name on the server, on top of the current version. */
async function otherDeviceRenames(server, app, path, name) {
  const userId = app.window.NT.connection.session().userId;
  await server.pg.as(userId, (tx) =>
    tx.query(
      "update public.documents set data = jsonb_set(data, '{name}', to_jsonb($1::text)), client_updated_at = now() + interval '1 hour' where path = $2",
      [name, path]
    )
  );
}

/** Taps "Sincronizar ahora" in Ajustes and waits for the round to end. */
async function syncNow(app) {
  await app.go("#/ajustes");
  await app.click('[data-act="syncNow"]');
  await app.wait(400);
}

test("[TC-SYN-07-02] a conflict is shown with both versions; 'Usar la mía' saves mine and discarding mine takes two taps", async (t) => {
  const { server, app } = await connectedApp();
  // The connected page keeps a sync timer running: close it so the test process can end.
  t.after(() => app.window.close());
  const NT = app.window.NT;
  await app.go("#/cliente/nuevo");
  await app.type("#cf-name", "Ana");
  app.window.document
    .querySelector('[data-form="customer"]')
    .dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await app.wait(100);
  const path = Object.keys(app.stored()).find((k) => k.startsWith("customers/"));
  await syncNow(app);
  await otherDeviceRenames(server, app, path, "Ana (otro equipo)");
  // This device edits the version it had, then syncs: the server already moved on.
  await app.go("#/" + path.replace("customers/", "cliente/"));
  app.window.document.querySelector("#cf-name").value = "Ana (este equipo)";
  app.window.document
    .querySelector('[data-form="customer"]')
    .dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await app.wait(100);
  await syncNow(app);
  await app.waitFor(() => /Otra persona cambió lo mismo que tú/.test(app.text()));
  const box = app.window.document.querySelector("#conflicts");
  assert.match(box.textContent, /Cliente «Ana \(otro equipo\)»/);
  assert.match(box.textContent, /Ana \(este equipo\)/, "my version is shown");
  assert.match(app.window.document.getElementById("sync-status").textContent, /por revisar/);
  // Discarding mine takes a second tap.
  await app.click('[data-act="confirm"][data-key^="conflict"]');
  assert.ok(app.window.document.querySelector('[data-act="conflictTheirs"]'), "second tap offered");
  await app.click('[data-act="confirmNo"]');
  await app.click('[data-act="conflictMine"]');
  await app.waitFor(() => !app.window.document.querySelector("#conflicts"));
  await syncNow(app);
  const rows = await server.rows("documents", NT.connection.session().userId);
  assert.equal(rows.find((r) => r.path === path).data.name, "Ana (este equipo)");
});

test("[TC-SYN-07-03] opening an order that someone else changed minutes ago says so", async (t) => {
  const { server, app } = await connectedApp();
  t.after(() => app.window.close());
  await app.go("#/producto/nuevo");
  await app.type("#pf-name", "Palomitas");
  await app.type("#pl-0", "Bolsa");
  await app.type("#pp-0", "25");
  app.submit("product-form");
  await app.waitFor(() => /#\/catalogo/.test(app.window.location.hash));
  await app.go("#/nuevo");
  await app.click('[data-act="draftNext"]');
  await app.click(app.byText('[data-act="openProduct"]', /Palomitas/));
  await app.click('[data-act="saveDraft"]');
  await app.waitFor(() => /#\/pedido\//.test(app.window.location.hash));
  const id = decodeURIComponent(app.window.location.hash.split("/")[2]);
  assert.doesNotMatch(app.text(), /desde otro equipo/, "my own change is not flagged");
  await syncNow(app);
  const userId = app.window.NT.connection.session().userId;
  await server.pg.as(userId, (tx) =>
    tx.query(
      "update public.documents set data = data || jsonb_build_object('updatedBy', 'luis', 'updatedAt', to_char(now() at time zone 'utc' - interval '3 minutes', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'), 'comment', 'sin sal'), client_updated_at = now() where path = $1",
      ["orders/" + id]
    )
  );
  await syncNow(app);
  await app.go("#/pedido/" + encodeURIComponent(id));
  assert.match(app.text(), /luis cambió este pedido hace 3 min desde otro equipo/);
});
