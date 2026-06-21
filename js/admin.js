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

let userModalInst, deleteUserModalInst, linksModalInst, toolModalInst, deleteModalInst, kpiCardModalInst;
let pendingDeleteRow = null, pendingDeleteType = null;
let pendingDeleteUserRow = null;

const UH = {
  PERSONAL_NO: 'Personal No.',
  NAME:        'Name',
  MARKAZ:      'Markaz Name',
  CELL:        'Cell No',
  CNIC:        'CNIC',
  PASSWORD:    'Password',
  ROLE:        'Role',
  DISTRICT:    'District',
  WING:        'Wing',
  TEHSIL:      'Tehsil',
  SCOPE_TYPE:  'Scope Type',
  SCOPE_VALUE: 'Scope Value',
  ACCESS_TYPE: 'Access Type'
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
        else { loadLinksAppsTable(); if (typeof loadDashboardLinksApps === 'function') loadDashboardLinksApps(); }
      } else showToast(res.message || 'Delete failed.', false);
    };
    if (pendingDeleteType === 'tools')
      google.script.run.withSuccessHandler(done).deleteToolRow(pendingDeleteRow, currentUser);
    else if (pendingDeleteType === 'kpi')
      google.script.run.withSuccessHandler(done).deleteKpiCard(pendingDeleteRow, currentUser);
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
  document.getElementById('adminPanelUsers').style.display = tab === 'users' ? 'block' : 'none';
  document.getElementById('adminPanelLinks').style.display = tab === 'links' ? 'block' : 'none';
  document.getElementById('adminPanelTools').style.display = tab === 'tools' ? 'block' : 'none';
  document.getElementById('adminPanelKpi').style.display   = tab === 'kpi'   ? 'block' : 'none';
  document.querySelectorAll('.admin-sub-tab').forEach(b => b.classList.remove('active-admin-tab'));
  btn.classList.add('active-admin-tab');
  if (tab === 'links') loadLinksAppsTable();
  if (tab === 'tools') loadToolsTableAdmin();
  if (tab === 'kpi')   loadKpiCardsTable();
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

  // Helper: build tag input with filtered items
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

  if (type === 'Markaz') {
    // Filter markazes by primary wing & tehsil
    const filtered = filterMap({ wing: primary.wing, tehsil: primary.tehsil });
    const markazs = [...new Set(filtered.map(i => i.markaz).filter(Boolean))].sort();
    area.innerHTML = buildTagInput(markazs, 'markaz', existingValue);
    if (existingValue) {
      existingValue.split(',').map(s => s.trim()).filter(Boolean).forEach(v => _addScopeTag(v, 'markaz'));
    }
  } else if (type === 'Tehsil') {
    const wings = ['M-EE', 'W-EE', 'SE'];
    area.innerHTML = buildPairTagInput(jDropdowns.tehsils, wings, 'Tehsil', 'Wing');
    if (existingValue) {
      existingValue.split(',').map(s => s.trim()).filter(Boolean).forEach(pair => {
        const parts = pair.split(':').map(p => p.trim());
        if (parts.length === 2) _addScopePairTag(pair, `${parts[0]} → ${parts[1]}`);
      });
    }
  } else if (type === 'Wing') {
    const wings = ['M-EE', 'W-EE', 'SE'];
    area.innerHTML = buildPairTagInput(jDropdowns.districts, wings, 'District', 'Wing');
    if (existingValue) {
      existingValue.split(',').map(s => s.trim()).filter(Boolean).forEach(pair => {
        const parts = pair.split(':').map(p => p.trim());
        if (parts.length === 2) _addScopePairTag(pair, `${parts[0]} → ${parts[1]}`);
      });
    }
  } else if (type === 'District') {
    // All districts – no filtering
    area.innerHTML = buildTagInput(jDropdowns.districts, 'district', existingValue);
    if (existingValue) {
      existingValue.split(',').map(s => s.trim()).filter(Boolean).forEach(v => _addScopeTag(v, 'district'));
    }
  } else if (type === 'Schools') {
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

  // Store the scope type for tag removal
  if (type !== 'Schools') {
    const picker = document.getElementById('scope_picker');
    if (picker) picker.dataset.scopeType = type;
  }
}

// ── Tag management ──────────────────────────────────────────────
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
                UH.SCOPE_TYPE, UH.SCOPE_VALUE, UH.ACCESS_TYPE];
  const cols = show.filter(h => userHeaders.includes(h));
  document.getElementById('userTHead').innerHTML =
    `<tr><th style="min-width:90px">Actions</th>${cols.map(h => `<th>${h}</th>`).join('')}</tr>`;
  document.getElementById('userTBody').innerHTML = userData.map(row => {
    const ri   = row._rowIndex;
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
            onclick="confirmDeleteUser(${ri},'${name.replace(/'/g,"\\'")}')">
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
  jLoaded ? doOpen() : loadJurisdictionDropdowns(doOpen);
}

// ── User modal: edit ─────────────────────────────────────────────
function editUser(cnic) {
  const row = userData.find(u => String(u[UH.CNIC]) === String(cnic));
  if (!row) return;
  document.getElementById('userModalTitle').textContent = 'Edit User: ' + cnic;
  const doEdit = () => {
    clearUserForm();
    setVal('u_row_index',   row._rowIndex || '');
    setVal('u_personal_no', row[UH.PERSONAL_NO] || '');
    setVal('u_name',        row[UH.NAME]         || '');
    setVal('u_cell',        row[UH.CELL]         || '');
    setVal('u_cnic',        row[UH.CNIC]         || '');
    setVal('u_password',    row[UH.PASSWORD]     || '');
    setVal('u_role',        row[UH.ROLE]         || '');
    setVal('u_access_type', row[UH.ACCESS_TYPE]  || 'Editor');
    setVal('u_district',    row[UH.DISTRICT]     || '');
    setVal('u_wing',        row[UH.WING]         || '');
    setVal('u_tehsil',      row[UH.TEHSIL]       || '');
    filterMarkazDropdown();
    setVal('u_markaz',      row[UH.MARKAZ]       || '');
    setVal('u_scope_type',  row[UH.SCOPE_TYPE]   || 'Markaz');
    renderScopeValueUI(row[UH.SCOPE_VALUE] || '');
    userModalInst.show();
  };
  jLoaded ? doEdit() : loadJurisdictionDropdowns(doEdit);
}

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }

function clearUserForm() {
  ['u_row_index','u_personal_no','u_name','u_cell','u_cnic','u_password'].forEach(id => setVal(id, ''));
  ['u_role','u_district','u_wing','u_tehsil','u_markaz','u_access_type','u_scope_type'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.options && el.options.length) el.value = el.options[0].value;
  });
  document.getElementById('scopeValueArea').innerHTML = '';
  document.getElementById('scopePreviewWrap').style.display = 'none';
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
  if (!cnic) { showToast('CNIC is required.', false); return; }
  if (!name) { showToast('Name is required.', false); return; }

  const dataObj = {
    [UH.PERSONAL_NO]: document.getElementById('u_personal_no').value.trim(),
    [UH.NAME]:        name,
    [UH.MARKAZ]:      document.getElementById('u_markaz').value.trim(),
    [UH.CELL]:        document.getElementById('u_cell').value.trim(),
    [UH.CNIC]:        cnic,
    [UH.PASSWORD]:    document.getElementById('u_password').value.trim(),
    [UH.ROLE]:        document.getElementById('u_role').value.trim(),
    [UH.DISTRICT]:    document.getElementById('u_district').value.trim(),
    [UH.WING]:        document.getElementById('u_wing').value.trim(),
    [UH.TEHSIL]:      document.getElementById('u_tehsil').value.trim(),
    [UH.SCOPE_TYPE]:  document.getElementById('u_scope_type').value.trim(),
    [UH.SCOPE_VALUE]: scopeH ? scopeH.value.trim() : '',
    [UH.ACCESS_TYPE]: document.getElementById('u_access_type').value.trim()
  };

  const btn = document.getElementById('saveUserBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving…';
  google.script.run
    .withSuccessHandler(res => {
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy-fill"></i> Save User';
      if (res.success) { userModalInst.hide(); showToast(res.message || 'User saved!'); loadUsers(); }
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
function loadLinksAppsTable() {
  document.getElementById('linksTBody').innerHTML =
    '<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--t3)"><span class="spinner-border spinner-border-sm"></span> Loading…</td></tr>';
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
    `<tr><th>Actions</th>${linksHeaders.map(h => `<th>${h}</th>`).join('')}</tr>`;
  document.getElementById('linksTBody').innerHTML = linksData.map(row => {
    const ri = row._rowIndex;
    return `<tr>
      <td style="display:flex;gap:4px">
        <button class="tbl-btn btn-edit" onclick="editLinksRow(${ri})"><i class="bi bi-pencil"></i></button>
        <button class="tbl-btn" style="border-color:var(--bad);color:var(--bad);background:var(--bad-bg)"
          onclick="confirmDeleteLinksRow(${ri})"><i class="bi bi-trash"></i></button>
      </td>
      ${linksHeaders.map(h => {
        const v = row[h] || '';
        return `<td>${String(v).startsWith('http')
          ? `<a href="${v}" target="_blank" style="color:var(--brand);font-size:.75rem">${v.substring(0, 40)}…</a>`
          : v}</td>`;
      }).join('')}
    </tr>`;
  }).join('');
}

function openLinksModal() {
  document.getElementById('linksModalTitle').textContent = 'Add New Row';
  ['la_linkName','la_linkUrl','la_appName','la_appUrl'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('la_linkCat').value = '';
  document.getElementById('la_appCat').value  = '';
  document.getElementById('la_rowIndex').value = '';
  linksModalInst.show();
}

function editLinksRow(ri) {
  const row = linksData.find(r => r._rowIndex === ri);
  if (!row) return;
  const g = ci => row[linksHeaders[ci]] || '';
  document.getElementById('linksModalTitle').textContent = 'Edit Row';
  document.getElementById('la_linkName').value  = g(LA_COL.LINK_NAME);
  document.getElementById('la_linkUrl').value   = g(LA_COL.LINK_URL);
  document.getElementById('la_linkCat').value   = g(LA_COL.LINK_CATEGORY);
  document.getElementById('la_appName').value   = g(LA_COL.APP_NAME);
  document.getElementById('la_appUrl').value    = g(LA_COL.APP_URL);
  document.getElementById('la_appCat').value    = g(LA_COL.APP_CATEGORY);
  document.getElementById('la_rowIndex').value  = ri;
  linksModalInst.show();
}

function submitLinksRow() {
  const obj = {};
  const s   = (ci, v) => { if (linksHeaders[ci] !== undefined) obj[linksHeaders[ci]] = v; };
  s(LA_COL.LINK_NAME,     document.getElementById('la_linkName').value.trim());
  s(LA_COL.LINK_URL,      document.getElementById('la_linkUrl').value.trim());
  s(LA_COL.APP_NAME,      document.getElementById('la_appName').value.trim());
  s(LA_COL.APP_URL,       document.getElementById('la_appUrl').value.trim());
  s(LA_COL.APP_CATEGORY,  document.getElementById('la_appCat').value.trim());
  s(LA_COL.LINK_CATEGORY, document.getElementById('la_linkCat').value.trim());

  const hasLink = document.getElementById('la_linkName').value.trim() || document.getElementById('la_linkUrl').value.trim();
  const hasApp  = document.getElementById('la_appName').value.trim()  || document.getElementById('la_appUrl').value.trim();
  if (!hasLink && !hasApp) { showToast('Fill in at least a link or app.', false); return; }

  const ri  = parseInt(document.getElementById('la_rowIndex').value) || null;
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
function loadToolsTableAdmin() {
  document.getElementById('toolsTBody').innerHTML =
    '<tr><td colspan="3" style="padding:20px;text-align:center;color:var(--t3)"><span class="spinner-border spinner-border-sm"></span> Loading…</td></tr>';
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
    `<tr><th>Actions</th>${toolsHeaders.map(h => `<th>${h}</th>`).join('')}</tr>`;
  document.getElementById('toolsTBody').innerHTML = toolsData.map(row => {
    const ri = row._rowIndex;
    return `<tr>
      <td style="display:flex;gap:4px">
        <button class="tbl-btn btn-edit" style="border-color:var(--purple);color:var(--purple);background:var(--purple-bg)"
          onclick="editToolRow(${ri})"><i class="bi bi-pencil"></i></button>
        <button class="tbl-btn" style="border-color:var(--bad);color:var(--bad);background:var(--bad-bg)"
          onclick="confirmDeleteToolRow(${ri})"><i class="bi bi-trash"></i></button>
      </td>
      ${toolsHeaders.map(h => {
        const v = row[h] || '';
        return `<td>${String(v).startsWith('http')
          ? `<a href="${v}" target="_blank" style="color:var(--purple)">${v.substring(0, 40)}…</a>`
          : v}</td>`;
      }).join('')}
    </tr>`;
  }).join('');
}

function openToolModal() {
  document.getElementById('toolModalTitle').textContent = 'Add New Tool';
  document.getElementById('tool_name').value     = '';
  document.getElementById('tool_url').value      = '';
  document.getElementById('tool_rowIndex').value = '';
  toolModalInst.show();
}

function editToolRow(ri) {
  const row = toolsData.find(r => r._rowIndex === ri);
  if (!row) return;
  document.getElementById('toolModalTitle').textContent = 'Edit Tool';
  document.getElementById('tool_name').value     = row[toolsHeaders[0]] || '';
  document.getElementById('tool_url').value      = row[toolsHeaders[1]] || '';
  document.getElementById('tool_rowIndex').value = ri;
  toolModalInst.show();
}

function submitToolRow() {
  const obj = {};
  if (toolsHeaders[0]) obj[toolsHeaders[0]] = document.getElementById('tool_name').value.trim();
  if (toolsHeaders[1]) obj[toolsHeaders[1]] = document.getElementById('tool_url').value.trim();
  if (!obj[toolsHeaders[0]] || !obj[toolsHeaders[1]]) { showToast('Name and URL required.', false); return; }

  const ri  = parseInt(document.getElementById('tool_rowIndex').value) || null;
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
    '<tr><td colspan="9" style="padding:20px;text-align:center;color:var(--t3)"><span class="spinner-border spinner-border-sm"></span> Loading…</td></tr>';
  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast(res.message, false); return; }
      kpiCardsData = res.data || [];
      renderKpiCardsTable(res.headers || [], kpiCardsData);
    })
    .withFailureHandler(err => showToast('Load error: ' + err.message, false))
    .getKpiCardsAdmin(currentUser);
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
      <th>Icon</th>
      <th>Color</th>
      <th>Description</th>
      <th>Action Type</th>
      <th>Action Value</th>
      <th>Active</th>
    </tr>`;

  document.getElementById('kpiTBody').innerHTML = data.map(row => {
    const ri      = row._rowIndex;
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
            onclick="editKpiCard(${ri})" title="Edit">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="tbl-btn" style="border-color:var(--bad);color:var(--bad);background:var(--bad-bg)"
            onclick="confirmDeleteKpiCard(${ri})" title="Delete">
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
      <td><code>bi-${icon}</code></td>
      <td><span class="scope-badge cb-${color}">${color}</span></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;font-size:.8rem;color:var(--t2)">${row['Card Description'] || ''}</td>
      <td>${aTypeLabel}</td>
      <td style="font-size:.75rem;color:var(--t2);max-width:150px;overflow:hidden;text-overflow:ellipsis">${aVal}</td>
      <td><span class="${active === 'Yes' ? 'active-yes' : 'active-no'}">${active}</span></td>
    </tr>`;
  }).join('');
}

// ── Open KPI modal: add ──────────────────────────────────────────
function openKpiCardModal() {
  document.getElementById('kpiCardModalTitle').textContent = 'Add Dashboard Card';
  document.getElementById('kc_title').value       = '';
  document.getElementById('kc_icon').value        = 'people-fill';
  document.getElementById('kc_color').value       = 'accent';
  document.getElementById('kc_desc').value        = '';
  document.getElementById('kc_action_type').value = 'module';
  document.getElementById('kc_module_select').value = 'openHrModule';
  document.getElementById('kc_url_input').value   = '';
  document.getElementById('kc_active').value      = 'Yes';
  document.getElementById('kc_order').value       = '10';
  document.getElementById('kc_rowIndex').value    = '';
  onKpiActionTypeChange();
  updateKpiPreview();
  kpiCardModalInst.show();
}

// ── Open KPI modal: edit ─────────────────────────────────────────
function editKpiCard(ri) {
  const row = kpiCardsData.find(r => r._rowIndex === ri);
  if (!row) return;
  document.getElementById('kpiCardModalTitle').textContent = 'Edit Dashboard Card';
  document.getElementById('kc_title').value    = row['Card Title']       || '';
  document.getElementById('kc_icon').value     = row['Card Icon']        || 'people-fill';
  document.getElementById('kc_color').value    = row['Card Color']       || 'accent';
  document.getElementById('kc_desc').value     = row['Card Description'] || '';
  document.getElementById('kc_active').value   = row['Active']           || 'Yes';
  document.getElementById('kc_order').value    = row['Display Order']    || '10';
  document.getElementById('kc_rowIndex').value = ri;

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

  const rowData = {
    'Card Title':       title,
    'Card Icon':        document.getElementById('kc_icon').value.trim(),
    'Card Color':       document.getElementById('kc_color').value.trim(),
    'Card Description': document.getElementById('kc_desc').value.trim(),
    'Action Type':      aType,
    'Action Value':     aVal,
    'Active':           document.getElementById('kc_active').value.trim(),
    'Display Order':    document.getElementById('kc_order').value.trim() || '10'
  };

  const ri  = parseInt(document.getElementById('kc_rowIndex').value) || null;
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
