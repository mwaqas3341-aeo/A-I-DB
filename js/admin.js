// ── Admin module JS ──
// ═══════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════
let userHeaders = [], userData = [];
let linksHeaders = [], linksData = [];
let toolsHeaders = [], toolsData = [];
let kpiCardsData  = [];
let jDropdowns   = { districts:[], tehsils:[], wings:[], markazes:[], schools:[], jMap:[] };
let jLoaded      = false;
let jSchoolsLoaded = false;   // tracks lazy-loaded "Schools" scope picker data

let userModalInst, deleteUserModalInst, linksModalInst, toolModalInst, deleteModalInst, kpiCardModalInst;
let pendingDeleteRow = null, pendingDeleteType = null;
let pendingDeleteUserRow = null;

const UH = {
  PERSONAL_NO: 'Personal No.',
  NAME:        'Name',
  MARKAZ:      'Markaz Name',
  MARKAZ_UR:   'Markaz Name (Urdu)',
  DESIGNATION_UR: 'Designation (Urdu)',
  CELL:        'Cell No',
  CNIC:        'CNIC',
  PASSWORD:    'Password',
  ROLE:        'Role',
  DISTRICT:    'District',
  WING:        'Wing',
  TEHSIL:      'Tehsil',
  SCOPE_TYPE:  'Scope Type',
  SCOPE_VALUE: 'Scope Value',
  ACCESS_TYPE: 'Access Type',
  EMAIL:       'Email',
  PAGE_NO:     'Page No',
  DDEO_CODE:   'DDEO Code',
  BPS_SCALE:   'BPS Scale',
  DY_OFFICE:   'Dy Office Detail',  // read-only, DB-generated — never sent on save
  RECEIVES_BUDGET_COPY: 'Receives Budget Copy',
};
const LA_COL = { LINK_NAME:0, LINK_URL:1, APP_NAME:2, APP_URL:3, APP_CATEGORY:4, LINK_CATEGORY:5 };

const KPI_COLOR_HEX = {
  brand:'#1a56db', ok:'#059669', bad:'#dc2626',
  warn:'#d97706', purple:'#7c3aed', teal:'#0d9488', accent:'#0ea5e9'
};

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  userModalInst       = new bootstrap.Modal(document.getElementById('userModal'));
  deleteUserModalInst = new bootstrap.Modal(document.getElementById('deleteUserModal'));
  linksModalInst      = new bootstrap.Modal(document.getElementById('linksModal'));
  toolModalInst       = new bootstrap.Modal(document.getElementById('toolModal'));
  deleteModalInst     = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
  kpiCardModalInst    = new bootstrap.Modal(document.getElementById('kpiCardModal'));
  generalListModalInst = new bootstrap.Modal(document.getElementById('generalListModal'));

  // Generic delete handler (links / tools / kpi)
  document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
    if (pendingDeleteRow === null) return;
    const btn = document.getElementById('confirmDeleteBtn');
    btn.disabled = true; btn.innerHTML = 'Deleting…';
    const done = res => {
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-trash-fill"></i> Delete';
      deleteModalInst.hide();
      if (res.success) {
        showToast('Deleted.');
        if (pendingDeleteType === 'tools')      loadToolsTableAdmin();
        else if (pendingDeleteType === 'kpi')   { loadKpiCardsTable(); if (typeof loadDashboardKpiCards === 'function') loadDashboardKpiCards(); }
        else if (pendingDeleteType === 'designation') { loadGeneralList('designation'); if (typeof refreshDesignationOptions === 'function') refreshDesignationOptions(); }
        else if (pendingDeleteType === 'category')    { loadGeneralList('category');    if (typeof refreshPrivateCategoryOptions === 'function') refreshPrivateCategoryOptions(); }
        else { loadLinksAppsTable(); if (typeof loadDashboardLinksApps === 'function') loadDashboardLinksApps(); }
      } else showToast(res.message || 'Delete failed.', false);
    };
    if (pendingDeleteType === 'tools')
      google.script.run.withSuccessHandler(done).deleteToolRow(pendingDeleteRow, currentUser);
    else if (pendingDeleteType === 'kpi')
      google.script.run.withSuccessHandler(done).deleteKpiCard(pendingDeleteRow, currentUser);
    else if (pendingDeleteType === 'designation')
      google.script.run.withSuccessHandler(done).deleteDesignationRow(pendingDeleteRow, currentUser);
    else if (pendingDeleteType === 'category')
      google.script.run.withSuccessHandler(done).deleteCategoryRow(pendingDeleteRow, currentUser);
    else
      google.script.run.withSuccessHandler(done).deleteLinksAppsRow(pendingDeleteRow, currentUser);
  });

  // User delete confirm
  document.getElementById('confirmDeleteUserBtn').addEventListener('click', () => {
    if (!pendingDeleteUserRow) return;
    const btn = document.getElementById('confirmDeleteUserBtn');
    btn.disabled = true; btn.innerHTML = 'Deleting…';
    google.script.run
      .withSuccessHandler(res => {
        btn.disabled = false; btn.innerHTML = '<i class="bi bi-person-x-fill"></i> Delete User';
        deleteUserModalInst.hide();
        if (res.success) { showToast(res.message); loadUsers(); }
        else showToast(res.message || 'Delete failed.', false);
      })
      .withFailureHandler(err => {
        btn.disabled = false; btn.innerHTML = '<i class="bi bi-person-x-fill"></i> Delete User';
        showToast('Error: ' + err.message, false);
      })
      .deleteUser(pendingDeleteUserRow, currentUser);
  });
});

// ═══════════════════════════════════════════════
//  TAB SWITCHER
// ═══════════════════════════════════════════════
function switchAdminTab(tab, btn) {
  document.getElementById('adminPanelUsers').style.display   = tab === 'users'   ? 'block' : 'none';
  document.getElementById('adminPanelLinks').style.display   = tab === 'links'   ? 'block' : 'none';
  document.getElementById('adminPanelTools').style.display   = tab === 'tools'   ? 'block' : 'none';
  document.getElementById('adminPanelKpi').style.display     = tab === 'kpi'     ? 'block' : 'none';
  document.getElementById('adminPanelGeneral').style.display = tab === 'general' ? 'block' : 'none';
  document.querySelectorAll('.admin-sub-tab').forEach(b => b.classList.remove('active-admin-tab'));
  if (btn) btn.classList.add('active-admin-tab');
  if (tab === 'links')   loadLinksAppsTable();
  if (tab === 'tools')   loadToolsTableAdmin();
  if (tab === 'kpi')     loadKpiCardsTable();
  if (tab === 'general') loadGeneralList('designation');
}

// ═══════════════════════════════════════════════
//  GENERAL MANAGEMENT — Staff Designations & Private School Categories
// ═══════════════════════════════════════════════
// Both are just an admin-managed name list (Name + Display Order +
// Active) — same shape, same CRUD, just a different backend table —
// so one set of functions backs both instead of duplicating the panel.
const GENERAL_LIST_CONFIG = {
  designation: {
    label: 'Designation', getAdmin: 'getStaffDesignationsAdmin', save: 'saveDesignationRow', del: 'deleteDesignationRow',
    tbody: 'designationTBody', thead: 'designationTHead', searchCount: 'designationSearchCount',
  },
  category: {
    label: 'Category', getAdmin: 'getPrivateCategoriesAdmin', save: 'saveCategoryRow', del: 'deleteCategoryRow',
    tbody: 'categoryTBody', thead: 'categoryTHead', searchCount: 'categorySearchCount',
  },
};
let generalListData = { designation: [], category: [] };
let generalListLoaded = { designation: false, category: false };

function switchGeneralTab(kind, btn) {
  document.getElementById('genPanelDesignations').style.display = kind === 'designation' ? 'block' : 'none';
  document.getElementById('genPanelCategories').style.display   = kind === 'category'    ? 'block' : 'none';
  document.querySelectorAll('.general-sub-tab').forEach(b => b.classList.remove('active-admin-tab'));
  btn.classList.add('active-admin-tab');
  if (!generalListLoaded[kind]) loadGeneralList(kind);
}

function loadGeneralList(kind) {
  const cfg = GENERAL_LIST_CONFIG[kind];
  document.getElementById(cfg.tbody).innerHTML =
    '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--t3)"><span class="spinner-border spinner-border-sm"></span> Loading…</td></tr>';
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast(res.message || 'Load failed.', false); return; }
      generalListData[kind] = res.data;
      generalListLoaded[kind] = true;
      renderGeneralTable(kind, res.headers, res.data);
    })
    .withFailureHandler(err => showToast('Error: ' + err.message, false))
    [cfg.getAdmin]();
}

function renderGeneralTable(kind, headers, data) {
  const cfg = GENERAL_LIST_CONFIG[kind];
  document.getElementById(cfg.thead).innerHTML =
    `<tr><th>Actions</th><th>Name</th><th>Display Order</th><th>Active</th></tr>`;
  document.getElementById(cfg.tbody).innerHTML = data.map(row => `
    <tr>
      <td style="display:flex;gap:4px">
        <button class="tbl-btn btn-edit" style="border-color:#b45309;color:#b45309;background:#fffbeb"
          onclick="editGeneralListRow('${kind}','${row._id}')"><i class="bi bi-pencil"></i></button>
        <button class="tbl-btn" style="border-color:var(--bad);color:var(--bad);background:var(--bad-bg)"
          onclick="confirmDeleteGeneralRow('${kind}','${row._id}')"><i class="bi bi-trash"></i></button>
      </td>
      <td style="font-weight:700;color:var(--t1)">${escHtml(row['Name'])}</td>
      <td>${row['Display Order']}</td>
      <td>${row['Active'] === 'No'
        ? '<span style="color:var(--t3)">Hidden</span>'
        : '<span style="color:var(--ok)">Shown</span>'}</td>
    </tr>`).join('') || `<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--t3)">No ${cfg.label.toLowerCase()}s yet.</td></tr>`;
}

function filterGeneralTable(kind, query) {
  const cfg = GENERAL_LIST_CONFIG[kind];
  const q = query.trim().toLowerCase();
  const countEl = document.getElementById(cfg.searchCount);
  const rows = document.querySelectorAll(`#${cfg.tbody} tr`);
  if (!q) { rows.forEach(tr => tr.style.display = ''); countEl.textContent = ''; return; }
  let visible = 0;
  rows.forEach(tr => {
    const show = tr.textContent.toLowerCase().includes(q);
    tr.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  countEl.textContent = `${visible} of ${rows.length}`;
}

function openGeneralListModal(kind) {
  const cfg = GENERAL_LIST_CONFIG[kind];
  document.getElementById('glModalTitle').textContent = `Add ${cfg.label}`;
  document.getElementById('glModalSub').textContent = kind === 'designation' ? 'Staff Designations' : 'Private School Categories';
  document.getElementById('gl_name').value  = '';
  document.getElementById('gl_order').value = '99';
  document.getElementById('gl_active').value = 'Yes';
  document.getElementById('gl_kind').value = kind;
  document.getElementById('gl_rowIndex').value = '';
  generalListModalInst.show();
}

function editGeneralListRow(kind, ri) {
  const cfg = GENERAL_LIST_CONFIG[kind];
  const row = generalListData[kind].find(r => String(r._id) === String(ri));
  if (!row) return;
  document.getElementById('glModalTitle').textContent = `Edit ${cfg.label}`;
  document.getElementById('glModalSub').textContent = kind === 'designation' ? 'Staff Designations' : 'Private School Categories';
  document.getElementById('gl_name').value  = row['Name'] || '';
  document.getElementById('gl_order').value = row['Display Order'] || '99';
  document.getElementById('gl_active').value = row['Active'] || 'Yes';
  document.getElementById('gl_kind').value = kind;
  document.getElementById('gl_rowIndex').value = ri;
  generalListModalInst.show();
}

function submitGeneralListRow() {
  const kind = document.getElementById('gl_kind').value;
  const cfg  = GENERAL_LIST_CONFIG[kind];
  const name = document.getElementById('gl_name').value.trim();
  if (!name) { showToast('Name is required.', false); return; }

  const rowData = {
    'Name': name,
    'Display Order': document.getElementById('gl_order').value.trim() || '99',
    'Active': document.getElementById('gl_active').value,
  };
  const ri  = document.getElementById('gl_rowIndex').value || null;
  const btn = document.getElementById('saveGeneralListBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving…';

  google.script.run
    .withSuccessHandler(res => {
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy-fill"></i> Save';
      if (res.success) {
        generalListModalInst.hide();
        showToast(res.message || 'Saved!');
        loadGeneralList(kind);
        // Keep the live forms in sync immediately — no page reload needed.
        if (kind === 'designation' && typeof refreshDesignationOptions === 'function') refreshDesignationOptions();
        if (kind === 'category' && typeof refreshPrivateCategoryOptions === 'function') refreshPrivateCategoryOptions();
      } else showToast(res.message || 'Save failed.', false);
    })
    .withFailureHandler(err => {
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy-fill"></i> Save';
      showToast('Error: ' + err.message, false);
    })
    [cfg.save](rowData, ri, currentUser);
}

function confirmDeleteGeneralRow(kind, ri) {
  pendingDeleteRow = ri;
  pendingDeleteType = kind; // 'designation' | 'category'
  deleteModalInst.show();
}

function openAdminModule() {
  switchGlobalTab('adminDataView', null);
  document.getElementById('userTBody').innerHTML =
    '<tr><td colspan="10" style="padding:20px;text-align:center;color:var(--t3)">Loading users…</td></tr>';
  loadUsers();
  loadJurisdictionDropdowns();
}

// ═══════════════════════════════════════════════
//  JURISDICTION DROPDOWNS
// ═══════════════════════════════════════════════
function loadJurisdictionDropdowns(callback) {
  if (jLoaded) { if (callback) callback(); return; }
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast('Could not load jurisdiction data: ' + res.message, false); return; }
      jDropdowns = res;
      jDropdowns.schools = jDropdowns.schools || [];
      jLoaded    = true;
      populateStaticDropdowns();
      if (callback) callback();
    })
    .withFailureHandler(err => showToast('Jurisdiction load error: ' + err.message, false))
    .getJurisdictionDropdownData(currentUser);
}

function populateStaticDropdowns() {
  const setOptions = (id, items) => {
    const el = document.getElementById(id);
    if (!el) return;
    const existing = el.value;
    el.innerHTML = `<option value="">Select</option>` +
      items.map(v => `<option value="${v}">${v}</option>`).join('');
    if (existing) el.value = existing;
  };
  setOptions('u_district', jDropdowns.districts);
  setOptions('u_tehsil',   jDropdowns.tehsils);
  setOptions('u_markaz',   jDropdowns.markazes);
}

function filterMarkazDropdown() {
  if (!jDropdowns || !jDropdowns.jMap) return;
  const selDistrict = document.getElementById('u_district').value;
  const selWing     = document.getElementById('u_wing').value;
  const selTehsil   = document.getElementById('u_tehsil').value;

  const filteredMap = jDropdowns.jMap.filter(item => {
    return (!selDistrict || item.district === selDistrict) &&
           (!selWing     || item.wing === selWing) &&
           (!selTehsil   || item.tehsil === selTehsil);
  });

  const validMarkazes = [...new Set(filteredMap.map(i => i.markaz))].sort();
  const markazEl      = document.getElementById('u_markaz');
  const currentVal    = markazEl.value;
  const optionsList   = (selDistrict || selWing || selTehsil) ? validMarkazes : jDropdowns.markazes;

  markazEl.innerHTML = '<option value="">Select Markaz</option>' +
    optionsList.map(m => `<option value="${m}">${m}</option>`).join('');
  if (optionsList.includes(currentVal)) markazEl.value = currentVal;
}

// ═══════════════════════════════════════════════
//  SCOPE VALUE UI – MULTI‑SELECT WITH FILTERING
// ═══════════════════════════════════════════════
function renderScopeValueUI(existingValue) {
  const type = document.getElementById('u_scope_type').value;
  const area = document.getElementById('scopeValueArea');
  const prev = document.getElementById('scopePreviewWrap');
  prev.style.display = 'none';
  area.innerHTML = '';

  // Get current user's primary jurisdiction (from the user being edited, or from currentUser if adding)
  const primary = {
    district: document.getElementById('u_district').value || (currentUser ? currentUser.district : ''),
    wing:     document.getElementById('u_wing').value || (currentUser ? currentUser.wing : ''),
    tehsil:   document.getElementById('u_tehsil').value || (currentUser ? currentUser.tehsil : ''),
    markaz:   document.getElementById('u_markaz').value || (currentUser ? currentUser.markaz : '')
  };

  // Helper: filter jMap based on primary location
  function filterMap(conditions) {
    return jDropdowns.jMap.filter(item => {
      return (!conditions.district || item.district === conditions.district) &&
             (!conditions.wing     || item.wing === conditions.wing) &&
             (!conditions.tehsil   || item.tehsil === conditions.tehsil) &&
             (!conditions.markaz   || item.markaz === conditions.markaz);
    });
  }

  // Helper: build tag input with filtered items (single-value tags —
  // used by Markaz / District scope types)
  function buildTagInput(items, placeholder, existing) {
    return `
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <select id="scope_picker" style="flex:1;height:38px;border:1px solid var(--b0);border-radius:6px;padding:0 10px;font-size:.85rem">
          <option value="">— Pick ${placeholder} —</option>
          ${items.map(v => `<option value="${v}">${v}</option>`).join('')}
        </select>
        <button type="button" onclick="addScopeTag('${placeholder}')"
          style="height:38px;padding:0 14px;background:var(--brand);color:#fff;border:none;border-radius:6px;font-size:.82rem;cursor:pointer">
          <i class="bi bi-plus-lg"></i> Add
        </button>
      </div>
      <div id="scope_tags" style="display:flex;flex-wrap:wrap;gap:6px;min-height:24px"></div>
      <input type="hidden" id="scope_value_hidden">
    `;
  }

  // Helper: build a THREE-select paired tag input — used by Tehsil
  // scope type. District narrows the Tehsil list; only Tehsil+Wing end
  // up in the stored value (District is just for filtering the pick).
  function buildDistrictFilteredTehsilInput(districts, wings) {
    return `
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <select id="scope_tehsil_district" onchange="filterScopeTehsilOptions()" style="flex:1;height:38px;border:1px solid var(--b0);border-radius:6px;padding:0 10px;font-size:.85rem">
          <option value="">— Pick District —</option>
          ${districts.map(v => `<option value="${v}">${v}</option>`).join('')}
        </select>
        <select id="scope_pair_primary" style="flex:1;height:38px;border:1px solid var(--b0);border-radius:6px;padding:0 10px;font-size:.85rem">
          <option value="">— Pick District first —</option>
        </select>
        <select id="scope_pair_secondary" style="flex:1;height:38px;border:1px solid var(--b0);border-radius:6px;padding:0 10px;font-size:.85rem">
          <option value="">— Pick Wing —</option>
          ${wings.map(v => `<option value="${v}">${v}</option>`).join('')}
        </select>
        <button type="button" onclick="addScopePairTag()"
          style="height:38px;padding:0 14px;background:var(--brand);color:#fff;border:none;border-radius:6px;font-size:.82rem;cursor:pointer">
          <i class="bi bi-plus-lg"></i> Add
        </button>
      </div>
      <div id="scope_tags" style="display:flex;flex-wrap:wrap;gap:6px;min-height:24px"></div>
      <input type="hidden" id="scope_value_hidden">
    `;
  }

  // Helper: build a TWO-select paired tag input — used by Wing / Tehsil
  // scope types, which now store "Primary:Secondary" pairs (e.g.
  // "Layyah:M-EE" for Wing scope, "Kot Addu:W-EE" for Tehsil scope).
  function buildPairTagInput(primaryItems, secondaryItems, primaryLabel, secondaryLabel) {
    return `
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <select id="scope_pair_primary" style="flex:1;height:38px;border:1px solid var(--b0);border-radius:6px;padding:0 10px;font-size:.85rem">
          <option value="">— Pick ${primaryLabel} —</option>
          ${primaryItems.map(v => `<option value="${v}">${v}</option>`).join('')}
        </select>
        <select id="scope_pair_secondary" style="flex:1;height:38px;border:1px solid var(--b0);border-radius:6px;padding:0 10px;font-size:.85rem">
          <option value="">— Pick ${secondaryLabel} —</option>
          ${secondaryItems.map(v => `<option value="${v}">${v}</option>`).join('')}
        </select>
        <button type="button" onclick="addScopePairTag()"
          style="height:38px;padding:0 14px;background:var(--brand);color:#fff;border:none;border-radius:6px;font-size:.82rem;cursor:pointer">
          <i class="bi bi-plus-lg"></i> Add
        </button>
      </div>
      <div id="scope_tags" style="display:flex;flex-wrap:wrap;gap:6px;min-height:24px"></div>
      <input type="hidden" id="scope_value_hidden">
    `;
  }

  if (type === 'Markaz') {
    // Filter markazes by primary wing & tehsil
    const filtered = filterMap({ wing: primary.wing, tehsil: primary.tehsil });
    const markazs = [...new Set(filtered.map(i => i.markaz).filter(Boolean))].sort();
    area.innerHTML = buildTagInput(markazs, 'markaz', existingValue);
    if (existingValue) {
      existingValue.split(',').map(s => s.trim()).filter(Boolean).forEach(v => _addScopeTag(v, 'markaz'));
    }

  } else if (type === 'Tehsil') {
    // Cascading: District (picked first) → Tehsil (filtered to that
    // district) → Wing. Only Tehsil+Wing are stored ("Tehsil:Wing"),
    // District is just there to narrow the pick since tehsil names can
    // repeat across districts.
    const wings = ['M-EE', 'W-EE', 'SE'];
    area.innerHTML = buildDistrictFilteredTehsilInput(jDropdowns.districts, wings);
    if (existingValue) {
      existingValue.split(',').map(s => s.trim()).filter(Boolean).forEach(pair => {
        const parts = pair.split(':').map(p => p.trim());
        if (parts.length === 2) _addScopePairTag(pair, `${parts[0]} → ${parts[1]}`);
      });
    }

  } else if (type === 'Wing') {
    // Paired: District + Wing — admin picks both per tag, can differ
    // from the user's own primary wing. Stored as "District:Wing".
    const wings = ['M-EE', 'W-EE', 'SE'];
    area.innerHTML = buildPairTagInput(jDropdowns.districts, wings, 'District', 'Wing');
    if (existingValue) {
      existingValue.split(',').map(s => s.trim()).filter(Boolean).forEach(pair => {
        const parts = pair.split(':').map(p => p.trim());
        if (parts.length === 2) _addScopePairTag(pair, `${parts[0]} → ${parts[1]}`);
      });
    }

  } else if (type === 'District') {
    // All districts – no filtering, full charge (all wings)
    area.innerHTML = buildTagInput(jDropdowns.districts, 'district', existingValue);
    if (existingValue) {
      existingValue.split(',').map(s => s.trim()).filter(Boolean).forEach(v => _addScopeTag(v, 'district'));
    }

  } else if (type === 'Schools') {
    // ★ LAZY LOAD: only fetch the full Public+Private schools list
    // (38k+ rows) the first time an admin actually selects "Schools"
    // as the scope type — not on every Add/Edit User modal open.
    if (!jSchoolsLoaded) {
      area.innerHTML = `<div style="padding:24px;text-align:center;color:var(--t3)">
        <span class="spinner-border spinner-border-sm"></span> Loading school list…
      </div>`;
      google.script.run
        .withSuccessHandler(res => {
          if (!res.success) { showToast('Could not load school list: ' + res.message, false); return; }
          jDropdowns.schools = res.schools || [];
          jSchoolsLoaded = true;
          renderScopeValueUI(existingValue);
        })
        .withFailureHandler(err => showToast('School list load error: ' + err.message, false))
        .getSchoolsListForScope(currentUser);
      return;
    }

    // Filter schools by primary wing & tehsil (or primary markaz)
    // Use jMap to get emis/uid for schools within the primary jurisdiction
    const filteredSchools = jDropdowns.schools.filter(s => {
      // Find this school in jMap by emis (public) or uid (private)
      const matched = jDropdowns.jMap.find(item => {
        return (s.emis && item.emis === s.emis) || (s.uid && item.uid === s.uid);
      });
      if (!matched) return false;
      // Check if the school's district/wing/tehsil matches primary
      return (!primary.district || matched.district === primary.district) &&
             (!primary.wing     || matched.wing === primary.wing) &&
             (!primary.tehsil   || matched.tehsil === primary.tehsil) &&
             (!primary.markaz   || matched.markaz === primary.markaz);
    });

    const rows = filteredSchools.map(s => {
      const sheetClass = s.sheet === 'Public' ? 'pub' : 'priv';
      const emisLabel  = s.emis ? `<span class="sp-emis">EMIS: ${s.emis}</span>` : '';
      const uidLabel   = s.uid  ? `<span class="sp-emis">UID: ${s.uid}</span>`   : '';
      const id         = (s.emis || s.uid || '').replace(/[^a-zA-Z0-9]/g, '_');
      const val        = s.sheet === 'Public' ? (s.emis || s.uid) : s.uid;
      return `<div class="sp-item" id="spi_${id}">
        <input type="checkbox" value="${val}" id="chk_${id}" onchange="onSchoolCheck()">
        <span class="sp-name">${s.name}</span>
        ${emisLabel}${uidLabel}
        <span class="sp-sheet ${sheetClass}">${s.sheet}</span>
      </div>`;
    }).join('');

    area.innerHTML = `
      <div style="grid-column:1/-1">
        <span class="flabel" style="display:block;margin-bottom:6px">
          Select Schools (Col L — stores EMIS for Public, UID for Private)
        </span>
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <input type="text" id="school_search" placeholder="Search name, EMIS, or UID…"
            oninput="filterSchoolPicker(this.value)"
            style="flex:1;height:36px;border:1px solid var(--b0);border-radius:6px;padding:0 12px;font-size:.82rem;outline:none">
          <div style="display:flex;gap:6px">
            <button type="button" onclick="filterSchoolPicker('',true,'Public')"
              style="height:36px;padding:0 10px;background:#d1fae5;color:#065f46;border:1px solid #a7f3d0;border-radius:6px;font-size:.75rem;cursor:pointer">
              Public only
            </button>
            <button type="button" onclick="filterSchoolPicker('',true,'Private')"
              style="height:36px;padding:0 10px;background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;border-radius:6px;font-size:.75rem;cursor:pointer">
              Private only
            </button>
            <button type="button" onclick="filterSchoolPicker('')"
              style="height:36px;padding:0 10px;background:var(--s2);color:var(--t2);border:1px solid var(--b0);border-radius:6px;font-size:.75rem;cursor:pointer">
              All
            </button>
          </div>
        </div>
        <div class="school-picker-wrap" id="schoolPickerList">${rows}</div>
        <div id="school_count" style="font-size:.75rem;color:var(--t3);margin-top:6px">No schools selected</div>
        <input type="hidden" id="scope_value_hidden">
      </div>`;
    if (existingValue) {
      const saved = existingValue.split(',').map(s => s.trim().toLowerCase());
      document.querySelectorAll('#schoolPickerList input[type=checkbox]').forEach(chk => {
        if (saved.includes(String(chk.value).trim().toLowerCase())) chk.checked = true;
      });
      onSchoolCheck();
    }
  }

  // Store the scope type for tag removal (single-value pickers only —
  // paired pickers use #scope_pair_primary/#scope_pair_secondary instead)
  if (type !== 'Schools') {
    const picker = document.getElementById('scope_picker');
    if (picker) picker.dataset.scopeType = type;
  }
}

// ── Tag management (single-value tags — Markaz / District) ───────
function _addScopeTag(value, type) {
  if (!value) return;
  const tags = document.getElementById('scope_tags');
  if (!tags || tags.querySelector(`[data-value="${value}"]`)) return;
  const d = document.createElement('div');
  d.className = 'markaz-tag'; // reuse same class
  d.setAttribute('data-value', value);
  d.innerHTML = `<i class="bi bi-geo-alt-fill"></i>${value}<span class="rm" onclick="this.parentElement.remove();updateScopeValue()">×</span>`;
  tags.appendChild(d);
  updateScopeValue();
}

window.addScopeTag = function(type) {
  const picker = document.getElementById('scope_picker');
  if (!picker) return;
  const val = picker.value.trim();
  if (!val) return;
  _addScopeTag(val, type);
  picker.value = '';
};

// ── Tag management (paired tags — Wing / Tehsil) ──────────────────
// Stores raw value as "Primary:Secondary" (e.g. "Layyah:M-EE") while
// showing a friendlier "Layyah → M-EE" label in the tag itself.
function _addScopePairTag(rawValue, displayLabel) {
  if (!rawValue) return;
  const tags = document.getElementById('scope_tags');
  if (!tags || tags.querySelector(`[data-value="${rawValue}"]`)) return;
  const d = document.createElement('div');
  d.className = 'markaz-tag';
  d.setAttribute('data-value', rawValue);
  d.innerHTML = `<i class="bi bi-geo-alt-fill"></i>${displayLabel}<span class="rm" onclick="this.parentElement.remove();updateScopeValue()">×</span>`;
  tags.appendChild(d);
  updateScopeValue();
}

// Narrows #scope_pair_primary (Tehsil) to the tehsils that belong to
// the district picked in #scope_tehsil_district — used only by the
// Tehsil scope-charge picker.
window.filterScopeTehsilOptions = function() {
  const districtEl = document.getElementById('scope_tehsil_district');
  const tehsilEl   = document.getElementById('scope_pair_primary');
  if (!districtEl || !tehsilEl || !jDropdowns || !jDropdowns.jMap) return;

  const selDistrict = districtEl.value;
  if (!selDistrict) {
    tehsilEl.innerHTML = '<option value="">— Pick District first —</option>';
    return;
  }
  const tehsils = [...new Set(
    jDropdowns.jMap.filter(i => i.district === selDistrict).map(i => i.tehsil)
  )].sort();

  tehsilEl.innerHTML = '<option value="">— Pick Tehsil —</option>' +
    tehsils.map(t => `<option value="${t}">${t}</option>`).join('');
};

window.addScopePairTag = function() {
  const primaryEl   = document.getElementById('scope_pair_primary');
  const secondaryEl = document.getElementById('scope_pair_secondary');
  if (!primaryEl || !secondaryEl) return;
  const primaryVal   = primaryEl.value.trim();
  const secondaryVal = secondaryEl.value.trim();
  if (!primaryVal || !secondaryVal) { showToast('Please select both values before adding.', false); return; }
  const rawValue     = `${primaryVal}:${secondaryVal}`;
  const displayLabel = `${primaryVal} → ${secondaryVal}`;
  _addScopePairTag(rawValue, displayLabel);
  primaryEl.value   = '';
  secondaryEl.value = '';
};

function updateScopeValue() {
  const tags  = document.querySelectorAll('#scope_tags [data-value]');
  const value = Array.from(tags).map(t => t.getAttribute('data-value')).join(', ');
  const h = document.getElementById('scope_value_hidden');
  if (h) h.value = value;
  updateScopePreview();
}

function onSchoolCheck() {
  const checked = document.querySelectorAll('#schoolPickerList input[type=checkbox]:checked');
  const vals    = Array.from(checked).map(c => c.value);
  const h = document.getElementById('scope_value_hidden');
  if (h) h.value = vals.join(', ');
  const cnt = document.getElementById('school_count');
  if (cnt) cnt.textContent = checked.length ? `${checked.length} school(s) selected` : 'No schools selected';
  updateScopePreview();
}

function filterSchoolPicker(q, sheetOnly, sheetName) {
  const lower = q ? q.toLowerCase().trim() : '';
  document.querySelectorAll('.sp-item').forEach(item => {
    const text  = item.textContent.toLowerCase();
    const sheet = item.querySelector('.sp-sheet') ? item.querySelector('.sp-sheet').textContent.trim() : '';
    item.style.display = ((!lower || text.includes(lower)) && (!sheetOnly || sheet === sheetName)) ? '' : 'none';
  });
}

function updateScopePreview() {
  const h    = document.getElementById('scope_value_hidden');
  const wrap = document.getElementById('scopePreviewWrap');
  const txt  = document.getElementById('scopePreviewText');
  if (!h) return;
  const val = h.value.trim();
  wrap.style.display = val ? 'block' : 'none';
  if (txt) txt.textContent = val || '—';
}

// ═══════════════════════════════════════════════
//  USER TABLE
// ═══════════════════════════════════════════════
function loadUsers() {
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast(res.message, false); return; }
      userHeaders = res.headers; userData = res.data; renderUserTable();
    })
    .withFailureHandler(err => showToast('Load error: ' + err.message, false))
    .getUsers(currentUser);
}

function renderUserTable() {
  if (!userData.length) {
    document.getElementById('userTBody').innerHTML =
      '<tr><td colspan="10" style="padding:20px;text-align:center;color:var(--t3)">No users found.</td></tr>';
    return;
  }
  const show = [UH.PERSONAL_NO, UH.NAME, UH.CNIC, UH.CELL, UH.ROLE,
                UH.DISTRICT, UH.TEHSIL, UH.WING, UH.MARKAZ,
                UH.SCOPE_TYPE, UH.SCOPE_VALUE, UH.ACCESS_TYPE,
                UH.PAGE_NO, UH.DDEO_CODE, UH.BPS_SCALE, UH.DY_OFFICE, UH.RECEIVES_BUDGET_COPY];
  const cols = show.filter(h => userHeaders.includes(h));
  document.getElementById('userTHead').innerHTML =
    `<tr><th style="min-width:90px">Actions</th>${cols.map(h => `<th>${h}</th>`).join('')}</tr>`;
  document.getElementById('userTBody').innerHTML = userData.map(row => {
    const ri   = row._id;
    const cnic = row[UH.CNIC] || '';
    const name = row[UH.NAME] || 'Unknown';
    const scope  = row[UH.SCOPE_TYPE]  || 'Markaz';
    const access = row[UH.ACCESS_TYPE] || 'Editor';
    const role   = row[UH.ROLE] || '';
    return `<tr>
      <td>
        <div style="display:flex;gap:4px">
          <button class="tbl-btn btn-edit" title="Edit" onclick="editUser('${cnic}')">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="tbl-btn" title="Delete"
            style="border-color:var(--bad);color:var(--bad);background:var(--bad-bg)"
            onclick="confirmDeleteUser('${ri}','${name.replace(/'/g,"\\'")}')">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </td>
      ${cols.map(h => {
        const v = row[h] || '';
        if (h === UH.SCOPE_TYPE)  return `<td><span class="scope-badge sb-${v}">${v}</span></td>`;
        if (h === UH.ACCESS_TYPE) return `<td><span class="scope-badge sb-${v.replace(' ', '-')}">${v}</span></td>`;
        if (h === UH.ROLE)        return `<td><span class="scope-badge sb-${v}">${v}</span></td>`;
        return `<td>${v}</td>`;
      }).join('')}
    </tr>`;
  }).join('');
   const searchInput = document.getElementById('userSearchInput');
  if (searchInput) { searchInput.value = ''; }
  const countEl = document.getElementById('userSearchCount');
  if (countEl) countEl.textContent = '';
}

function filterUserTable(query) {
  const q = query.trim().toLowerCase();
  const countEl = document.getElementById('userSearchCount');

  if (!q) {
    document.querySelectorAll('#userTBody tr').forEach(tr => tr.style.display = '');
    countEl.textContent = '';
    return;
  }

  let visible = 0;
  document.querySelectorAll('#userTBody tr').forEach(tr => {
    const text = tr.textContent.toLowerCase();
    const show = text.includes(q);
    tr.style.display = show ? '' : 'none';
    if (show) visible++;
  });

  const total = document.querySelectorAll('#userTBody tr').length;
  countEl.textContent = `${visible} of ${total} users`;
}

// ── User modal: add ──────────────────────────────────────────────
function openUserModal() {
  document.getElementById('userModalTitle').textContent = 'Add New User';
  clearUserForm();
  const doOpen = () => { renderScopeValueUI(); userModalInst.show(); };
  if (!jLoaded) showToast('Loading jurisdiction data…', true);
  jLoaded ? doOpen() : loadJurisdictionDropdowns(doOpen);
}

// ── User modal: edit ─────────────────────────────────────────────
function editUser(cnic) {
  const row = userData.find(u => String(u[UH.CNIC]) === String(cnic));
  if (!row) return;
  document.getElementById('userModalTitle').textContent = 'Edit User: ' + cnic;
  const doEdit = () => {
    clearUserForm();
    setVal('u_row_index',   row._id || '');
    setVal('u_personal_no', row[UH.PERSONAL_NO] || '');
    setVal('u_name',        row[UH.NAME]         || '');
    setVal('u_cell',        row[UH.CELL]         || '');
    setVal('u_cnic',        row[UH.CNIC]         || '');
    setVal('u_email',       row[UH.EMAIL]        || '');
    setVal('u_password',    row[UH.PASSWORD]     || '');
    setVal('u_role',        row[UH.ROLE]         || '');
    setVal('u_access_type', row[UH.ACCESS_TYPE]  || 'Editor');
    setVal('u_district',    row[UH.DISTRICT]     || '');
    setVal('u_wing',        row[UH.WING]         || '');
    setVal('u_tehsil',      row[UH.TEHSIL]       || '');
    filterMarkazDropdown();
    setVal('u_markaz',      row[UH.MARKAZ]       || '');
    setVal('u_markaz_ur',   row[UH.MARKAZ_UR]    || '');
    setVal('u_designation_ur', row[UH.DESIGNATION_UR] || '');
    setVal('u_scope_type',  row[UH.SCOPE_TYPE]   || 'Markaz');
    renderScopeValueUI(row[UH.SCOPE_VALUE] || '');
    setVal('u_page_no',     row[UH.PAGE_NO]      || '');
    setVal('u_ddeo_code',   row[UH.DDEO_CODE]    || '');
    setVal('u_bps_scale',   row[UH.BPS_SCALE]    || '');
    document.getElementById('u_receives_budget_copy').checked = !!row[UH.RECEIVES_BUDGET_COPY];
    refreshDyOfficePreview();
    userModalInst.show();
  };
  if (!jLoaded) showToast('Loading jurisdiction data…', true);
  jLoaded ? doEdit() : loadJurisdictionDropdowns(doEdit);
}

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }

// Mirrors the Postgres GENERATED column on app_users.dy_office_detail
// ('DDEO (' || wing || ') ' || tehsil) so the admin sees the exact value
// that will be saved, before it's saved. Purely visual — never submitted.
function refreshDyOfficePreview() {
  const el = document.getElementById('u_dy_office_preview');
  if (!el) return;
  const wing = document.getElementById('u_wing').value.trim();
  const tehsil = document.getElementById('u_tehsil').value.trim();
  if (!wing || !tehsil) {
    el.textContent = 'Select Wing & Tehsil above';
    el.style.color = 'var(--t2)';
    return;
  }
  el.textContent = `DDEO (${wing}) ${tehsil}`;
  el.style.color = 'var(--brand)';
}

function clearUserForm() {
  ['u_row_index','u_personal_no','u_name','u_cell','u_cnic','u_email','u_password','u_markaz_ur','u_designation_ur','u_page_no','u_ddeo_code','u_bps_scale'].forEach(id => setVal(id, ''));
  ['u_role','u_district','u_wing','u_tehsil','u_markaz','u_access_type','u_scope_type'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.options && el.options.length) el.value = el.options[0].value;
  });
  document.getElementById('scopeValueArea').innerHTML = '';
  document.getElementById('scopePreviewWrap').style.display = 'none';
  document.getElementById('u_receives_budget_copy').checked = false;
  refreshDyOfficePreview();
}

function submitUser() {
  // Collect tags from scope UI if not Schools
  const scopeType = document.getElementById('u_scope_type').value;
  if (scopeType !== 'Schools') {
    const tags = document.querySelectorAll('#scope_tags [data-value]');
    const values = Array.from(tags).map(t => t.getAttribute('data-value')).join(', ');
    const h = document.getElementById('scope_value_hidden');
    if (h) h.value = values;
  } else {
    // Schools already handled by onSchoolCheck
  }

  const scopeH = document.getElementById('scope_value_hidden');
  const cnic = document.getElementById('u_cnic').value.trim();
  const name = document.getElementById('u_name').value.trim();
  const email = document.getElementById('u_email').value.trim();
  if (!cnic) { showToast('CNIC is required.', false); return; }
  if (!name) { showToast('Name is required.', false); return; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast('Please enter a valid email address.', false);
    return;
  }

  const dataObj = {
    _id:               document.getElementById('u_row_index').value.trim() || undefined,
    [UH.PERSONAL_NO]: document.getElementById('u_personal_no').value.trim(),
    [UH.NAME]:        name,
    [UH.MARKAZ]:      document.getElementById('u_markaz').value.trim(),
    [UH.MARKAZ_UR]:   document.getElementById('u_markaz_ur').value.trim(),
    [UH.DESIGNATION_UR]: document.getElementById('u_designation_ur').value.trim(),
    [UH.CELL]:        document.getElementById('u_cell').value.trim(),
    [UH.CNIC]:        cnic,
    [UH.EMAIL]:       email,
    [UH.PASSWORD]:    document.getElementById('u_password').value.trim(),
    [UH.ROLE]:        document.getElementById('u_role').value.trim(),
    [UH.DISTRICT]:    document.getElementById('u_district').value.trim(),
    [UH.WING]:        document.getElementById('u_wing').value.trim(),
    [UH.TEHSIL]:      document.getElementById('u_tehsil').value.trim(),
    [UH.SCOPE_TYPE]:  document.getElementById('u_scope_type').value.trim(),
    [UH.SCOPE_VALUE]: scopeH ? scopeH.value.trim() : '',
    [UH.ACCESS_TYPE]: document.getElementById('u_access_type').value.trim(),
    [UH.PAGE_NO]:     document.getElementById('u_page_no').value.trim(),
    [UH.DDEO_CODE]:   document.getElementById('u_ddeo_code').value.trim(),
    [UH.BPS_SCALE]:   document.getElementById('u_bps_scale').value.trim() || null,
    [UH.RECEIVES_BUDGET_COPY]: document.getElementById('u_receives_budget_copy').checked,
    // Dy Office Detail intentionally NOT sent — it's a Postgres GENERATED
    // column (wing + tehsil), writing to it would error the update.
  };

  const editedUserId = document.getElementById('u_row_index').value.trim();

  const btn = document.getElementById('saveUserBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving…';
  google.script.run
    .withSuccessHandler(res => {
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy-fill"></i> Save User';
      if (res.success) {
        userModalInst.hide(); showToast(res.message || 'User saved!'); loadUsers();
        // If the admin just edited their OWN profile, sync currentUser
        // immediately — otherwise the write-report form (and anything
        // else that reads currentUser) would keep using the stale
        // snapshot from page load until the next reload.
        if (editedUserId && currentUser && editedUserId === currentUser.id && typeof _refreshCurrentUserFromDb === 'function') {
          _refreshCurrentUserFromDb(currentUser.id);
        }
      }
      else showToast(res.message || 'Save failed.', false);
    })
    .withFailureHandler(err => {
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy-fill"></i> Save User';
      showToast('Server error: ' + err.message, false);
    })
    .saveUser(dataObj, currentUser);
}

function confirmDeleteUser(rowIndex, name) {
  pendingDeleteUserRow = rowIndex;
  document.getElementById('deleteUserName').textContent = 'User: ' + name;
  deleteUserModalInst.show();
}

// ═══════════════════════════════════════════════
//  LINKS & APPS
// ═══════════════════════════════════════════════
function filterLinksTable(query) {
  const q = query.trim().toLowerCase();
  const countEl = document.getElementById('linksSearchCount');

  if (!q) {
    document.querySelectorAll('#linksTBody tr').forEach(tr => tr.style.display = '');
    countEl.textContent = '';
    return;
  }

  let visible = 0;
  document.querySelectorAll('#linksTBody tr').forEach(tr => {
    const show = tr.textContent.toLowerCase().includes(q);
    tr.style.display = show ? '' : 'none';
    if (show) visible++;
  });

  const total = document.querySelectorAll('#linksTBody tr').length;
  countEl.textContent = `${visible} of ${total} rows`;
}

function loadLinksAppsTable() {
  document.getElementById('linksTBody').innerHTML =
    '<tr><td colspan="9" style="padding:20px;text-align:center;color:var(--t3)"><span class="spinner-border spinner-border-sm"></span> Loading…</td></tr>';
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast(res.message, false); return; }
      linksHeaders = res.headers; linksData = res.data; renderLinksTable();
    })
    .withFailureHandler(err => showToast('Load error: ' + err.message, false))
    .getLinksAppsAdmin(currentUser);
}

function renderLinksTable() {
  if (!linksData.length) {
    document.getElementById('linksTHead').innerHTML = '';
    document.getElementById('linksTBody').innerHTML =
      '<tr><td style="padding:20px;text-align:center;color:var(--t3)">No rows found.</td></tr>';
    return;
  }
  document.getElementById('linksTHead').innerHTML =
    `<tr><th>Actions</th><th>Type</th>${linksHeaders.map(h => `<th>${h}</th>`).join('')}<th>Visible To</th></tr>`;
  document.getElementById('linksTBody').innerHTML = linksData.map(row => {
    const ri = row._id;
    const hasLink = row['Link Name'] || row['Link URL'];
    const hasApp  = row['App Name']  || row['App URL'];
    const typeBadge = hasLink && hasApp
      ? `<span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:700">Link + App</span>`
      : hasApp
        ? `<span style="background:var(--ok-bg);color:var(--ok);padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:700">App</span>`
        : `<span style="background:var(--teal-bg);color:var(--teal);padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:700">Link</span>`;
    return `<tr>
      <td style="display:flex;gap:4px">
        <button class="tbl-btn btn-edit" onclick="editLinksRow('${ri}')"><i class="bi bi-pencil"></i></button>
        <button class="tbl-btn" style="border-color:var(--bad);color:var(--bad);background:var(--bad-bg)"
          onclick="confirmDeleteLinksRow('${ri}')"><i class="bi bi-trash"></i></button>
      </td>
      <td>${typeBadge}</td>
      ${linksHeaders.map(h => {
        const v = row[h] || '';
        return `<td>${String(v).startsWith('http')
          ? `<a href="${v}" target="_blank" style="color:var(--brand);font-size:.75rem">${v.substring(0, 40)}…</a>`
          : v}</td>`;
      }).join('')}
      <td>${scopeVisibleToBadge(row)}</td>
    </tr>`;
  }).join('');
}

// Category options depend on what's being added — a Link only ever
// has one category, an App has two. Reduces the modal to one clear
// path instead of showing both a Link section and an App section at
// the same time regardless of which one the admin actually wants.
const LA_CATEGORY_OPTIONS = {
  link: [{ value: 'Important Link', label: 'Important Link' }],
  app:  [{ value: 'Official/Departmental', label: 'Official / Departmental' },
         { value: 'By Team AEOs',         label: 'By Team AEOs' }],
};

function onLinksTypeChange() {
  const type = document.getElementById('la_type').value;
  document.getElementById('la_nameLabel').textContent = type === 'app' ? 'App Name' : 'Link Name';
  document.getElementById('la_urlLabel').textContent  = type === 'app' ? 'App URL'  : 'Link URL';
  document.getElementById('la_catLabel').textContent  = type === 'app' ? 'App Category' : 'Link Category';
  const catSel = document.getElementById('la_cat');
  catSel.innerHTML = '<option value="">— None —</option>' +
    LA_CATEGORY_OPTIONS[type].map(o => `<option value="${o.value}">${o.label}</option>`).join('');

  // Editing an existing row: switching sides restores whatever that
  // side already had saved, instead of starting blank each time.
  const name = type === 'app' ? (_laEditingRow ? _laEditingRow['App Name'] || '' : '') : (_laEditingRow ? _laEditingRow['Link Name'] || '' : '');
  const url  = type === 'app' ? (_laEditingRow ? _laEditingRow['App URL']  || '' : '') : (_laEditingRow ? _laEditingRow['Link URL']  || '' : '');
  const cat  = type === 'app' ? (_laEditingRow ? _laEditingRow['App Category'] || '' : '') : (_laEditingRow ? _laEditingRow['Link Category'] || '' : '');
  document.getElementById('la_name').value = name;
  document.getElementById('la_url').value  = url;
  if (cat && !LA_CATEGORY_OPTIONS[type].some(o => o.value === cat)) {
    catSel.insertAdjacentHTML('beforeend', `<option value="${cat}">${cat}</option>`);
  }
  catSel.value = cat;
}

// Holds the full row being edited (both its link_* and app_* fields,
// even though the modal only shows one side at a time) so switching
// Type and saving never silently erases the other side's data on an
// older row that happened to have both a link and an app on it.
let _laEditingRow = null;

function openLinksModal() {
  document.getElementById('linksModalTitle').textContent = 'Add New Row';
  _laEditingRow = null;
  document.getElementById('la_type').value = 'link';
  onLinksTypeChange(); // clears Name/URL/Category since _laEditingRow is null
  document.getElementById('la_rowIndex').value = '';
  document.getElementById('la_scope_type').value = 'All';
  renderScopeHierarchyUI('la_scope');
  linksModalInst.show();
}

function editLinksRow(ri) {
  const row = linksData.find(r => String(r._id) === String(ri));
  if (!row) return;
  _laEditingRow = row;

  const hasApp = row['App Name'] || row['App URL'];
  const type = hasApp ? 'app' : 'link'; // an old row with both defaults to showing its Link side first

  document.getElementById('linksModalTitle').textContent = 'Edit Row';
  document.getElementById('la_type').value = type;
  onLinksTypeChange(); // populates Name/URL/Category from _laEditingRow for this type
  document.getElementById('la_rowIndex').value  = ri;
  document.getElementById('la_scope_type').value = row['Scope Type'] || 'All';
  renderScopeHierarchyUI('la_scope', {
    district: row['Scope District'] || '',
    wing:     row['Scope Wing']     || '',
    tehsil:   row['Scope Tehsil']   || '',
    markaz:   row['Scope Markaz']   || '',
  });
  linksModalInst.show();
}

function submitLinksRow() {
  const type = document.getElementById('la_type').value;
  const name = document.getElementById('la_name').value.trim();
  const url  = document.getElementById('la_url').value.trim();
  const cat  = document.getElementById('la_cat').value;
  if (!name || !url) { showToast('Name and URL are required.', false); return; }

  // Whichever side isn't being edited right now keeps its previously
  // saved value (blank for a brand-new row) instead of being wiped out.
  const obj = {
    'Link Name':     type === 'link' ? name : (_laEditingRow ? (_laEditingRow['Link Name'] || '') : ''),
    'Link URL':      type === 'link' ? url  : (_laEditingRow ? (_laEditingRow['Link URL']  || '') : ''),
    'Link Category': type === 'link' ? cat  : (_laEditingRow ? (_laEditingRow['Link Category'] || '') : ''),
    'App Name':      type === 'app'  ? name : (_laEditingRow ? (_laEditingRow['App Name'] || '') : ''),
    'App URL':       type === 'app'  ? url  : (_laEditingRow ? (_laEditingRow['App URL']  || '') : ''),
    'App Category':  type === 'app'  ? cat  : (_laEditingRow ? (_laEditingRow['App Category'] || '') : ''),
  };

  const scopeType = document.getElementById('la_scope_type').value;
  const hierarchyError = validateScopeHierarchy('la_scope', 'link/app');
  if (hierarchyError) { showToast(hierarchyError, false); return; }
  const h = readScopeHierarchy('la_scope');
  obj['Scope Type']     = scopeType;
  obj['Scope District']  = h.district;
  obj['Scope Wing']      = h.wing;
  obj['Scope Tehsil']    = h.tehsil;
  obj['Scope Markaz']    = h.markaz;

  const ri  = document.getElementById('la_rowIndex').value || null;
  const btn = document.getElementById('saveLinksBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving…';
  google.script.run
    .withSuccessHandler(res => {
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy-fill"></i> Save Row';
      if (res.success) {
        linksModalInst.hide(); showToast(res.message || 'Saved!');
        loadLinksAppsTable();
        if (typeof loadDashboardLinksApps === 'function') loadDashboardLinksApps();
      } else showToast(res.message || 'Save failed.', false);
    })
    .withFailureHandler(err => {
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy-fill"></i> Save Row';
      showToast('Error: ' + err.message, false);
    })
    .saveLinksAppsRow(obj, ri, currentUser);
}

function confirmDeleteLinksRow(ri) { pendingDeleteRow = ri; pendingDeleteType = 'links'; deleteModalInst.show(); }

// ═══════════════════════════════════════════════
//  TOOLS
// ═══════════════════════════════════════════════
function filterToolsTable(query) {
  const q = query.trim().toLowerCase();
  const countEl = document.getElementById('toolsSearchCount');

  if (!q) {
    document.querySelectorAll('#toolsTBody tr').forEach(tr => tr.style.display = '');
    countEl.textContent = '';
    return;
  }

  let visible = 0;
  document.querySelectorAll('#toolsTBody tr').forEach(tr => {
    const show = tr.textContent.toLowerCase().includes(q);
    tr.style.display = show ? '' : 'none';
    if (show) visible++;
  });

  const total = document.querySelectorAll('#toolsTBody tr').length;
  countEl.textContent = `${visible} of ${total} tools`;
}

function loadToolsTableAdmin() {
  document.getElementById('toolsTBody').innerHTML =
    '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--t3)"><span class="spinner-border spinner-border-sm"></span> Loading…</td></tr>';
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast(res.message, false); return; }
      toolsHeaders = res.headers; toolsData = res.data; renderToolsTable();
    })
    .withFailureHandler(err => showToast('Load error: ' + err.message, false))
    .getToolsAdmin(currentUser);
}

function renderToolsTable() {
  if (!toolsData.length) {
    document.getElementById('toolsTHead').innerHTML = '';
    document.getElementById('toolsTBody').innerHTML =
      '<tr><td style="padding:20px;text-align:center;color:var(--t3)">No tools found.</td></tr>';
    return;
  }
  document.getElementById('toolsTHead').innerHTML =
    `<tr><th>Actions</th>${toolsHeaders.map(h => `<th>${h}</th>`).join('')}<th>Visible To</th></tr>`;
  document.getElementById('toolsTBody').innerHTML = toolsData.map(row => {
    const ri = row._id;
    return `<tr>
      <td style="display:flex;gap:4px">
        <button class="tbl-btn btn-edit" style="border-color:var(--purple);color:var(--purple);background:var(--purple-bg)"
          onclick="editToolRow('${ri}')"><i class="bi bi-pencil"></i></button>
        <button class="tbl-btn" style="border-color:var(--bad);color:var(--bad);background:var(--bad-bg)"
          onclick="confirmDeleteToolRow('${ri}')"><i class="bi bi-trash"></i></button>
      </td>
      ${toolsHeaders.map(h => {
        const v = row[h] || '';
        return `<td>${String(v).startsWith('http')
          ? `<a href="${v}" target="_blank" style="color:var(--purple)">${v.substring(0, 40)}…</a>`
          : v}</td>`;
      }).join('')}
      <td>${scopeVisibleToBadge(row)}</td>
    </tr>`;
  }).join('');
}

function openToolModal() {
  document.getElementById('toolModalTitle').textContent = 'Add New Tool';
  document.getElementById('tool_name').value     = '';
  document.getElementById('tool_url').value      = '';
  document.getElementById('tool_rowIndex').value = '';
  document.getElementById('tool_scope_type').value = 'All';
  renderScopeHierarchyUI('tool_scope');
  toolModalInst.show();
}

function editToolRow(ri) {
  const row = toolsData.find(r => String(r._id) === String(ri));
  if (!row) return;
  document.getElementById('toolModalTitle').textContent = 'Edit Tool';
  document.getElementById('tool_name').value     = row[toolsHeaders[0]] || '';
  document.getElementById('tool_url').value      = row[toolsHeaders[1]] || '';
  document.getElementById('tool_rowIndex').value = ri;
  document.getElementById('tool_scope_type').value = row['Scope Type'] || 'All';
  renderScopeHierarchyUI('tool_scope', {
    district: row['Scope District'] || '',
    wing:     row['Scope Wing']     || '',
    tehsil:   row['Scope Tehsil']   || '',
    markaz:   row['Scope Markaz']   || '',
  });
  toolModalInst.show();
}

function submitToolRow() {
  const obj = {};
  if (toolsHeaders[0]) obj[toolsHeaders[0]] = document.getElementById('tool_name').value.trim();
  if (toolsHeaders[1]) obj[toolsHeaders[1]] = document.getElementById('tool_url').value.trim();
  if (!obj[toolsHeaders[0]] || !obj[toolsHeaders[1]]) { showToast('Name and URL required.', false); return; }

  const scopeType = document.getElementById('tool_scope_type').value;
  const hierarchyError = validateScopeHierarchy('tool_scope', 'tool');
  if (hierarchyError) { showToast(hierarchyError, false); return; }
  const h = readScopeHierarchy('tool_scope');
  obj['Scope Type']     = scopeType;
  obj['Scope District']  = h.district;
  obj['Scope Wing']      = h.wing;
  obj['Scope Tehsil']    = h.tehsil;
  obj['Scope Markaz']    = h.markaz;

  const ri  = document.getElementById('tool_rowIndex').value || null;
  const btn = document.getElementById('saveToolBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving…';
  google.script.run
    .withSuccessHandler(res => {
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy-fill"></i> Save Tool';
      if (res.success) { toolModalInst.hide(); showToast(res.message); loadToolsTableAdmin(); }
      else showToast(res.message, false);
    })
    .withFailureHandler(err => {
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy-fill"></i> Save Tool';
      showToast('Error: ' + err.message, false);
    })
    .saveToolRow(obj, ri, currentUser);
}

function confirmDeleteToolRow(ri) { pendingDeleteRow = ri; pendingDeleteType = 'tools'; deleteModalInst.show(); }

// ═══════════════════════════════════════════════
//  KPI CARDS
// ═══════════════════════════════════════════════
function loadKpiCardsTable() {
  document.getElementById('kpiTBody').innerHTML =
    '<tr><td colspan="11" style="padding:20px;text-align:center;color:var(--t3)"><span class="spinner-border spinner-border-sm"></span> Loading…</td></tr>';
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast(res.message, false); return; }
      kpiCardsData = res.data || [];
      renderKpiCardsTable(res.headers || [], kpiCardsData);
    })
    .withFailureHandler(err => showToast('Load error: ' + err.message, false))
    .getKpiCardsAdmin(currentUser);
}

const KPI_MODULE_LABEL = {
  dashboard:       '🏠 Dashboard',
  tools:           '🔧 Portal Tools',
  hr:              '👥 HR / Staff',
  public_schools:  '🏢 Public Schools',
  private_schools: '🏫 Private Schools',
  dispatch:        '📤 Report Dispatch',
};

// Shared "who can see this" badge — same look everywhere it's used
// (KPI Cards, Links & Apps, Tools Manager) so visibility reads
// consistently across the whole Admin Panel.
function scopeVisibleToBadge(row) {
  if (row['Scope Type'] && row['Scope Type'] !== 'All') {
    const parts = [row['Scope District'], row['Scope Wing'], row['Scope Tehsil'], row['Scope Markaz']]
      .filter(Boolean).join(' → ') || row['Scope Value'] || '—';
    return `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:700">${escHtml(row['Scope Type'])}: ${escHtml(parts)}</span>`;
  }
  return `<span style="color:var(--t3);font-size:.75rem">All users</span>`;
}

function renderKpiCardsTable(headers, data) {
  if (!data.length) {
    document.getElementById('kpiTHead').innerHTML = '';
    document.getElementById('kpiTBody').innerHTML =
      '<tr><td style="padding:20px;text-align:center;color:var(--t3)">No cards yet. Click Add Card to create one.</td></tr>';
    return;
  }

  document.getElementById('kpiTHead').innerHTML = `
    <tr>
      <th>Actions</th>
      <th>Order</th>
      <th>Preview</th>
      <th>Card Title</th>
      <th>Shown On</th>
      <th>Icon</th>
      <th>Color</th>
      <th>Description</th>
      <th>Action Type</th>
      <th>Action Value</th>
      <th>Active</th>
      <th>Visible To</th>
    </tr>`;

  document.getElementById('kpiTBody').innerHTML = data.map(row => {
    const ri      = row._id;
    const color   = row['Card Color'] || 'brand';
    const icon    = row['Card Icon']  || 'grid-fill';
    const active  = String(row['Active'] || 'Yes').trim();
    const hex     = KPI_COLOR_HEX[color] || KPI_COLOR_HEX.brand;
    const aType   = row['Action Type'] || '';
    const aVal    = row['Action Value'] || '';
    const aTypeLabel = aType === 'url' ? '<span style="background:#dbeafe;color:#1e40af;padding:1px 8px;border-radius:10px;font-size:.68rem;font-weight:700">URL</span>'
                                       : '<span style="background:#d1fae5;color:#065f46;padding:1px 8px;border-radius:10px;font-size:.68rem;font-weight:700">Module</span>';

    return `<tr>
      <td>
        <div style="display:flex;gap:4px">
          <button class="tbl-btn btn-edit" style="border-color:#0f766e;color:#0f766e;background:#f0fdfa"
            onclick="editKpiCard('${ri}')" title="Edit">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="tbl-btn" style="border-color:var(--bad);color:var(--bad);background:var(--bad-bg)"
            onclick="confirmDeleteKpiCard('${ri}')" title="Delete">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </td>
      <td style="font-weight:700;color:var(--t2);font-size:.8rem">${row['Display Order'] || '—'}</td>
      <td>
        <div style="width:36px;height:36px;border-radius:8px;background:${hex}22;display:flex;align-items:center;justify-content:center;border:2px solid ${hex}">
          <i class="bi bi-${icon}" style="color:${hex};font-size:1rem"></i>
        </div>
      </td>
      <td style="font-weight:700;color:var(--t1)">${row['Card Title'] || ''}</td>
      <td><span style="background:#eef2ff;color:#3730a3;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:700">${KPI_MODULE_LABEL[row['Module']] || row['Module'] || 'Dashboard'}</span></td>
      <td><code>bi-${icon}</code></td>
      <td><span class="scope-badge cb-${color}">${color}</span></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;font-size:.8rem;color:var(--t2)">${row['Card Description'] || ''}</td>
      <td>${aTypeLabel}</td>
      <td style="font-size:.75rem;color:var(--t2);max-width:150px;overflow:hidden;text-overflow:ellipsis">${aVal}</td>
      <td><span class="${active === 'Yes' ? 'active-yes' : 'active-no'}">${active}</span></td>
      <td>${scopeVisibleToBadge(row)}</td>
    </tr>`;
  }).join('');
}

// ── Generic hierarchical scope picker — District → Wing → Tehsil → Markaz ──
// Originally built just for KPI Card visibility; now shared by any modal
// that needs the same "who can see this" picker (KPI Cards, Links & Apps,
// Tools Manager). Every set of fields is namespaced by a `prefix`, so a
// modal just needs a Scope Type select at `${prefix}_type`, a wrapper at
// `${prefix}_hierarchy_wrap`, and district/wing/tehsil/markaz selects at
// `${prefix}_district` etc. (with matching `${prefix}_<level>_wrap` divs) —
// see the KPI Card modal in index.html for the exact markup shape to copy.
//
// Reuses jDropdowns.jMap (the same District/Wing/Tehsil/Markaz map already
// loaded for the Admin Panel's user-scope picker) so every dropdown here
// only ever offers valid child locations for whatever parent was picked
// above it. Levels below the selected Scope Type stay hidden/disabled and
// are cleared, so no invalid partial combination can be saved.
const SCOPE_LEVELS = ['District', 'Wing', 'Tehsil', 'Markaz'];

function _scopeUniqueSorted(list) { return [...new Set(list.filter(Boolean))].sort(); }

function _scopeFillSelect(id, items, placeholder, keepValue) {
  const el = document.getElementById(id);
  if (!el) return;
  const prev = keepValue !== undefined ? keepValue : el.value;
  el.innerHTML = `<option value="">${placeholder}</option>` + items.map(v => `<option value="${v}">${v}</option>`).join('');
  if (prev && items.includes(prev)) el.value = prev;
}

function renderScopeHierarchyUI(prefix, existing) {
  const type = document.getElementById(`${prefix}_type`).value;
  const wrap = document.getElementById(`${prefix}_hierarchy_wrap`);
  const levelIndex = SCOPE_LEVELS.indexOf(type); // -1 for "All"

  if (type === 'All' || levelIndex === -1) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';

  ['district', 'wing', 'tehsil', 'markaz'].forEach((lvl, i) => {
    const fieldWrap = document.getElementById(`${prefix}_${lvl}_wrap`);
    if (fieldWrap) fieldWrap.style.display = (i <= levelIndex) ? '' : 'none';
  });

  // No explicit "existing" was passed (e.g. the admin just changed the
  // Scope Type dropdown) — preserve whatever is already picked in the
  // form instead of wiping it, so narrowing from Markaz to Wing (say)
  // keeps the District/Wing the admin already chose.
  const ex = existing || {
    district: document.getElementById(`${prefix}_district`) ? document.getElementById(`${prefix}_district`).value : '',
    wing:     document.getElementById(`${prefix}_wing`)     ? document.getElementById(`${prefix}_wing`).value     : '',
    tehsil:   document.getElementById(`${prefix}_tehsil`)   ? document.getElementById(`${prefix}_tehsil`).value   : '',
    markaz:   document.getElementById(`${prefix}_markaz`)   ? document.getElementById(`${prefix}_markaz`).value   : '',
  };

  _scopeFillSelect(`${prefix}_district`, jDropdowns.districts || [], '— Select District —', ex.district || '');
  document.getElementById(`${prefix}_district`).disabled = false;

  if (levelIndex >= 1) onScopeDistrictChange(prefix, ex.wing || '');
  if (levelIndex >= 2) onScopeWingChange(prefix, ex.tehsil || '');
  if (levelIndex >= 3) onScopeTehsilChange(prefix, ex.markaz || '');
}

function onScopeDistrictChange(prefix, keepWing) {
  const district = document.getElementById(`${prefix}_district`).value;
  const wingEl   = document.getElementById(`${prefix}_wing`);
  if (!wingEl) return;
  if (!district) {
    wingEl.innerHTML = '<option value="">— Select District first —</option>';
    wingEl.disabled = true;
    _scopeClearDownstream(prefix, 'wing');
    return;
  }
  const wings = _scopeUniqueSorted((jDropdowns.jMap || []).filter(r => r.district === district).map(r => r.wing));
  _scopeFillSelect(`${prefix}_wing`, wings, '— Select Wing —', keepWing);
  wingEl.disabled = false;
  if (keepWing === undefined) _scopeClearDownstream(prefix, 'wing');
}

function onScopeWingChange(prefix, keepTehsil) {
  const district = document.getElementById(`${prefix}_district`).value;
  const wing     = document.getElementById(`${prefix}_wing`).value;
  const tehsilEl = document.getElementById(`${prefix}_tehsil`);
  if (!tehsilEl) return;
  if (!wing) {
    tehsilEl.innerHTML = '<option value="">— Select Wing first —</option>';
    tehsilEl.disabled = true;
    _scopeClearDownstream(prefix, 'tehsil');
    return;
  }
  const tehsils = _scopeUniqueSorted((jDropdowns.jMap || [])
    .filter(r => r.district === district && r.wing === wing).map(r => r.tehsil));
  _scopeFillSelect(`${prefix}_tehsil`, tehsils, '— Select Tehsil —', keepTehsil);
  tehsilEl.disabled = false;
  if (keepTehsil === undefined) _scopeClearDownstream(prefix, 'tehsil');
}

function onScopeTehsilChange(prefix, keepMarkaz) {
  const district = document.getElementById(`${prefix}_district`).value;
  const wing     = document.getElementById(`${prefix}_wing`).value;
  const tehsil   = document.getElementById(`${prefix}_tehsil`).value;
  const markazEl = document.getElementById(`${prefix}_markaz`);
  if (!markazEl) return;
  if (!tehsil) {
    markazEl.innerHTML = '<option value="">— Select Tehsil first —</option>';
    markazEl.disabled = true;
    return;
  }
  const markazes = _scopeUniqueSorted((jDropdowns.jMap || [])
    .filter(r => r.district === district && r.wing === wing && r.tehsil === tehsil).map(r => r.markaz));
  _scopeFillSelect(`${prefix}_markaz`, markazes, '— Select Markaz —', keepMarkaz);
  markazEl.disabled = false;
}

// Changing a parent level clears everything below it, per the
// "changing a parent must clear lower-level selections" requirement.
function _scopeClearDownstream(prefix, fromLevel) {
  const order = ['wing', 'tehsil', 'markaz'];
  const startAt = order.indexOf(fromLevel);
  order.forEach((lvl, i) => {
    if (i < startAt) return;
    const el = document.getElementById(`${prefix}_${lvl}`);
    if (el) el.value = '';
  });
}

// Reads back the currently-selected hierarchy values, trimmed to
// whatever the active Scope Type actually requires.
function readScopeHierarchy(prefix) {
  const type = document.getElementById(`${prefix}_type`).value;
  const levelIndex = SCOPE_LEVELS.indexOf(type);
  const raw = {
    district: document.getElementById(`${prefix}_district`) ? document.getElementById(`${prefix}_district`).value : '',
    wing:     document.getElementById(`${prefix}_wing`)     ? document.getElementById(`${prefix}_wing`).value     : '',
    tehsil:   document.getElementById(`${prefix}_tehsil`)   ? document.getElementById(`${prefix}_tehsil`).value   : '',
    markaz:   document.getElementById(`${prefix}_markaz`)   ? document.getElementById(`${prefix}_markaz`).value   : '',
  };
  return {
    district: levelIndex >= 0 ? raw.district : '',
    wing:     levelIndex >= 1 ? raw.wing     : '',
    tehsil:   levelIndex >= 2 ? raw.tehsil   : '',
    markaz:   levelIndex >= 3 ? raw.markaz   : '',
  };
}

// Validates the required-selection rules before save:
//   District level -> District
//   Wing level     -> District + Wing
//   Tehsil level    -> District + Wing + Tehsil
//   Markaz level    -> District + Wing + Tehsil + Markaz
// Returns an error message string, or '' if valid.
function validateScopeHierarchy(prefix, itemLabel) {
  const type = document.getElementById(`${prefix}_type`).value;
  if (type === 'All') return '';
  const h = readScopeHierarchy(prefix);
  const requiredByType = {
    District: ['district'],
    Wing:     ['district', 'wing'],
    Tehsil:   ['district', 'wing', 'tehsil'],
    Markaz:   ['district', 'wing', 'tehsil', 'markaz'],
  };
  const labels = { district: 'District', wing: 'Wing', tehsil: 'Tehsil', markaz: 'Markaz' };
  const missing = (requiredByType[type] || []).filter(f => !h[f]).map(f => labels[f]);
  if (missing.length) {
    return `A ${type}-level ${itemLabel || 'item'} needs: ${missing.join(', ')}.`;
  }
  return '';
}

// ── Thin KPI-specific wrappers (kept so existing onchange="..." calls
//    in the KPI modal's markup keep working unchanged) ──────────────
function renderKpiScopeValueUI(existing)      { renderScopeHierarchyUI('kc_scope', existing); }
function onKpiScopeDistrictChange(keepWing)   { onScopeDistrictChange('kc_scope', keepWing); }
function onKpiScopeWingChange(keepTehsil)     { onScopeWingChange('kc_scope', keepTehsil); }
function onKpiScopeTehsilChange(keepMarkaz)   { onScopeTehsilChange('kc_scope', keepMarkaz); }
function _kpiReadScopeHierarchy()             { return readScopeHierarchy('kc_scope'); }
function _kpiValidateScopeHierarchy()         { return validateScopeHierarchy('kc_scope', 'card'); }

// ── Open KPI modal: add ──────────────────────────────────────────
function openKpiCardModal() {
  document.getElementById('kpiCardModalTitle').textContent = 'Add Dashboard Card';
  document.getElementById('kc_title').value       = '';
  document.getElementById('kc_icon').value        = 'people-fill';
  document.getElementById('kc_color').value       = 'accent';
  document.getElementById('kc_desc').value        = '';
  document.getElementById('kc_page_module').value = 'dashboard';
  document.getElementById('kc_action_type').value = 'module';
  document.getElementById('kc_module_select').value = 'openHrModule';
  document.getElementById('kc_url_input').value   = '';
  document.getElementById('kc_active').value      = 'Yes';
  document.getElementById('kc_order').value       = '10';
  document.getElementById('kc_rowIndex').value    = '';
  document.getElementById('kc_scope_type').value  = 'All';
  renderKpiScopeValueUI();
  onKpiActionTypeChange();
  updateKpiPreview();
  kpiCardModalInst.show();
}

// ── Open KPI modal: edit ─────────────────────────────────────────
function editKpiCard(ri) {
  const row = kpiCardsData.find(r => String(r._id) === String(ri));
  if (!row) return;
  document.getElementById('kpiCardModalTitle').textContent = 'Edit Dashboard Card';
  document.getElementById('kc_title').value    = row['Card Title']       || '';
  document.getElementById('kc_icon').value     = row['Card Icon']        || 'people-fill';
  document.getElementById('kc_color').value    = row['Card Color']       || 'accent';
  document.getElementById('kc_desc').value     = row['Card Description'] || '';
  document.getElementById('kc_active').value   = row['Active']           || 'Yes';
  document.getElementById('kc_order').value    = row['Display Order']    || '10';
  document.getElementById('kc_rowIndex').value = ri;
  document.getElementById('kc_page_module').value = row['Module'] || 'dashboard';
  document.getElementById('kc_scope_type').value = row['Scope Type'] || 'All';
  renderKpiScopeValueUI({
    district: row['Scope District'] || '',
    wing:     row['Scope Wing']     || '',
    tehsil:   row['Scope Tehsil']   || '',
    markaz:   row['Scope Markaz']   || '',
  });

  const aType = row['Action Type'] || 'module';
  const aVal  = row['Action Value'] || '';
  document.getElementById('kc_action_type').value = aType;
  onKpiActionTypeChange();
  if (aType === 'url') {
    document.getElementById('kc_url_input').value = aVal;
  } else {
    const sel = document.getElementById('kc_module_select');
    const opt = Array.from(sel.options).find(o => o.value === aVal);
    sel.value = opt ? aVal : sel.options[0].value;
  }
  updateKpiPreview();
  kpiCardModalInst.show();
}

// ── Toggle URL vs Module field ───────────────────────────────────
function onKpiActionTypeChange() {
  const aType = document.getElementById('kc_action_type').value;
  document.getElementById('kc_module_wrap').style.display = aType === 'module' ? '' : 'none';
  document.getElementById('kc_url_wrap').style.display    = aType === 'url'    ? '' : 'none';
}

// ── Live card preview ────────────────────────────────────────────
function updateKpiPreview() {
  const title = document.getElementById('kc_title').value  || 'Card Title';
  const icon  = document.getElementById('kc_icon').value   || 'grid-fill';
  const color = document.getElementById('kc_color').value  || 'accent';
  const desc  = document.getElementById('kc_desc').value   || 'Card description…';
  const hex   = KPI_COLOR_HEX[color] || KPI_COLOR_HEX.accent;

  document.getElementById('kpiCardPreview').innerHTML = `
    <div class="kpi-preview-card" style="border-top-color:${hex}">
      <i class="bi bi-${icon} mc-icon" style="color:${hex}"></i>
      <div class="mc-title">${title}</div>
      <div class="mc-desc">${desc}</div>
      <div class="mc-arrow" style="color:${hex}">
        <i class="bi bi-arrow-right-circle-fill"></i> Open
      </div>
    </div>`;
}

// ── Submit KPI card ──────────────────────────────────────────────
function submitKpiCard() {
  const title  = document.getElementById('kc_title').value.trim();
  const aType  = document.getElementById('kc_action_type').value;
  const aVal   = aType === 'url'
    ? document.getElementById('kc_url_input').value.trim()
    : document.getElementById('kc_module_select').value.trim();

  if (!title) { showToast('Card Title is required.', false); return; }
  if (!aVal)  { showToast('Action Value is required.', false); return; }

  const scopeType = document.getElementById('kc_scope_type').value;
  const hierarchyError = _kpiValidateScopeHierarchy();
  if (hierarchyError) { showToast(hierarchyError, false); return; }
  const h = _kpiReadScopeHierarchy();
  const scopeValue = scopeType === 'All' ? '' : (h.markaz || h.tehsil || h.wing || h.district);

  const rowData = {
    'Card Title':       title,
    'Card Icon':        document.getElementById('kc_icon').value.trim(),
    'Card Color':       document.getElementById('kc_color').value.trim(),
    'Card Description': document.getElementById('kc_desc').value.trim(),
    'Action Type':      aType,
    'Action Value':     aVal,
    'Active':           document.getElementById('kc_active').value.trim(),
    'Display Order':    document.getElementById('kc_order').value.trim() || '10',
    'Module':           document.getElementById('kc_page_module').value,
    'Scope Type':       scopeType,
    'Scope Value':      scopeValue,
    'Scope District':   h.district,
    'Scope Wing':       h.wing,
    'Scope Tehsil':     h.tehsil,
    'Scope Markaz':     h.markaz,
  };

  const ri  = document.getElementById('kc_rowIndex').value || null;
  const btn = document.getElementById('saveKpiBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving…';

  google.script.run
    .withSuccessHandler(res => {
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy-fill"></i> Save Card';
      if (res.success) {
        kpiCardModalInst.hide();
        showToast(res.message || 'Card saved!');
        loadKpiCardsTable();
        if (typeof loadDashboardKpiCards === 'function') loadDashboardKpiCards();
      } else showToast(res.message || 'Save failed.', false);
    })
    .withFailureHandler(err => {
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy-fill"></i> Save Card';
      showToast('Error: ' + err.message, false);
    })
    .saveKpiCard(rowData, ri, currentUser);
}

// ── Delete KPI card ──────────────────────────────────────────────
function confirmDeleteKpiCard(ri) {
  pendingDeleteRow  = ri;
  pendingDeleteType = 'kpi';
  deleteModalInst.show();
}