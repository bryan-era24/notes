/*
 * Purpose: A stand-in for a Supabase project (Auth plus PostgREST) backed by a real in-memory PostgreSQL, so sync tests run offline against the real schema.
 * Responsibilities: Answer the HTTP calls backend/remote.js makes (sign-up, sign-in, refresh, logout, GET/POST/PATCH on the tables, and rpc calls) by running SQL as the signed-in user, so row-level security and the last-write-wins trigger really apply. Tests can take it offline, expire tokens, pretend the schema was never run and read every request. It only answers its own base URL.
 */
"use strict";
const { openDatabase } = require("./postgres");

const BASE = "https://notas-test.supabase.local";
const ANON_KEY = "test-anon-key";
const TABLES = new Set(["documents", "businesses", "members"]);
const FUNCTIONS = new Set(["notas_bootstrap", "notas_join", "notas_membership"]);
const COLUMN = /^[a-z_]+$/;
const OPS = { eq: "=", gt: ">", gte: ">=", lt: "<", lte: "<=" };

function respond(status, body) {
  const text = body === undefined ? "" : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}
/** Values the way PostgREST sends them: numbers for numeric, YYYY-MM-DD for date, ISO for timestamps. */
function serialise(result) {
  const types = Object.fromEntries(result.fields.map((f) => [f.name, f.dataTypeID]));
  return result.rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === null) out[k] = null;
      else if (types[k] === 1700) out[k] = Number(v);
      else if (types[k] === 1082) out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
      else if (types[k] === 1184) out[k] = new Date(v).toISOString();
      else out[k] = v;
    }
    return out;
  });
}
/** "(a,b,"c d")" -> ["a", "b", "c d"] */
function parseList(text) {
  const inner = text.replace(/^\(|\)$/g, "");
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|([^,]+)/g;
  let m;
  while ((m = re.exec(inner))) out.push(m[1] !== undefined ? m[1].replace(/\\"/g, '"') : m[2]);
  return out;
}

async function createFakeSupabase() {
  const pg = await openDatabase();
  const users = new Map(); // email -> { id, password }
  const tokens = new Map(); // access token -> user id
  const refreshTokens = new Map(); // refresh token -> user id
  let counter = 0;
  const server = { base: BASE, anonKey: ANON_KEY, offline: false, requests: [], pg };

  server.addUser = (email, password, id) => users.set(email, { id, password });
  server.expireTokens = () => tokens.clear();

  function issue(userId, email) {
    counter += 1;
    const access = `access-${counter}`;
    const refresh = `refresh-${counter}`;
    tokens.set(access, userId);
    refreshTokens.set(refresh, userId);
    return {
      access_token: access,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: refresh,
      user: { id: userId, email },
    };
  }

  function where(params, values) {
    const clauses = [];
    for (const [key, raw] of params) {
      if (["select", "order", "limit", "on_conflict"].includes(key)) continue;
      if (key === "or") {
        const parts = raw
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map((p) => {
            const [col, op, ...rest] = p.split(".");
            const value = rest.join(".");
            if (!COLUMN.test(col)) throw new Error("bad column " + col);
            if (op === "is") return `${col} is ${value === "null" ? "null" : "not null"}`;
            if (!OPS[op]) throw new Error("unsupported operator " + op);
            values.push(value);
            return `${col} ${OPS[op]} $${values.length}`;
          });
        clauses.push("(" + parts.join(" or ") + ")");
        continue;
      }
      if (!COLUMN.test(key)) throw new Error("bad column " + key);
      const dot = raw.indexOf(".");
      let op = raw.slice(0, dot);
      let value = raw.slice(dot + 1);
      if (op === "not") {
        const rest = value;
        op = "not." + rest.slice(0, rest.indexOf("."));
        value = rest.slice(rest.indexOf(".") + 1);
      }
      if (op === "is") clauses.push(`${key} is ${value === "null" ? "null" : "not null"}`);
      else if (op === "in" || op === "not.in") {
        const list = parseList(value);
        const marks = list.map((v) => (values.push(v), "$" + values.length));
        clauses.push(`${key} ${op === "in" ? "in" : "not in"} (${marks.join(",")})`);
      } else if (OPS[op]) {
        values.push(value);
        clauses.push(`${key} ${OPS[op]} $${values.length}`);
      } else throw new Error("unsupported operator " + op);
    }
    return clauses.length ? " where " + clauses.join(" and ") : "";
  }

  async function rest(method, table, params, body, userId, prefer) {
    if (server.schemaMissing || !TABLES.has(table))
      return respond(404, { code: "PGRST205", message: "Could not find the table 'public." + table + "' in the schema cache" });
    const values = [];
    if (method === "GET") {
      let sql = `select * from public.${table}` + where(params, values);
      const order = params.find(([k]) => k === "order");
      if (order) {
        const [col, dir] = order[1].split(".");
        if (!COLUMN.test(col)) throw new Error("bad order");
        sql += ` order by ${col} ${dir === "desc" ? "desc" : "asc"}`;
      }
      const limit = params.find(([k]) => k === "limit");
      if (limit) sql += ` limit ${Number(limit[1])}`;
      const result = await pg.as(userId, (tx) => tx.query(sql, values));
      return respond(200, serialise(result));
    }
    if (method === "POST") {
      const rows = Array.isArray(body) ? body : [body];
      const conflict = (params.find(([k]) => k === "on_conflict") || [null, ""])[1].split(",").filter(Boolean);
      const columns = Object.keys(rows[0]);
      columns.concat(conflict).forEach((c) => {
        if (!COLUMN.test(c)) throw new Error("bad column " + c);
      });
      const tuples = rows.map(
        (r) =>
          "(" +
          columns
            .map((c) => (values.push(r[c] !== null && typeof r[c] === "object" ? JSON.stringify(r[c]) : r[c]), "$" + values.length))
            .join(",") +
          ")"
      );
      let sql = `insert into public.${table} (${columns.join(",")}) values ${tuples.join(",")}`;
      if (conflict.length && /merge-duplicates/.test(prefer || "")) {
        const updates = columns.filter((c) => !conflict.includes(c)).map((c) => `${c} = excluded.${c}`);
        sql += ` on conflict (${conflict.join(",")}) do update set ${updates.join(", ")}`;
      }
      await pg.as(userId, (tx) => tx.query(sql, values));
      return respond(201);
    }
    if (method === "PATCH") {
      const sets = Object.keys(body).map((c) => {
        if (!COLUMN.test(c)) throw new Error("bad column " + c);
        values.push(body[c]);
        return `${c} = $${values.length}`;
      });
      await pg.as(userId, (tx) => tx.query(`update public.${table} set ${sets.join(", ")}` + where(params, values), values));
      return respond(204);
    }
    return respond(405, { message: "method not allowed" });
  }

  /** A fetch that answers only this server's URLs. */
  server.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method || "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init.body ? JSON.parse(init.body) : undefined;
    server.requests.push({ method, path: url.pathname, search: url.search, headers, body });
    if (server.offline) throw new TypeError("Failed to fetch");
    if (headers.apikey !== ANON_KEY) return respond(401, { message: "Invalid API key" });

    if (url.pathname === "/auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const user = users.get(body.email);
        if (!user || user.password !== body.password)
          return respond(400, { error: "invalid_grant", error_description: "Invalid login credentials" });
        return respond(200, issue(user.id, body.email));
      }
      if (grant === "refresh_token") {
        const userId = refreshTokens.get(body.refresh_token);
        if (!userId) return respond(400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
        refreshTokens.delete(body.refresh_token);
        const email = [...users.entries()].find(([, u]) => u.id === userId)[0];
        return respond(200, issue(userId, email));
      }
      return respond(400, { error: "unsupported_grant_type" });
    }
    if (url.pathname === "/auth/v1/logout") return respond(204);
    if (url.pathname === "/auth/v1/signup") {
      if (users.has(body.email)) return respond(422, { msg: "User already registered" });
      const id = "00000000-0000-4000-8000-" + String(users.size + 1).padStart(12, "0");
      users.set(body.email, { id, password: body.password });
      return respond(200, server.confirmEmail ? { id, email: body.email } : issue(id, body.email));
    }

    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    const match = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!match && !rpc) return respond(404, { message: "not found" });
    const token = String(headers.authorization || "").replace(/^Bearer /, "");
    const userId = tokens.get(token);
    if (!userId) return respond(401, { code: "PGRST301", message: "JWT expired" });
    if (rpc) {
      if (server.schemaMissing || !FUNCTIONS.has(rpc[1])) return respond(404, { code: "PGRST202", message: "Could not find the function" });
      const names = Object.keys(body || {});
      names.forEach((n) => {
        if (!COLUMN.test(n)) throw new Error("bad argument " + n);
      });
      const args = names.map((n, i) => `${n} => $${i + 1}`).join(", ");
      try {
        const result = await pg.as(userId, (tx) =>
          tx.query(
            `select * from public.${rpc[1]}(${args})`,
            names.map((n) => body[n])
          )
        );
        return respond(200, serialise(result));
      } catch (e) {
        return respond(400, { code: "P0001", message: e.message });
      }
    }
    try {
      return await rest(method, match[1], [...url.searchParams.entries()], body, userId, headers.prefer);
    } catch (e) {
      const status = /row-level security|permission denied/.test(e.message) ? 403 : 400;
      return respond(status, { message: e.message });
    }
  };

  /** Reads the database as `userId` for assertions. */
  server.rows = async (table, userId) => {
    const result = await pg.as(userId, (tx) => tx.query(`select * from public.${table} order by 1, 2`));
    return serialise(result);
  };
  return server;
}

module.exports = { createFakeSupabase, BASE, ANON_KEY };
