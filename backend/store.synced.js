/*
 * Purpose: The "synced" backend: the local store plus pending changes and a sync with the hosted PostgreSQL.
 * Responsibilities: Build the device store (IndexedDB or localStorage) with a hook that records every change as pending in the same write, attach the sync engine,
 * and expose it to the app as store.sync. The app sees the same store contract as in Lite mode; nothing here touches the DOM.
 */
window.NT = window.NT || {};
NT.backends = NT.backends || {};

NT.backends.synced = function (config) {
  "use strict";
  var engine = null;
  return NT.openDeviceStore(config, {
    afterWrite: function (data, changes) {
      if (engine) engine.recordChanges(data, changes);
    },
  }).then(function (opened) {
    if (!opened || opened.corrupt || opened.failed) return opened;
    engine = NT.sync.create(opened.core, NT.connection.remote(), {
      session: NT.connection.session,
      businessId: function () {
        return NT.connection.settings().businessId;
      },
      windowDays: function () {
        return NT.connection.settings().windowDays;
      },
      today: NT.clock.today,
      pollMs: (NT.config && NT.config.pollMs) || 90000,
      isActive: function () {
        return typeof document === "undefined" || document.visibilityState !== "hidden";
      },
    });
    opened.store.sync = engine.api;
    opened.store.engine = opened.engine;
    engine.schedule(0);
    NT.log.info("store.synced_opened", { engine: opened.engine });
    return opened.store;
  });
};
