/**
 * ── PERFORMANCE LAYER (standalone, no edits to api.js) ─────────────
 *
 * This file must load AFTER js/api.js. It wraps the existing global
 * `apiCall` function in place — every other file keeps calling
 * `google.script.run....someAction(...)` exactly as before; nothing
 * about their code changes. This file only changes what happens
 * *underneath* that call for a few specific actions:
 *
 *   1. getSummaryCounts — instead of fetching every row of
 *      public_schools/private_schools to the browser just to count
 *      them, it calls a small Postgres function that does the
 *      counting server-side (see supabase_fast_summary_counts.sql).
 *      Falls back automatically to the original slow-but-correct
 *      behavior if that SQL function hasn't been created yet, so
 *      it's safe to deploy this file before running the SQL.
 *
 *   2. A short in-memory cache (60s) for lookups that rarely change
 *      within a session: jurisdiction dropdown data, Links/Apps,
 *      Tools, KPI cards. Any Save/Delete action for those clears the
 *      relevant cache entry immediately, so edits always show up
 *      right away — the cache only skips *repeat, unchanged* reads.
 *
 * Nothing here touches security or scoping: every request still goes
 * through the exact same Supabase client and RLS policies as before.
 * This only avoids doing the *same* work over and over.
 */

(function () {
  'use strict';

  if (typeof apiCall !== 'function') {
    console.error('[perf-cache] apiCall not found — make sure this file loads AFTER js/api.js.');
    return;
  }

  const _originalApiCall = apiCall;

  // ── Fast summary counts, with automatic fallback ──────────────────
  let _summaryCountsRpcAvailable = null; // null = unknown yet, true/false once checked

  async function _fastSummaryCounts(payload) {
    // get_summary_counts() takes no arguments — it returns raw,
    // system-wide totals with no awareness of a user's jurisdiction or
    // extra scope_type/scope_value tags. That's fine (and fast) for an
    // admin, who's meant to see everything anyway, but it silently
    // showed every scoped user the full system count regardless of
    // their Markaz/Tehsil/Wing/District assignment. Only take the fast
    // RPC path for admins; every scoped user goes through the slower
    // but correctly-filtered path in api.js.
    const isAdmin = payload && String(payload.role || '').toLowerCase() === 'admin';
    if (!isAdmin) {
      return _originalApiCall('getSummaryCounts', payload);
    }
    try {
      const { data, error } = await _sb.rpc('get_summary_counts');
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('No data returned from get_summary_counts()');
      _summaryCountsRpcAvailable = true;
      return {
        success:         true,
        publicCount:     Number(row.public_active)    || 0,
        outsourcedCount: Number(row.public_outsourced) || 0,
        privateCount:    Number(row.private_active)    || 0,
        inactiveCount:   Number(row.private_inactive)  || 0,
      };
    } catch (e) {
      // Function probably doesn't exist yet (SQL not run) — fall back
      // to the original slower-but-correct implementation, silently.
      _summaryCountsRpcAvailable = false;
      return _originalApiCall('getSummaryCounts', payload);
    }
  }

  // ── Short-TTL cache for rarely-changing lookups ───────────────────
  const CACHE_TTL_MS = 60 * 1000; // 60 seconds
  const _cache = new Map(); // key -> { value, expires }

  const CACHEABLE_ACTIONS = new Set([
    'getJurisdictionDropdownData',
    'getLinksAndApps',
    'getLinksAppsAdmin',
    'getToolsAdmin',
    'getKpiCards',
    'getKpiCardsAdmin',
  ]);

  // Saving/deleting any of these should immediately invalidate the
  // matching read-cache entries above, so an edit is visible right away.
  const WRITE_TO_READ_INVALIDATION = {
    saveLinksAppsRow:   ['getLinksAndApps', 'getLinksAppsAdmin'],
    deleteLinksAppsRow: ['getLinksAndApps', 'getLinksAppsAdmin'],
    saveToolRow:        ['getToolsAdmin'],
    deleteToolRow:      ['getToolsAdmin'],
    saveKpiCard:        ['getKpiCards', 'getKpiCardsAdmin'],
    deleteKpiCard:      ['getKpiCards', 'getKpiCardsAdmin'],
    saveUser:           ['getJurisdictionDropdownData'],
  };

  function _cacheKey(action, payload) {
    try { return action + ':' + JSON.stringify(payload); }
    catch { return action; }
  }

  function _invalidate(actionsToClear) {
    for (const key of Array.from(_cache.keys())) {
      for (const action of actionsToClear) {
        if (key.startsWith(action + ':')) { _cache.delete(key); break; }
      }
    }
  }

  // ── The actual wrapper ─────────────────────────────────────────────
  apiCall = async function (action, payload) {
    _loadingBarStart();
    try {
      if (action === 'getSummaryCounts' && _summaryCountsRpcAvailable !== false) {
        return await _fastSummaryCounts(payload);
      }

      if (CACHEABLE_ACTIONS.has(action)) {
        const key = _cacheKey(action, payload);
        const hit = _cache.get(key);
        if (hit && hit.expires > Date.now()) {
          return hit.value;
        }
        const result = await _originalApiCall(action, payload);
        _cache.set(key, { value: result, expires: Date.now() + CACHE_TTL_MS });
        return result;
      }

      const result = await _originalApiCall(action, payload);

      if (WRITE_TO_READ_INVALIDATION[action]) {
        _invalidate(WRITE_TO_READ_INVALIDATION[action]);
      }

      return result;
    } finally {
      _loadingBarEnd();
    }
  };

  // ── Animated loading bar ───────────────────────────────────────────
  // Self-contained: injects its own CSS + DOM, sits in the header
  // between the nav menu buttons and the WhatsApp/Facebook icons.
  // Shows automatically whenever 1+ API calls are in flight; the fill
  // eases toward ~92% while waiting (never claims false completion for
  // an unknown-duration request), then snaps to 100% and fades out the
  // instant every in-flight call has finished.
  let _inFlight = 0;
  let _progressTimer = null;
  let _hideTimer = null;
  let _currentPct = 0;
  let _barEl, _fillEl, _pctEl, _msgEl;

  const LOADING_MESSAGES = [
    'Loading data…', 'Fetching records…', 'Syncing with server…',
    'Almost there…', 'Getting things ready…',
  ];

  function _injectLoadingBarStyles() {
    if (document.getElementById('perf-loading-bar-styles')) return;
    const style = document.createElement('style');
    style.id = 'perf-loading-bar-styles';
    style.textContent = `
      #perfLoadingBar {
        display: none;
        align-items: center;
        gap: 10px;
        padding: 6px 14px;
        border-radius: 999px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.08);
        white-space: nowrap;
      }
      #perfLoadingBar.active { display: flex; }
      #perfLoadingBarTrack {
        position: relative;
        width: 130px;
        height: 8px;
        border-radius: 999px;
        background: rgba(0,0,0,0.35);
        overflow: hidden;
        box-shadow: inset 0 1px 2px rgba(0,0,0,0.4);
      }
      #perfLoadingBarFill {
        position: absolute;
        top: 0; left: 0; height: 100%;
        width: 0%;
        border-radius: 999px;
        background: linear-gradient(90deg, #ef4444 0%, #f97316 50%, #facc15 100%);
        box-shadow: 0 0 8px rgba(249,115,22,0.7);
        transition: width 0.25s ease-out;
      }
      #perfLoadingBarFill::after {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent);
        width: 40%;
        animation: perfBarShine 1.1s linear infinite;
      }
      @keyframes perfBarShine {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(250%); }
      }
      #perfLoadingBarPct {
        font-size: 0.72rem;
        font-weight: 600;
        color: #fbbf24;
        min-width: 30px;
        text-align: right;
      }
      #perfLoadingBarMsg {
        font-size: 0.72rem;
        color: rgba(255,255,255,0.65);
      }
      @media (max-width: 900px) {
        #perfLoadingBarMsg { display: none; }
        #perfLoadingBarTrack { width: 70px; }
      }
    `;
    document.head.appendChild(style);
  }

  function _injectLoadingBarDom() {
    if (document.getElementById('perfLoadingBar')) return;
    _barEl = document.createElement('div');
    _barEl.id = 'perfLoadingBar';
    _barEl.innerHTML = `
      <span id="perfLoadingBarMsg">Loading data…</span>
      <div id="perfLoadingBarTrack"><div id="perfLoadingBarFill"></div></div>
      <span id="perfLoadingBarPct">0%</span>
    `;

    // Place it between the nav menu buttons (.nav-links) and the
    // WhatsApp/Facebook icons (.contact-links), inside the header's
    // existing flex spacer — no HTML file changes needed.
    const nav = document.querySelector('.top-nav');
    const contactLinks = document.querySelector('.top-nav .contact-links');
    if (nav && contactLinks) {
      nav.insertBefore(_barEl, contactLinks);
    } else if (nav) {
      nav.appendChild(_barEl);
    } else {
      // Fallback: if the header isn't found for any reason, don't
      // break anything — just skip showing the bar.
      return;
    }

    _fillEl = document.getElementById('perfLoadingBarFill');
    _pctEl  = document.getElementById('perfLoadingBarPct');
    _msgEl  = document.getElementById('perfLoadingBarMsg');
  }

  function _setPct(pct) {
    _currentPct = pct;
    if (_fillEl) _fillEl.style.width = pct + '%';
    if (_pctEl)  _pctEl.textContent = Math.round(pct) + '%';
  }

  function _loadingBarStart() {
    _injectLoadingBarStyles();
    _injectLoadingBarDom();
    if (!_barEl) return;

    _inFlight++;
    if (_inFlight > 1) return; // already showing, just track the extra call

    clearTimeout(_hideTimer);
    if (_msgEl) _msgEl.textContent = LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
    _barEl.classList.add('active');
    _setPct(8);

    clearInterval(_progressTimer);
    _progressTimer = setInterval(() => {
      // Ease toward ~92%, slowing down — never promises false completion
      // for a call whose real duration we don't know in advance.
      const next = _currentPct + (92 - _currentPct) * 0.12;
      _setPct(Math.min(next, 92));
    }, 200);
  }

  function _loadingBarEnd() {
    if (!_barEl) return;
    _inFlight = Math.max(0, _inFlight - 1);
    if (_inFlight > 0) return; // other calls still in flight

    clearInterval(_progressTimer);
    _setPct(100);
    _hideTimer = setTimeout(() => {
      _barEl.classList.remove('active');
      _setPct(0);
    }, 350);
  }

  console.log('[perf-cache] Performance layer active (fast summary counts + short-TTL caching + loading bar).');
})();
