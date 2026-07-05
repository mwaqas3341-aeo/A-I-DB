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
    if (action === 'getSummaryCounts' && _summaryCountsRpcAvailable !== false) {
      return _fastSummaryCounts(payload);
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
  };

  console.log('[perf-cache] Performance layer active (fast summary counts + short-TTL caching).');
})();
