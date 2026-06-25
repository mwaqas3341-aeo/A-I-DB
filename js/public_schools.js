// ── Public module JS ──
// ══════════════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════════════
let pubHeaders        = [];
let pubData           = [];
let currentPubSheet   = '';
let pubFilteredCache  = [];
let pubModal;
let pubDataLoaded     = false;

// Pagination state
let pubPageSize       = 50;
let pubCurrentPage    = 1;

// Master (read-only) column count A-I
const PUB_MASTER_COUNT = 9;

// Editable field definitions J → AO
const PUB_EDITABLE_FIELDS = [
  { header: 'Physical Address of School',                                                                                              id: 'pub_PA' },
  { header: 'Latitude (Number Only)',                                                                                                   id: 'pub_Lat',         type: 'number' },
  { header: 'Longitude (Number Only)',                                                                                                  id: 'pub_Long',        type: 'number' },
  { header: 'Uc Name',                                                                                                                  id: 'pub_UCName' },
  { header: 'Uc No. (Number Only)',                                                                                                     id: 'pub_UCNo',        type: 'number' },
  { header: 'Na (Number Only)',                                                                                                         id: 'pub_NA',          type: 'number' },
  { header: 'Pp (Number Only)',                                                                                                         id: 'pub_PP',          type: 'number' },
  { header: 'Kanal (Number Only)',                                                                                                      id: 'pub_Kanal',       type: 'number',  oninput: 'calcPubLand()' },
  { header: 'Marlas (Number Only)',                                                                                                     id: 'pub_Marla',       type: 'number',  oninput: 'calcPubLand()' },
  { header: 'Sarsai (Number Only)',                                                                                                     id: 'pub_Sarsai',      type: 'number',  oninput: 'calcPubLand()' },
  { header: 'Total Area Square Feet (Auto Calculated by converting Kanal to Square Feets,marlas To square feet and sarsar and adding them togather', id: 'pub_TotalArea', readonly: true },
  { header: 'Total Covered Area Square Feet (Number Only)',                                                                             id: 'pub_Covered',     type: 'number',  oninput: 'calcPubUncovered()' },
  { header: 'Total Uncovered Area Square Feet (Number Only) Auto Calculated',                                                           id: 'pub_Uncovered',   readonly: true },
  { header: 'Total rooms (Number Only)',                                                                                                id: 'pub_Rooms',       type: 'number',  oninput: 'calcPubRooms()' },
  { header: 'Used For Teaching (Number Only)',                                                                                          id: 'pub_Teaching',    type: 'number',  oninput: 'calcPubRooms()' },
  { header: 'Non Teaching Activities (Number Only)',                                                                                    id: 'pub_NonTeaching', readonly: true },
  { header: 'Total Washrooms (Number Only)',                                                                                            id: 'pub_Washrooms',   type: 'number' },
  { header: 'Electricity Source Wapda,Solar Both, Check boxes',                                                                        id: 'pub_Elect',       type: 'select',  options: ['Wapda', 'Solar', 'Both'] },
  { header: 'Boundary Wall Complete/Partial Casade tow options Complete,Partial',                                                      id: 'pub_BWStatus',    type: 'select',  options: ['Complete', 'Partial'], onchange: 'handlePubBW()' },
  { header: 'Required Boundary Wall (Number Only)',                                                                                    id: 'pub_BWFeet',      type: 'number',  hidden: true },
  { header: 'Total Furniture (Write no of students for which available) (Number Only)',                                                 id: 'pub_Furniture',   type: 'number' },
  { header: 'Total Enrollment (Number Only)',                                                                                           id: 'pub_Enroll',      type: 'number',  oninput: 'calcPubLand()' },
  { header: 'School Category Auto Calculated on Front End',                                                                            id: 'pub_Category',    readonly: true },
  { header: 'Grade 16 Sanctioned Seats (Number Only)',                                                                                 id: 'pub_G16',         type: 'number' },
  { header: 'Grade 15 Sancitoned Seats (Number Only)',                                                                                 id: 'pub_G15',         type: 'number' },
  { header: 'Grade 14 Sanctioned Seats (Number Only)',                                                                                 id: 'pub_G14',         type: 'number' },
  { header: 'Grade 1-12 All Non Teaching Sanctioned Seats (Number Only)',                                                              id: 'pub_GNon',        type: 'number' },
  { header: 'Bank Name',                                                                                                               id: 'pub_Bank' },
  { header: 'Address',                                                                                                                 id: 'pub_BankAddr' },
  { header: 'Branch Code',                                                                                                             id: 'pub_Branch' },
  { header: 'IBAN NO.',                                                                                                                id: 'pub_IBAN' },
  { header: 'Status (Active/Out Sourced)',                                                                                             id: 'pub_Status',      type: 'select',  options: ['Active', 'Out Sourced'] }
];

// Header key tracking for cascade filters
let pubFHeaders = { district: '', tehsil: '', wing: '', markaz: '', emis: '' };

// ── NEW: Store filtered school hierarchy for dropdowns ──────────────
let pubSchoolHierarchy = [];

// ══════════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  pubModal = new bootstrap.Modal(document.getElementById('publicSchoolModal'));
  // Page size dropdown
  document.getElementById('pubPageSize').addEventListener('change', function() {
    pubPageSize = parseInt(this.value);
    pubCurrentPage = 1;
    applyPubFilters();
  });
});

// ══════════════════════════════════════════════════════════════════════
//  OPEN MODULE
//  sheetName: 'Public'  → Active schools
//             'Out Sourced School' → Outsourced schools
// ══════════════════════════════════════════════════════════════════════
function openPublicModule(sheetName) {
  currentPubSheet   = sheetName;
  pubDataLoaded     = false;
  pubData           = [];
  pubHeaders        = [];
  pubFilteredCache  = [];
  pubSchoolHierarchy = [];

  document.getElementById('pubCurrentSheet').textContent = sheetName;
  document.getElementById('pubRecordCount').innerHTML    = '<i class="bi bi-database"></i> —';

  // ★ HIDE THE ADD SCHOOL BUTTON ALWAYS (removed from public module)
  document.getElementById('btnPubAdd').style.display = 'none';

  if (typeof switchGlobalTab === 'function') switchGlobalTab('publicDataView', null);

  _pubShowEmptyState('Loading data…', true);

  ['pubFltDistrict','pubFltTehsil','pubFltWing','pubFltMarkaz','pubFltEmis','pubSearchInput']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.tagName === 'SELECT' ? (el.innerHTML = '<option value="">All</option>') : (el.value = '');
    });

  // Step 1: Load filtered school hierarchy for dropdowns
  google.script.run
    .withSuccessHandler(function(schools) {
      pubSchoolHierarchy = schools || [];
      // Step 2: Load the actual data rows
      google.script.run
        .withSuccessHandler(res => {
          if (!res || !res.success) {
            _pubShowEmptyState('Error loading data. Please try again.', false);
            return;
          }
          pubHeaders       = res.headers;
          pubData          = res.data;
          pubDataLoaded    = true;

          setupPubFilterHeaders();
          // Populate dropdowns from schoolHierarchy (not from pubData)
          populatePubFiltersFromHierarchy();

          buildPublicForm();

          _pubShowEmptyState('Select your filters above and click Filter Data to load records.', false);
          document.getElementById('pubRecordCount').innerHTML =
            `<i class="bi bi-database"></i> ${pubData.length} Total`;
        })
        .withFailureHandler(err => {
          _pubShowEmptyState('Server error: ' + err.message, false);
        })
        .getPublicDashboardData(currentUser, sheetName);
    })
    .withFailureHandler(err => {
      _pubShowEmptyState('Error loading school hierarchy: ' + err.message, false);
    })
    .getSchoolHierarchyForUser(currentUser);
}

// Helper: toggle between empty-state div and table
function _pubShowEmptyState(msg, isLoading) {
  const empty = document.getElementById('pubEmptyState');
  const wrap  = document.getElementById('pubTableWrap');
  if (empty) {
    empty.style.display = 'block';
    empty.innerHTML = isLoading
      ? `<span class="spinner-border spinner-border-sm"></span> <span style="margin-left:8px">${msg}</span>`
      : `<i class="bi bi-funnel"></i><p>${msg}</p>`;
  }
  if (wrap) wrap.style.display = 'none';
  document.getElementById('pubTHead').innerHTML = '';
  document.getElementById('pubTBody').innerHTML = '';
}

// ══════════════════════════════════════════════════════════════════════
//  FILTER HEADER MAPPING
// ══════════════════════════════════════════════════════════════════════
function setupPubFilterHeaders() {
  const findH = (keys) =>
    pubHeaders.find(h => keys.some(k => String(h).toLowerCase().includes(k))) || '';
  pubFHeaders.district = findH(['district', 'distr']);
  pubFHeaders.tehsil   = findH(['tehsil']);
  pubFHeaders.wing     = findH(['wing']);
  pubFHeaders.markaz   = findH(['markaz name', 'markaz']);
  pubFHeaders.emis     = findH(['emis', 'reg no']);
}

// ── NEW: Populate filters from schoolHierarchy ──────────────────────
function populatePubFiltersFromHierarchy() {
  const dists = [...new Set(pubSchoolHierarchy.map(s => s.d).filter(Boolean))].sort();
  const wings = [...new Set(pubSchoolHierarchy.map(s => s.w).filter(Boolean))].sort();
  const tehsils = [...new Set(pubSchoolHierarchy.map(s => s.t).filter(Boolean))].sort();
  const markazs = [...new Set(pubSchoolHierarchy.map(s => s.m).filter(Boolean))].sort();

  const popSelect = (id, items) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = '<option value="">All</option>' +
      items.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
    if (items.includes(cur)) el.value = cur;
  };

  popSelect('pubFltDistrict', dists);
  popSelect('pubFltWing', wings);
  popSelect('pubFltTehsil', tehsils);
  popSelect('pubFltMarkaz', markazs);
}

// ══════════════════════════════════════════════════════════════════════
//  CASCADE FILTER – uses schoolHierarchy (not pubData)
// ══════════════════════════════════════════════════════════════════════
function updatePubCascades(trigger) {
  const d = document.getElementById('pubFltDistrict').value;
  const t = document.getElementById('pubFltTehsil').value;
  const w = document.getElementById('pubFltWing').value;

  let filteredSchools = [...pubSchoolHierarchy];

  if (trigger === 'District') {
    if (d) filteredSchools = filteredSchools.filter(s => s.d === d);
    const wings = [...new Set(filteredSchools.map(s => s.w).filter(Boolean))].sort();
    const tehsils = [...new Set(filteredSchools.map(s => s.t).filter(Boolean))].sort();
    const markazs = [...new Set(filteredSchools.map(s => s.m).filter(Boolean))].sort();

    popSelect('pubFltWing', wings);
    document.getElementById('pubFltWing').value = '';
    popSelect('pubFltTehsil', tehsils);
    document.getElementById('pubFltTehsil').value = '';
    popSelect('pubFltMarkaz', markazs);
    document.getElementById('pubFltMarkaz').value = '';
    return;
  }

  if (d) filteredSchools = filteredSchools.filter(s => s.d === d);
  if (trigger === 'Tehsil') {
    if (t) filteredSchools = filteredSchools.filter(s => s.t === t);
    const wings = [...new Set(filteredSchools.map(s => s.w).filter(Boolean))].sort();
    const markazs = [...new Set(filteredSchools.map(s => s.m).filter(Boolean))].sort();

    popSelect('pubFltWing', wings);
    document.getElementById('pubFltWing').value = '';
    popSelect('pubFltMarkaz', markazs);
    document.getElementById('pubFltMarkaz').value = '';
    return;
  }

  if (t) filteredSchools = filteredSchools.filter(s => s.t === t);
  if (trigger === 'Wing') {
    if (w) filteredSchools = filteredSchools.filter(s => s.w === w);
    const markazs = [...new Set(filteredSchools.map(s => s.m).filter(Boolean))].sort();
    popSelect('pubFltMarkaz', markazs);
    document.getElementById('pubFltMarkaz').value = '';
  }
}

function popSelect(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  const cur = el.value;
  el.innerHTML = '<option value="">All</option>' +
    items.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
  if (items.includes(cur)) el.value = cur;
}

// ══════════════════════════════════════════════════════════════════════
//  APPLY FILTERS – uses pubData (filtered rows)
// ══════════════════════════════════════════════════════════════════════
function applyPubFilters() {
  if (!pubDataLoaded) {
    if (typeof showToast === 'function') showToast('Data is still loading, please wait.', false);
    return;
  }

  const d = document.getElementById('pubFltDistrict').value;
  const t = document.getElementById('pubFltTehsil').value;
  const w = document.getElementById('pubFltWing').value;
  const m = document.getElementById('pubFltMarkaz').value;
  const e = document.getElementById('pubFltEmis').value.toLowerCase().trim();
  const q = document.getElementById('pubSearchInput').value.toLowerCase().trim();

  let fData = [...pubData];
  if (d && pubFHeaders.district) fData = fData.filter(r => r[pubFHeaders.district] === d);
  if (t && pubFHeaders.tehsil)   fData = fData.filter(r => r[pubFHeaders.tehsil]   === t);
  if (w && pubFHeaders.wing)     fData = fData.filter(r => r[pubFHeaders.wing]     === w);
  if (m && pubFHeaders.markaz)   fData = fData.filter(r => r[pubFHeaders.markaz]   === m);
  if (e && pubFHeaders.emis)     fData = fData.filter(r => String(r[pubFHeaders.emis]).toLowerCase().includes(e));
  if (q) fData = fData.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));

  // ★ NEW: Sort by Markaz Name (A → Z), then EMIS Code (ascending)
  if (pubFHeaders.markaz && pubFHeaders.emis) {
    fData.sort((a, b) => {
      const markazA = (a[pubFHeaders.markaz] || '').toString().toLowerCase();
      const markazB = (b[pubFHeaders.markaz] || '').toString().toLowerCase();
      if (markazA < markazB) return -1;
      if (markazA > markazB) return 1;
      const emisA = parseInt((a[pubFHeaders.emis] || '').toString(), 10) || 0;
      const emisB = parseInt((b[pubFHeaders.emis] || '').toString(), 10) || 0;
      return emisA - emisB;
    });
  }

  pubFilteredCache = fData;

  // Pagination
  const totalRecords = fData.length;
  const totalPages = Math.ceil(totalRecords / pubPageSize);
  if (pubCurrentPage > totalPages) pubCurrentPage = totalPages || 1;
  const start = (pubCurrentPage - 1) * pubPageSize;
  const pageData = fData.slice(start, start + pubPageSize);

  document.getElementById('pubEmptyState').style.display  = 'none';
  document.getElementById('pubTableWrap').style.display   = 'block';

  document.getElementById('pubRecordCount').innerHTML =
    `<i class="bi bi-database"></i> ${totalRecords} Records (Page ${pubCurrentPage}/${totalPages})`;

  if (!fData.length) {
    document.getElementById('pubTHead').innerHTML = '';
    document.getElementById('pubTBody').innerHTML =
      `<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--t3)">
         No records match the selected filters.
       </td></tr>`;
    return;
  }

  document.getElementById('pubTHead').innerHTML =
    `<tr><th>Actions</th>${pubHeaders.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr>`;

  document.getElementById('pubTBody').innerHTML = pageData.map(row => {
    const keyVal = String(row[pubHeaders[0]] || '').replace(/'/g, "\\'");
    return `<tr>
      <td>
        <button class="tbl-btn btn-edit" onclick="editPublic('${keyVal}')">
          <i class="bi bi-pencil-square"></i>
        </button>
      </td>
      ${pubHeaders.map(h => `<td>${escHtml(String(row[h] || ''))}</td>`).join('')}
    </tr>`;
  }).join('');

  // Add pagination controls
  const paginationHtml = totalPages > 1 ? `
    <div style="display:flex; justify-content:center; align-items:center; gap:10px; margin-top:15px;">
      <button class="btn btn-outline-secondary btn-sm" onclick="pubGoPage(${pubCurrentPage - 1})" ${pubCurrentPage === 1 ? 'disabled' : ''}>Previous</button>
      <span>Page ${pubCurrentPage} of ${totalPages}</span>
      <button class="btn btn-outline-secondary btn-sm" onclick="pubGoPage(${pubCurrentPage + 1})" ${pubCurrentPage === totalPages ? 'disabled' : ''}>Next</button>
    </div>
  ` : '';
  const tblWrap = document.getElementById('pubTableWrap');
  const existingPagination = tblWrap.querySelector('.pub-pagination');
  if (existingPagination) existingPagination.remove();
  if (paginationHtml) {
    const div = document.createElement('div');
    div.className = 'pub-pagination';
    div.innerHTML = paginationHtml;
    tblWrap.appendChild(div);
  }
}

function pubGoPage(page) {
  const total = Math.ceil(pubFilteredCache.length / pubPageSize);
  if (page < 1 || page > total) return;
  pubCurrentPage = page;
  applyPubFilters();
}

// ══════════════════════════════════════════════════════════════════════
//  FORM BUILD
// ══════════════════════════════════════════════════════════════════════
function buildPublicForm() {
  // Master fields (A-I) — read-only
  const mGrid = document.getElementById('pubMasterGrid');
  mGrid.innerHTML = '';
  for (let i = 0; i < PUB_MASTER_COUNT; i++) {
    if (pubHeaders[i]) {
      mGrid.innerHTML +=
        `<div class="ff ff-locked">
           <span class="flabel">${escHtml(pubHeaders[i])}</span>
           <input type="text" id="pub_m_${i}" readonly>
         </div>`;
    }
  }

  // Editable fields (J-AO)
  const eGrid = document.getElementById('pubEditableGrid');
  eGrid.innerHTML = '';
  PUB_EDITABLE_FIELDS.forEach(f => {
    const input = f.type === 'select'
      ? `<select id="${f.id}" data-header="${f.header}" ${f.onchange ? `onchange="${f.onchange}"` : ''}>
           <option value="">Select</option>
           ${f.options.map(o => `<option>${o}</option>`).join('')}
         </select>`
      : `<input
           type="${f.type || 'text'}"
           id="${f.id}"
           data-header="${f.header}"
           ${f.readonly ? 'readonly' : ''}
           ${f.oninput  ? `oninput="${f.oninput}"` : ''}
         >`;

    eGrid.innerHTML +=
      `<div class="ff${f.readonly ? ' ff-locked' : ''}" id="wrap_${f.id}" ${f.hidden ? 'style="display:none"' : ''}>
         <span class="flabel" title="${f.header}">${f.header}</span>
         ${input}
         <div class="field-error">Invalid value</div>
       </div>`;
  });
}

function editPublic(keyVal) {
  const row = pubData.find(r => String(r[pubHeaders[0]]) === String(keyVal));
  if (!row) return;

  document.getElementById('pubEditId').value = keyVal;
  for (let i = 0; i < PUB_MASTER_COUNT; i++) {
    const el = document.getElementById('pub_m_' + i);
    if (el && pubHeaders[i]) el.value = row[pubHeaders[i]] || '';
  }
  PUB_EDITABLE_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if (el) el.value = row[f.header] || '';
  });
  handlePubBW();
  document.querySelectorAll('.ff-invalid').forEach(el => el.classList.remove('ff-invalid'));
  pubModal.show();
}

function openPublicModal() {
  document.getElementById('pubEditId').value = '';
  for (let i = 0; i < PUB_MASTER_COUNT; i++) {
    const el = document.getElementById('pub_m_' + i);
    if (el) el.value = '';
  }
  PUB_EDITABLE_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if (el) el.value = '';
  });
  document.querySelectorAll('.ff-invalid').forEach(el => el.classList.remove('ff-invalid'));
  pubModal.show();
}

// ══════════════════════════════════════════════════════════════════════
//  CALCULATIONS
// ══════════════════════════════════════════════════════════════════════
function calcPubLand() {
  const k = parseFloat(document.getElementById('pub_Kanal')?.value  || 0);
  const m = parseFloat(document.getElementById('pub_Marla')?.value  || 0);
  const s = parseFloat(document.getElementById('pub_Sarsai')?.value || 0);
  const tSqFt = (k * 5445) + (m * 272.25) + (s * 30.25);
  const totEl = document.getElementById('pub_TotalArea');
  if (totEl) totEl.value = (isNaN(tSqFt) || tSqFt === 0) ? '' : tSqFt.toFixed(2);
  calcPubUncovered();

  const enrol  = parseInt(document.getElementById('pub_Enroll')?.value || 0);
  const catEl  = document.getElementById('pub_Category');
  if (catEl) {
    if      (enrol > 2000) catEl.value = 'A+';
    else if (enrol >= 500) catEl.value = 'A';
    else if (enrol > 0)    catEl.value = 'B';
    else                   catEl.value = '';
  }
}

function calcPubUncovered() {
  const total = parseFloat(document.getElementById('pub_TotalArea')?.value || 0);
  const cov   = parseFloat(document.getElementById('pub_Covered')?.value   || 0);
  const el    = document.getElementById('pub_Uncovered');
  if (el) el.value = (!isNaN(total) && !isNaN(cov)) ? Math.max(0, total - cov).toFixed(2) : '';
}

function calcPubRooms() {
  const t  = parseInt(document.getElementById('pub_Rooms')?.value    || 0);
  const u  = parseInt(document.getElementById('pub_Teaching')?.value || 0);
  const el = document.getElementById('pub_NonTeaching');
  if (el) el.value = (!isNaN(t) && !isNaN(u)) ? Math.max(0, t - u) : '';
}

function handlePubBW() {
  const stat = document.getElementById('pub_BWStatus')?.value;
  const wrap = document.getElementById('wrap_pub_BWFeet');
  if (wrap) {
    wrap.style.display = (stat === 'Partial') ? 'block' : 'none';
    if (stat !== 'Partial') {
      const feetEl = document.getElementById('pub_BWFeet');
      if (feetEl) feetEl.value = '';
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
//  SAVE
// ══════════════════════════════════════════════════════════════════════
function submitPublicForm() {
  const iban = document.getElementById('pub_IBAN')?.value.trim().replace(/\s/g, '') || '';
  if (iban.length > 0 && iban.length !== 24) {
    document.getElementById('wrap_pub_IBAN').classList.add('ff-invalid');
    if (typeof showToast === 'function') showToast('IBAN must be exactly 24 characters', false);
    return;
  }

  let dataObj = {};
  dataObj[pubHeaders[0]] = document.getElementById('pubEditId').value;
  for (let i = 0; i < PUB_MASTER_COUNT; i++) {
    if (pubHeaders[i]) dataObj[pubHeaders[i]] = document.getElementById('pub_m_' + i).value;
  }
  PUB_EDITABLE_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if (el) dataObj[f.header] = el.value;
  });

  const btn = document.getElementById('pubSaveBtn');
  btn.disabled = true;
  btn.innerHTML = 'Saving…';

  google.script.run
    .withSuccessHandler(res => {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-save2"></i> Save Record';
      if (res.success) {
        if (typeof showToast === 'function') showToast(res.message, true);
        pubModal.hide();
        openPublicModule(currentPubSheet);
        if (typeof loadKPIs === 'function') loadKPIs();
      } else {
        if (typeof showToast === 'function') showToast(res.message, false);
      }
    })
    .withFailureHandler(err => {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-save2"></i> Save Record';
      if (typeof showToast === 'function') showToast('Server error: ' + err.message, false);
      else alert('Server error: ' + err.message);
    })
    .savePublicSchool(dataObj, currentUser, currentPubSheet);
}

// ══════════════════════════════════════════════════════════════════════
//  EXPORT
// ══════════════════════════════════════════════════════════════════════
function exportPubView() {
  if (pubFilteredCache.length > 0 && pubHeaders.length > 0) {
    _triggerExcelDownload(pubHeaders, pubFilteredCache, currentPubSheet || 'Public');
    return;
  }
  exportPubDirect(currentPubSheet || 'Public');
}

function exportPubDirect(sheetName) {
  _showExportToast('Fetching ' + sheetName + ' data…');
  google.script.run
    .withSuccessHandler(function(res) {
      _hideExportToast();
      if (!res || !res.success) {
        alert('Export failed: ' + (res ? res.message : 'Unknown error'));
        return;
      }
      if (!res.rows || res.rows.length === 0) {
        alert('No records to export for: ' + sheetName);
        return;
      }
      const objRows = res.rows.map(row => {
        const obj = {};
        res.headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
        return obj;
      });
      _triggerExcelDownload(res.headers, objRows, sheetName);
    })
    .withFailureHandler(function(err) {
      _hideExportToast();
      alert('Export server error: ' + err.message);
    })
    .exportSheetData(sheetName, currentUser);
}

// Shared helpers (defined in Index.html, aliased here for safety)
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
if (typeof escHtml === 'undefined') {
  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
