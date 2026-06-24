// =====================================================================
//  PRELOADER.JS  —  Parallel Data Preloader for AEO Portal
//  ─────────────────────────────────────────────────────────────────────
//  ✅  STANDALONE — zero edits to any existing file.
//  ✅  Must load AFTER cache-service.js (data goes straight into cache).
//  ✅  On login, fires ALL 9 GAS data calls in parallel simultaneously.
//  ✅  By the time user clicks any module, data is already in cache.
//  ✅  Shows a thin progress bar at the top during preload.
//  ✅  Injects DNS prefetch hints for Google APIs (faster first call).
//  ✅  Debounces all search/filter inputs (stops lag on every keystroke).
//
//  HOW TO ADD — in index.html after cache-service.js:
//      <script src="js/cache-service.js"></script>
//      <script src="js/preloader.js"></script>
//
//  WHAT GETS PRELOADED (all fired simultaneously):
//  ┌─────────────────────────────────────────────────────┐
//  │  1. getSummaryCounts       → KPI numbers            │
//  │  2. getLinksAndApps        → sidebar links & apps   │
//  │  3. getKpiCards            → dashboard cards        │
//  │  4. getToolsUser           → tools view             │
//  │  5. getSchoolHierarchy     → all dropdowns          │
//  │  6. getPrivateDashboardData (Private)               │
//  │  7. getPublicDashboardData  (Public)                │
//  │  8. getPublicDashboardData  (Out Sourced School)    │
//  │  9. loadSheetForClient      (Staff/HR)              │
//  └─────────────────────────────────────────────────────┘
// =====================================================================

(function () {
  'use strict';

  // ─── Read logged-in user from localStorage ──────────────────────
  function _getUser() {
    try {
      var key = (typeof CONFIG !== 'undefined' && CONFIG.SESSION_KEY)
        ? CONFIG.SESSION_KEY : 'portalUser';
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PROGRESS BAR
  //  Thin animated bar across the very top of the page.
  // ═══════════════════════════════════════════════════════════════════
  var _bar = null;
  var _barProgress = 0;
  var _barTimer = null;

  function _createBar() {
    if (_bar) return;

    var style = document.createElement('style');
    style.textContent = [
      '#preloadBar{',
        'position:fixed;top:0;left:0;z-index:99999;',
        'height:3px;width:0%;',
        'background:linear-gradient(90deg,#1a56db,#0ea5e9,#059669);',
        'transition:width .25s ease,opacity .4s ease;',
        'pointer-events:none;',
      '}',
      '#preloadBar.done{opacity:0;}',
    ].join('');
    document.head.appendChild(style);

    _bar = document.createElement('div');
    _bar.id = 'preloadBar';
    document.body.appendChild(_bar);
  }

  function _setBar(pct) {
    if (!_bar) return;
    _barProgress = Math.max(_barProgress, pct);
    _bar.style.width = _barProgress + '%';
  }

  function _completeBar() {
    _setBar(100);
    clearTimeout(_barTimer);
    _barTimer = setTimeout(function () {
      if (_bar) _bar.classList.add('done');
    }, 400);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  DNS PREFETCH — tells browser to resolve Google API DNS early
  //  Shaves ~100-300ms off the very first GAS call per session.
  // ═══════════════════════════════════════════════════════════════════
  function _injectDnsPrefetch() {
    var hints = [
      { rel: 'preconnect',   href: 'https://script.google.com' },
      { rel: 'preconnect',   href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect',   href: 'https://fonts.gstatic.com', crossorigin: true },
      { rel: 'dns-prefetch', href: 'https://cdn.jsdelivr.net' },
    ];

    hints.forEach(function (h) {
      if (document.querySelector('link[href="' + h.href + '"]')) return;
      var link = document.createElement('link');
      link.rel  = h.rel;
      link.href = h.href;
      if (h.crossorigin) link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  DEBOUNCE — wraps search/filter inputs to stop firing on every key
  //  Waits 320ms after the user stops typing before running the handler.
  //  Applied to all inputs with id containing 'search', 'filter',
  //  'keyword', 'emis', or 'flt'.
  // ═══════════════════════════════════════════════════════════════════
  function _debounce(fn, delay) {
    var timer;
    return function () {
      var ctx  = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, delay);
    };
  }

  function _applyDebounce() {
    var PATTERNS = ['search', 'filter', 'keyword', 'emis', 'flt', 'Flt', 'Search'];
    var inputs = document.querySelectorAll('input[type="text"], input:not([type])');

    inputs.forEach(function (inp) {
      var id = (inp.id || '').toLowerCase();
      var matched = PATTERNS.some(function (p) {
        return id.indexOf(p.toLowerCase()) !== -1;
      });
      if (!matched) return;
      if (inp._debounced) return;   // already done

      // Wrap existing oninput / onkeyup handlers
      ['oninput', 'onkeyup'].forEach(function (ev) {
        if (typeof inp[ev] === 'function') {
          inp[ev] = _debounce(inp[ev], 320);
        }
      });
      inp._debounced = true;
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PARALLEL PRELOAD — the core feature
  //  Calls window.apiCall (wrapped by cache-service.js) for every
  //  data type so it's stored in cache before user needs it.
  // ═══════════════════════════════════════════════════════════════════
  function _preload(user) {
    if (!user || !user.cnic) {
      console.warn('[preloader] No user — skipping preload');
      return;
    }

    if (typeof window.apiCall !== 'function') {
      console.warn('[preloader] apiCall not ready — retrying in 300ms');
      setTimeout(function () { _preload(user); }, 300);
      return;
    }

    console.log('[preloader] 🚀 Starting parallel preload for', user.name);
    _createBar();
    _setBar(5);

    var completed = 0;
    var total     = 9;

    function _tick() {
      completed++;
      _setBar(Math.round((completed / total) * 95) + 5);
      console.debug('[preloader] ' + completed + '/' + total + ' complete');
      if (completed >= total) {
        _completeBar();
        console.log('[preloader] ✅ All ' + total + ' data sources preloaded');
        // Apply debounce now that all views are rendered
        setTimeout(_applyDebounce, 500);
      }
    }

    function _fetch(action, payload) {
      window.apiCall(action, payload)
        .then(_tick)
        .catch(function (err) {
          console.warn('[preloader] ' + action + ' failed:', err.message || err);
          _tick();   // still count it so bar completes
        });
    }

    // ── Fire all 9 simultaneously ────────────────────────────────────

    // 1. KPI counts (dashboard numbers)
    _fetch('getSummaryCounts', user);

    // 2. Sidebar links & apps
    _fetch('getLinksAndApps', undefined);

    // 3. Dashboard quick-access cards
    _fetch('getKpiCards', undefined);

    // 4. Tools view
    _fetch('getToolsUser', undefined);

    // 5. School hierarchy (district / tehsil / markaz dropdowns)
    //    Try user-scoped version first, fall back to global
    if (user.markaz && user.markaz !== 'All') {
      _fetch('getSchoolHierarchyForUser', user);
    } else {
      _fetch('getSchoolHierarchy', undefined);
    }

    // 6. Private schools — Active
    _fetch('getPrivateDashboardData', [user, 'Private']);

    // 7. Public schools — Active
    _fetch('getPublicDashboardData', [user, 'Public']);

    // 8. Public schools — Out Sourced
    _fetch('getPublicDashboardData', [user, 'Out Sourced School']);

    // 9. HR Staff sheet
    _fetch('loadSheetForClient', ['Staff', user]);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  HOOK — watch #appWrapper becoming visible (login / session restore)
  //  Same reliable pattern used by cache-service.js and expiry-alerts.js
  // ═══════════════════════════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', function () {
    // Inject DNS hints immediately — before any fetch happens
    _injectDnsPrefetch();

    var appWrapper = document.getElementById('appWrapper');
    if (!appWrapper) {
      console.warn('[preloader] #appWrapper not found');
      return;
    }

    var _ran = false;

    function _onAppVisible() {
      if (_ran) return;
      if (appWrapper.style.display === 'none' || appWrapper.style.display === '') return;
      _ran = true;

      // Small delay so enterApp() finishes setting up the DOM first
      setTimeout(function () {
        var user = _getUser();
        _preload(user);
      }, 200);
    }

    var observer = new MutationObserver(_onAppVisible);
    observer.observe(appWrapper, { attributes: true, attributeFilter: ['style'] });

    // Check immediately in case session already restored
    _onAppVisible();
  });

  console.log('[preloader] Loaded ✅ — waiting for login');

})();
