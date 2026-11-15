/*
 * Purpose: Talk to the hosted PostgreSQL over HTTP, the way Supabase exposes it (Auth plus PostgREST).
 * Responsibilities: Sign up, sign in, refresh and sign out a session, call database functions, and read, upsert and patch table rows as the signed-in user, refreshing an expired session once. It reports failures as { code: "offline" | "auth" | "http" } and never logs or returns secrets. It must not touch the DOM or local storage: the session is handed in and out through callbacks.
 */
window.NT = window.NT || {};

NT.remote = (function () {
  "use strict";

  function failure(code, extra) {
    return Object.assign({ code: code }, extra || {});
  }
  function trimUrl(url) {
    return String(url || "").replace(/\/+$/, "");
  }
  /** PostgREST filter value: in.(a,b) needs each value quoted when it holds special characters. */
  function listValue(values) {
    return (
      "(" +
      values
        .map(function (v) {
          return /[,()".\s]/.test(String(v)) ? '"' + String(v).replace(/"/g, '\\"') + '"' : String(v);
        })
        .join(",") +
      ")"
    );
  }
  /** Turns [["column", "op", value], ...] into a query string. */
  function query(filters, extra) {
    var parts = (filters || []).map(function (f) {
      var value = f[1] === "in" || f[1] === "not.in" ? listValue(f[2]) : f[2] === null ? "null" : String(f[2]);
      return encodeURIComponent(f[0]) + "=" + f[1] + "." + encodeURIComponent(value);
    });
    Object.keys(extra || {}).forEach(function (k) {
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(extra[k]));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  /**
   * options: { url, anonKey, getSession(), setSession(session | null) }.
   * A session is { accessToken, refreshToken, expiresAt, userId, email }.
   */
  function create(options) {
    var base = trimUrl(options.url);

    function send(method, path, body, headers) {
      var init = { method: method, headers: Object.assign({ apikey: options.anonKey, "Content-Type": "application/json" }, headers || {}) };
      if (body !== undefined) init.body = JSON.stringify(body);
      NT.log.debug("remote.request", { method: method, path: path.split("?")[0] });
      return fetch(base + path, init).then(
        function (response) {
          return response.text().then(function (text) {
            var parsed = null;
            try {
              parsed = text ? JSON.parse(text) : null;
            } catch {
              // catch-ok: a non-JSON body (an HTML error page) is reported by status below.
            }
            if (response.ok) return parsed;
            var expired = response.status === 401 || (parsed && /jwt/i.test(String(parsed.message || parsed.msg || "")));
            NT.log.warn("remote.http_error", { method: method, path: path.split("?")[0], status: response.status });
            throw failure(expired ? "auth" : "http", {
              status: response.status,
              pgCode: parsed && parsed.code,
              message: parsed && (parsed.message || parsed.msg || parsed.error_description),
            });
          });
        },
        function (e) {
          NT.log.warn("remote.offline", { method: method, path: path.split("?")[0], error: e });
          throw failure("offline");
        }
      );
    }

    function toSession(body) {
      return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: body.expires_at || Math.floor(Date.now() / 1000) + (body.expires_in || 3600),
        userId: body.user && body.user.id,
        email: body.user && body.user.email,
      };
    }

    function signIn(email, password) {
      return send("POST", "/auth/v1/token?grant_type=password", { email: email, password: password }).then(function (body) {
        var session = toSession(body);
        options.setSession(session);
        NT.log.info("remote.signed_in", { userId: session.userId });
        return session;
      });
    }

    var refreshing = null;
    function refresh() {
      var current = options.getSession();
      if (!current || !current.refreshToken) return Promise.reject(failure("auth"));
      if (!refreshing) {
        refreshing = send("POST", "/auth/v1/token?grant_type=refresh_token", { refresh_token: current.refreshToken })
          .then(function (body) {
            var session = toSession(body);
            options.setSession(session);
            NT.log.info("remote.refreshed", {});
            return session;
          })
          .catch(function (e) {
            if (e.code === "offline") throw e;
            // A refused refresh means the session is over, whatever the status: sign out, never retry the data.
            options.setSession(null);
            NT.log.warn("remote.refresh_refused", { status: e.status });
            throw failure("auth", { status: e.status });
          })
          .finally(function () {
            refreshing = null;
          });
      }
      return refreshing;
    }

    /** Sends an authorised request; on an expired session refreshes once and retries. */
    function authorised(method, path, body, headers) {
      var session = options.getSession();
      if (!session) return Promise.reject(failure("auth"));
      var soon = session.expiresAt && session.expiresAt - 60 < Date.now() / 1000;
      var ready = soon ? refresh() : Promise.resolve(session);
      return ready.then(function (s) {
        var withAuth = Object.assign({ Authorization: "Bearer " + s.accessToken }, headers || {});
        return send(method, path, body, withAuth).catch(function (e) {
          if (e.code !== "auth") throw e;
          return refresh().then(function (fresh) {
            return send(method, path, body, Object.assign({}, withAuth, { Authorization: "Bearer " + fresh.accessToken }));
          });
        });
      });
    }

    /** Creates an account. Resolves with the session, or with null when the project asks to confirm the email first. */
    function signUp(email, password) {
      return send("POST", "/auth/v1/signup", { email: email, password: password }).then(function (body) {
        if (!body || !body.access_token) {
          NT.log.info("remote.signed_up_confirm", {});
          return null;
        }
        var session = toSession(body);
        options.setSession(session);
        NT.log.info("remote.signed_up", { userId: session.userId });
        return session;
      });
    }

    function signOut() {
      var session = options.getSession();
      options.setSession(null);
      if (!session) return Promise.resolve();
      return send("POST", "/auth/v1/logout", {}, { Authorization: "Bearer " + session.accessToken }).catch(function () {
        // catch-ok: the local session is already gone; a failed server logout only leaves a token that expires.
      });
    }

    return {
      signIn: signIn,
      signUp: signUp,
      signOut: signOut,
      refresh: refresh,
      /** filters: [["column", "eq" | "gte" | "lte" | "gt" | "is" | "in" | "not.in", value]] */
      select: function (table, filters, order, limit, raw) {
        var extra = Object.assign({ select: "*" }, raw || {});
        if (order) extra.order = order;
        if (limit) extra.limit = String(limit);
        return authorised("GET", "/rest/v1/" + table + query(filters, extra));
      },
      upsert: function (table, rows, conflictColumns) {
        if (!rows.length) return Promise.resolve(null);
        return authorised("POST", "/rest/v1/" + table + query([], { on_conflict: conflictColumns.join(",") }), rows, {
          Prefer: "resolution=merge-duplicates,return=minimal",
        });
      },
      /** Calls a database function (POST /rest/v1/rpc/name) with named arguments. */
      rpc: function (name, args) {
        return authorised("POST", "/rest/v1/rpc/" + name, args || {});
      },
      patch: function (table, filters, values) {
        return authorised("PATCH", "/rest/v1/" + table + query(filters), values, { Prefer: "return=minimal" });
      },
    };
  }

  return { create: create };
})();
