// =====================================================================
//  EXPIRY-ALERTS.JS  —  Private Schools Certificate / Registration Alerts
//  ─────────────────────────────────────────────────────────────────────
//  ✅  STANDALONE FILE — zero edits to any existing file required.
//  ✅  Hooks into login by wrapping window.enterApp after all scripts load.
//  ✅  Injects its own CSS + HTML — no changes to index.html needed
//      (except adding one <script> tag pointing to this file).
//
//  WHAT IT DOES
//  ─────────────
//  After every successful sign-in it scans the Private Schools sheet for:
//    1. Registration Expired  →  status field = "Expired"
//                               OR expiry date is in the past
//    2. Building Certificate  →  expiry date is in the past
//    3. Health & Hygiene      →  expiry date is in the past
//
//  Results appear as a compact dismissable alert panel in the
//  bottom-right corner.  Dismissed state is stored in sessionStorage
//  so it does not re-appear during the same browser session.
//
//  HOW TO ADD TO YOUR PROJECT
//  ──────────────────────────
//  In index.html, AFTER the existing <script src="js/index.js"> tag, add:
//      <script src="js/expiry-alerts.js"></script>
//
// =====================================================================

(function () {
  'use strict';

  // ─── Column detection ─────────────────────────────────────────────
  // Auto-detects the right column by keywords from whatever headers
  // the API actually returns — immune to minor typos/spacing in sheet headers.
  // Columns confirmed by user:
  //   I  → Registration Expiry date
  //   V  → Building Certificate Expiry date
  //   W  → Health & Hygiene Certificate Expiry date
  //   G  → Registration Status (Registered / Non Registered / Expired)

  // Fallback exact strings (from private_schools.js PRIVATE_FIELD_CONFIG)
  const COL_FALLBACK = {
    name:       'School Name',
    district:   'District',
    tehsil:     'Tehsil',
    markaz:     'Markaz Name',
    regStatus:  'Registeration Status Registered/Non Registered Pepris',
    regExpiry:  'Date of Expiry of Registeration on Pepris',
    bldgExpiry: 'Building Certificate Expirey',
    hlthExpiry: 'Heallth and hygiene Certificate Expirey',
  };

  // Returns the first key whose lowercase contains ALL of the given terms.
  function _findKey(keys) {
    var terms = Array.prototype.slice.call(arguments, 1);
    return keys.find(function(k) {
      return terms.every(function(t) {
        return k.toLowerCase().indexOf(t.toLowerCase()) !== -1;
      });
    }) || null;
  }

  // Called once per scan with the first data row to map column keys.
  function detectCols(firstRow) {
    var keys = Object.keys(firstRow);
    return {
      name:       _findKey(keys, 'school name')                         || COL_FALLBACK.name,
      district:   _findKey(keys, 'district')                            || COL_FALLBACK.district,
      tehsil:     _findKey(keys, 'tehsil')                              || COL_FALLBACK.tehsil,
      markaz:     _findKey(keys, 'markaz')                              || COL_FALLBACK.markaz,
      // Col G — registration status
      regStatus:  _findKey(keys, 'registeration status')
               || _findKey(keys, 'registration status')                 || COL_FALLBACK.regStatus,
      // Col I — registration expiry date
      regExpiry:  _findKey(keys, 'expiry', 'registeration')
               || _findKey(keys, 'expiry', 'registration')
               || _findKey(keys, 'reg', 'exp')                          || COL_FALLBACK.regExpiry,
      // Col V — building certificate expiry date
      bldgExpiry: _findKey(keys, 'building', 'certificate')
               || _findKey(keys, 'building', 'exp')                     || COL_FALLBACK.bldgExpiry,
      // Col W — health & hygiene certificate expiry date
      hlthExpiry: _findKey(keys, 'health')
               || _findKey(keys, 'hygiene')                             || COL_FALLBACK.hlthExpiry,
    };
  }

  const SESSION_KEY = 'expiryAlertsDismissed';
  const PANEL_ID    = 'expiryAlertsPanel';

  // ─── Utility: parse a date string into a Date object ─────────────
  // Handles  YYYY-MM-DD  and  DD/MM/YYYY  (common in Pakistani data entry)
  function parseDate(str) {
    if (!str) return null;
    const s = String(str).trim();
    if (!s) return null;

    // ISO: 2024-06-15
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s);

    // DD/MM/YYYY or DD-MM-YYYY
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) return new Date(`${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`);

    // fallback
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  function isExpired(str) {
    const d = parseDate(str);
    if (!d) return false;
    return d < _today();
  }

  // Returns today at midnight so date comparisons are day-level
  function _today() {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Format a date string for display ─────────────────────────────
  function fmtDate(str) {
    const d = parseDate(str);
    if (!d) return str || '—';
    return d.toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' });
  }

  // ─── Scan raw rows and build three alert groups ───────────────────
  // detectCols() is called once on the first row so we resolve the
  // exact header keys used in THIS deployment (immune to sheet typos).
  function scanRows(rows) {
    if (!rows || !rows.length) return { regExpired: [], bldgExpired: [], hlthExpired: [] };

    // Auto-detect column keys from actual data (columns I, V, W confirmed)
    const COL = detectCols(rows[0]);

    // Log detected keys in dev console for easy debugging
    console.debug('[expiry-alerts] Detected columns:', COL);

    const regExpired   = [];
    const bldgExpired  = [];
    const hlthExpired  = [];

    rows.forEach(function(row) {
      const name     = row[COL.name]     || 'Unknown School';
      const district = row[COL.district] || '';
      const tehsil   = row[COL.tehsil]   || '';
      const markaz   = row[COL.markaz]   || '';
      const location = [markaz, tehsil, district].filter(Boolean).join(', ') || 'N/A';

      // ── Column I : Registration Expiry ────────────────────────────
      const regStatus = String(row[COL.regStatus] || '').trim();
      const regDate   = row[COL.regExpiry];
      if (regStatus === 'Expired' || isExpired(regDate)) {
        regExpired.push({
          name, location,
          expiry: regDate
            ? fmtDate(regDate)
            : (regStatus === 'Expired' ? 'Marked Expired' : '—')
        });
      }

      // ── Column V : Building Certificate Expiry ────────────────────
      const bldgDate = row[COL.bldgExpiry];
      if (isExpired(bldgDate)) {
        bldgExpired.push({ name, location, expiry: fmtDate(bldgDate) });
      }

      // ── Column W : Health & Hygiene Certificate Expiry ────────────
      const hlthDate = row[COL.hlthExpiry];
      if (isExpired(hlthDate)) {
        hlthExpired.push({ name, location, expiry: fmtDate(hlthDate) });
      }
    });

    return { regExpired, bldgExpired, hlthExpired };
  }

  // ─── Inject scoped CSS (once) ─────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('expiry-alerts-css')) return;
    const style = document.createElement('style');
    style.id = 'expiry-alerts-css';
    style.textContent = `
      /* ── Expiry Alerts Panel ─────────────────────────────── */
      #${PANEL_ID} {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 380px;
        max-width: calc(100vw - 32px);
        max-height: 70vh;
        background: var(--s1, #1e2330);
        border: 1px solid var(--b0, #2e3450);
        border-radius: 14px;
        box-shadow: 0 12px 40px rgba(0,0,0,.45);
        display: flex;
        flex-direction: column;
        z-index: 9999;
        overflow: hidden;
        font-family: inherit;
        animation: eaSlideIn .28s cubic-bezier(.22,1,.36,1);
      }
      @keyframes eaSlideIn {
        from { transform: translateY(24px); opacity: 0; }
        to   { transform: translateY(0);    opacity: 1; }
      }
      #${PANEL_ID}.ea-hide {
        animation: eaSlideOut .22s ease forwards;
      }
      @keyframes eaSlideOut {
        to { transform: translateY(24px); opacity: 0; }
      }

      .ea-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px 12px;
        border-bottom: 1px solid var(--b0, #2e3450);
        flex-shrink: 0;
      }
      .ea-header-icon {
        width: 34px;
        height: 34px;
        border-radius: 8px;
        background: rgba(239,68,68,.15);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.1rem;
        color: #f87171;
        flex-shrink: 0;
      }
      .ea-header-text { flex: 1; min-width: 0; }
      .ea-header-title {
        font-size: .85rem;
        font-weight: 700;
        color: var(--t1, #e2e8f0);
        line-height: 1.2;
      }
      .ea-header-sub {
        font-size: .72rem;
        color: var(--t3, #64748b);
        margin-top: 2px;
      }
      .ea-close {
        background: none;
        border: none;
        color: var(--t3, #64748b);
        cursor: pointer;
        font-size: 1.1rem;
        padding: 4px 6px;
        border-radius: 6px;
        line-height: 1;
        transition: color .15s, background .15s;
        flex-shrink: 0;
      }
      .ea-close:hover {
        background: rgba(255,255,255,.07);
        color: var(--t1, #e2e8f0);
      }

      .ea-body {
        overflow-y: auto;
        padding: 10px 14px 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      /* thin scrollbar */
      .ea-body::-webkit-scrollbar { width: 4px; }
      .ea-body::-webkit-scrollbar-thumb {
        background: var(--b0, #2e3450);
        border-radius: 4px;
      }

      .ea-group {}
      .ea-group-header {
        display: flex;
        align-items: center;
        gap: 7px;
        cursor: pointer;
        padding: 7px 10px;
        border-radius: 8px;
        transition: background .15s;
        user-select: none;
      }
      .ea-group-header:hover { background: rgba(255,255,255,.04); }
      .ea-group-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .ea-group-dot.reg   { background: #f87171; }
      .ea-group-dot.bldg  { background: #fb923c; }
      .ea-group-dot.hlth  { background: #facc15; }
      .ea-group-label {
        flex: 1;
        font-size: .78rem;
        font-weight: 600;
        color: var(--t1, #e2e8f0);
      }
      .ea-group-badge {
        font-size: .68rem;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 20px;
        line-height: 1.4;
      }
      .ea-group-badge.reg  { background: rgba(239,68,68,.18); color: #fca5a5; }
      .ea-group-badge.bldg { background: rgba(251,146,60,.18); color: #fdba74; }
      .ea-group-badge.hlth { background: rgba(250,204,21,.18); color: #fde047; }
      .ea-chevron {
        font-size: .75rem;
        color: var(--t3, #64748b);
        transition: transform .2s;
      }
      .ea-chevron.open { transform: rotate(90deg); }

      .ea-list {
        display: none;
        flex-direction: column;
        gap: 4px;
        padding: 4px 0 4px 24px;
      }
      .ea-list.open { display: flex; }

      .ea-row {
        background: rgba(255,255,255,.03);
        border: 1px solid var(--b0, #2e3450);
        border-radius: 7px;
        padding: 7px 10px;
      }
      .ea-row-name {
        font-size: .77rem;
        font-weight: 600;
        color: var(--t1, #e2e8f0);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ea-row-meta {
        font-size: .68rem;
        color: var(--t3, #64748b);
        margin-top: 2px;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .ea-row-meta span { display: flex; align-items: center; gap: 3px; }

      .ea-footer {
        padding: 10px 16px 12px;
        border-top: 1px solid var(--b0, #2e3450);
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
      }
      .ea-footer-note {
        font-size: .68rem;
        color: var(--t3, #64748b);
      }
      .ea-dismiss-btn {
        background: none;
        border: 1px solid var(--b0, #2e3450);
        color: var(--t2, #94a3b8);
        font-size: .72rem;
        cursor: pointer;
        padding: 4px 10px;
        border-radius: 6px;
        transition: background .15s, color .15s;
        font-family: inherit;
      }
      .ea-dismiss-btn:hover {
        background: rgba(255,255,255,.06);
        color: var(--t1, #e2e8f0);
      }

      .ea-empty {
        text-align: center;
        padding: 18px 0 6px;
        font-size: .78rem;
        color: var(--t3, #64748b);
      }
      .ea-empty i { font-size: 1.4rem; display: block; margin-bottom: 6px; color: var(--ok, #22c55e); }

      /* Loading state */
      .ea-loading {
        text-align: center;
        padding: 20px 0;
        font-size: .78rem;
        color: var(--t3, #64748b);
      }

      /* Mobile responsive */
      @media (max-width: 480px) {
        #${PANEL_ID} {
          bottom: 0;
          right: 0;
          width: 100%;
          max-width: 100%;
          border-radius: 14px 14px 0 0;
          max-height: 75vh;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Build and show the panel ─────────────────────────────────────
  function showPanel(alerts) {
    // Remove old panel if present
    const old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    const { regExpired, bldgExpired, hlthExpired } = alerts;
    const total = regExpired.length + bldgExpired.length + hlthExpired.length;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    // ── Header ─────────────────────────────────────────────────────
    panel.innerHTML = `
      <div class="ea-header">
        <div class="ea-header-icon">
          <i class="bi bi-exclamation-triangle-fill"></i>
        </div>
        <div class="ea-header-text">
          <div class="ea-header-title">Private School Expiry Alerts</div>
          <div class="ea-header-sub">${total} issue${total !== 1 ? 's' : ''} found across Private Schools</div>
        </div>
        <button class="ea-close" onclick="document.getElementById('${PANEL_ID}').remove()" title="Close">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="ea-body" id="ea-body-content"></div>
      <div class="ea-footer">
        <span class="ea-footer-note"><i class="bi bi-info-circle"></i> Scanned on sign-in</span>
        <button class="ea-dismiss-btn" onclick="_eaDismissSession()">
          Dismiss for session
        </button>
      </div>
    `;

    document.body.appendChild(panel);

    // ── Body content ───────────────────────────────────────────────
    const body = document.getElementById('ea-body-content');

    if (total === 0) {
      body.innerHTML = `
        <div class="ea-empty">
          <i class="bi bi-check-circle-fill"></i>
          All registrations and certificates are valid.
        </div>`;
      return;
    }

    // Build each group
    const groups = [
      {
        key:   'reg',
        label: 'Registration Expired',
        icon:  'bi-file-earmark-x-fill',
        rows:  regExpired,
        color: 'reg',
      },
      {
        key:   'bldg',
        label: 'Building Certificate Expired',
        icon:  'bi-building-x',
        rows:  bldgExpired,
        color: 'bldg',
      },
      {
        key:   'hlth',
        label: 'Health & Hygiene Certificate Expired',
        icon:  'bi-heart-pulse-fill',
        rows:  hlthExpired,
        color: 'hlth',
      },
    ];

    groups.forEach(g => {
      if (!g.rows.length) return;

      const groupEl = document.createElement('div');
      groupEl.className = 'ea-group';

      const listId = `ea-list-${g.key}`;
      const chevId = `ea-chev-${g.key}`;

      groupEl.innerHTML = `
        <div class="ea-group-header" onclick="_eaToggleGroup('${listId}', '${chevId}')">
          <span class="ea-group-dot ${g.color}"></span>
          <span class="ea-group-label">
            <i class="bi ${g.icon}" style="margin-right:5px"></i>${g.label}
          </span>
          <span class="ea-group-badge ${g.color}">${g.rows.length}</span>
          <span class="ea-chevron" id="${chevId}"><i class="bi bi-chevron-right"></i></span>
        </div>
        <div class="ea-list" id="${listId}">
          ${g.rows.map(r => `
            <div class="ea-row">
              <div class="ea-row-name" title="${_esc(r.name)}">${_esc(r.name)}</div>
              <div class="ea-row-meta">
                <span><i class="bi bi-geo-alt"></i>${_esc(r.location)}</span>
                <span><i class="bi bi-calendar-x"></i>${_esc(r.expiry)}</span>
              </div>
            </div>`).join('')}
        </div>
      `;

      body.appendChild(groupEl);
    });

    // Auto-expand first group
    const firstList  = body.querySelector('.ea-list');
    const firstChev  = body.querySelector('.ea-chevron');
    if (firstList) firstList.classList.add('open');
    if (firstChev) firstChev.classList.add('open');
  }

  // ─── Show loading skeleton while fetching ─────────────────────────
  function showLoadingPanel() {
    const old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="ea-header">
        <div class="ea-header-icon">
          <i class="bi bi-exclamation-triangle-fill"></i>
        </div>
        <div class="ea-header-text">
          <div class="ea-header-title">Private School Expiry Alerts</div>
          <div class="ea-header-sub">Scanning school records…</div>
        </div>
        <button class="ea-close" onclick="document.getElementById('${PANEL_ID}').remove()" title="Close">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="ea-loading">
        <span class="spinner-border spinner-border-sm"></span>
        <span style="margin-left:8px">Loading private school data…</span>
      </div>
    `;
    document.body.appendChild(panel);
  }

  // ─── Toggle a group list open / closed ────────────────────────────
  window._eaToggleGroup = function(listId, chevId) {
    const list = document.getElementById(listId);
    const chev = document.getElementById(chevId);
    if (!list) return;
    list.classList.toggle('open');
    if (chev) chev.classList.toggle('open');
  };

  // ─── Dismiss for this browser session ────────────────────────────
  window._eaDismissSession = function() {
    sessionStorage.setItem(SESSION_KEY, '1');
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.classList.add('ea-hide');
      setTimeout(() => panel.remove(), 240);
    }
  };

  // ─── Main: fetch Private data and run scan ─────────────────────────
  // Read the logged-in user from localStorage — same key enterApp() uses.
  // This avoids depending on window.currentUser which is a module-level
  // let variable in index.js and is never exposed on window.
  function _getStoredUser() {
    try {
      var key = (typeof CONFIG !== 'undefined' && CONFIG.SESSION_KEY) ? CONFIG.SESSION_KEY : 'portalUser';
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  function runExpiryCheck(user) {
    if (sessionStorage.getItem(SESSION_KEY)) return;

    // If user wasn't passed or is stale, read fresh from localStorage
    var activeUser = (user && user.cnic) ? user : _getStoredUser();

    if (!activeUser || !activeUser.cnic) {
      console.warn('[expiry-alerts] No logged-in user found in localStorage — aborting.');
      return;
    }

    console.log('[expiry-alerts] Starting scan. user:', activeUser.name, '| cnic:', activeUser.cnic);
    injectCSS();
    showLoadingPanel();

    google.script.run
      .withSuccessHandler(function (res) {
        const panel = document.getElementById(PANEL_ID);

        // Log the FULL raw response so we can see exactly what the API returns
        console.log('[expiry-alerts] Raw API response:', JSON.stringify(res).slice(0, 300));

        if (!res) {
          console.warn('[expiry-alerts] Response is null/undefined.');
          if (panel) panel.remove();
          return;
        }
        if (!res.success) {
          console.warn('[expiry-alerts] res.success is false. Message:', res.message);
          if (panel) panel.remove();
          return;
        }

        // Handle both res.data (object rows) and res.rows (array rows)
        var rows = res.data || res.rows || [];

        // If rows is array-of-arrays (not objects), convert using res.headers
        if (rows.length && Array.isArray(rows[0]) && res.headers && res.headers.length) {
          console.log('[expiry-alerts] Converting array rows to objects using headers...');
          rows = rows.map(function(row) {
            var obj = {};
            res.headers.forEach(function(h, i) { obj[h] = row[i] !== undefined ? row[i] : ''; });
            return obj;
          });
        }

        console.log('[expiry-alerts] Row count:', rows.length);
        if (!rows.length) {
          console.warn('[expiry-alerts] No rows in response. Full res keys:', Object.keys(res));
          if (panel) panel.remove();
          return;
        }

        // Log first row keys so we can verify column detection
        console.log('[expiry-alerts] First row keys:', Object.keys(rows[0]).join(' | '));

        const alerts = scanRows(rows);
        const total  = alerts.regExpired.length + alerts.bldgExpired.length + alerts.hlthExpired.length;
        console.log('[expiry-alerts] Scan complete — reg:', alerts.regExpired.length,
          'bldg:', alerts.bldgExpired.length, 'hlth:', alerts.hlthExpired.length);

        if (total === 0) {
          if (panel) panel.remove();
          return;
        }

        showPanel(alerts);
      })
      .withFailureHandler(function (err) {
        const panel = document.getElementById(PANEL_ID);
        if (panel) panel.remove();
        console.warn('[expiry-alerts] API call FAILED:', err.message || err);
      })
      .getPrivateDashboardData(activeUser, 'Private');
  }

  // ─── Hook: MutationObserver on #appWrapper ────────────────────────
  // Watches for #appWrapper becoming visible (display:block).
  // This fires for BOTH:
  //   • Session restore  (DOMContentLoaded → restoreSession → enterApp)
  //   • Fresh login      (user submits login form → enterApp)
  // The old window.load + enterApp-wrap approach missed session restores
  // because DOMContentLoaded (where restoreSession runs) fires BEFORE load.
  document.addEventListener('DOMContentLoaded', function () {
    var appWrapper = document.getElementById('appWrapper');
    if (!appWrapper) {
      console.warn('[expiry-alerts] #appWrapper element not found — alerts disabled.');
      return;
    }

    console.log('[expiry-alerts] Loaded OK. Watching #appWrapper for login...');
    var _ran = false;

    function onAppVisible() {
      if (_ran) return;
      // Confirm the wrapper is actually visible now
      if (appWrapper.style.display === 'none' || appWrapper.style.display === '') return;
      _ran = true;
      console.log('[expiry-alerts] App is visible — scheduling expiry check in 1s...');
      setTimeout(function () {
        try {
          runExpiryCheck(window.currentUser);
        } catch (e) {
          console.warn('[expiry-alerts] runExpiryCheck threw:', e.message);
        }
      }, 1000);
    }

    // Watch for style attribute changes on #appWrapper
    var observer = new MutationObserver(onAppVisible);
    observer.observe(appWrapper, { attributes: true, attributeFilter: ['style'] });

    // Also check immediately — handles edge case where app is already visible
    // before this script runs (e.g. very fast session restore)
    onAppVisible();
  });

})(); // end IIFE — nothing leaks to global scope except _eaToggle* helpers
