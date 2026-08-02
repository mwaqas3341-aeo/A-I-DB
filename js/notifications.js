// =====================================================================
//  NOTIFICATIONS.JS  —  Main dashboard notification bell
//  ─────────────────────────────────────────────────────────────────
//  Aggregates everything the SYSTEM changed on its own (not a manual
//  HR action) so every user can see it from one place instead of
//  discovering it by accident:
//    • A school marked outsourced/closed, moving its staff into
//      Awaiting Posting
//    • Any staff member moved into Awaiting Posting for any reason
//    • Staff auto-retired at age 60 by the nightly job
//    • Private School registration / building / health & hygiene
//      certificate expiries — previously a floating popup shown on
//      every login (js/expiry-alerts.js); that auto-popup is now
//      disabled and its data feeds into this panel instead.
//
//  Unread counting: there's no server-side read/unread table, so the
//  badge compares each notification's timestamp against a per-user
//  "last seen" mark stored in localStorage. Opening the panel marks
//  everything currently shown as seen.
// =====================================================================

let _notifCache = null;       // last fetched, merged + sorted notification list
let _notifLoading = false;

const NOTIF_CATEGORY_META = {
  school_change:     { label: 'School Changes',           icon: 'bi-building-dash',      color: '#F59E0B' },
  awaiting_posting:  { label: 'Moved to Awaiting Posting', icon: 'bi-person-walking',     color: '#EF4444' },
  auto_retired:       { label: 'Auto-Retired by System',   icon: 'bi-person-x-fill',      color: '#8B5CF6' },
  incomplete_info:     { label: 'Incomplete Staff Information', icon: 'bi-exclamation-diamond-fill', color: '#F43F5E' },
  expiry_reg:          { label: 'Private School — Registration Expired',           icon: 'bi-file-earmark-x-fill', color: '#EF4444' },
  expiry_bldg:         { label: 'Private School — Building Certificate Expired',   icon: 'bi-building-x',          color: '#F97316' },
  expiry_hlth:         { label: 'Private School — Health & Hygiene Cert Expired',  icon: 'bi-heart-pulse-fill',    color: '#EAB308' },
};

function _notifSeenKey() {
  const u = (typeof currentUser !== 'undefined' && currentUser && currentUser.cnic) ? currentUser.cnic : 'anon';
  return 'notifLastSeen:' + u;
}
function _notifLastSeen() {
  try { return localStorage.getItem(_notifSeenKey()) || ''; } catch (e) { return ''; }
}
function _notifMarkSeenNow() {
  try { localStorage.setItem(_notifSeenKey(), new Date().toISOString()); } catch (e) { /* ignore */ }
  _updateNotifBadge();
}

function _notifEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _notifTimeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Fetch + merge every source into one sorted list ─────────────────
function _fetchAllNotifications(callback) {
  let systemNotifs = [];
  let expiryGroups = { regExpired: [], bldgExpired: [], hlthExpired: [] };
  let incompleteRows = [];
  let pending = 3;
  function done() {
    pending--;
    if (pending > 0) return;

    const merged = systemNotifs.slice();
    incompleteRows.slice(0, 30).forEach(r => merged.push({
      id: 'inc_' + (r['PERSONAL NO.'] || r.personal_no || Math.random()),
      category: 'incomplete_info',
      title: 'Incomplete school posting info: ' + (r['NAME OF TEACHER'] || r.name_of_teacher || 'Unknown'),
      detail: 'Personal No. ' + (r['PERSONAL NO.'] || r.personal_no || '—') +
               ' has a School EMIS Code that doesn\'t match any known school — record needs review.',
      time: null,
    }));
    expiryGroups.regExpired.forEach(r => merged.push({
      id: 'exp_reg_' + r.name + r.expiry, category: 'expiry_reg',
      title: 'Registration expired: ' + r.name,
      detail: r.location + ' — expired ' + r.expiry, time: null,
    }));
    expiryGroups.bldgExpired.forEach(r => merged.push({
      id: 'exp_bldg_' + r.name + r.expiry, category: 'expiry_bldg',
      title: 'Building certificate expired: ' + r.name,
      detail: r.location + ' — expired ' + r.expiry, time: null,
    }));
    expiryGroups.hlthExpired.forEach(r => merged.push({
      id: 'exp_hlth_' + r.name + r.expiry, category: 'expiry_hlth',
      title: 'Health & Hygiene certificate expired: ' + r.name,
      detail: r.location + ' — expired ' + r.expiry, time: null,
    }));
    // System events (with a real timestamp) first, then expiry items (no timestamp) after.
    merged.sort((a, b) => {
      if (a.time && b.time) return new Date(b.time) - new Date(a.time);
      if (a.time) return -1;
      if (b.time) return 1;
      return 0;
    });
    _notifCache = merged;
    callback(merged);
  }

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run
      .withSuccessHandler(res => { if (res && res.success) systemNotifs = res.notifications || []; done(); })
      .withFailureHandler(() => done())
      .getSystemNotifications();
  } else { done(); }

  if (typeof window.eaGetAlerts === 'function') {
    window.eaGetAlerts(groups => { expiryGroups = groups || expiryGroups; done(); });
  } else { done(); }

  if (typeof google !== 'undefined' && google.script && google.script.run &&
      typeof currentUser !== 'undefined' && currentUser) {
    google.script.run
      .withSuccessHandler(res => { if (res && res.success) incompleteRows = res.rows || []; done(); })
      .withFailureHandler(() => done())
      .getStaffEmisNotInPublicSchools(currentUser);
  } else { done(); }
}

function _updateNotifBadge() {
  const badge = document.getElementById('navNotifBadge');
  if (!badge) return;
  const list = _notifCache || [];
  const lastSeen = _notifLastSeen();
  const unread = lastSeen
    ? list.filter(n => n.time && n.time > lastSeen).length
    : list.length; // never opened before -> everything currently known counts
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// Lightweight background refresh just for the badge count (no panel render).
function refreshNotificationBadge() {
  _fetchAllNotifications(() => _updateNotifBadge());
}

function toggleNotificationsPanel() {
  const panel = document.getElementById('navNotifPanel');
  if (!panel) return;
  const isHidden = panel.classList.contains('hidden');
  if (!isHidden) { panel.classList.add('hidden'); return; }

  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="nav-notif-header">
      <span class="nav-notif-header-title"><i class="bi bi-bell-fill"></i> Notifications</span>
      <button class="nav-notif-close" onclick="toggleNotificationsPanel()" title="Close"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="nav-notif-body" id="navNotifBody"><div class="nav-notif-loading"><span class="spinner-border spinner-border-sm"></span> Loading…</div></div>`;

  _fetchAllNotifications(list => {
    _renderNotifBody(list);
    _notifMarkSeenNow();
  });
}

function _renderNotifBody(list) {
  const body = document.getElementById('navNotifBody');
  if (!body) return;
  if (!list.length) {
    body.innerHTML = `<div class="nav-notif-empty"><i class="bi bi-check-circle-fill"></i>No new system notifications.</div>`;
    return;
  }

  // Group in display order, skipping empty categories.
  const order = ['school_change', 'awaiting_posting', 'auto_retired', 'incomplete_info', 'expiry_reg', 'expiry_bldg', 'expiry_hlth'];
  let html = '';
  order.forEach(cat => {
    const items = list.filter(n => n.category === cat);
    if (!items.length) return;
    const meta = NOTIF_CATEGORY_META[cat] || { label: cat, icon: 'bi-bell', color: '#94a3b8' };
    html += `<div class="nav-notif-group-label">${_notifEsc(meta.label)} (${items.length})</div>`;
    html += items.slice(0, 20).map(n => `
      <div class="nav-notif-row">
        <div class="nav-notif-row-icon" style="background:${meta.color}22;color:${meta.color}"><i class="bi ${meta.icon}"></i></div>
        <div class="nav-notif-row-body">
          <div class="nav-notif-row-title">${_notifEsc(n.title)}</div>
          <div class="nav-notif-row-detail">${_notifEsc(n.detail)}</div>
          ${n.time ? `<div class="nav-notif-row-time">${_notifTimeAgo(n.time)}</div>` : ''}
        </div>
      </div>`).join('');
  });
  body.innerHTML = html;
}

// Close the panel on an outside click. Per request, notifications are
// no longer fetched automatically on login/session-restore — the bell
// stays visible with no badge until the user actually presses it,
// which is the only thing that triggers a backend fetch now.
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', e => {
    const wrap = document.getElementById('navNotifWrap');
    const panel = document.getElementById('navNotifPanel');
    if (!wrap || !panel || panel.classList.contains('hidden')) return;
    if (!wrap.contains(e.target)) panel.classList.add('hidden');
  });
});
