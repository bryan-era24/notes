/*
 * Purpose: The "synced" backend: the local store plus pending changes and a sync with the hosted PostgreSQL.
 * Responsibilities: Build the local store with a hook that records every change as pending in the same write, attach the sync engine,
 * and expose it to the app as store.sync. The app sees the same store contract as in Lite mode; nothing here touches the DOM.
 */
window.NT = window.NT || {};
NT.backends = NT.backends || {};

NT.backends.synced = function (config) {
  "use strict";
  var engine = null;
  var opened = NT.openLocalStore(config, {
    afterWrite: function (data, changes) {
      if (engine) engine.recordChanges(data, changes);
    },
  });
  if (!opened || opened.corrupt) return opened;
  engine = NT.sync.create(opened.core, NT.connection.remote(), {
    session: NT.connection.session,
    businessId: function () {
      return NT.connection.settings().businessId;
    },
    windowDays: function () {
      return NT.connection.settings().windowDays;
    },
    today: NT.clock.today,
  });
  opened.store.sync = engine.api;
  engine.schedule(0);
  NT.log.info("store.synced_opened", {});
  return opened.store;
};
