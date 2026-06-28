// ── Index / App Shell JS ──
// ═══════════════════════════════════════════════════
//  IMPORTANT NEWS
// ═══════════════════════════════════════════════════
const systemNotes = [
  { text: "Please update all schools Public & Private data under your jurisdiction.", isNew: true },
  { text: "Portal Tools Manager has been added to the main dashboard.", isNew: true },
  { text: "Please update your data whole staff  & verify head teachers working under your jurisdiction.", isNew: false },
  { text: "Contact support via WhatsApp for any data sync issues.", isNew: false }
];

function renderNotes() {
  const list = document.getElementById('sidebarNotesList');
  if (!list) return;
  list.innerHTML = systemNotes.map(note => `
    <li>
      <i class="bi bi-info-circle-fill note-icon" style="color:var(--brand)"></i>
      <div>
        <div>${note.text}</div>
        ${note.isNew
          ? '<span class="badge-new">New</span>'
          : '<span class="badge-info">Note</span>'}
      </div>
    </li>`).join('');
}
document.addEventListener('DOMContentLoaded', renderNotes);

// ── Seed the login history entry immediately on page load ─────────
document.addEventListener('DOMContentLoaded', () => {
  history.replaceState({ page: 'login' }, '', location.href);
});

// ═══════════════════════════════════════════════════
//  GLOBAL STATE
// ═══════════════════════════════════════════════════
let currentUser = null;

// ─── Toast ────────────────────────────────────────
function showToast(msg, ok = true) {
  const s  = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast-item ${ok ? 'ok' : 'err'}`;
  el.innerHTML = `<i class="bi bi-${ok ? 'check-circle-fill' : 'exclamation-circle-fill'}"></i><span>${msg}</span>`;
  s.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'tout .3s forwards';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ─── View switcher ────────────────────────────────
function switchGlobalTab(viewId, btnElement) {
  document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active-view'));
  const target = document.getElementById(viewId);
  if (target) target.classList.add('active-view');

  document.querySelectorAll('.nav-link-btn').forEach(b => b.classList.remove('active'));

  if (btnElement) {
    btnElement.classList.add('active');
  } else if (viewId === 'homeView') {
    const homeBtn = document.getElementById('navHomeBtn');
    if (homeBtn) homeBtn.classList.add('active');
  }
}

// ─── KPI toggle ───────────────────────────────────
function toggleKpiCards(showNested) {
  document.getElementById('mainKpiContainer').style.display = showNested ? 'none'  : 'block';
  document.getElementById('subKpiContainer').style.display  = showNested ? 'block' : 'none';
}

// ═══════════════════════════════════════════════════
//  JURISDICTION HELPERS
//  Reads the user's assigned area and stores it in
//  localStorage so enrollment.html (opened in a new
//  tab) can read it and lock its dropdowns.
// ═══════════════════════════════════════════════════

/**
 * Parse extra markazs from the user's scope_value field (Col L).
 * The admin sets scope_type = "Markaz" and scope_value as a
 * comma-separated list of extra markaz names beyond their primary one.
 * e.g.  "MARKAZ SHAH SADAR DIN, MARKAZ FATEHPUR"
 *
 * Returns [] if scope_type is not "Markaz" or value is empty.
 */
function parseExtraMarkazs(scopeType, scopeValue) {
  if (!scopeType || String(scopeType).trim().toLowerCase() !== 'markaz') return [];
  if (!scopeValue) return [];
  return String(scopeValue)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Build the jurisdiction object from the logged-in user and
 * save it to localStorage so enrollment.html can read it.
 */
function saveJurisdiction(user) {
  // Admin users get no jurisdiction lock — clear any old entry and return
  if (String(user.role).toLowerCase() === 'admin') {
    try { localStorage.removeItem('AEO_JURISDICTION'); } catch (e) {}
    return;
  }
  const jur = {
    role:         user.role        || 'user',
    district:     user.district    || '',
    tehsil:       user.tehsil      || '',
    markaz:       user.markaz      || '',
    extraMarkazs: parseExtraMarkazs(user.scope_type, user.scope_value),
  };
  try {
    localStorage.setItem('AEO_JURISDICTION', JSON.stringify(jur));
  } catch (e) {
    console.warn('Could not save jurisdiction:', e);
  }
}
/**
 * Clear jurisdiction on logout so the next user starts clean.
 */
function clearJurisdiction() {
  try { localStorage.removeItem('AEO_JURISDICTION'); } catch (e) {}
}

// ─── Login ────────────────────────────────────────
function doLogin() {
  const btn  = document.getElementById('loginBtn');
  const cnic = document.getElementById('cnic').value.trim();
  const pass = document.getElementById('pass').value.trim();
  if (!cnic || !pass) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Logging in…';

  google.script.run
    .withSuccessHandler(res => {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Secure Login';
      if (res.success) {
        localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(res));
        enterApp(res);
      } else {
        showToast(res.message, false);
      }
    })
    .login(cnic, pass);
}

// ─── Enter app — shared by fresh login and session restore ────────
function enterApp(user) {
  currentUser = user;
  localStorage.setItem('userMarkaz', user.markaz || 'All');

  // ── Save jurisdiction so enrollment.html can read it ──────────
  saveJurisdiction(user);
  // ──────────────────────────────────────────────────────────────

  document.getElementById('userName').textContent       = user.name;
  document.getElementById('userMarkaz').textContent     = user.markaz || 'N/A';
  document.getElementById('dashMarkazName').textContent = user.markaz || 'All';
  document.getElementById('navAvatar').textContent      = user.name.substring(0, 2).toUpperCase();
  document.getElementById('loginView').style.display    = 'none';
  document.getElementById('appWrapper').style.display   = 'block';

  if (String(user.role).toLowerCase() === 'admin')
    document.getElementById('navAdminBtn').style.display = 'block';

  loadKPIs();
  loadDashboardLinksApps();
  loadDashboardKpiCards();

  const startRoute = location.hash ? location.hash.slice(1) : 'home';
  history.pushState({ route: 'home' }, '', '#home');
  if (startRoute !== 'home') {
    navigateTo(startRoute, true);
  }
}

// ─── Restore session on page load ──────────────────
function restoreSession() {
  const saved = localStorage.getItem(CONFIG.SESSION_KEY);
  if (!saved) return;
  try {
    const user = JSON.parse(saved);
    if (user && user.cnic) enterApp(user);
  } catch (e) {
    localStorage.removeItem(CONFIG.SESSION_KEY);
  }
}
document.addEventListener('DOMContentLoaded', restoreSession);

// ─── Logout ───────────────────────────────────────
function doLogout() {
  currentUser = null;
  localStorage.removeItem('userMarkaz');
  localStorage.removeItem(CONFIG.SESSION_KEY);

  // ── Clear jurisdiction on logout ───────────────
  clearJurisdiction();
  // ──────────────────────────────────────────────

  document.getElementById('appWrapper').style.display = 'none';
  document.getElementById('loginView').style.display  = 'flex';
  document.getElementById('pass').value = '';
  history.replaceState(null, '', location.pathname);
  showToast('Logged out successfully', true);
}

// ─── Load KPIs ────────────────────────────────────
function loadKPIs() {
  google.script.run.withSuccessHandler(res => {
    if (res.success) {
      document.getElementById('kpiGovt').textContent       = res.publicCount;
      document.getElementById('kpiPrivate').textContent    = res.privateCount;
      document.getElementById('kpiOutsourced').textContent = res.outsourcedCount;
      document.getElementById('kpiInactive').textContent   = res.inactiveCount;
    }
  }).getSummaryCounts(currentUser);
}

// ─── Excel helper (shared) ────────────────────────
function downloadExcel(headers, objRows, filename) {
  _triggerExcelDownload(headers, objRows, filename);
}

function _triggerExcelDownload(headers, objRows, filename) {
  try {
    const ws_data = [
      headers,
      ...objRows.map(row => headers.map(h => row[h] !== undefined ? row[h] : ''))
    ];
    if (typeof XLSX !== 'undefined') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(ws_data);
      ws['!cols'] = headers.map((h) => ({
        wch: Math.min(
          Math.max(String(h).length, ...objRows.map(r => String(r[h] || '').length)) + 2,
          50
        )
      }));
      XLSX.utils.book_append_sheet(wb, ws, filename.substring(0, 31));
      XLSX.writeFile(wb, filename.replace(/[^a-zA-Z0-9_\-]/g, '_') + '.xlsx');
    } else {
      const csv = ws_data.map(row =>
        row.map(cell => '"' + String(cell || '').replace(/"/g, '""') + '"').join(',')
      ).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename.replace(/[^a-zA-Z0-9_\-]/g, '_') + '.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  } catch (e) {
    alert('Download error: ' + e.message);
  }
}

function _showExportToast(msg) {
  const t = document.getElementById('exportToast');
  if (t) { document.getElementById('exportToastMsg').textContent = msg; t.style.display = 'flex'; }
}
function _hideExportToast() {
  const t = document.getElementById('exportToast');
  if (t) t.style.display = 'none';
}

// ═══════════════════════════════════════════════════
//  DYNAMIC SIDEBAR: LINKS & APPS
// ═══════════════════════════════════════════════════
function loadDashboardLinksApps() {
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) {
        renderImportantLinks([]);
        renderOfficialApps([]);
        renderTeamApps([]);
        return;
      }
      renderImportantLinks(res.importantLinks || []);
      renderOfficialApps(res.officialApps    || []);
      renderTeamApps(res.teamApps            || []);
    })
    .withFailureHandler(() => {
      renderImportantLinks([]);
      renderOfficialApps([]);
      renderTeamApps([]);
    })
    .getLinksAndApps();
}

function renderImportantLinks(links) {
  const el = document.getElementById('dynamicLinksList');
  if (!el) return;
  if (!links.length) {
    el.innerHTML = '<div style="font-size:.78rem;color:var(--t3);padding:6px 0">No links configured. Admin can add via Admin Panel → Links &amp; Apps Manager.</div>';
    return;
  }
  el.innerHTML = links.map(l => `
    <a href="${escHtml(l.url)}" class="link-item" target="_blank">
      <i class="bi bi-link-45deg"></i> ${escHtml(l.name)}
    </a>`).join('');
}

function renderOfficialApps(apps) {
  const el = document.getElementById('dynamicOfficialApps');
  if (!el) return;
  if (!apps.length) {
    el.innerHTML = '<div style="grid-column:1/-1;font-size:.78rem;color:var(--t3);padding:6px 0">No official apps configured.</div>';
    return;
  }
  el.innerHTML = apps.map(a => `
    <a href="${escHtml(a.url)}" class="app-card" target="_blank">
      <i class="bi bi-grid-fill"></i>
      <span class="app-name">${escHtml(a.name)}</span>
      <span class="app-badge badge-official">Official</span>
    </a>`).join('');
}

function renderTeamApps(apps) {
  const el = document.getElementById('dynamicTeamApps');
  if (!el) return;
  if (!apps.length) {
    el.innerHTML = '<div style="grid-column:1/-1;font-size:.78rem;color:var(--t3);padding:6px 0">No team apps configured.</div>';
    return;
  }
  el.innerHTML = apps.map(a => `
    <a href="${escHtml(a.url)}" class="app-card" target="_blank">
      <i class="bi bi-stars" style="color:var(--teal)"></i>
      <span class="app-name">${escHtml(a.name)}</span>
      <span class="app-badge badge-team">Team</span>
    </a>`).join('');
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════
//  DYNAMIC DASHBOARD KPI / MODULE CARDS
// ═══════════════════════════════════════════════════
function loadDashboardKpiCards() {
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success || !res.data || !res.data.length) {
        document.getElementById('dynamicKpiSection').style.display = 'none';
        return;
      }
      renderDashboardKpiCards(res.data);
    })
    .withFailureHandler(() => {
      document.getElementById('dynamicKpiSection').style.display = 'none';
    })
    .getKpiCards();
}

const KPI_CARD_COLOR_VAR = {
  brand: 'var(--brand)', ok: 'var(--ok)', bad: 'var(--bad)',
  warn: 'var(--warn)', purple: 'var(--purple)', teal: 'var(--teal)',
  accent: 'var(--accent)'
};

function renderDashboardKpiCards(cards) {
  const grid    = document.getElementById('dynamicKpiGrid');
  const section = document.getElementById('dynamicKpiSection');
  if (!grid || !section) return;

  const sorted = [...cards].sort((a, b) =>
    (parseInt(a['Display Order']) || 99) - (parseInt(b['Display Order']) || 99)
  );

  grid.innerHTML = sorted.map(c => {
    const color   = KPI_CARD_COLOR_VAR[c['Card Color']] || 'var(--accent)';
    const icon    = c['Card Icon'] || 'grid-fill';
    const title   = escHtml(c['Card Title'] || '');
    const desc    = escHtml(c['Card Description'] || '');
    const aType   = c['Action Type'] || 'module';
    const aVal    = c['Action Value'] || '';
    const safeVal = String(aVal).replace(/'/g, "\\'");

    const clickAttr = aType === 'url'
      ? `onclick="window.open('${safeVal}','_blank')"`
      : `onclick="if (typeof window['${safeVal}'] === 'function') { window['${safeVal}'](); } else { showToast('Module not available: ${safeVal}', false); }"`;

    return `
      <div class="module-card" style="border-top-color:${color}" ${clickAttr}>
        <i class="bi bi-${icon} mc-icon" style="color:${color}"></i>
        <div class="mc-title">${title}</div>
        <div class="mc-desc">${desc}</div>
        <div class="mc-arrow" style="color:${color}">
          <i class="bi bi-arrow-right-circle-fill"></i> Open
        </div>
      </div>`;
  }).join('');

  section.style.display = 'block';
}

// ═══════════════════════════════════════════════
//  TOOLS VIEW
// ═══════════════════════════════════════════════
function openToolsView() {
  switchGlobalTab('toolsView', null);
  document.getElementById('toolsUserContainer').innerHTML = `
    <div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--t3)">
      <span class="spinner-border"></span> Fetching tools...
    </div>`;

  google.script.run.withSuccessHandler(res => {
    const container = document.getElementById('toolsUserContainer');
    if (!res.success) {
      container.innerHTML = `<div style="grid-column:1/-1;color:var(--bad)">Error: ${res.message}</div>`;
      return;
    }
    if (!res.tools || res.tools.length === 0) {
      container.innerHTML = `
        <div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--t3);
                    background:var(--s0);border-radius:var(--r2);border:1px solid var(--b0);">
          <i class="bi bi-box" style="font-size:2rem;display:block;margin-bottom:10px;"></i>
          No tools available yet. Admins can add tools via the Admin Panel.
        </div>`;
      return;
    }
    container.innerHTML = res.tools.map(tool => `
      <a href="${escHtml(tool.url)}" class="tool-pg-card" target="_blank">
        <i class="bi bi-wrench-adjustable-circle-fill"></i>
        <div class="t-name">${escHtml(tool.name)}</div>
        <div class="t-arrow">Launch Tool <i class="bi bi-arrow-right"></i></div>
      </a>
    `).join('');
  }).getToolsUser();
}

// ═══════════════════════════════════════════════════════════════════
//  ROUTER — hash-based navigation
// ═══════════════════════════════════════════════════════════════════
const ROUTES = {
  home:                () => switchGlobalTab('homeView', document.getElementById('navHomeBtn')),
  admin:               () => { if (typeof _rawOpenAdmin   === 'function') _rawOpenAdmin();          },
  tools:               () => { if (typeof _rawOpenTools   === 'function') _rawOpenTools();          },
  hr:                  () => { if (typeof _rawOpenHr      === 'function') _rawOpenHr();             },
  'public-Public':     () => { if (typeof _rawOpenPublic  === 'function') _rawOpenPublic('Public'); },
  'public-OutSourced': () => { if (typeof _rawOpenPublic  === 'function') _rawOpenPublic('Out Sourced School'); },
  'private-Private':   () => { if (typeof _rawOpenPrivate === 'function') _rawOpenPrivate('Private'); },
  'private-Inactive':  () => { if (typeof _rawOpenPrivate === 'function') _rawOpenPrivate('Inactive'); },
};

let _navInFlight = false;

function navigateTo(routeKey, push = true) {
  const fn = ROUTES[routeKey];
  if (!fn) return;
  _navInFlight = true;
  try { fn(); } finally { _navInFlight = false; }
  if (push) history.pushState({ route: routeKey }, '', '#' + routeKey);
}

window.addEventListener('popstate', e => {
  if (!e.state || e.state.page === 'login') {
    if (currentUser) {
      currentUser = null;
      document.getElementById('appWrapper').style.display = 'none';
      document.getElementById('loginView').style.display  = 'flex';
    }
    return;
  }
  if (!currentUser) return;
  const routeKey = e.state.route || 'home';
  navigateTo(routeKey, false);
});

let _rawOpenPublic  = null;
let _rawOpenPrivate = null;
let _rawOpenHr      = null;
let _rawOpenAdmin   = null;
let _rawOpenTools   = null;

function _installRouterWrappers() {
  _rawOpenPublic  = window.openPublicModule;
  _rawOpenPrivate = window.openPrivateModule;
  _rawOpenHr      = window.openHrModule;
  _rawOpenAdmin   = window.openAdminModule;
  _rawOpenTools   = window.openToolsView;

  if (typeof _rawOpenPublic === 'function') {
    window.openPublicModule = function(sheetName) {
      _rawOpenPublic(sheetName);
      if (!_navInFlight) {
        const key = (sheetName === 'Out Sourced School') ? 'public-OutSourced' : 'public-Public';
        history.pushState({ route: key }, '', '#' + key);
      }
    };
  }

  if (typeof _rawOpenPrivate === 'function') {
    window.openPrivateModule = function(sheetName) {
      _rawOpenPrivate(sheetName);
      if (!_navInFlight) {
        const key = (sheetName === 'Inactive') ? 'private-Inactive' : 'private-Private';
        history.pushState({ route: key }, '', '#' + key);
      }
    };
  }

  if (typeof _rawOpenHr === 'function') {
    window.openHrModule = function() {
      _rawOpenHr();
      if (!_navInFlight) history.pushState({ route: 'hr' }, '', '#hr');
    };
  }

  if (typeof _rawOpenAdmin === 'function') {
    window.openAdminModule = function() {
      _rawOpenAdmin();
      if (!_navInFlight) history.pushState({ route: 'admin' }, '', '#admin');
    };
  }

  if (typeof _rawOpenTools === 'function') {
    window.openToolsView = function() {
      _rawOpenTools();
      if (!_navInFlight) history.pushState({ route: 'tools' }, '', '#tools');
    };
  }

  const homeBtn = document.getElementById('navHomeBtn');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      if (!_navInFlight) history.pushState({ route: 'home' }, '', '#home');
    });
  }
}

window.addEventListener('load', _installRouterWrappers);
