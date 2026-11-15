/*
 * Purpose: Keep this device's documents and the business's rows in the hosted PostgreSQL in step, working offline first.
 * Responsibilities: Record every local change as pending in the same write, send pending changes when the server can be reached, pull
 * other devices' changes inside the cache window, drop documents outside the window only once they are safely on the server, detect a
 * database that is not set up yet, and report its state. It never deletes a pending change, never overwrites a pending document with
 * server data, and keeps a copy of the device's data before replacing it (decisions 0002 and 0003).
 */
window.NT = window.NT || {};

NT.sync = (function () {
  "use strict";

  var STATE = "_sync/state";
  var BEFORE_CONNECT = "_sync/before-connect";
  var DEBOUNCE_MS = 1500;
  var RETRY_MIN_MS = 15000;
  var RETRY_MAX_MS = 300000;
  var PAGE = 1000;
  var CHUNK = 100;
  var MISSING = ["PGRST205", "PGRST202", "42P01", "42883"];

  function emptyState() {
    return { outbox: {}, cursor: null, setup: "pending", lastSyncAt: null, lastError: null, windowKey: null };
  }
  function isMissingSchema(e) {
    return (
      !!e &&
      e.code === "http" &&
      (MISSING.indexOf(e.pgCode) >= 0 || (e.status === 404 && /relation|schema cache|function/i.test(String(e.message || ""))))
    );
  }

  /**
   * core: the local core from NT.openLocalStore. remote: an NT.remote client.
   * options: { session(), businessId(), windowDays(), now() -> Date, today() -> "YYYY-MM-DD", setTimeout, clearTimeout }
   */
  function create(core, remote, options) {
    var now =
      options.now ||
      function () {
        return new Date();
      };
    var setTimer = options.setTimeout || setTimeout;
    var clearTimer = options.clearTimeout || clearTimeout;
    var listeners = [];
    var phase = "idle";
    var running = null,
      again = false,
      timer = null,
      retryMs = RETRY_MIN_MS;

    function state() {
      return Object.assign(emptyState(), core.get(STATE) || {});
    }
    function saveState(s, docs) {
      var internal = {};
      internal[STATE] = s;
      core.apply(docs || {}, internal);
    }
    function status() {
      var s = state();
      var entries = Object.keys(s.outbox).map(function (k) {
        return s.outbox[k];
      });
      return {
        state: phase,
        pending: entries.filter(function (e) {
          return !e.failed;
        }).length,
        failed: entries.filter(function (e) {
          return e.failed;
        }).length,
        lastSyncAt: s.lastSyncAt,
        lastError: s.lastError,
      };
    }
    function setPhase(next, error) {
      phase = next;
      if (error !== undefined) {
        var s = state();
        s.lastError = error;
        saveState(s);
      }
      var st = status();
      NT.log.info("sync.status", st);
      listeners.slice().forEach(function (fn) {
        fn(st);
      });
    }

    /** Runs inside every user write (backend/store.local.js afterWrite): marks changed documents as pending. */
    function recordChanges(data, changes) {
      var s = Object.assign(emptyState(), data[STATE] || {});
      var at = now().toISOString();
      var any = false;
      changes.forEach(function (c) {
        if (c.op !== "upsert") return; // removing from this device only (window, cleanup) is not a deletion
        s.outbox[c.path] = { at: at };
        any = true;
      });
      if (!any) return;
      data[STATE] = s;
      schedule(DEBOUNCE_MS);
    }

    function schedule(ms) {
      if (timer) clearTimer(timer);
      timer = setTimer(function () {
        timer = null;
        syncNow();
      }, ms);
    }
    function retryLater() {
      schedule(retryMs);
      retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
    }
    function markAllPending(s) {
      var at = now().toISOString();
      core.paths().forEach(function (path) {
        s.outbox[path] = { at: at };
      });
    }
    function windowFrom() {
      return NT.logic.addDays(options.today(), -Math.max(1, options.windowDays() || 30));
    }

    // ---------- first connection ----------
    function setup(s, bid) {
      return remote.select("documents", [["business_id", "eq", bid]], null, 1).then(function (rows) {
        var serverHasData = rows && rows.length > 0;
        var deviceHasData = core.paths().length > 0;
        if (!serverHasData) {
          markAllPending(s);
          s.setup = "done";
          NT.log.info("sync.setup_upload", { documents: core.paths().length });
        } else if (!deviceHasData) {
          s.setup = "done";
          s.cursor = null;
          NT.log.info("sync.setup_download", {});
        } else {
          NT.log.info("sync.setup_needs_choice", {});
          return false;
        }
        saveState(s);
        return true;
      });
    }

    // ---------- push ----------
    function settle(entries, failedPaths) {
      var after = state();
      entries.forEach(function (pair) {
        var path = pair[0],
          entry = pair[1];
        var current = after.outbox[path];
        // A newer local change made while this one was in flight stays pending.
        if (!current || current.at !== entry.at) return;
        if (failedPaths && failedPaths[path]) after.outbox[path] = Object.assign({}, entry, { failed: true });
        else delete after.outbox[path];
      });
      saveState(after);
    }

    function sendChunk(entries, bid) {
      var rows = [];
      var gone = [];
      entries.forEach(function (pair) {
        var doc = core.get(pair[0]);
        if (!doc) gone.push(pair);
        else rows.push(NT.rows.toRow(pair[0], doc, bid, pair[1].at, core.get));
      });
      if (gone.length) settle(gone);
      var live = entries.filter(function (pair) {
        return gone.indexOf(pair) < 0;
      });
      if (!rows.length) return Promise.resolve(0);
      return remote.upsert("documents", rows, NT.rows.KEY).then(
        function () {
          settle(live);
          return live.length;
        },
        function (e) {
          var refused = e.code === "http" && e.status >= 400 && e.status < 500 && !isMissingSchema(e);
          if (!refused) throw e;
          if (live.length === 1) {
            // The server will never accept this version: keep it, flagged, until the person changes it again.
            var failed = {};
            failed[live[0][0]] = true;
            settle(live, failed);
            NT.log.error("sync.push_rejected", { path: live[0][0], status: e.status });
            return 0;
          }
          // Find the refused ones by sending one at a time.
          var sent = 0,
            chain = Promise.resolve();
          live.forEach(function (pair) {
            chain = chain.then(function () {
              return sendChunk([pair], bid).then(function (n) {
                sent += n;
              });
            });
          });
          return chain.then(function () {
            return sent;
          });
        }
      );
    }

    function push(bid) {
      var s = state();
      var entries = Object.keys(s.outbox)
        .sort()
        .filter(function (p) {
          return !s.outbox[p].failed;
        })
        .map(function (p) {
          return [p, s.outbox[p]];
        });
      var sent = 0,
        chain = Promise.resolve();
      for (var i = 0; i < entries.length; i += CHUNK) {
        (function (chunk) {
          chain = chain.then(function () {
            return sendChunk(chunk, bid).then(function (n) {
              sent += n;
            });
          });
        })(entries.slice(i, i + CHUNK));
      }
      return chain.then(function () {
        NT.log.info("sync.pushed", { sent: sent });
      });
    }

    // ---------- pull ----------
    function pull(bid) {
      var s = state();
      var from = windowFrom();
      var key = String(options.windowDays());
      if (s.windowKey !== key) s.cursor = null; // the window changed: read it again in full
      s.windowKey = key;
      var docs = {},
        counts = { pulled: 0, evicted: 0 };
      var pending = function (path) {
        return !!state().outbox[path];
      };
      var cursor = s.cursor;

      function page(after, strict) {
        var filters = [["business_id", "eq", bid]];
        if (after) filters.push(["server_updated_at", strict ? "gt" : "gte", after]);
        return remote
          .select("documents", filters, "server_updated_at.asc", PAGE, { or: "(doc_date.is.null,doc_date.gte." + from + ")" })
          .then(function (rows) {
            rows = rows || [];
            rows.forEach(function (row) {
              var pair = NT.rows.fromRow(row);
              if (pending(pair[0])) return;
              var local = core.get(pair[0]);
              if (local && NT.rows.isNewer(local.updatedAt, row.client_updated_at)) return;
              docs[pair[0]] = pair[1];
              counts.pulled++;
            });
            rows.forEach(function (r) {
              if (r.server_updated_at && (!cursor || r.server_updated_at > cursor)) cursor = r.server_updated_at;
            });
            if (rows.length === PAGE) return page(cursor, true);
          });
      }

      return page(cursor, false).then(function () {
        var get = function (p) {
          return Object.prototype.hasOwnProperty.call(docs, p) ? docs[p] : core.get(p);
        };
        // Drop what fell out of the window, but only documents that are safely on the server.
        core.paths().forEach(function (p) {
          if (pending(p) || Object.prototype.hasOwnProperty.call(docs, p)) return;
          var d = NT.rows.docDate(p, core.get(p), get);
          if (d && d < from) {
            docs[p] = null;
            counts.evicted++;
          }
        });
        var latest = state();
        latest.cursor = cursor;
        latest.windowKey = s.windowKey;
        latest.lastSyncAt = now().toISOString();
        latest.lastError = null;
        saveState(latest, docs);
        NT.log.info("sync.pulled", counts);
      });
    }

    // ---------- one full sync ----------
    function runOnce() {
      var session = options.session();
      if (!session || !session.userId) {
        setPhase("signed-out");
        return Promise.resolve(status());
      }
      var bid = options.businessId();
      if (!bid) {
        setPhase("needs-business");
        return Promise.resolve(status());
      }
      setPhase("syncing");
      var s = state();
      var ready = s.setup === "done" ? Promise.resolve(true) : setup(s, bid);
      return ready
        .then(function (ok) {
          if (!ok) {
            setPhase("needs-choice");
            return false;
          }
          return push(bid)
            .then(function () {
              return pull(bid);
            })
            .then(function () {
              return true;
            });
        })
        .then(
          function (done) {
            if (done) {
              retryMs = RETRY_MIN_MS;
              setPhase("idle");
            }
            return status();
          },
          function (e) {
            var code = (e && e.code) || "error";
            if (isMissingSchema(e)) {
              setPhase("needs-schema", "schema");
            } else if (code === "offline" || (code === "http" && e.status >= 500)) {
              setPhase("offline", null);
              retryLater();
            } else if (code === "auth") {
              setPhase("signed-out", "auth");
            } else {
              NT.log.error("sync.failed", { error: e });
              setPhase("error", String((e && (e.message || e.code)) || e));
              retryLater();
            }
            return status();
          }
        );
    }

    /** Runs a sync now, or once more after the one already running. Resolves with the status. */
    function syncNow() {
      if (running) {
        again = true;
        return running;
      }
      running = runOnce().then(function (st) {
        running = null;
        if (again) {
          again = false;
          return syncNow();
        }
        return st;
      });
      return running;
    }

    /** First connection with data on both sides: keep the server's ("server") or send this device's too ("device"). */
    function choose(which) {
      var s = state();
      if (which === "server") {
        var copy = {},
          docs = {};
        core.paths().forEach(function (p) {
          copy[p] = core.get(p);
          docs[p] = null;
        });
        var internal = {};
        internal[BEFORE_CONNECT] = { at: now().toISOString(), documents: copy };
        s.outbox = {};
        s.cursor = null;
        s.setup = "done";
        internal[STATE] = s;
        core.apply(docs, internal);
        NT.log.info("sync.chose_server", { keptCopy: Object.keys(copy).length });
      } else {
        markAllPending(s);
        s.setup = "done";
        saveState(s);
        NT.log.info("sync.chose_device", {});
      }
      return syncNow();
    }

    /**
     * Orders, notes and payments of a period read from the server without storing them, for full-history reports.
     * Resolves with { orders: { id: doc }, notes: [doc], payments: [doc] }.
     */
    function fetchRange(from, to) {
      var bid = options.businessId();
      var out = { orders: {}, notes: [], payments: [] };
      function page(after) {
        var filters = [
          ["business_id", "eq", bid],
          ["collection", "in", ["orders", "notes", "payments"]],
          ["doc_date", "gte", NT.logic.addDays(from, -60)],
          ["doc_date", "lte", NT.logic.addDays(to, 60)],
          ["deleted_at", "is", null],
        ];
        if (after) filters.push(["server_updated_at", "gt", after]);
        return remote.select("documents", filters, "server_updated_at.asc", PAGE).then(function (rows) {
          rows = rows || [];
          rows.forEach(function (r) {
            var pair = NT.rows.fromRow(r);
            var id = pair[0].split("/")[1];
            if (r.collection === "orders") out.orders[id] = pair[1];
            else out[r.collection].push(Object.assign({ id: id }, pair[1]));
          });
          if (rows.length === PAGE) return page(rows[rows.length - 1].server_updated_at);
        });
      }
      return page(null).then(function () {
        return out;
      });
    }

    return {
      recordChanges: recordChanges,
      schedule: schedule,
      api: {
        syncNow: syncNow,
        choose: choose,
        status: status,
        fetchRange: fetchRange,
        onStatus: function (fn) {
          listeners.push(fn);
        },
        failedPaths: function () {
          var s = state();
          return Object.keys(s.outbox).filter(function (p) {
            return s.outbox[p].failed;
          });
        },
      },
    };
  }

  return { create: create, STATE: STATE, BEFORE_CONNECT: BEFORE_CONNECT, isMissingSchema: isMissingSchema };
})();
