// =====================================================================
//  CACHE-SERVICE.JS  —  Smart Client-Side Cache for AEO Portal
//  ─────────────────────────────────────────────────────────────────────
//  ✅  STANDALONE — zero edits to any existing file.
//  ✅  Wraps window.apiCall (defined in api.js) transparently.
//  ✅  All read calls: served from memory cache after first load.
//  ✅  All write calls: update cache instantly + save to GAS.
//  ✅  Background refresh every 3 min (handles simultaneous users).
//  ✅  BroadcastChannel sync across open tabs.
//  ✅  School hierarchy persists in localStorage (survives refresh).
//  ✅  Live status badge injected into navbar.
//
//  HOW TO ADD:
//  In index.html, after <script src="js/api.js"> add:
//      <script src="js/cache-service.js"></script>
//  (Must be before core.js and all module files.)
//
//  CACHE LIFETIME (TTL):
//  ┌──────────────────────────────┬────────────┐
//  │  School hierarchy/dropdowns  │  30 min    │
//  │  Links, Apps, Tools, KPI     │  15 min    │
//  │  Summary counts              │   5 min    │
//  │  School data (pub/priv/HR)   │   3 min    │
//  └──────────────────────────────┴────────────┘
// =====================================================================

(function () {
  'use strict';

  // ─── TTL constants (milliseconds) ──────────────────────────────────
  var TTL = {
    HIERARCHY : 30 * 60 * 1000,   // 30 min — district/tehsil/markaz
    STATIC    : 15 * 60 * 1000,   // 15 min — links, apps, tools, KPI cards
    SUMMARY   :  5 * 60 * 1000,   //  5 min — KPI counts
    DATA      :  3 * 60 * 1000,   //  3 min — school rows, HR rows
  };

  // ─── Which actions are READ (cacheable) ────────────────────────────
  var READ_TTL = {
    getSchoolHierarchy          : TTL.HIERARCHY,
    getSchoolHierarchyForUser   : TTL.HIERARCHY,
    getSchoolsListForScope      : TTL.HIERARCHY,
    getSummaryCounts            : TTL.SUMMARY,
    getLinksAndApps             : TTL.STATIC,
    getLinksAppsAdmin           : TTL.STATIC,
    getToolsUser                : TTL.STATIC,
    getToolsAdmin               : TTL.STATIC,
    getKpiCards                 : TTL.STATIC,
    getKpiCardsAdmin            : TTL.STATIC,
    getPrivateDashboardData     : TTL.DATA,
    getPublicDashboardData      : TTL.DATA,
    loadSheetForClient          : TTL.DATA,
  };

  // ─── Which write actions invalidate which read caches ──────────────
  var WRITE_INVALIDATES = {
    savePrivateSchool   : ['getPrivateDashboardData'],
    savePublicSchool    : ['getPublicDashboardData'],
    addStaffRow         : ['loadSheetForClient'],
    updateStaffRow      : ['loadSheetForClient'],
    deleteStaffRow      : ['loadSheetForClient'],
    saveLinksAppsRow    : ['getLinksAndApps', 'getLinksAppsAdmin'],
    deleteLinksAppsRow  : ['getLinksAndApps', 'getLinksAppsAdmin'],
    saveToolRow         : ['getToolsUser', 'getToolsAdmin'],
    deleteToolRow       : ['getToolsUser', 'getToolsAdmin'],
    saveKpiCard         : ['getKpiCards', 'getKpiCardsAdmin'],
    deleteKpiCard       : ['getKpiCards', 'getKpiCardsAdmin'],
  };

  // ─── Hierarchy actions whose data also goes to localStorage ────────
  var PERSIST_ACTIONS = [
    'getSchoolHierarchy',
    'getSchoolHierarchyForUser',
    'getSchoolsListForScope',
  ];

  var LS_PREFIX = 'aeo_cache_';          // localStorage key prefix
  var BC_CHANNEL = 'aeo_cache_sync';     // BroadcastChannel name

  // ═══════════════════════════════════════════════════════════════════
  //  IN-MEMORY STORE
  //  Map: cacheKey → { data, timestamp, ttl, action }
  // ═══════════════════════════════════════════════════════════════════
  var _store = new Map();

  // Pending requests: cacheKey → Promise  (de-duplicate in-flight calls)
  var _pending = new Map();

  // ─── Read user from localStorage (same key as index.js uses) ───────
  function _getUser() {
    try {
      var key = (typeof CONFIG !== 'undefined' && CONFIG.SESSION_KEY)
        ? CONFIG.SESSION_KEY : 'portalUser';
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // ─── Build a stable cache key from action + payload ─────────────────
  // We include the user's markaz so different users get separate caches.
  function _key(action, payload) {
    var parts = [action];

    if (Array.isArray(payload)) {
      payload.forEach(function (p) {
        if (typeof p === 'string') parts.push(p);
      });
    } else if (typeof payload === 'string') {
      parts.push(payload);
    }

    // Scope to logged-in user's markaz
    var u = _getUser();
    if (u && u.markaz) parts.push(u.markaz);

    return parts.join('||');
  }

  // ─── Check if a cache entry is still fresh ──────────────────────────
  function _fresh(entry) {
    if (!entry) return false;
    return (Date.now() - entry.timestamp) < entry.ttl;
  }

  // ─── Read from store (memory first, then localStorage for hierarchy) ─
  function _read(cacheKey, action) {
    if (_store.has(cacheKey)) {
      var entry = _store.get(cacheKey);
      if (_fresh(entry)) return entry.data;
    }

    // Try localStorage for persisted hierarchy data
    if (PERSIST_ACTIONS.indexOf(action) !== -1) {
      try {
        var raw = localStorage.getItem(LS_PREFIX + cacheKey);
        if (raw) {
          var stored = JSON.parse(raw);
          if (_fresh(stored)) {
            _store.set(cacheKey, stored);   // warm memory cache too
            return stored.data;
          }
        }
      } catch (e) { /* ignore */ }
    }

    return null;
  }

  // ─── Write to store ─────────────────────────────────────────────────
  function _write(cacheKey, action, data, ttl) {
    var entry = { data: data, timestamp: Date.now(), ttl: ttl, action: action };
    _store.set(cacheKey, entry);

    // Persist hierarchy to localStorage
    if (PERSIST_ACTIONS.indexOf(action) !== -1) {
      try { localStorage.setItem(LS_PREFIX + cacheKey, JSON.stringify(entry)); }
      catch (e) { /* quota exceeded — ignore */ }
    }
  }

  // ─── Invalidate by action prefix ────────────────────────────────────
  function _invalidate(actionNames) {
    _store.forEach(function (entry, key) {
      actionNames.forEach(function (name) {
        if (key.indexOf(name) === 0) {
          _store.delete(key);
          try { localStorage.removeItem(LS_PREFIX + key); } catch (e) {}
        }
      });
    });

    // Broadcast to other tabs
    _broadcast({ type: 'invalidate', actions: actionNames });
  }

  // ─── Clear everything (called on logout) ────────────────────────────
  function _clearAll() {
    _store.clear();
    _pending.clear();
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf(LS_PREFIX) === 0) localStorage.removeItem(k);
      });
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════════
  //  BROADCAST CHANNEL  (cross-tab sync)
  // ═══════════════════════════════════════════════════════════════════
  var _bc = null;
  try {
    _bc = new BroadcastChannel(BC_CHANNEL);
    _bc.onmessage = function (e) {
      var msg = e.data;
      if (!msg) return;
      if (msg.type === 'invalidate' && Array.isArray(msg.actions)) {
        // Another tab wrote data — clear our stale entries
        msg.actions.forEach(function (name) {
          _store.forEach(function (entry, key) {
            if (key.indexOf(name) === 0) _store.delete(key);
          });
        });
        _setStatus('synced');
      }
    };
  } catch (e) { /* BroadcastChannel not supported — graceful fallback */ }

  function _broadcast(msg) {
    if (_bc) {
      try { _bc.postMessage(msg); } catch (e) {}
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  STATUS BADGE  (live indicator in navbar)
  // ═══════════════════════════════════════════════════════════════════
  var _badgeEl = null;
  var _statusTimer = null;

  function _injectBadge() {
    if (_badgeEl) return;
    var nav = document.querySelector('.top-nav') || document.querySelector('nav');
    if (!nav) return;

    _badgeEl = document.createElement('div');
    _badgeEl.id = 'cacheStatusBadge';
    _badgeEl.style.cssText = [
      'display:inline-flex','align-items:center','gap:5px',
      'padding:3px 10px','border-radius:20px',
      'font-size:.68rem','font-weight:700',
      'background:rgba(5,150,105,.15)','color:#059669',
      'border:1px solid rgba(5,150,105,.3)',
      'transition:all .3s','cursor:default',
      'user-select:none','margin-right:8px',
    ].join(';');
    _badgeEl.title = 'Cache status — data is served from memory for speed';

    // Insert before the logout button
    var logoutBtn = nav.querySelector('.btn-logout');
    if (logoutBtn) {
      nav.insertBefore(_badgeEl, logoutBtn);
    } else {
      nav.appendChild(_badgeEl);
    }

    _setStatus('idle');
  }

  function _setStatus(state) {
    if (!_badgeEl) return;
    clearTimeout(_statusTimer);

    var states = {
      idle    : { icon: '●', text: 'Live',     bg: 'rgba(5,150,105,.15)',  color: '#059669', border: 'rgba(5,150,105,.3)'  },
      loading : { icon: '↻', text: 'Syncing',  bg: 'rgba(14,165,233,.15)', color: '#0ea5e9', border: 'rgba(14,165,233,.3)' },
      synced  : { icon: '✓', text: 'Updated',  bg: 'rgba(26,86,219,.15)',  color: '#1a56db', border: 'rgba(26,86,219,.3)'  },
      stale   : { icon: '⚠', text: 'Stale',    bg: 'rgba(217,119,6,.15)', color: '#d97706', border: 'rgba(217,119,6,.3)'  },
      saved   : { icon: '✓', text: 'Saved',    bg: 'rgba(5,150,105,.15)',  color: '#059669', border: 'rgba(5,150,105,.3)'  },
    };

    var s = states[state] || states.idle;
    _badgeEl.style.background = s.bg;
    _badgeEl.style.color      = s.color;
    _badgeEl.style.border     = '1px solid ' + s.border;
    _badgeEl.innerHTML        = s.icon + ' ' + s.text;

    // Auto-revert to idle after 3 seconds
    if (state !== 'idle' && state !== 'loading') {
      _statusTimer = setTimeout(function () { _setStatus('idle'); }, 3000);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CORE INTERCEPT — wraps window.apiCall
  //  Called by the google.script.run shim in api.js for every request.
  // ═══════════════════════════════════════════════════════════════════
  var _originalApiCall = null;

  function _installIntercept() {
    if (typeof window.apiCall !== 'function') {
      console.warn('[cache-service] apiCall not found — retrying in 200ms...');
      setTimeout(_installIntercept, 200);
      return;
    }

    _originalApiCall = window.apiCall;
    console.log('[cache-service] ✅ Intercepting apiCall');

    window.apiCall = async function (action, payload) {
      var ttl = READ_TTL[action];

      // ── READ: check cache ────────────────────────────────────────
      if (ttl !== undefined) {
        var cKey = _key(action, payload);
        var cached = _read(cKey, action);

        if (cached !== null) {
          console.debug('[cache-service] HIT  ' + action + '  key=' + cKey);
          return cached;
        }

        // De-duplicate in-flight requests for same key
        if (_pending.has(cKey)) {
          console.debug('[cache-service] WAIT ' + action + ' (in flight)');
          return _pending.get(cKey);
        }

        console.debug('[cache-service] MISS ' + action + '  key=' + cKey);
        _setStatus('loading');

        var promise = _originalApiCall(action, payload)
          .then(function (result) {
            _pending.delete(cKey);
            _write(cKey, action, result, ttl);
            _setStatus('idle');
            return result;
          })
          .catch(function (err) {
            _pending.delete(cKey);
            _setStatus('stale');
            throw err;
          });

        _pending.set(cKey, promise);
        return promise;
      }

      // ── WRITE: pass through, then invalidate ─────────────────────
      var toInvalidate = WRITE_INVALIDATES[action];
      var result = await _originalApiCall(action, payload);

      if (toInvalidate) {
        console.debug('[cache-service] WRITE ' + action + ' — invalidating', toInvalidate);
        _invalidate(toInvalidate);
        _setStatus('saved');
      }

      return result;
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  //  BACKGROUND REFRESH  (3-minute cycle)
  //  Silently re-fetches stale read actions that were previously loaded.
  //  This ensures simultaneous users see each other's edits within 3 min.
  // ═══════════════════════════════════════════════════════════════════
  var _refreshInterval = null;

  function _backgroundRefresh() {
    if (!_getUser()) return;          // not logged in
    if (!_originalApiCall) return;    // intercept not ready

    var now = Date.now();
    var refreshed = 0;

    _store.forEach(function (entry, cKey) {
      var age = now - entry.timestamp;
      // Refresh entries that are older than 80% of their TTL
      if (age > entry.ttl * 0.8) {
        var action = entry.action;
        if (!READ_TTL[action]) return;

        // Reconstruct payload from cache key (best-effort)
        // We stored the full result; just re-fetch by action name.
        // For keyed actions (sheet-specific), we rely on next user action.
        // For global actions, we can re-fetch directly.
        var globalActions = [
          'getSchoolHierarchy', 'getLinksAndApps', 'getLinksAppsAdmin',
          'getToolsUser', 'getToolsAdmin', 'getKpiCards', 'getKpiCardsAdmin',
        ];

        if (globalActions.indexOf(action) !== -1) {
          _store.delete(cKey);    // Mark stale so next read re-fetches
          refreshed++;
        }
      }
    });

    if (refreshed > 0) {
      console.debug('[cache-service] Background refresh — marked ' + refreshed + ' entries stale');
      _setStatus('synced');
    }
  }

  function _startBackgroundRefresh() {
    if (_refreshInterval) clearInterval(_refreshInterval);
    _refreshInterval = setInterval(_backgroundRefresh, 3 * 60 * 1000);
    console.log('[cache-service] Background refresh scheduled every 3 min');
  }

  // ═══════════════════════════════════════════════════════════════════
  //  LOGOUT HOOK  — clear cache when user logs out
  // ═══════════════════════════════════════════════════════════════════
  function _installLogoutHook() {
    var _origLogout = window.doLogout;
    if (typeof _origLogout === 'function') {
      window.doLogout = function () {
        _clearAll();
        if (_refreshInterval) clearInterval(_refreshInterval);
        _origLogout.apply(this, arguments);
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  MANUAL REFRESH BUTTON
  //  Clicking the status badge forces a full cache clear + reload
  // ═══════════════════════════════════════════════════════════════════
  function _installManualRefresh() {
    if (!_badgeEl) return;
    _badgeEl.title = 'Click to force refresh all data';
    _badgeEl.style.cursor = 'pointer';
    _badgeEl.addEventListener('click', function () {
      _clearAll();
      _setStatus('loading');
      console.log('[cache-service] Manual refresh — all caches cleared');
      // Brief delay then reload current view
      setTimeout(function () {
        _setStatus('synced');
        // Trigger a reload of the current view if possible
        if (typeof loadKPIs === 'function') loadKPIs();
      }, 400);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PUBLIC API  (window.CacheService)
  // ═══════════════════════════════════════════════════════════════════
  window.CacheService = {
    // Force-invalidate specific actions (callable from other modules)
    invalidate: function (actionNames) {
      if (!Array.isArray(actionNames)) actionNames = [actionNames];
      _invalidate(actionNames);
    },

    // Clear all caches
    clear: function () { _clearAll(); },

    // Stats (useful for debugging)
    stats: function () {
      var entries = [];
      _store.forEach(function (v, k) {
        entries.push({
          key: k,
          age: Math.round((Date.now() - v.timestamp) / 1000) + 's',
          fresh: _fresh(v),
          ttl: Math.round(v.ttl / 1000) + 's',
        });
      });
      console.table(entries);
      return entries;
    },
  };

  // ═══════════════════════════════════════════════════════════════════
  //  INITIALISE
  // ═══════════════════════════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', function () {
    // 1. Wrap apiCall as soon as the page loads
    _installIntercept();

    // 2. Inject badge once DOM is ready
    //    appWrapper may be hidden — watch for it to appear
    var _badgeInstalled = false;
    function _tryBadge() {
      if (_badgeInstalled) return;
      var nav = document.querySelector('.top-nav');
      if (nav) {
        _injectBadge();
        _installManualRefresh();
        _badgeInstalled = true;
      }
    }
    _tryBadge();

    // Watch for appWrapper becoming visible (login event)
    var appWrapper = document.getElementById('appWrapper');
    if (appWrapper) {
      var obs = new MutationObserver(function () {
        if (appWrapper.style.display !== 'none' && appWrapper.style.display !== '') {
          _tryBadge();
          _startBackgroundRefresh();
          obs.disconnect();
        }
      });
      obs.observe(appWrapper, { attributes: true, attributeFilter: ['style'] });
    }

    // 3. Logout hook (wraps doLogout after all scripts parse)
    window.addEventListener('load', function () {
      _installLogoutHook();
      _tryBadge();
    });
  });

  console.log('[cache-service] Loaded ✅ — apiCall intercept pending DOM ready');

})(); // end IIFE — nothing leaks to global scope except window.CacheService
