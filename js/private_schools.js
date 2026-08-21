// ── Private module JS ──
// ══════════════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════════════
let privHeaders          = [];
let privData             = [];
let privFilteredCache    = [];
let currentPrivSheet     = '';
let privDataLoaded       = false;
let privModal;
let nameCheckModalInstance;

// Pagination state
let privPageSize         = 50;
let privCurrentPage      = 1;

// ── Row Editing Mode state ──────────────────────────────────────────
let privRowEditModeEnabled = false;   // "Enable Row Editing" toggle
let privEditingRowKey      = null;    // Unique ID of the row currently being edited inline (only one at a time)

// Columns that must never be edited via Row Editing Mode — the School
// column and the school's primary identifier. Never remove entries
// from this list without a very deliberate reason.
const PRIV_ROW_EDIT_LOCKED_HEADERS = ['Unique ID', 'School Name'];

// ★ NEW: Store filtered school hierarchy for dropdowns
let privSchoolHierarchy = [];

// Header keys for cascade filters
let privFHeaders = { district: '', tehsil: '', markaz: '', status: '', name: '', regNo: '', regStatus: '', category: '' };

// ═══════════════════════════════════════════════════════════════════
//  FIELD CONFIG — Columns A to AK
// ═══════════════════════════════════════════════════════════════════
const PRIVATE_FIELD_CONFIG = [
  { header: 'Unique ID', col: 'unique_id',                                                                                    id: 'priv_uid',         readonly: true,  placeholder: 'Auto-generated' },
  { header: 'District', col: 'district',                                                                                     id: 'priv_district',    type: 'select', options: [], onchange: 'onPrivFormDistrictChange()' },
  { header: 'Tehsil', col: 'tehsil',                                                                                      id: 'priv_tehsil',      type: 'select', options: [], onchange: 'onPrivFormTehsilChange()' },
  { header: 'Markaz Name', col: 'markaz_name',                                                                                  id: 'priv_markaz',      type: 'select', options: [] },
  { header: 'School Category', col: 'school_category',   hint: 'School Category',                       id: 'priv_cat',         type: 'select', options: [] },
  { header: 'School Name', col: 'school_name',                                                                                  id: 'priv_name',        wide: true },
  { header: 'Registeration Status', col: 'registration_status', hint: 'Registeration Status (Registered/Non Registered/Expired/In Process/Provisional E-License Issued)',       id: 'priv_reg_status',  type: 'select', options: ['Registered', 'Non Registered', 'Expired', 'In Process', 'Provisional E-License Issued'], onchange: 'handleRegStatus()' },
  { header: 'Registeration No', col: 'registration_no',  hint: 'Registeration No in Case of registered (EMIS Code)',                id: 'priv_reg_no',      type: 'text', readonly: true, placeholder: 'e.g. 123456 or 123456, 789012' },
  { header: 'Date of Expiry of Registeration', col: 'registration_expiry_date', hint: 'Date of Expiry of Registeration',                     id: 'priv_reg_exp',     type: 'date'   },
  { header: 'Level', col: 'level',             hint: 'Level (Primary,Middle,High,Higher Secondary)',                      id: 'priv_level',       type: 'select', options: ['Primary', 'Middle', 'High', 'Higher Secondary'] },
  { header: 'School Gender', col: 'school_gender',                                                                               id: 'priv_gender',      type: 'select', options: ['Male', 'Female', 'Both'] },
  { header: 'School Physical Address', col: 'physical_address',                                                                      id: 'priv_addr'        },
  { header: 'Zebra Crossing', col: 'zebra_crossing',                                                                              id: 'priv_zebra',       type: 'select', options: ['Painted', 'Not Needed', 'Needed But not Painted'] },
  { header: 'Longitude', col: 'longitude',                                                                                   id: 'priv_long',        type: 'number' },
  { header: 'Latitude', col: 'latitude',                                                                                    id: 'priv_lat',         type: 'number' },
  { header: 'Owner name', col: 'owner_name',                                                                                  id: 'priv_noval'       },
  { header: 'Owner CNIC', col: 'owner_cnic',                                                                                  id: 'priv_own_cnic',    type: 'number', placeholder: '13 digits', onblur: 'validateCNIC(this)' },
  { header: 'Owner Cell No', col: 'owner_cell_no',                                                                               id: 'priv_own_cell',    type: 'number', placeholder: '11 digits' },
  { header: 'Principal Name', col: 'principal_name',                                                                              id: 'priv_prin_name'   },
  { header: 'Principal CNIC', col: 'principal_cnic',                                                                             id: 'priv_prin_cnic',   type: 'number', placeholder: '13 digits', onblur: 'validateCNIC(this)' },
  { header: 'Principal Cell No', col: 'principal_cell_no',                                                                          id: 'priv_prin_cell',   type: 'number' },
  { header: 'Building Certificate Expirey', col: 'building_certificate_expiry',                                                               id: 'priv_bldg_exp',    type: 'date'   },
  { header: 'Health and hygiene Certificate Expirey', col: 'health_hygiene_cert_expiry', hint: 'Health and hygiene Certificate Expirey',      id: 'priv_health_exp',  type: 'date'   },
  { header: 'Total Rooms', col: 'total_rooms',                                                                                id: 'priv_rooms',       type: 'number' },
  { header: 'Total Teaching Staff', col: 'total_teaching_staff',                                                                       id: 'priv_teach_staff', type: 'number' },
  { header: 'Total Non Teaching Staff', col: 'total_non_teaching_staff',                                                                   id: 'priv_non_teach',   type: 'number' },
  { header: 'Total Enrolment', col: 'total_enrollment',                                                                            id: 'priv_enrol',       type: 'number', oninput: 'calcPrivCategory()' },
  { header: 'Security Category', col: 'security_category',                                                                          id: 'priv_sec_cat',     readonly: true },
  { header: 'Entry Gates', col: 'entry_gates',       hint: 'Entry Gates (No.)',                                                id: 'priv_gates',       type: 'number' },
  { header: 'Operational Gates', col: 'operational_gates', hint: 'Operational Gates (No.)',                                          id: 'priv_op_gates',    type: 'number' },
  { header: 'CCTV Cameras', col: 'cctv_cameras',      hint: 'CCTV Cameras (No.)',                                               id: 'priv_cctv',        type: 'number' },
  { header: 'Security Guards', col: 'security_guards',   hint: 'Security Guards (No.)',                                            id: 'priv_guards',      type: 'number' },
  { header: 'Height of boundary walls', col: 'boundary_wall_height_ft', hint: 'Height of boundary walls (ft)',                             id: 'priv_wall_h',      type: 'number' },
  { header: 'Barbed wires', col: 'barbed_wires',      hint: 'Barbed wires on boundary walls (Yes/No)',                          id: 'priv_barbed',      type: 'select', options: ['Yes', 'No'] },
  { header: 'Fire fighting system', col: 'firefighting_system', hint: 'Fire fighting system (Yes/No)',                                 id: 'priv_fire',        type: 'select', options: ['Yes', 'No'] },
  { header: 'Nearby key installations', col: 'nearby_key_installations', hint: 'Nearby key installations (No.)',                            id: 'priv_ki_no',       type: 'number', oninput: 'generateKICascades()' },
  { header: 'Name of Key Installation', col: 'key_installation_name',                                                                   id: 'priv_ki_names',    hidden: true   },
  { header: 'Gate facing KI', col: 'gate_facing_ki',    hint: 'Gate facing KI, if any (Yes/No)',                                  id: 'priv_ki_gate',     type: 'select', options: ['Yes', 'No'] },
  { header: 'Status', col: 'status',                                                                                     id: 'priv_status',      type: 'select', options: ['Active', 'Inactive'] }
];

// ══════════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  privModal              = new bootstrap.Modal(document.getElementById('privateSchoolModal'));
  nameCheckModalInstance = new bootstrap.Modal(document.getElementById('nameCheckModal'));
  // Page size dropdown
  document.getElementById('privPageSize').addEventListener('change', function() {
    privPageSize = parseInt(this.value);
    privCurrentPage = 1;
    applyPrivFilters();
  });
});

// ══════════════════════════════════════════════════════════════════════
//  OPEN MODULE
//  sheetName: 'Private'  → Private
//             'Inactive' → Inactive
// ══════════════════════════════════════════════════════════════════════
function openPrivateModule(sheetName) {
  try {
    currentPrivSheet = sheetName;
    privDataLoaded   = false;
    privData         = [];
    privHeaders      = [];
    privFilteredCache = [];
    privSchoolHierarchy = [];

    document.getElementById('privCurrentSheet').textContent = sheetName;
    document.getElementById('privRecordCount').innerHTML    = '<i class="bi bi-database"></i> —';
    const catEl = document.getElementById('privFltCategory');
    if (catEl) catEl.value = sheetName;

    // Hide Add button for Inactive sheet
    document.getElementById('btnPrivAdd').style.display =
      (sheetName === 'Inactive') ? 'none' : 'flex';

    if (typeof switchGlobalTab === 'function') switchGlobalTab('privateDataView', null);
    if (typeof loadKpiCardsForModule === 'function') {
      loadKpiCardsForModule('private_schools', 'privateKpiGrid', 'privateKpiSection');
    }

    // Reset to empty state
    _privShowEmptyState('Loading data…', true);

    // Reset filter dropdowns
    ['privFltDistrict','privFltTehsil','privFltMarkaz','privFltStatus','privFltRegStatus','privFltSchoolCategory','privFltSearch','privSearchInput']
      .forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.tagName === 'SELECT') {
          if (id === 'privFltStatus') { el.value = ''; return; }
          el.innerHTML = '<option value="">All</option>';
        } else {
          el.value = '';
        }
      });

    const activeUser = (typeof currentUser !== 'undefined') ? currentUser : null;

    // ★ Step 1: Load filtered school hierarchy for dropdowns
    google.script.run
      .withSuccessHandler(function(schools) {
        privSchoolHierarchy = schools || [];
        // ★ Step 2: Load the actual data rows
        google.script.run
          .withSuccessHandler(res => {
            if (!res || !res.success) {
              _privShowEmptyState('Error loading data: ' + (res ? res.message : 'Unknown'), false);
              return;
            }
            privHeaders   = res.headers;
            privData      = res.data;
            privDataLoaded = true;

            setupPrivFilterHeaders();
            // ★ Populate dropdowns from schoolHierarchy (not from privData)
            populatePrivFiltersFromHierarchy();
            // Lock/grey out dropdowns per the user's jurisdiction level.
            // No Wing filter exists in this module, so it's simply
            // omitted from the ids map below. Option restriction itself
            // comes from RLS on `schools` — this only controls which
            // selects are interactive.
            if (typeof applyJurisdictionLock === 'function') {
              applyJurisdictionLock(
                { district: 'privFltDistrict', tehsil: 'privFltTehsil', markaz: 'privFltMarkaz' },
                activeUser
              );
            }

            refreshPrivateCategoryOptions(() => {
              buildPrivateForm();
              populatePrivRegStatusFilter();
              populatePrivSchoolCategoryFilter();
              renderPrivCategoryCards();
              renderPrivRegStatusCards();
            });

            // Show "apply filter" prompt — do NOT render rows yet
            _privShowEmptyState('Select your filters above and click Filter Data to load records.', false);
            document.getElementById('privRecordCount').innerHTML =
              `<i class="bi bi-database"></i> ${privData.length} Total`;
          })
          .withFailureHandler(err => {
            _privShowEmptyState('Server error: ' + err.message, false);
          })
          .getPrivateDashboardData(activeUser, sheetName);
      })
      .withFailureHandler(err => {
        _privShowEmptyState('Error loading school hierarchy: ' + err.message, false);
      })
      .getSchoolHierarchyForUser(activeUser);
  } catch (e) {
    alert('openPrivateModule crash: ' + e.message);
  }
}

// Toggle empty state vs table
function _privShowEmptyState(msg, isLoading) {
  const empty = document.getElementById('privEmptyState');
  const wrap  = document.getElementById('privTableWrap');
  if (empty) {
    empty.style.display = 'block';
    empty.innerHTML = isLoading
      ? `<span class="spinner-border spinner-border-sm"></span><span style="margin-left:8px">${msg}</span>`
      : `<i class="bi bi-funnel"></i><p>${msg}</p>`;
  }
  if (wrap) wrap.style.display = 'none';
  const th = document.getElementById('privTHead');
  const tb = document.getElementById('privTBody');
  if (th) th.innerHTML = '';
  if (tb) tb.innerHTML = '';
}

// ══════════════════════════════════════════════════════════════════════
//  FILTER HEADER MAPPING & DROPDOWN POPULATION (NEW)
// ══════════════════════════════════════════════════════════════════════
function setupPrivFilterHeaders() {
  const findH = (keys) =>
    privHeaders.find(h => keys.some(k => String(h).toLowerCase().includes(k))) || '';
  // Exact-match lookup, used where a substring match would risk
  // colliding with another header (e.g. "Registeration Status" also
  // contains the substring "status").
  const findHExact = (h2) =>
    privHeaders.find(h => String(h).toLowerCase() === h2.toLowerCase()) || '';
  privFHeaders.district  = findH(['district']);
  privFHeaders.tehsil    = findH(['tehsil']);
  privFHeaders.markaz    = findH(['markaz name', 'markaz']);
  privFHeaders.status    = findH(['status']);
  privFHeaders.name      = findH(['school name']);
  privFHeaders.regNo     = findH(['emis code', 'reg no', 'registeration no']);
  privFHeaders.regStatus = findHExact('Registeration Status');
  privFHeaders.category  = findHExact('School Category');
}

// ★ NEW: Populate dropdowns from schoolHierarchy
function populatePrivFiltersFromHierarchy() {
  const dists = [...new Set(privSchoolHierarchy.map(s => s.d).filter(Boolean))].sort();
  const tehsils = [...new Set(privSchoolHierarchy.map(s => s.t).filter(Boolean))].sort();
  const markazs = [...new Set(privSchoolHierarchy.map(s => s.m).filter(Boolean))].sort();

  const popSelect = (id, items) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = '<option value="">All</option>' +
      items.map(v => `<option value="${_privEsc(v)}">${_privEsc(v)}</option>`).join('');
    if (items.includes(cur)) el.value = cur;
  };

  popSelect('privFltDistrict', dists);
  popSelect('privFltTehsil', tehsils);
  popSelect('privFltMarkaz', markazs);
}

// ══════════════════════════════════════════════════════════════════════
//  REGISTRATION STATUS FILTER — always lists every valid status
//  (including ones with 0 current records), sourced from the same
//  PRIVATE_FIELD_CONFIG options list the form's dropdown uses, so
//  adding/renaming a status there is the only place it needs to change.
// ══════════════════════════════════════════════════════════════════════
function populatePrivRegStatusFilter() {
  const el = document.getElementById('privFltRegStatus');
  if (!el) return;
  const cur = el.value;
  const statusField = PRIVATE_FIELD_CONFIG.find(f => f.header === 'Registeration Status');
  const statuses = statusField ? statusField.options : [];
  el.innerHTML = '<option value="">All</option>' +
    statuses.map(s => `<option value="${_privEsc(s)}">${_privEsc(s)}</option>`).join('');
  if (statuses.includes(cur)) el.value = cur;
}

// School Category filter — sourced dynamically from admin-managed
// categories (same list the Add/Edit form uses via
// refreshPrivateCategoryOptions), never hard-coded.
function populatePrivSchoolCategoryFilter() {
  const el = document.getElementById('privFltSchoolCategory');
  if (!el) return;
  const cur = el.value;
  const catField = PRIVATE_FIELD_CONFIG.find(f => f.header === 'School Category');
  const cats = catField ? catField.options : [];
  el.innerHTML = '<option value="">All</option>' +
    cats.map(c => `<option value="${_privEsc(c)}">${_privEsc(c)}</option>`).join('');
  if (cats.includes(cur)) el.value = cur;
}

// ══════════════════════════════════════════════════════════════════════
//  CATEGORY CARDS — one card per School Category, dynamically generated,
//  showing live counts from the currently loaded sheet (Active/Inactive).
//  Clicking a card filters the table to that category.
// ══════════════════════════════════════════════════════════════════════
function renderPrivCategoryCards() {
  const grid = document.getElementById('privCategoryCards');
  if (!grid) return;
  const catField = PRIVATE_FIELD_CONFIG.find(f => f.header === 'School Category');
  const cats = catField ? catField.options : [];
  const header = privFHeaders.category;

  const counts = {};
  cats.forEach(c => counts[c] = 0);
  if (header) {
    privData.forEach(r => {
      const v = r[header];
      if (v) counts[v] = (counts[v] || 0) + 1;
    });
  }

  grid.innerHTML = cats.map(c => `
    <div class="kpi-card" style="cursor:pointer" onclick="selectPrivCategoryCard('${_privJsEsc(c)}')">
      <div class="kpi-title">${_privEsc(c)}</div>
      <div class="kpi-value">${counts[c] || 0}</div>
      <i class="bi bi-mortarboard-fill kpi-icon"></i>
    </div>
  `).join('') || '<div style="color:var(--t3);font-size:.85rem;padding:8px">No categories configured yet.</div>';
}

function selectPrivCategoryCard(cat) {
  const el = document.getElementById('privFltSchoolCategory');
  if (el) el.value = cat;
  applyPrivFilters();
}

// ══════════════════════════════════════════════════════════════════════
//  REGISTRATION STATUS CARDS — one card per valid status, always shown
//  (even with a count of 0). Clicking a card filters the table to that
//  status.
// ══════════════════════════════════════════════════════════════════════
function renderPrivRegStatusCards() {
  const grid = document.getElementById('privRegStatusCards');
  if (!grid) return;
  const statusField = PRIVATE_FIELD_CONFIG.find(f => f.header === 'Registeration Status');
  const statuses = statusField ? statusField.options : [];
  const header = privFHeaders.regStatus;

  const counts = {};
  statuses.forEach(s => counts[s] = 0);
  if (header) {
    privData.forEach(r => {
      const v = r[header];
      if (v) counts[v] = (counts[v] || 0) + 1;
    });
  }

  grid.innerHTML = statuses.map(s => `
    <div class="kpi-card" style="cursor:pointer" onclick="selectPrivRegStatusCard('${_privJsEsc(s)}')">
      <div class="kpi-title">${_privEsc(s)}</div>
      <div class="kpi-value">${counts[s] || 0}</div>
      <i class="bi bi-patch-check-fill kpi-icon"></i>
    </div>
  `).join('');
}

function selectPrivRegStatusCard(status) {
  const el = document.getElementById('privFltRegStatus');
  if (el) el.value = status;
  applyPrivFilters();
}

// Escape a value for safe embedding inside a single-quoted JS string
// literal in generated onclick="" HTML attributes.
function _privJsEsc(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ══════════════════════════════════════════════════════════════════════
//  CASCADE FILTER – uses schoolHierarchy (not privData)
// ══════════════════════════════════════════════════════════════════════
function updatePrivCascades(trigger) {
  const d = document.getElementById('privFltDistrict').value;
  const t = document.getElementById('privFltTehsil').value;

  let filtered = [...privSchoolHierarchy];

  if (trigger === 'District') {
    if (d) filtered = filtered.filter(s => s.d === d);
    const tehsils = [...new Set(filtered.map(s => s.t).filter(Boolean))].sort();
    const markazs = [...new Set(filtered.map(s => s.m).filter(Boolean))].sort();

    popSelect('privFltTehsil', tehsils);
    document.getElementById('privFltTehsil').value = '';
    popSelect('privFltMarkaz', markazs);
    document.getElementById('privFltMarkaz').value = '';
    return;
  }

  if (d) filtered = filtered.filter(s => s.d === d);
  if (trigger === 'Tehsil') {
    if (t) filtered = filtered.filter(s => s.t === t);
    const markazs = [...new Set(filtered.map(s => s.m).filter(Boolean))].sort();
    popSelect('privFltMarkaz', markazs);
    document.getElementById('privFltMarkaz').value = '';
  }
}

function popSelect(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  const cur = el.value;
  el.innerHTML = '<option value="">All</option>' +
    items.map(v => `<option value="${_privEsc(v)}">${_privEsc(v)}</option>`).join('');
  if (items.includes(cur)) el.value = cur;
}

// ══════════════════════════════════════════════════════════════════════
//  APPLY FILTERS — only when user clicks "Filter Data"
// ══════════════════════════════════════════════════════════════════════
function applyPrivFilters() {
  if (!privDataLoaded) {
    if (typeof showToast === 'function') showToast('Data is still loading, please wait.', false);
    return;
  }

  const d   = document.getElementById('privFltDistrict').value;
  const t   = document.getElementById('privFltTehsil').value;
  const m   = document.getElementById('privFltMarkaz').value;
  const st  = document.getElementById('privFltStatus').value;
  const rs  = document.getElementById('privFltRegStatus')?.value || '';
  const cat = document.getElementById('privFltSchoolCategory')?.value || '';
  const q   = document.getElementById('privFltSearch').value.toLowerCase().trim();

  let fData = [...privData];
  if (d   && privFHeaders.district)  fData = fData.filter(r => r[privFHeaders.district]  === d);
  if (t   && privFHeaders.tehsil)    fData = fData.filter(r => r[privFHeaders.tehsil]    === t);
  if (m   && privFHeaders.markaz)    fData = fData.filter(r => r[privFHeaders.markaz]    === m);
  if (st  && privFHeaders.status)    fData = fData.filter(r => r[privFHeaders.status]    === st);
  if (rs  && privFHeaders.regStatus) fData = fData.filter(r => r[privFHeaders.regStatus] === rs);
  if (cat && privFHeaders.category)  fData = fData.filter(r => r[privFHeaders.category]  === cat);
  if (q) fData = fData.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));

  // ★ NEW: Sort filtered results by School Name (A → Z) alphabetically
  if (privFHeaders.name) {
    fData.sort((a, b) => {
      const nameA = (a[privFHeaders.name] || '').toString().toLowerCase();
      const nameB = (b[privFHeaders.name] || '').toString().toLowerCase();
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      return 0;
    });
  }

  privFilteredCache = fData;

  // Pagination
  const totalRecords = fData.length;
  const totalPages = Math.ceil(totalRecords / privPageSize);
  if (privCurrentPage > totalPages) privCurrentPage = totalPages || 1;
  const start = (privCurrentPage - 1) * privPageSize;
  const pageData = fData.slice(start, start + privPageSize);

  document.getElementById('privEmptyState').style.display = 'none';
  document.getElementById('privTableWrap').style.display  = 'block';

  document.getElementById('privRecordCount').innerHTML =
    `<i class="bi bi-database"></i> ${totalRecords} Records (Page ${privCurrentPage}/${totalPages})`;

  renderPrivateTable(pageData, totalRecords);
}

// ══════════════════════════════════════════════════════════════════════
//  TABLE RENDER
// ══════════════════════════════════════════════════════════════════════
function renderPrivateTable(dataArr, totalRecords) {
  if (!dataArr.length) {
    document.getElementById('privTHead').innerHTML = '';
    document.getElementById('privTBody').innerHTML =
      `<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--t3)">
         No records match the selected filters.
       </td></tr>`;
    return;
  }
  document.getElementById('privTHead').innerHTML =
    `<tr><th>Actions</th>${privHeaders.map(h => `<th>${_privEsc(h)}</th>`).join('')}</tr>`;
  document.getElementById('privTBody').innerHTML = dataArr.map(row => {
    const keyVal = String(row['Unique ID'] || '');
    const keyValJs = _privJsEsc(keyVal);
    const isEditingThisRow = privRowEditModeEnabled && privEditingRowKey === keyVal;

    if (isEditingThisRow) {
      return `<tr class="priv-row-editing">
        <td class="priv-row-edit-actions">
          <button class="tbl-btn btn-save" title="Save" onclick="savePrivRowEdit('${keyValJs}')">
            <i class="bi bi-check-lg"></i>
          </button>
          <button class="tbl-btn btn-cancel" title="Cancel" onclick="cancelPrivRowEdit()">
            <i class="bi bi-x-lg"></i>
          </button>
        </td>
        ${privHeaders.map(h => _renderPrivRowEditCell(h, row, keyVal)).join('')}
      </tr>`;
    }

    return `<tr>
      <td>
        <button class="tbl-btn btn-edit" title="Edit in form" onclick="editPrivate('${keyValJs}')">
          <i class="bi bi-pencil"></i>
        </button>
        ${privRowEditModeEnabled ? `
        <button class="tbl-btn btn-row-edit" title="Edit row inline" onclick="startPrivRowEdit('${keyValJs}')">
          <i class="bi bi-pencil-square"></i>
        </button>` : ''}
      </td>
      ${privHeaders.map(h => `<td>${_privEsc(String(row[h] || ''))}</td>`).join('')}
    </tr>`;
  }).join('');

  // Add pagination controls
  const totalPages = Math.ceil(totalRecords / privPageSize);
  if (totalPages > 1) {
    const paginationHtml = `
      <div style="display:flex; justify-content:center; align-items:center; gap:10px; margin-top:15px;">
        <button class="btn btn-outline-secondary btn-sm" onclick="privGoPage(${privCurrentPage - 1})" ${privCurrentPage === 1 ? 'disabled' : ''}>Previous</button>
        <span>Page ${privCurrentPage} of ${totalPages}</span>
        <button class="btn btn-outline-secondary btn-sm" onclick="privGoPage(${privCurrentPage + 1})" ${privCurrentPage === totalPages ? 'disabled' : ''}>Next</button>
      </div>
    `;
    const tblWrap = document.getElementById('privTableWrap');
    const existing = tblWrap.querySelector('.priv-pagination');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'priv-pagination';
    div.innerHTML = paginationHtml;
    tblWrap.appendChild(div);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  ROW EDITING MODE — inline table editing without opening the full form
// ══════════════════════════════════════════════════════════════════════

// Re-renders only the currently visible page, preserving filters and
// pagination state (used by row-edit toggle/cancel so we don't disturb
// the user's current filter/search context).
function rerenderCurrentPrivPage() {
  const totalRecords = privFilteredCache.length;
  const totalPages = Math.ceil(totalRecords / privPageSize) || 1;
  if (privCurrentPage > totalPages) privCurrentPage = totalPages;
  const start = (privCurrentPage - 1) * privPageSize;
  const pageData = privFilteredCache.slice(start, start + privPageSize);
  renderPrivateTable(pageData, totalRecords);
}

function togglePrivRowEditMode() {
  privRowEditModeEnabled = document.getElementById('privRowEditToggle').checked;
  privEditingRowKey = null; // leaving/entering the mode always clears any in-progress edit
  if (privFilteredCache.length || privDataLoaded) rerenderCurrentPrivPage();
}

function startPrivRowEdit(keyVal) {
  privEditingRowKey = keyVal;
  rerenderCurrentPrivPage();
}

function cancelPrivRowEdit() {
  privEditingRowKey = null;
  rerenderCurrentPrivPage();
}

// Build a single <td> for a row in inline-edit mode. Locked columns
// (School column + primary identifier) always render as plain
// read-only text — never an editable input — no matter what.
function _renderPrivRowEditCell(header, row, keyVal) {
  const val = row[header] != null ? row[header] : '';
  if (PRIV_ROW_EDIT_LOCKED_HEADERS.includes(header)) {
    return `<td class="priv-row-locked" title="Locked — cannot be changed here">${_privEsc(String(val))} <i class="bi bi-lock-fill" style="opacity:.5;font-size:.7em"></i></td>`;
  }

  const f = PRIVATE_FIELD_CONFIG.find(fc => fc.header === header);
  if (!f) {
    // Unmapped/computed column (shouldn't normally happen) — show read-only.
    return `<td>${_privEsc(String(val))}</td>`;
  }

  const cellId = `re_${f.id}_${_privSafeIdPart(keyVal)}`;

  // Computed / always-readonly fields (e.g. Security Category, Unique ID)
  if (f.readonly) {
    return `<td><input type="text" id="${cellId}" data-header="${_privEsc(header)}" value="${_privEsc(String(val))}" readonly style="width:100%;background:transparent;border:none"></td>`;
  }

  if (f.type === 'select') {
    // Registration status field drives whether registration-related
    // fields (reg no / reg exp / building cert / health cert) are
    // editable in this row — mirrors handleRegStatus() in the full form.
    const isRegStatusField = header === 'Registeration Status';
    const opts = f.options.map(o =>
      `<option ${o === val ? 'selected' : ''}>${_privEsc(o)}</option>`).join('');
    return `<td><select id="${cellId}" data-header="${_privEsc(header)}" style="width:100%"
              ${isRegStatusField ? `onchange="_onPrivRowRegStatusChange('${_privJsEsc(keyVal)}')"` : ''}>
              <option value="">Select</option>${opts}
            </select></td>`;
  }

  // Registration-dependent fields start disabled/enabled based on the
  // row's current (unsaved) registration status, same rule as the form.
  const regDependent = ['Registeration No', 'Date of Expiry of Registeration', 'Building Certificate Expirey', 'Health and hygiene Certificate Expirey'];
  let disabledAttr = '';
  if (regDependent.includes(header)) {
    const st = row['Registeration Status'];
    if (!REG_FIELDS_UNLOCKED_STATUSES.includes(st)) disabledAttr = 'disabled';
  }

  return `<td><input type="${f.type || 'text'}" id="${cellId}" data-header="${_privEsc(header)}" value="${_privEsc(String(val))}" ${disabledAttr} style="width:100%"></td>`;
}

// When the registration-status <select> changes inside an editing row,
// toggle the registration-related inputs in that same row — mirrors
// handleRegStatus() in the full Add/Edit form.
function _onPrivRowRegStatusChange(keyVal) {
  const safe = _privSafeIdPart(keyVal);
  const stEl = document.getElementById(`re_priv_reg_status_${safe}`);
  if (!stEl) return;
  const unlock = REG_FIELDS_UNLOCKED_STATUSES.includes(stEl.value);
  ['priv_reg_no', 'priv_reg_exp', 'priv_bldg_exp', 'priv_health_exp'].forEach(fid => {
    const el = document.getElementById(`re_${fid}_${safe}`);
    if (el) el.disabled = !unlock;
  });
}

// Sanitize a Unique ID for safe use inside an HTML element id attribute.
function _privSafeIdPart(v) {
  return String(v).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function savePrivRowEdit(keyVal) {
  const safe = _privSafeIdPart(keyVal);
  const dataObj = { 'Unique ID': keyVal };

  PRIVATE_FIELD_CONFIG.forEach(f => {
    if (PRIV_ROW_EDIT_LOCKED_HEADERS.includes(f.header)) return; // never touch locked columns
    const el = document.getElementById(`re_${f.id}_${safe}`);
    if (el) dataObj[f.header] = el.value;
  });

  const btn = event?.currentTarget;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; }

  const activeUser = (typeof currentUser !== 'undefined') ? currentUser : null;

  google.script.run
    .withSuccessHandler(res => {
      if (res && res.success) {
        if (typeof showToast === 'function') showToast('Row saved successfully', true);
        privEditingRowKey = null;
        // Reload from the database so every card/filter/table reflects
        // the authoritative saved state (same pattern the full form uses).
        openPrivateModule(currentPrivSheet);
      } else {
        alert('Save Failed: ' + (res ? res.message : 'Unknown error'));
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i>'; }
      }
    })
    .withFailureHandler(err => {
      alert('Row save crash: ' + err.message);
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i>'; }
    })
    .savePrivateSchool(dataObj, activeUser, currentPrivSheet);
}

function privGoPage(page) {
  const total = Math.ceil(privFilteredCache.length / privPageSize);
  if (page < 1 || page > total) return;
  privCurrentPage = page;
  applyPrivFilters();
}

// Quick search within already-filtered results (toolbar search box)
function quickSearchPriv() {
  const q = document.getElementById('privSearchInput').value.toLowerCase();
  if (!privFilteredCache.length) return;
  const visible = privFilteredCache.filter(r =>
    Object.values(r).some(v => String(v).toLowerCase().includes(q))
  );
  // Re‑apply pagination to the filtered subset
  const totalRecords = visible.length;
  const totalPages = Math.ceil(totalRecords / privPageSize);
  if (privCurrentPage > totalPages) privCurrentPage = totalPages || 1;
  const start = (privCurrentPage - 1) * privPageSize;
  const pageData = visible.slice(start, start + privPageSize);
  renderPrivateTable(pageData, totalRecords);
}

// Legacy alias for older code that calls filterPrivateTable()
function filterPrivateTable() { quickSearchPriv(); }

// ══════════════════════════════════════════════════════════════════════
//  SCHOOL CATEGORY — loaded from General Management (was hardcoded)
// ══════════════════════════════════════════════════════════════════════
// Adding/editing/removing a category in Admin Panel → General Management
// → Private School Categories updates this list (and therefore the form)
// with no code change — this just re-fetches it before the form builds.
function refreshPrivateCategoryOptions(callback) {
  google.script.run
    .withSuccessHandler(res => {
      const catField = PRIVATE_FIELD_CONFIG.find(f => f.header === 'School Category');
      if (catField) catField.options = (res && res.success) ? res.items : catField.options;
      if (callback) callback();
    })
    .withFailureHandler(() => { if (callback) callback(); })
    .getPrivateCategories();
}

// ══════════════════════════════════════════════════════════════════════
//  FORM BUILD
// ══════════════════════════════════════════════════════════════════════
function buildPrivateForm() {
  const pGrid = document.getElementById('privFormGrid');
  pGrid.innerHTML = '';

  PRIVATE_FIELD_CONFIG.forEach(f => {
    if (f.hidden) {
      pGrid.innerHTML += `<input type="hidden" id="${f.id}" data-header="${f.header}" value="">`;
      return;
    }

    let defaultVal = '';
    if (typeof currentUser !== 'undefined' && currentUser) {
      if      (f.id === 'priv_district') defaultVal = currentUser.district || '';
      else if (f.id === 'priv_tehsil')   defaultVal = currentUser.tehsil   || '';
      else if (f.id === 'priv_markaz')   defaultVal = currentUser.markaz   || '';
    }

    let inputHTML = '';
    if (f.type === 'select') {
      inputHTML = `<select id="${f.id}" data-header="${f.header}"
                     ${f.onchange ? `onchange="${f.onchange}"` : ''}>
                     <option value="">Select</option>
                     ${f.options.map(o => `<option>${o}</option>`).join('')}
                   </select>`;
    } else {
      inputHTML = `<input
        type="${f.type || 'text'}"
        id="${f.id}"
        data-header="${f.header}"
        value="${defaultVal}"
        ${f.readonly    ? 'readonly'                       : ''}
        ${f.oninput     ? `oninput="${f.oninput}"`         : ''}
        ${f.onblur      ? `onblur="${f.onblur}"`           : ''}
        ${f.placeholder ? `placeholder="${f.placeholder}"` : ''}
      >`;
    }

    const width = f.wide ? 'grid-column:1/-1;' : '';
    pGrid.innerHTML += `
      <div class="ff${f.readonly ? ' ff-locked' : ''}" id="wrap_${f.id}" style="${width}">
        <span class="flabel" title="${f.hint || f.header}">${f.hint || f.header}</span>
        ${inputHTML}
        <div class="field-error">Invalid</div>
      </div>`;
  });

  _pfPopulateJurisdictionSelects();
}

// ══════════════════════════════════════════════════════════════════════
//  JURISDICTION CASCADE (Add/Edit form) — District → Tehsil → Markaz
//  Sourced from privSchoolHierarchy, which getSchoolHierarchyForUser()
//  already scopes to the signed-in user's assigned jurisdiction via RLS
//  (same source the filter panel above uses). This never hardcodes a
//  jurisdiction list — whatever the backend allows is what shows here.
// ══════════════════════════════════════════════════════════════════════
function _pfFillSelect(id, items, keepValue) {
  const el = document.getElementById(id);
  if (!el) return;
  const cur = keepValue !== undefined ? keepValue : el.value;
  el.innerHTML = '<option value="">Select</option>' +
    items.map(v => `<option value="${_privEsc(v)}">${_privEsc(v)}</option>`).join('');
  if (items.includes(cur)) el.value = cur;
}

function _pfPopulateJurisdictionSelects(presetDistrict, presetTehsil, presetMarkaz) {
  const pool = privSchoolHierarchy || [];
  const dists = [...new Set(pool.map(s => s.d).filter(Boolean))].sort();
  _pfFillSelect('priv_district', dists, presetDistrict);

  const d = document.getElementById('priv_district')?.value || '';
  const tehsils = [...new Set(pool.filter(s => !d || s.d === d).map(s => s.t).filter(Boolean))].sort();
  _pfFillSelect('priv_tehsil', tehsils, presetTehsil);

  const t = document.getElementById('priv_tehsil')?.value || '';
  const markazs = [...new Set(
    pool.filter(s => (!d || s.d === d) && (!t || s.t === t)).map(s => s.m).filter(Boolean)
  )].sort();
  _pfFillSelect('priv_markaz', markazs, presetMarkaz);

  // Auto-select when the user's scope only allows a single option at a
  // level — same convenience the Staff module offers, just not locked
  // to editing (applyJurisdictionLock below handles graying it out).
  if (dists.length === 1 && !document.getElementById('priv_district').value) {
    document.getElementById('priv_district').value = dists[0];
    onPrivFormDistrictChange(true);
  } else if (tehsils.length === 1 && !document.getElementById('priv_tehsil').value) {
    document.getElementById('priv_tehsil').value = tehsils[0];
    onPrivFormTehsilChange(true);
  } else if (markazs.length === 1 && !document.getElementById('priv_markaz').value) {
    document.getElementById('priv_markaz').value = markazs[0];
  }

  const activeUser = (typeof currentUser !== 'undefined') ? currentUser : null;
  if (typeof applyJurisdictionLock === 'function') {
    applyJurisdictionLock({ district: 'priv_district', tehsil: 'priv_tehsil', markaz: 'priv_markaz' }, activeUser);
  }
}

function onPrivFormDistrictChange(skipMarkazReset) {
  const d = document.getElementById('priv_district').value;
  const pool = privSchoolHierarchy || [];
  const tehsils = [...new Set(pool.filter(s => !d || s.d === d).map(s => s.t).filter(Boolean))].sort();
  _pfFillSelect('priv_tehsil', tehsils, '');
  if (!skipMarkazReset) _pfFillSelect('priv_markaz', [], '');
  if (tehsils.length === 1) {
    document.getElementById('priv_tehsil').value = tehsils[0];
    onPrivFormTehsilChange();
  }
}

function onPrivFormTehsilChange() {
  const d = document.getElementById('priv_district').value;
  const t = document.getElementById('priv_tehsil').value;
  const pool = privSchoolHierarchy || [];
  const markazs = [...new Set(
    pool.filter(s => (!d || s.d === d) && (!t || s.t === t)).map(s => s.m).filter(Boolean)
  )].sort();
  _pfFillSelect('priv_markaz', markazs, '');
  if (markazs.length === 1) document.getElementById('priv_markaz').value = markazs[0];
}

// ══════════════════════════════════════════════════════════════════════
//  ADD NEW — name-check flow
// ══════════════════════════════════════════════════════════════════════
function startAddPrivate() {
  document.getElementById('checkSchoolNameInput').value = '';
  document.getElementById('matchingSchoolsList').innerHTML = '';
  nameCheckModalInstance.show();
}

function searchExistingSchools(val) {
  const listDiv = document.getElementById('matchingSchoolsList');
  if (!val || val.length < 3) { listDiv.innerHTML = ''; return; }

  const lower = val.toLowerCase().trim();
  const nameH = privHeaders.find(h => String(h).toLowerCase().includes('school name'));
  const matches = privData.filter(r =>
    String(r[nameH] || '').toLowerCase().includes(lower)
  );

  if (matches.length > 0) {
    listDiv.innerHTML =
      `<div style="color:var(--warn);font-size:0.75rem;font-weight:700;padding:6px;
                   background:var(--warn-bg);border-radius:6px;margin-bottom:8px;">
         <i class="bi bi-exclamation-triangle-fill"></i>
         Similar schools found! Click to load data or proceed as new.
       </div>` +
      matches.map(m => `
        <div onclick="loadMatchedSchool('${String(m['Unique ID'] || '').replace(/'/g, "\\'")}')"
          style="padding:10px;background:var(--s0);border:1px solid var(--b0);
                 border-radius:6px;cursor:pointer;transition:background 0.15s;margin-bottom:4px">
          <strong style="color:var(--brand);display:block;font-size:0.85rem;">${_privEsc(m[nameH])}</strong>
          <span style="font-size:0.7rem;color:var(--t2);">
            EMIS/Reg: ${_privEsc(m['Registeration No in Case of registered (EMIS Code) pepris'] || 'N/A')} |
            Level: ${_privEsc(m['Level (Primary,Middle,High,Higher Secondary)'] || 'N/A')}
          </span>
        </div>`
      ).join('');
  } else {
    listDiv.innerHTML =
      `<div style="color:var(--ok);font-size:0.75rem;font-weight:700;padding:6px;
                   background:var(--ok-bg);border-radius:6px;">
         <i class="bi bi-check-circle-fill"></i> No exact matches found. You can proceed to add.
       </div>`;
  }
}

function loadMatchedSchool(uid) {
  nameCheckModalInstance.hide();
  editPrivate(uid);
}

function proceedWithNewSchool() {
  const newName = document.getElementById('checkSchoolNameInput').value.trim();
  nameCheckModalInstance.hide();
  openPrivateModal();
  setTimeout(() => {
    const nameEl = document.getElementById('priv_name');
    if (nameEl) nameEl.value = newName;
  }, 400);
}

function openPrivateModal() {
  document.getElementById('privEditId').value = '';
  const protect_ = ['priv_uid', 'priv_name'];
  PRIVATE_FIELD_CONFIG.forEach(f => {
    const el = document.getElementById(f.id);
    if (el && !protect_.includes(f.id)) el.value = '';
  });
  _pfPopulateJurisdictionSelects();
  document.getElementById('ki_cascade_container').innerHTML = '';
  document.getElementById('kiTitle').style.display = 'none';
  document.querySelectorAll('.ff-invalid').forEach(el => el.classList.remove('ff-invalid'));
  privModal.show();
}

// ══════════════════════════════════════════════════════════════════════
//  EDIT EXISTING
// ══════════════════════════════════════════════════════════════════════
function editPrivate(keyVal) {
  const row = privData.find(r => String(r['Unique ID']) === String(keyVal));
  if (!row) return;

  document.getElementById('privEditId').value = keyVal;
  PRIVATE_FIELD_CONFIG.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    if (['priv_district', 'priv_tehsil', 'priv_markaz'].includes(f.id)) return; // handled by cascade below
    el.value = row[f.header] || '';
    // If this record's saved value isn't in the (possibly since-edited)
    // select options, keep it visible/selected instead of silently
    // resetting to blank — otherwise saving again would erase it.
    if (f.type === 'select' && row[f.header] && el.value !== row[f.header]) {
      el.insertAdjacentHTML('beforeend', `<option>${row[f.header]}</option>`);
      el.value = row[f.header];
    }
  });
  _pfPopulateJurisdictionSelects(
    row[PRIVATE_FIELD_CONFIG.find(f => f.id === 'priv_district').header] || '',
    row[PRIVATE_FIELD_CONFIG.find(f => f.id === 'priv_tehsil').header] || '',
    row[PRIVATE_FIELD_CONFIG.find(f => f.id === 'priv_markaz').header] || ''
  );

  handleRegStatus(true);
  generateKICascades();

  const kiStr = document.getElementById('priv_ki_names').value;
  const count = parseInt(document.getElementById('priv_ki_no').value || 0);
  if (kiStr && count > 0) {
    const arr = kiStr.split(',').map(s => s.trim());
    for (let i = 1; i <= count; i++) {
      const iEl = document.getElementById('ki_name_' + i);
      if (iEl && arr[i - 1]) iEl.value = arr[i - 1];
    }
  }

  document.querySelectorAll('.ff-invalid').forEach(el => el.classList.remove('ff-invalid'));
  privModal.show();
}

// ══════════════════════════════════════════════════════════════════════
//  SAVE
// ══════════════════════════════════════════════════════════════════════
function submitPrivateForm() {
  try {
    document.querySelectorAll('.ff-invalid').forEach(el => el.classList.remove('ff-invalid'));
    document.querySelectorAll('.field-error').forEach(el => el.style.display = 'none');

    if (!validatePrivateForm()) {
      if (typeof showToast === 'function') showToast('Please fix the errors in the form', false);
      else alert('Please fix the errors in the form');
      return;
    }

    const kiNames = [];
    const count   = parseInt(document.getElementById('priv_ki_no')?.value || 0);
    for (let i = 1; i <= count; i++) {
      const val = document.getElementById('ki_name_' + i)?.value;
      if (val) kiNames.push(val);
    }
    document.getElementById('priv_ki_names').value = kiNames.join(', ');

    let dataObj = {};
    if (document.getElementById('privEditId').value) {
      dataObj['Unique ID'] = document.getElementById('privEditId').value;
    }
    PRIVATE_FIELD_CONFIG.forEach(f => {
      const el = document.getElementById(f.id);
      if (el) dataObj[f.header] = el.value;
    });

    const btn = document.getElementById('privSaveBtn');
    btn.disabled = true;
    btn.innerHTML = 'Saving…';

    const activeUser = (typeof currentUser !== 'undefined') ? currentUser : null;

    google.script.run
      .withSuccessHandler(res => {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-save2"></i> Save Record';
        if (res && res.success) {
          if (typeof showToast === 'function') showToast('Record saved successfully', true);
          privModal.hide();
          openPrivateModule(currentPrivSheet);
          if (typeof loadKPIs === 'function') loadKPIs();
        } else {
          alert('Save Failed: ' + (res ? res.message : 'Unknown error'));
        }
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-save2"></i> Save Record';
        alert('Server crash (savePrivateSchool): ' + err.message);
      })
      .savePrivateSchool(dataObj, activeUser, currentPrivSheet);
  } catch (e) {
    alert('submitPrivateForm crash: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  EXPORT
// ══════════════════════════════════════════════════════════════════════
function exportPrivateView() {
  const target = privFilteredCache.length ? privFilteredCache : privData;
  if (target.length > 0 && privHeaders.length > 0) {
    _triggerExcelDownload(privHeaders, target, currentPrivSheet || 'Private');
  } else {
    exportPrivateDirect(currentPrivSheet || 'Private');
  }
}

function exportPrivateDirect(sheetName) {
  _showExportToast('Fetching ' + sheetName + ' data…');
  const activeUser = (typeof currentUser !== 'undefined') ? currentUser : null;
  google.script.run
    .withSuccessHandler(function(res) {
      _hideExportToast();
      if (!res || !res.success) { alert('Export failed: ' + (res ? res.message : 'Unknown')); return; }
      if (!res.rows || res.rows.length === 0) { alert('No records to export for: ' + sheetName); return; }
      const objRows = res.rows.map(row => {
        const obj = {};
        res.headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
        return obj;
      });
      _triggerExcelDownload(res.headers, objRows, sheetName);
    })
    .withFailureHandler(function(err) { _hideExportToast(); alert('Export error: ' + err.message); })
    .exportSheetData(sheetName, activeUser);
}

// ══════════════════════════════════════════════════════════════════════
//  FIELD HELPERS & CALCULATIONS
// ══════════════════════════════════════════════════════════════════════
// Statuses for which registration-related questions/fields must be
// unlocked for entry/update. 'Registered' and 'Expired' already had
// registration numbers/dates on file; 'In Process' and 'Provisional
// E-License Issued' are schools actively going through registration,
// so they also need these fields open for data entry.
const REG_FIELDS_UNLOCKED_STATUSES = ['Registered', 'Expired', 'In Process', 'Provisional E-License Issued'];

function handleRegStatus(preserveValue) {
  const st = document.getElementById('priv_reg_status').value;
  const unlockRegFields = REG_FIELDS_UNLOCKED_STATUSES.includes(st);

  const fieldsToToggle = [
    { input: 'priv_reg_no',      wrap: 'wrap_priv_reg_no' },
    { input: 'priv_reg_exp',     wrap: 'wrap_priv_reg_exp' },
    { input: 'priv_bldg_exp',    wrap: 'wrap_priv_bldg_exp' },
    { input: 'priv_health_exp',  wrap: 'wrap_priv_health_exp' },
  ];

  fieldsToToggle.forEach(({ input, wrap }) => {
    const el     = document.getElementById(input);
    const wrapEl = document.getElementById(wrap);
    if (!el) return;
    if (unlockRegFields) {
      el.readOnly = false;
      if (wrapEl) wrapEl.classList.remove('ff-locked');
    } else {
      el.readOnly = true;
      if (wrapEl) wrapEl.classList.add('ff-locked');
      if (!preserveValue) el.value = '';
    }
  });
}

function validateCNIC(el) {
  const v = el.value.replace(/\D/g, '');
  if (v.length > 0 && v.length !== 13) {
    el.parentElement.classList.add('ff-invalid');
    const errDiv = el.parentElement.querySelector('.field-error');
    if (errDiv) errDiv.textContent = 'Exactly 13 digits required.';
  } else {
    el.parentElement.classList.remove('ff-invalid');
  }
}

function markInvalid(el, msg) {
  const parent   = el.closest('.ff');
  if (!parent) return;
  parent.classList.add('ff-invalid');
  const errorDiv = parent.querySelector('.field-error');
  if (errorDiv) { errorDiv.textContent = msg; errorDiv.style.display = 'block'; }
}

function calcPrivCategory() {
  const en  = parseInt(document.getElementById('priv_enrol').value || 0);
  const cat = document.getElementById('priv_sec_cat');
  if      (en > 2000) cat.value = 'A+';
  else if (en >= 500) cat.value = 'A';
  else if (en > 0)    cat.value = 'B';
  else                cat.value = '';
}

function generateKICascades() {
  const c     = parseInt(document.getElementById('priv_ki_no').value || 0);
  const box   = document.getElementById('ki_cascade_container');
  const title = document.getElementById('kiTitle');
  box.innerHTML       = '';
  title.style.display = c > 0 ? 'block' : 'none';
  for (let i = 1; i <= c; i++) {
    box.innerHTML += `
      <div class="ff">
        <span class="flabel">Name of KI #${i}</span>
        <input type="text" id="ki_name_${i}" class="ki-name"
          style="width:100%;height:36px;border:1px solid var(--b0);border-radius:6px;padding:0 9px;">
      </div>`;
  }
}

function validatePrivateForm() {
  let isValid = true;
  ['priv_district', 'priv_tehsil', 'priv_markaz'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value) {
      markInvalid(el, 'Required');
      isValid = false;
    }
  });
  ['priv_own_cnic', 'priv_prin_cnic'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value.length > 0 && el.value.length !== 13) {
      markInvalid(el, 'Must be exactly 13 digits');
      isValid = false;
    }
  });
  ['priv_own_cell', 'priv_prin_cell'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value.length > 0 && el.value.length !== 11) {
      markInvalid(el, 'Must be 11 digits');
      isValid = false;
    }
  });
  PRIVATE_FIELD_CONFIG.forEach(f => {
    if (f.type === 'number') {
      const el = document.getElementById(f.id);
      if (el && el.value !== '' && isNaN(el.value)) {
        markInvalid(el, 'Must be a number');
        isValid = false;
      }
    }
  });
  return isValid;
}

// ── Local escHtml (safe even if Index.html's version loads first) ─────
function _privEsc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Shared download helpers — defined only if not already present ─────
if (typeof _triggerExcelDownload === 'undefined') {
  function _triggerExcelDownload(headers, objRows, filename) {
    try {
      const ws_data = [
        headers,
        ...objRows.map(row => headers.map(h => row[h] !== undefined ? row[h] : ''))
      ];
      if (typeof XLSX !== 'undefined') {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        ws['!cols'] = headers.map(h => ({
          wch: Math.min(
            Math.max(String(h).length, ...objRows.map(r => String(r[h] || '').length)) + 2, 50
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
    } catch (e) { alert('Download error: ' + e.message); }
  }
}
if (typeof _showExportToast === 'undefined') {
  function _showExportToast(msg) {
    const t = document.getElementById('exportToast');
    if (t) { document.getElementById('exportToastMsg').textContent = msg; t.style.display = 'flex'; }
  }
  function _hideExportToast() {
    const t = document.getElementById('exportToast');
    if (t) t.style.display = 'none';
  }
}
if (typeof downloadExcel === 'undefined') {
  function downloadExcel(h, r, f) { _triggerExcelDownload(h, r, f); }
}
