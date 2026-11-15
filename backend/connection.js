/*
 * Purpose: Remember on this device how the app stores data (Lite or Connected), the connection to the hosted database and the business it belongs to.
 * Responsibilities: Keep the mode, server address, public key, session, business and cache window in the per-device preferences; sign up,
 * sign in and out through NT.remote; check whether the database is set up; and create or join a business. It never stores the password.
 */
window.NT = window.NT || {};

NT.connection = (function () {
  "use strict";

  function readJSON(name) {
    var raw = NT.prefs.get(name);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // catch-ok: an unreadable preference behaves as if it were never saved.
      return null;
    }
  }

  /** { mode, url, anonKey, windowDays, businessId, businessName, joinCode, role } */
  function settings() {
    var saved = readJSON("connection") || {};
    return {
      mode: saved.mode === "connected" ? "connected" : "lite",
      url: saved.url || "",
      anonKey: saved.anonKey || "",
      windowDays: saved.windowDays > 0 ? saved.windowDays : (NT.config && NT.config.windowDays) || 30,
      businessId: saved.businessId || null,
      businessName: saved.businessName || "",
      joinCode: saved.joinCode || "",
      role: saved.role || "",
    };
  }
  function saveSettings(changes) {
    var next = Object.assign(settings(), changes || {});
    NT.prefs.set("connection", JSON.stringify(next));
    NT.log.info("connection.settings_saved", { mode: next.mode, windowDays: next.windowDays, hasBusiness: !!next.businessId });
    return next;
  }
  function session() {
    return readJSON("session");
  }
  function setSession(s) {
    NT.prefs.set("session", s ? JSON.stringify(s) : "");
  }

  function remote(overrides) {
    var s = Object.assign(settings(), overrides || {});
    return NT.remote.create({ url: s.url, anonKey: s.anonKey, getSession: session, setSession: setSession });
  }

  /** Resolves "ok" when the tables exist, "missing" when the SQL has not been run yet. Rejects on other failures. */
  function checkSchema(client) {
    client = client || remote();
    return client.select("documents", [], null, 1).then(
      function () {
        return "ok";
      },
      function (e) {
        if (NT.sync.isMissingSchema(e)) return "missing";
        throw e;
      }
    );
  }

  function remember(rows) {
    var m = rows && rows[0];
    if (!m) return null;
    saveSettings({ businessId: m.business_id, businessName: m.business_name, joinCode: m.join_code, role: m.role });
    return m;
  }

  /**
   * Signs in (or creates the account when signUp is true) and saves the server details. Does not switch to Connected yet:
   * the app does that once the database and the business are ready. Resolves with { session } or { confirmEmail: true }.
   */
  function signIn(url, anonKey, email, password, signUp) {
    var client = remote({ url: url, anonKey: anonKey });
    var step = signUp ? client.signUp(email, password) : client.signIn(email, password);
    return step.then(function (s) {
      saveSettings({ url: url, anonKey: anonKey });
      return s ? { session: s } : { confirmEmail: true };
    });
  }

  /** The caller's business from the server (null when none yet). */
  function membership() {
    return remote().rpc("notas_membership", {}).then(remember);
  }
  function bootstrap(name) {
    return remote().rpc("notas_bootstrap", { p_name: name }).then(remember);
  }
  function join(code) {
    return remote().rpc("notas_join", { p_code: code }).then(remember);
  }

  function setConnected() {
    return saveSettings({ mode: "connected" });
  }

  /** Back to Lite. The data stays on this device; the session is closed. */
  function disconnect() {
    var client = remote();
    saveSettings({ mode: "lite" });
    return client.signOut();
  }

  return {
    settings: settings,
    saveSettings: saveSettings,
    session: session,
    remote: remote,
    checkSchema: checkSchema,
    signIn: signIn,
    membership: membership,
    bootstrap: bootstrap,
    join: join,
    setConnected: setConnected,
    disconnect: disconnect,
    isConnected: function () {
      var s = settings();
      return s.mode === "connected" && !!s.url;
    },
  };
})();
