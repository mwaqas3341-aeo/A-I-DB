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

  // ── Seed the history stack so the browser back button never exits the app ──
  // If a hash route exists (e.g. user refreshed on #hr), restore it;
  // otherwise land on home and replace so there is no extra entry before login.
  const startRoute = location.hash ? location.hash.slice(1) : 'home';
  history.replaceState({ route: 'home' }, '', '#home');   // bottom of stack = home
  if (startRoute !== 'home') {
    navigateTo(startRoute, true);                          // push the requested view on top
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
  document.getElementById('appWrapper').style.display = 'none';
  document.getElementById('loginView').style.display  = 'flex';
  document.getElementById('pass').value = '';
  // Clear the hash so back/forward history resets cleanly at login
  history.replaceState(null, '', location.pathname);
  showToast('Logged out successfully', true);
}// ─── Load KPIs ────────────────────────────────────
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
//  (driven by Admin Panel → Dashboard Cards manager)
//  Does NOT touch the hardcoded entry-card or the 3
//  hardcoded Portal Modules cards above — this only
//  adds an optional "Quick Access" section beneath them.
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

  // Sort by Display Order ascending (lowest first), same convention as admin panel
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
//  ROUTER — hash-based navigation (back/forward button support)
//
//  HOW IT WORKS
//  ────────────
//  • Every view change pushes a history entry (#home, #hr, etc.)
//  • Browser back/forward fires popstate → we switch views in-app
//  • On login we seed the stack:  [#home]  so back never exits the app
//  • Module functions (openHrModule, openPublicModule …) are wrapped
//    ONCE after DOMContentLoaded so ANY caller (nav buttons, KPI cards,
//    onclick attributes in HTML) automatically records the navigation —
//    no changes to index.html or other JS files are needed.
//
//  _navInFlight flag prevents the wrapper from double-pushing state
//  when the route is triggered by the router itself (popstate path).
// ═══════════════════════════════════════════════════════════════════

// Raw route handlers — these call the actual view functions.
// navigateTo() uses these; the wrappers below call the raw originals.
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

// Set to true while the router is driving a navigation so wrappers
// know not to push a second history entry for the same action.
let _navInFlight = false;

// Core navigate function — all navigation should flow through here.
function navigateTo(routeKey, push = true) {
  const fn = ROUTES[routeKey];
  if (!fn) return;
  _navInFlight = true;
  try { fn(); } finally { _navInFlight = false; }
  if (push) history.pushState({ route: routeKey }, '', '#' + routeKey);
}

// Back / Forward button handler
window.addEventListener('popstate', e => {
  // Only act if the user is actually logged in (app is visible)
  if (!currentUser) return;
  const routeKey = (e.state && e.state.route)
    || (location.hash ? location.hash.slice(1) : 'home');
  navigateTo(routeKey, false);   // false = don't push, we're already here
});

// ── Wrap module-opener functions so ANY call (from onclick attrs,
//    KPI cards, sidebar buttons) automatically records history.
//    Called once from DOMContentLoaded after all scripts have loaded.
// ─────────────────────────────────────────────────────────────────
let _rawOpenPublic  = null;
let _rawOpenPrivate = null;
let _rawOpenHr      = null;
let _rawOpenAdmin   = null;
let _rawOpenTools   = null;

function _installRouterWrappers() {
  // Save references to the originals (defined in other JS files)
  _rawOpenPublic  = window.openPublicModule;
  _rawOpenPrivate = window.openPrivateModule;
  _rawOpenHr      = window.openHrModule;
  _rawOpenAdmin   = window.openAdminModule;
  _rawOpenTools   = window.openToolsView;

  // openPublicModule(sheetName)
  if (typeof _rawOpenPublic === 'function') {
    window.openPublicModule = function(sheetName) {
      _rawOpenPublic(sheetName);
      if (!_navInFlight) {
        const key = (sheetName === 'Out Sourced School') ? 'public-OutSourced' : 'public-Public';
        history.pushState({ route: key }, '', '#' + key);
      }
    };
  }

  // openPrivateModule(sheetName)
  if (typeof _rawOpenPrivate === 'function') {
    window.openPrivateModule = function(sheetName) {
      _rawOpenPrivate(sheetName);
      if (!_navInFlight) {
        const key = (sheetName === 'Inactive') ? 'private-Inactive' : 'private-Private';
        history.pushState({ route: key }, '', '#' + key);
      }
    };
  }

  // openHrModule()
  if (typeof _rawOpenHr === 'function') {
    window.openHrModule = function() {
      _rawOpenHr();
      if (!_navInFlight) history.pushState({ route: 'hr' }, '', '#hr');
    };
  }

  // openAdminModule()
  if (typeof _rawOpenAdmin === 'function') {
    window.openAdminModule = function() {
      _rawOpenAdmin();
      if (!_navInFlight) history.pushState({ route: 'admin' }, '', '#admin');
    };
  }

  // openToolsView()
  if (typeof _rawOpenTools === 'function') {
    window.openToolsView = function() {
      _rawOpenTools();
      if (!_navInFlight) history.pushState({ route: 'tools' }, '', '#tools');
    };
  }

  // Home button — intercept click so navigating home is also tracked.
  // Works alongside any existing onclick on the button.
  const homeBtn = document.getElementById('navHomeBtn');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      if (!_navInFlight) history.pushState({ route: 'home' }, '', '#home');
    });
  }
}

// Install wrappers after all scripts have parsed.
// 'load' fires after DOMContentLoaded and after all <script> tags finish,
// so the module functions from other JS files are guaranteed to exist.
window.addEventListener('load', _installRouterWrappers);
