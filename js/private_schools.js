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

// Header keys for cascade filters
let privFHeaders = { district: '', tehsil: '', markaz: '', status: '', name: '', regNo: '' };

// ═══════════════════════════════════════════════════════════════
//  FIELD CONFIG — Columns A to AK
// ═══════════════════════════════════════════════════════════════
const PRIVATE_FIELD_CONFIG = [
  { header: 'Unique ID',                                                                                    id: 'priv_uid',         readonly: true,  placeholder: 'Auto-generated' },
  { header: 'District',                                                                                     id: 'priv_district',    readonly: true  },
  { header: 'Tehsil',                                                                                      id: 'priv_tehsil',      readonly: true  },
  { header: 'Markaz Name',                                                                                  id: 'priv_markaz',      readonly: true  },
  { header: 'School Category (Private,Pef,Piema)',                                                          id: 'priv_cat',         type: 'select', options: ['Private', 'Pef', 'Piema'] },
  { header: 'School Name',                                                                                  id: 'priv_name',        wide: true },
  { header: 'Registeration Status Registered/Non Registered Pepris',                                       id: 'priv_reg_status',  type: 'select', options: ['Registered', 'Non Registered', 'Expired'], onchange: 'handleRegStatus()' },
  { header: 'Registeration No in Case of registered (EMIS Code) pepris',                                   id: 'priv_reg_no',      type: 'number', readonly: true },
  { header: 'Date of Expiry of Registeration on Pepris',                                                   id: 'priv_reg_exp',     type: 'date'   },
  { header: 'Level (Primary,Middle,High,Higher Secondary)',                                                 id: 'priv_level',       type: 'select', options: ['Primary', 'Middle', 'High', 'Higher Secondary'] },
  { header: 'School Gender',                                                                               id: 'priv_gender',      type: 'select', options: ['Male', 'Female', 'Both'] },
  { header: 'School Physical Address',                                                                      id: 'priv_addr'        },
  { header: 'Zebra Crossing',                                                                              id: 'priv_zebra',       type: 'select', options: ['Painted', 'Not Needed', 'Needed But not Painted'] },
  { header: 'Longitude',                                                                                   id: 'priv_long',        type: 'number' },
  { header: 'Latitude',                                                                                    id: 'priv_lat',         type: 'number' },
  { header: 'Owner name',                                                                                  id: 'priv_noval'       },
  { header: 'Owner CNIC',                                                                                  id: 'priv_own_cnic',    type: 'number', placeholder: '13 digits', onblur: 'validateCNIC(this)' },
  { header: 'Owner Cell No',                                                                               id: 'priv_own_cell',    type: 'number', placeholder: '11 digits' },
  { header: 'Principal Name',                                                                              id: 'priv_prin_name'   },
  { header: 'Principal CNIC',                                                                             id: 'priv_prin_cnic',   type: 'number', placeholder: '13 digits', onblur: 'validateCNIC(this)' },
  { header: 'Principal Cell No',                                                                          id: 'priv_prin_cell',   type: 'number' },
  { header: 'Building Certificate Expirey',                                                               id: 'priv_bldg_exp',    type: 'date'   },
  { header: 'Heallth and hygiene Certificate Expirey',                                                    id: 'priv_health_exp',  type: 'date'   },
  { header: 'Total Rooms',                                                                                id: 'priv_rooms',       type: 'number' },
  { header: 'Total Teaching Staff',                                                                       id: 'priv_teach_staff', type: 'number' },
  { header: 'Total Non Teaching Staff',                                                                   id: 'priv_non_teach',   type: 'number' },
  { header: 'Total Enrolment',                                                                            id: 'priv_enrol',       type: 'number', oninput: 'calcPrivCategory()' },
  { header: 'Security Category',                                                                          id: 'priv_sec_cat',     readonly: true },
  { header: 'Entry Gates (No.)',                                                                          id: 'priv_gates',       type: 'number' },
  { header: 'Operational Gates (No.)',                                                                    id: 'priv_op_gates',    type: 'number' },
  { header: 'CCTV Cameras (No.)',                                                                         id: 'priv_cctv',        type: 'number' },
  { header: 'Security Guards (No.)',                                                                      id: 'priv_guards',      type: 'number' },
  { header: 'Height of boundary walls (ft)',                                                              id: 'priv_wall_h',      type: 'number' },
  { header: 'Barbed wires on boundary walls (Yes/No)',                                                    id: 'priv_barbed',      type: 'select', options: ['Yes', 'No'] },
  { header: 'Fire fighting system Yes / No',                                                              id: 'priv_fire',        type: 'select', options: ['Yes', 'No'] },
  { header: 'Nearby key installations No.',                                                               id: 'priv_ki_no',       type: 'number', oninput: 'generateKICascades()' },
  { header: 'Name of Key Installation',                                                                   id: 'priv_ki_names',    hidden: true   },
  { header: 'Gate facing KI, if any Yes/No',                                                              id: 'priv_ki_gate',     type: 'select', options: ['Yes', 'No'] },
  { header: 'Status',                                                                                     id: 'priv_status',      type: 'select', options: ['Active', 'Inactive'] }
];

// ══════════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  privModal              = new bootstrap.Modal(document.getElementById('privateSchoolModal'));
  nameCheckModalInstance = new bootstrap.Modal(document.getElementById('nameCheckModal'));
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

    document.getElementById('privCurrentSheet').textContent = sheetName;
    document.getElementById('privRecordCount').innerHTML    = '<i class="bi bi-database"></i> —';

    // Hide Add button for Inactive sheet
    document.getElementById('btnPrivAdd').style.display =
      (sheetName === 'Inactive') ? 'none' : 'flex';

    if (typeof switchGlobalTab === 'function') switchGlobalTab('privateDataView', null);

    // Reset to empty state
    _privShowEmptyState('Loading data from server…', true);

    // Reset filter dropdowns
    ['privFltDistrict','privFltTehsil','privFltMarkaz','privFltStatus','privFltSearch','privSearchInput']
      .forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.tagName === 'SELECT') {
          // preserve Status options
          if (id === 'privFltStatus') { el.value = ''; return; }
          el.innerHTML = '<option value="">All</option>';
        } else {
          el.value = '';
        }
      });

    const activeUser = (typeof currentUser !== 'undefined') ? currentUser : null;

    google.script.run
      .withSuccessHandler(res => {
        if (!res || !res.success) {
          _privShowEmptyState('Error loading data: ' + (res ? res.message : 'Unknown'), false);
          return;
        }
        privHeaders   = res.headers;
        privData      = res.data;
        privDataLoaded = true;

        // Detect header keys for cascades
        setupPrivFilterHeaders();
        setupPrivFilters();
        buildPrivateForm();

        // ★ Show "apply filter" prompt — do NOT render rows yet
        _privShowEmptyState('Select your filters above and click Filter Data to load records.', false);
        document.getElementById('privRecordCount').innerHTML =
          `<i class="bi bi-database"></i> ${privData.length} Total`;
      })
      .withFailureHandler(err => {
        _privShowEmptyState('Server error: ' + err.message, false);
      })
      .getPrivateDashboardData(activeUser, sheetName);
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
//  ★ NEW: PRIVATE FILTER HEADER MAPPING
// ══════════════════════════════════════════════════════════════════════
function setupPrivFilterHeaders() {
  const findH = (keys) =>
    privHeaders.find(h => keys.some(k => String(h).toLowerCase().includes(k))) || '';
  privFHeaders.district = findH(['district']);
  privFHeaders.tehsil   = findH(['tehsil']);
  privFHeaders.markaz   = findH(['markaz name', 'markaz']);
  privFHeaders.status   = findH(['status']);
  privFHeaders.name     = findH(['school name']);
  privFHeaders.regNo    = findH(['emis code', 'reg no', 'registeration no']);
}

function popPrivSelect(id, dataList, headerName) {
  const el = document.getElementById(id);
  if (!el || !headerName) return;
  const cur  = el.value;
  const uniq = [...new Set(dataList.map(r => r[headerName]).filter(Boolean))].sort();
  el.innerHTML =
    '<option value="">All</option>' +
    uniq.map(v => `<option value="${_privEsc(v)}">${_privEsc(v)}</option>`).join('');
  if (uniq.includes(cur)) el.value = cur;
}

function setupPrivFilters() {
  popPrivSelect('privFltDistrict', privData, privFHeaders.district);
  popPrivSelect('privFltTehsil',   privData, privFHeaders.tehsil);
  popPrivSelect('privFltMarkaz',   privData, privFHeaders.markaz);
}

// ══════════════════════════════════════════════════════════════════════
//  ★ NEW: PRIVATE CASCADE FILTER (District → Tehsil → Markaz)
// ══════════════════════════════════════════════════════════════════════
function updatePrivCascades(trigger) {
  const d = document.getElementById('privFltDistrict').value;
  const t = document.getElementById('privFltTehsil').value;

  let tData = [...privData];

  if (trigger === 'District') {
    if (d && privFHeaders.district) tData = tData.filter(r => r[privFHeaders.district] === d);
    popPrivSelect('privFltTehsil', tData, privFHeaders.tehsil);
    document.getElementById('privFltTehsil').value = '';
    popPrivSelect('privFltMarkaz', tData, privFHeaders.markaz);
    document.getElementById('privFltMarkaz').value = '';
    return;
  }

  if (d && privFHeaders.district) tData = tData.filter(r => r[privFHeaders.district] === d);

  if (trigger === 'Tehsil') {
    if (t && privFHeaders.tehsil) tData = tData.filter(r => r[privFHeaders.tehsil] === t);
    popPrivSelect('privFltMarkaz', tData, privFHeaders.markaz);
    document.getElementById('privFltMarkaz').value = '';
  }
}

// ══════════════════════════════════════════════════════════════════════
//  APPLY FILTERS — only when user clicks "Filter Data"
// ══════════════════════════════════════════════════════════════════════
function applyPrivFilters() {
  if (!privDataLoaded) {
    if (typeof showToast === 'function') showToast('Data is still loading, please wait.', false);
    return;
  }

  const d  = document.getElementById('privFltDistrict').value;
  const t  = document.getElementById('privFltTehsil').value;
  const m  = document.getElementById('privFltMarkaz').value;
  const st = document.getElementById('privFltStatus').value;
  const q  = document.getElementById('privFltSearch').value.toLowerCase().trim();

  let fData = [...privData];
  if (d  && privFHeaders.district) fData = fData.filter(r => r[privFHeaders.district] === d);
  if (t  && privFHeaders.tehsil)   fData = fData.filter(r => r[privFHeaders.tehsil]   === t);
  if (m  && privFHeaders.markaz)   fData = fData.filter(r => r[privFHeaders.markaz]   === m);
  if (st && privFHeaders.status)   fData = fData.filter(r => r[privFHeaders.status]   === st);
  if (q) fData = fData.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));

  privFilteredCache = fData;

  // Show table, hide empty state
  document.getElementById('privEmptyState').style.display = 'none';
  document.getElementById('privTableWrap').style.display  = 'block';

  document.getElementById('privRecordCount').innerHTML =
    `<i class="bi bi-database"></i> ${fData.length} Records`;

  renderPrivateTable(fData);
}

// ══════════════════════════════════════════════════════════════════════
//  TABLE RENDER
// ══════════════════════════════════════════════════════════════════════
function renderPrivateTable(dataArr) {
  if (!dataArr.length) {
    document.getElementById('privTHead').innerHTML = '';
    document.getElementById('privTBody').innerHTML =
      `<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--t3)">
         No records match the selected filters.
       </td></tr>`;
    return;
  }
  document.getElementById('privTHead').innerHTML =
    `<tr><th>Edit</th>${privHeaders.map(h => `<th>${_privEsc(h)}</th>`).join('')}</tr>`;
  document.getElementById('privTBody').innerHTML = dataArr.map(row => {
    const keyVal = String(row['Unique ID'] || '').replace(/'/g, "\\'");
    return `<tr>
      <td>
        <button class="tbl-btn btn-edit" onclick="editPrivate('${keyVal}')">
          <i class="bi bi-pencil"></i>
        </button>
      </td>
      ${privHeaders.map(h => `<td>${_privEsc(String(row[h] || ''))}</td>`).join('')}
    </tr>`;
  }).join('');
}

// Quick search within already-filtered results (toolbar search box)
function quickSearchPriv() {
  const q = document.getElementById('privSearchInput').value.toLowerCase();
  if (!privFilteredCache.length) return;
  const visible = privFilteredCache.filter(r =>
    Object.values(r).some(v => String(v).toLowerCase().includes(q))
  );
  renderPrivateTable(visible);
}

// Legacy alias for older code that calls filterPrivateTable()
function filterPrivateTable() { quickSearchPriv(); }

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
        <span class="flabel" title="${f.header}">${f.header}</span>
        ${inputHTML}
        <div class="field-error">Invalid</div>
      </div>`;
  });
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
  const protect_ = ['priv_uid', 'priv_name', 'priv_district', 'priv_tehsil', 'priv_markaz'];
  PRIVATE_FIELD_CONFIG.forEach(f => {
    const el = document.getElementById(f.id);
    if (el && !protect_.includes(f.id)) el.value = '';
  });
  if (typeof currentUser !== 'undefined' && currentUser) {
    const distEl   = document.getElementById('priv_district');
    const tehEl    = document.getElementById('priv_tehsil');
    const markazEl = document.getElementById('priv_markaz');
    if (distEl)   distEl.value   = currentUser.district || '';
    if (tehEl)    tehEl.value    = currentUser.tehsil   || '';
    if (markazEl) markazEl.value = currentUser.markaz   || '';
  }
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
    if (el) el.value = row[f.header] || '';
  });

  handleRegStatus();
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

    dataObj['__colB__'] = document.getElementById('priv_district')?.value || '';
    dataObj['__colC__'] = document.getElementById('priv_tehsil')?.value   || '';

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
function handleRegStatus() {
  const st   = document.getElementById('priv_reg_status').value;
  const no   = document.getElementById('priv_reg_no');
  const wrap = document.getElementById('wrap_priv_reg_no');
  if (st === 'Registered' || st === 'Expired') {
    no.readOnly = false;
    wrap.classList.remove('ff-locked');
  } else {
    no.readOnly = true;
    wrap.classList.add('ff-locked');
    no.value = '';
  }
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