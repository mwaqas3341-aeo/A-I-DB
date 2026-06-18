// ── Public module JS ──
// ══════════════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════════════
let pubHeaders        = [];
let pubData           = [];
let currentPubSheet   = '';
let pubFilteredCache  = [];
let pubModal;
let pubDataLoaded     = false; // tracks whether backend data is loaded

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

// ══════════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  pubModal = new bootstrap.Modal(document.getElementById('publicSchoolModal'));
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

  document.getElementById('pubCurrentSheet').textContent = sheetName;
  document.getElementById('pubRecordCount').innerHTML    = '<i class="bi bi-database"></i> —';

  // Add School button: only for Public (Active) sheet; hide for Outsourced
  document.getElementById('btnPubAdd').style.display =
    (sheetName === 'Public') ? 'flex' : 'none';

  // Switch to this view
  if (typeof switchGlobalTab === 'function') switchGlobalTab('publicDataView', null);

  // Reset table to empty state
  _pubShowEmptyState('Loading data from server…', true);

  // Reset filter dropdowns
  ['pubFltDistrict','pubFltTehsil','pubFltWing','pubFltMarkaz','pubFltEmis','pubSearchInput']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.tagName === 'SELECT' ? (el.innerHTML = '<option value="">All</option>') : (el.value = '');
    });

  google.script.run
    .withSuccessHandler(res => {
      if (!res || !res.success) {
        _pubShowEmptyState('Error loading data. Please try again.', false);
        return;
      }
      pubHeaders       = res.headers;
      pubData          = res.data;
      pubDataLoaded    = true;

      // Populate cascades from full dataset
      setupPubFilterHeaders();
      setupPubFilters();
      buildPublicForm();

      // ★ FIX: Do NOT render the table yet — show the "apply filter" prompt
      _pubShowEmptyState('Select your filters above and click Filter Data to load records.', false);
      document.getElementById('pubRecordCount').innerHTML =
        `<i class="bi bi-database"></i> ${pubData.length} Total`;
    })
    .withFailureHandler(err => {
      _pubShowEmptyState('Server error: ' + err.message, false);
    })
    .getPublicDashboardData(currentUser, sheetName);
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

function popPubSelect(id, dataList, headerName) {
  const el = document.getElementById(id);
  if (!el || !headerName) return;
  const cur  = el.value;
  const uniq = [...new Set(dataList.map(r => r[headerName]).filter(Boolean))].sort();
  el.innerHTML =
    '<option value="">All</option>' +
    uniq.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
  if (uniq.includes(cur)) el.value = cur;
}

function setupPubFilters() {
  popPubSelect('pubFltDistrict', pubData, pubFHeaders.district);
  popPubSelect('pubFltTehsil',   pubData, pubFHeaders.tehsil);
  popPubSelect('pubFltWing',     pubData, pubFHeaders.wing);
  popPubSelect('pubFltMarkaz',   pubData, pubFHeaders.markaz);
}

// ══════════════════════════════════════════════════════════════════════
//  CASCADE FILTER
//
//  ★ FIX: Original code used undefined variable `type` inside
//          document.getElementById('pubFlt' + type).
//          The parameter is named `trigger` — use that consistently.
//          Also removed the dead `sel.innerHTML = …` block at top that
//          was trying to clear a select before re-populating it.
// ══════════════════════════════════════════════════════════════════════
function updatePubCascades(trigger) {
  const d = document.getElementById('pubFltDistrict').value;
  const t = document.getElementById('pubFltTehsil').value;
  const w = document.getElementById('pubFltWing').value;

  let tData = [...pubData];

  if (trigger === 'District') {
    // Filter by district, then repopulate downstream
    if (d && pubFHeaders.district) tData = tData.filter(r => r[pubFHeaders.district] === d);
    popPubSelect('pubFltTehsil', tData, pubFHeaders.tehsil);
    document.getElementById('pubFltTehsil').value = '';
    popPubSelect('pubFltWing',   tData, pubFHeaders.wing);
    document.getElementById('pubFltWing').value = '';
    popPubSelect('pubFltMarkaz', tData, pubFHeaders.markaz);
    document.getElementById('pubFltMarkaz').value = '';
    return;
  }

  if (d && pubFHeaders.district) tData = tData.filter(r => r[pubFHeaders.district] === d);

  if (trigger === 'Tehsil') {
    if (t && pubFHeaders.tehsil) tData = tData.filter(r => r[pubFHeaders.tehsil] === t);
    popPubSelect('pubFltWing',   tData, pubFHeaders.wing);
    document.getElementById('pubFltWing').value = '';
    popPubSelect('pubFltMarkaz', tData, pubFHeaders.markaz);
    document.getElementById('pubFltMarkaz').value = '';
    return;
  }

  if (t && pubFHeaders.tehsil) tData = tData.filter(r => r[pubFHeaders.tehsil] === t);

  if (trigger === 'Wing') {
    if (w && pubFHeaders.wing) tData = tData.filter(r => r[pubFHeaders.wing] === w);
    popPubSelect('pubFltMarkaz', tData, pubFHeaders.markaz);
    document.getElementById('pubFltMarkaz').value = '';
  }
}

// ══════════════════════════════════════════════════════════════════════
//  APPLY FILTERS — called only when user clicks "Filter Data"
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

  pubFilteredCache = fData;

  // Show table, hide empty state
  document.getElementById('pubEmptyState').style.display  = 'none';
  document.getElementById('pubTableWrap').style.display   = 'block';

  document.getElementById('pubRecordCount').innerHTML =
    `<i class="bi bi-database"></i> ${fData.length} Records`;

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

  document.getElementById('pubTBody').innerHTML = fData.map(row => {
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
    .savePublicSchool(dataObj, currentPubSheet);
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