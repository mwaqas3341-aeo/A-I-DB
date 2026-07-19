// ── HR_View module JS ──
// ══════════════════════════════════════════════════════════════════
//  HR VIEW STATE
// ══════════════════════════════════════════════════════════════════
let hrCurrentSheetView = 'Staff';
let hrSchoolCache      = [];
let hrSheetDataCache   = {};
let hrFilteredResults  = [];
let hrCurrentHeaders   = [];
let hrPageSize         = 50;
let hrCurrentPage      = 1;
let hrActiveMenu       = null;
let sfmMode            = 'view';
let sfmCurrentRow      = null;
let hrTransferRow      = null;
let hrPromotionRow     = null;
let hrAllSchoolCache  = [];
let hrStaffFullRows    = [];
let hrPnoStatus        = 'unchecked';
let hrCnicStatus = 'unchecked';
let hrIbanStatus = 'unchecked';

// ──────────────────────────────────────────────────────────────────
//  JURISDICTION HELPERS
//  currentUser.assignedJurisdictions is expected to be an array of
//  objects parsed from columns K, L, M of the users sheet.
//  Each entry: { district, wing, tehsil, markaz } (any may be empty).
//  If currentUser.role === 'admin' → all schools are visible.
// ──────────────────────────────────────────────────────────────────

/**
 * Returns the list of jurisdiction assignments for the current user.
 * Normalises the shape so downstream code always deals with an array
 * of { district, wing, tehsil, markaz } objects.
 *
 * Sources (in priority order):
 *  1. currentUser.assignedJurisdictions  — array already parsed by caller
 *  2. currentUser.district / .wing / .tehsil / .markaz  — single assignment (legacy)
 */
function _getUserJurisdictions() {
  if (typeof currentUser === 'undefined' || !currentUser) return null; // null = admin
  if (currentUser.role === 'admin') return null; // null = all access

  // Prefer the structured array from columns K/L/M
  if (Array.isArray(currentUser.assignedJurisdictions) && currentUser.assignedJurisdictions.length > 0) {
    return currentUser.assignedJurisdictions.map(j => ({
      district: (j.district || '').trim(),
      wing:     (j.wing     || '').trim(),
      tehsil:   (j.tehsil   || '').trim(),
      markaz:   (j.markaz   || '').trim()
    }));
  }

  // Fallback: single flat assignment on the user object
  const single = {
    district: (currentUser.district || '').trim(),
    wing:     (currentUser.wing     || '').trim(),
    tehsil:   (currentUser.tehsil   || '').trim(),
    markaz:   (currentUser.markaz   || '').trim()
  };
  // Only include if at least one field is set
  if (single.district || single.wing || single.tehsil || single.markaz) return [single];

  return null; // nothing defined → treat as admin
}

/**
 * Returns true if a school object (from hrSchoolCache) is within the
 * user's allowed jurisdictions. A school matches a jurisdiction entry
 * if every non-empty field of that entry matches the school's field.
 * (So a wing-level entry with no markaz matches all markazs in that wing.)
 */
function _schoolInJurisdiction(school, jurisdictions) {
  if (!jurisdictions) return true; // admin
  return jurisdictions.some(j => {
    if (j.district && school.d !== j.district) return false;
    if (j.wing     && school.w !== j.wing)     return false;
    if (j.tehsil   && school.t !== j.tehsil)   return false;
    if (j.markaz   && school.m !== j.markaz)   return false;
    return true;
  });
}

/**
 * Returns the subset of hrSchoolCache visible to the logged-in user,
 * taking ALL assigned jurisdictions (K/L/M columns) into account.
 */
function _getJurisdictionSchools() {
  if (!hrSchoolCache || hrSchoolCache.length === 0) return [];
  const jurisdictions = _getUserJurisdictions();
  if (!jurisdictions) return hrSchoolCache; // admin sees all
  return hrSchoolCache.filter(s => _schoolInJurisdiction(s, jurisdictions));
}

const HR_SHEET_META = {
  'Staff':              { title:'Active Staff',       sub:'Browse and manage all active teaching staff records' },
  'Retirement':         { title:'Retirements',        sub:'Staff who have retired from service' },
  'Resignation':        { title:'Resignations',       sub:'Staff who have resigned from service' },
  'Deceased':           { title:'Death Cases',        sub:'Deceased staff records' },
  'Termination':        { title:'Terminations',       sub:'Staff whose service was terminated' },
  'Transfer_History':   { title:'Transfer History',   sub:'All transfer records and movement history' },
  'Promotions_History': { title:'Promotions History', sub:'All promotion events and scale changes' },
  'Deleted_Archive':    { title:'Deleted Archive',    sub:'Soft-deleted records stored for audit' }
};
const REVERT_SHEETS = ['Retirement','Resignation','Deceased','Termination','Deleted_Archive','Transfer_History','Promotions_History'];

const SF_MAP = {
  sf_emis:                 'SCHOOL EMIS CODE',
  sf_markaz:               'MARKAZ NAME',
  sf_district:             'District',
  sf_wing:                 'Wing',
  sf_tehsil:               'Tehsil',
  sf_personalNo:           'PERSONAL NO.',
  sf_name:                 'NAME OF TEACHER',
  sf_parentName:           'PARENT NAME',
  sf_dob:                  'DATE OF BIRTH',
  sf_gender:               'GENDER',
  sf_cnic:                 'CNIC',
  sf_address:              'ADDRESS AS PER CNIC',
  sf_designation:          'DESIGNATION',
  sf_workingAsHead:        'WORKING AS HEAD',
  sf_bps:                  'BPS',
  sf_pps:                  'PPS',
  sf_natureOfJob:          'NATURE OF JOB',
  sf_regularizationDate:   'date of regularization',
  sf_govtEntry:            'DATE OF ENTRY IN GOVT- SERVICE',
  sf_firstPosting:         'FIRST PLACE OF POSTING',
  sf_presentSchoolPosting: 'DATE OF POSTING IN PRESENT SCHOOL',
  sf_presentScaleJoining:  'DATE OF JOINING IN PRESENT SCALE',
  sf_subject:              'SUBJECT',
  sf_academicQual:         'ACADEMIC QUALIFICATION',
  sf_profQual:             'PROFESSIONAL QUALIFICATION',
  sf_cellNo:               'CELL NO',
  sf_whatsapp:             'WHATSAPP NO.',
  sf_email:                'EMAIL ID',
  sf_bankName:             'BANK NAME & BRANCH CODE WHERE SALARY IS CREDIT',
  sf_iban:                 'SALARY ACCOUNT IBAN NO.',
  sf_retirementDate:       'DATE OF RETIREMENT'
};

// ──────────────────────────────────────────────────────────────────
//  INIT
// ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.hr-view-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.hr-view-btn').forEach(b => b.classList.remove('hr-active'));
      this.classList.add('hr-active');
      hrCurrentSheetView = this.dataset.sheet;
      hrCurrentPage = 1;
      const meta = HR_SHEET_META[hrCurrentSheetView] || { title: hrCurrentSheetView, sub: '' };
      document.getElementById('hrPageTitle').textContent    = meta.title;
      document.getElementById('hrPageSubtitle').textContent = meta.sub;
      document.getElementById('addStaffBtn').style.display  = hrCurrentSheetView === 'Staff' ? 'inline-flex' : 'none';
      document.getElementById('hrSummaryCards').style.display = hrCurrentSheetView === 'Staff' ? '' : 'none';
      if (hrCurrentSheetView !== 'Staff') resetSummaryCards();
      clearHrFilters();
    });
  });

  document.addEventListener('click', e => {
    if (hrActiveMenu && !e.target.closest('.hr-fixed-menu') && !e.target.closest('.action-menu-btn')) {
      hrActiveMenu.remove(); hrActiveMenu = null;
    }
  });

  // Page size dropdown
  document.getElementById('hrPageSize').addEventListener('change', function() {
    hrPageSize = parseInt(this.value);
    hrCurrentPage = 1;
    applyHrFilter();
  });
});

// ──────────────────────────────────────────────────────────────────
//  OPEN MODULE
// ──────────────────────────────────────────────────────────────────
function openHrModule() {
  switchGlobalTab('hrDataView');
  if (typeof loadKpiCardsForModule === 'function') {
    loadKpiCardsForModule('hr', 'hrKpiGrid', 'hrKpiSection');
  }
  if (hrSchoolCache.length === 0) {
    _hrLoadSchoolHierarchy(1);
  } else {
    buildHrDistrictDropdown();
  }
}

// Retries the school-list fetch (which feeds all four filter dropdowns)
// with backoff. On a slow/flaky mobile connection this request is the
// most likely thing to time out — instead of leaving the filters
// silently blank, this keeps the user informed and retries automatically
// before finally offering a manual retry.
const HR_SCHOOL_LOAD_MAX_ATTEMPTS = 4;
const HR_SCHOOL_LOAD_BACKOFF_MS   = [1500, 3000, 6000]; // between attempts 1→2, 2→3, 3→4

function _hrLoadSchoolHierarchy(attempt) {
  document.getElementById('hrFilterDistrict').innerHTML = '<option>Loading…</option>';
  _hrShowFilterStatus(
    attempt === 1 ? 'loading' : 'retrying',
    attempt === 1
      ? 'Loading school list…'
      : `Slow internet connection — retrying (attempt ${attempt} of ${HR_SCHOOL_LOAD_MAX_ATTEMPTS})… please wait.`
  );

  const userPayload = typeof currentUser !== 'undefined' ? currentUser : null;
  google.script.run
    .withSuccessHandler(data => {
      hrSchoolCache = data || [];
      buildHrDistrictDropdown();
      _hrHideFilterStatus();
    })
    .withFailureHandler(err => {
      if (attempt < HR_SCHOOL_LOAD_MAX_ATTEMPTS) {
        const delay = HR_SCHOOL_LOAD_BACKOFF_MS[attempt - 1] || 6000;
        _hrShowFilterStatus('loading', `Slow internet connection — taking longer than usual, please wait…`);
        setTimeout(() => _hrLoadSchoolHierarchy(attempt + 1), delay);
      } else {
        document.getElementById('hrFilterDistrict').innerHTML = '<option value="">Failed to load</option>';
        _hrShowFilterStatus(
          'error',
          'Could not load the school list — your connection may be too slow or unstable right now.',
          true // show a manual Retry button
        );
      }
    })
    .getSchoolHierarchyForUser(userPayload);
}

function _hrShowFilterStatus(kind, message, showRetryBtn) {
  const el = document.getElementById('hrFilterStatusBanner');
  if (!el) return;
  el.classList.remove('hidden', 'hr-status-loading', 'hr-status-error');
  el.classList.add(kind === 'error' ? 'hr-status-error' : 'hr-status-loading');
  el.innerHTML =
    (kind === 'error' ? '<span class="material-icons-round" style="font-size:18px;">wifi_off</span>' : '<span class="hr-status-spinner"></span>') +
    '<span>' + message + '</span>' +
    (showRetryBtn ? '<button type="button" onclick="_hrLoadSchoolHierarchy(1)">Retry</button>' : '');
}

function _hrHideFilterStatus() {
  const el = document.getElementById('hrFilterStatusBanner');
  if (el) el.classList.add('hidden');
}

// ──────────────────────────────────────────────────────────────────
//  FILTER DROPDOWNS
//  Dropdown OPTIONS only ever contain values from the user's
//  jurisdiction pool (columns K, L, M) — enforced server-side by RLS
//  on the `schools` table (see supabase_jurisdiction_rls.sql), so
//  hrSchoolCache is already scoped correctly by the time it gets here.
//  Which of the four selects are interactive vs. locked/greyed-out is
//  now decided by applyJurisdictionLock() (js/jurisdiction-lock.js),
//  matching the same rules used by Public and Private Schools.
// ──────────────────────────────────────────────────────────────────
function buildHrDistrictDropdown() {
  const pool  = hrSchoolCache; // already jurisdiction-filtered server-side for non-admins
  const dists = [...new Set(pool.map(x => x.d).filter(Boolean))].sort();

  hrPopulateSelect('hrFilterDistrict', dists, 'All Districts');
  hrPopulateSelect('hrFilterWing',    [],    'All Wings');
  hrPopulateSelect('hrFilterTehsil',  [],    'All Tehsils');
  hrPopulateSelect('hrFilterMarkaz',  [],    'All Markazs');

  // Convenience preselect of the user's primary location.
  const u = typeof currentUser !== 'undefined' ? currentUser : null;
  const isAdmin = u && String(u.role || '').toLowerCase() === 'admin';
  if (u && !isAdmin && u.district) {
    document.getElementById('hrFilterDistrict').value = u.district;
    onHrDistrictChange();
    if (u.wing) {
      document.getElementById('hrFilterWing').value = u.wing;
      onHrWingChange();
    }
    if (u.tehsil) {
      document.getElementById('hrFilterTehsil').value = u.tehsil;
      onHrTehsilChange();
    }
    if (u.markaz) document.getElementById('hrFilterMarkaz').value = u.markaz;
  }

  // Lock/grey out per the user's jurisdiction level (District > Wing >
  // Tehsil > Markaz) — same rules as Public/Private Schools.
  if (typeof applyJurisdictionLock === 'function') {
    applyJurisdictionLock(
      { district: 'hrFilterDistrict', wing: 'hrFilterWing', tehsil: 'hrFilterTehsil', markaz: 'hrFilterMarkaz' },
      u
    );
  }
}
function onHrDistrictChange() {
  const pool = hrSchoolCache;
  const d    = document.getElementById('hrFilterDistrict').value;
  const wings = d
    ? [...new Set(pool.filter(x => x.d === d).map(x => x.w).filter(Boolean))].sort()
    : [...new Set(pool.map(x => x.w).filter(Boolean))].sort();
  hrPopulateSelect('hrFilterWing',   wings, 'All Wings');
  hrPopulateSelect('hrFilterTehsil', [],    'All Tehsils');
  hrPopulateSelect('hrFilterMarkaz', [],    'All Markazs');
}

function onHrWingChange() {
  const pool = hrSchoolCache;
  const d    = document.getElementById('hrFilterDistrict').value;
  const w    = document.getElementById('hrFilterWing').value;
  const tehsils = [...new Set(
    pool.filter(x => (!d || x.d === d) && (!w || x.w === w)).map(x => x.t).filter(Boolean)
  )].sort();
  hrPopulateSelect('hrFilterTehsil', tehsils, 'All Tehsils');
  hrPopulateSelect('hrFilterMarkaz', [],       'All Markazs');
}

function onHrTehsilChange() {
  const pool = hrSchoolCache;
  const d    = document.getElementById('hrFilterDistrict').value;
  const w    = document.getElementById('hrFilterWing').value;
  const t    = document.getElementById('hrFilterTehsil').value;
  const markazs = [...new Set(
    pool.filter(x => (!d || x.d === d) && (!w || x.w === w) && (!t || x.t === t))
        .map(x => x.m).filter(Boolean)
  )].sort();
  hrPopulateSelect('hrFilterMarkaz', markazs, 'All Markazs');
}


function hrPopulateSelect(id, values, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<option value="">${placeholder}</option>` +
    values.map(v => `<option value="${v}">${v}</option>`).join('');
}

function clearHrFilters() {
  document.getElementById('hrFilterEmis').value    = '';
  document.getElementById('hrFilterKeyword').value = '';
  buildHrDistrictDropdown();
  hrFilteredResults = [];
  document.getElementById('hrResultsContainer').innerHTML =
    '<div class="hr-empty-state">Filters cleared. Click Apply Filter to load.</div>';
  if (hrCurrentSheetView === 'Staff') resetSummaryCards();
}

// ──────────────────────────────────────────────────────────────────
//  APPLY FILTER & RENDER
// ──────────────────────────────────────────────────────────────────
function applyHrFilter() {
  hrCurrentPage = 1;
  const sheet = hrCurrentSheetView;
  if (hrSheetDataCache[sheet]) {
    runHrClientFilter(sheet);
  } else {
    document.getElementById('hrResultsContainer').innerHTML =
      '<div class="hr-empty-state">Loading HR Data…</div>';
    const userPayload = typeof currentUser !== 'undefined' ? currentUser : null;
    google.script.run
      .withSuccessHandler(res => {
        if (res.error) { hrShowToast('Error: ' + res.error, false); return; }
        const headersIn  = res.headers || [];
        const rowsIn     = res.rows || [];
        rowsIn.forEach(r => {
          r._searchBlob = headersIn.map(h => r[h] || '').join(' ').toLowerCase();
        });
        hrSheetDataCache[sheet] = { headers: headersIn, rows: rowsIn };
        if (sheet === 'Staff') hrStaffFullRows = rowsIn;
        runHrClientFilter(sheet);
      })
      .withFailureHandler(err => hrShowToast('Backend Error: ' + err.message, false))
      .loadSheetForClient(sheet, userPayload);
  }
}

function runHrClientFilter(sheet) {
  const cache = hrSheetDataCache[sheet];
  if (!cache || !cache.rows || !cache.rows.length) {
    document.getElementById('hrResultsContainer').innerHTML =
      '<div class="hr-empty-state">No records found in this sheet.</div>';
    if (sheet === 'Staff') { resetSummaryCards(); document.getElementById('hrSummaryCards').style.display = 'none'; }
    return;
  }
  hrCurrentHeaders = cache.headers;

  if (sheet === 'Staff' && (!hrStaffFullRows || hrStaffFullRows.length === 0)) {
    hrStaffFullRows = cache.rows;
  }

  const fDist = document.getElementById('hrFilterDistrict').value.toLowerCase();
  const fWing = document.getElementById('hrFilterWing').value.toLowerCase();
  const fTeh  = document.getElementById('hrFilterTehsil').value.toLowerCase();
  const fMark = document.getElementById('hrFilterMarkaz').value.toLowerCase();
  const fEmis = document.getElementById('hrFilterEmis').value.toLowerCase();
  const fKey  = document.getElementById('hrFilterKeyword').value.toLowerCase();

  let filtered = cache.rows.filter(row => {
    // Smart column fallback: Checks standard names, then historical sheet prefixes
    const rDist = (row._district || row['District'] || row['To District'] || row['From District'] || '').toLowerCase();
    const rWing = (row._wing     || row['Wing']     || row['To Wing']     || row['From Wing']     || '').toLowerCase();
    const rTeh  = (row._tehsil   || row['Tehsil']   || row['To Tehsil']   || row['From Tehsil']   || '').toLowerCase();
    const rMark = (row._markaz   || row['MARKAZ NAME'] || row['To Markaz'] || row['From Markaz'] || '').toLowerCase();
    const rEmis = (row['SCHOOL EMIS CODE'] || row['To EMIS'] || row['From EMIS'] || '').toString().toLowerCase();

    // Evaluate against active dropdowns
    if (fDist && rDist !== fDist) return false;
    if (fWing && rWing !== fWing) return false;
    if (fTeh  && rTeh !== fTeh)  return false;
    if (fMark && !rMark.includes(fMark)) return false;
    if (fEmis && !rEmis.includes(fEmis)) return false;
    if (fKey  && !(row._searchBlob || hrCurrentHeaders.map(h => row[h] || '').join(' ').toLowerCase()).includes(fKey)) return false;
    return true;
  });

  // ★ NEW: Sort filtered results by:
  // 1. Markaz Name (A → Z, case‑insensitive)
  // 2. EMIS Code (ascending, numeric)
  // 3. BPS (descending, numeric)  <-- changed to descending
  filtered.sort((a, b) => {
    const markazA = (a['MARKAZ NAME'] || a._markaz || '').toString().toLowerCase();
    const markazB = (b['MARKAZ NAME'] || b._markaz || '').toString().toLowerCase();
    if (markazA < markazB) return -1;
    if (markazA > markazB) return 1;

    const emisA = parseInt((a['SCHOOL EMIS CODE'] || '').toString(), 10) || 0;
    const emisB = parseInt((b['SCHOOL EMIS CODE'] || '').toString(), 10) || 0;
    if (emisA !== emisB) return emisA - emisB;

    const bpsA = parseInt((a['BPS'] || '').toString(), 10) || 0;
    const bpsB = parseInt((b['BPS'] || '').toString(), 10) || 0;
    return bpsB - bpsA; // Descending BPS
  });

  hrFilteredResults = filtered;

  // ── Summary cards are always based on the FILTERED results ──
  if (sheet === 'Staff') {
    document.getElementById('hrSummaryCards').style.display = '';
    updateSummaryCards(hrFilteredResults);
  }

  renderHrTable();
}

// ──────────────────────────────────────────────────────────────────
//  SUMMARY CARDS
//  All four cards recalculate from hrFilteredResults (the currently
//  visible rows after all filter dropdowns and keyword are applied).
//  Retirement dates are read from column AE header "DATE OF RETIREMENT".
// ──────────────────────────────────────────────────────────────────
function resetSummaryCards() {
  document.getElementById('scTotalStaff').textContent  = '—';
  document.getElementById('scRetiring1Yr').textContent = '—';
  document.getElementById('scNoHead').textContent      = '—';
  document.getElementById('scHeadCount').textContent   = '—';
  document.getElementById('scEmisMismatch').textContent = '—';
  document.getElementById('scEmisMismatchSub').textContent = 'Check list';
  window._hrEmisMismatchRows = null;  // force a fresh backend check next time it's opened
}

function updateSummaryCards(filteredRows) {
  // 1. Total active staff in current filter
  document.getElementById('scTotalStaff').textContent = filteredRows.length.toLocaleString();

  // 2. Retiring within 1 year — reads column AE: "DATE OF RETIREMENT"
  //    Supports formats: "DD-Mon-YYYY", "YYYY-MM-DD", JS date strings
  const now        = new Date();
  const oneYearOut = new Date();
  oneYearOut.setFullYear(now.getFullYear() + 1);

  const retiringRows = filteredRows.filter(row => {
    // Try the column AE header key first, then common variants
    const retRaw =
      row['DATE OF RETIREMENT'] ||
      row['Date of Retirement'] ||
      row['date of retirement'] || '';
    if (!retRaw) return false;
    const retDate = _parseHrDate(retRaw.toString().trim());
    if (!retDate) return false;
    return retDate >= now && retDate <= oneYearOut;
  });
  document.getElementById('scRetiring1Yr').textContent = retiringRows.length;
  document.getElementById('scRetiringNames').textContent =
    retiringRows.length > 0 ? 'View list (' + retiringRows.length + ')' : 'None due within 1 year';
  window._hrRetiringRows = retiringRows;

  // 3. Schools with no head — cross-check filtered EMIS vs filtered staff with Working as Head = Yes
  //    Uses only filtered rows so the count reflects the current filter selection
  const emisWithHead = new Set(
    filteredRows
      .filter(r => (r['WORKING AS HEAD'] || '').toString().trim().toLowerCase() === 'yes')
      .map(r => (r['SCHOOL EMIS CODE'] || '').toString().trim())
      .filter(Boolean)
  );

  // Build pool of schools that match the current filter selection
  const pool = _getFilteredSchoolPool();
  const noHeadSchools = pool.filter(s => {
    const emis = (s.e || '').toString().trim();
    return emis && !emisWithHead.has(emis);
  });
  document.getElementById('scNoHead').textContent = noHeadSchools.length;
  window._hrNoHeadSchools = noHeadSchools;

  // 4. Head teacher count in current filter
  const headTeachers = filteredRows.filter(r =>
    (r['WORKING AS HEAD'] || '').toString().trim().toLowerCase() === 'yes'
  );
  document.getElementById('scHeadCount').textContent = headTeachers.length;
  window._hrHeadTeachers = headTeachers;
}

/**
 * Returns the subset of the user's jurisdiction schools further narrowed
 * by whatever District/Wing/Tehsil/Markaz dropdowns are currently selected.
 * Used for the "Schools without a Head" card so it respects the active filter.
 */
function _getFilteredSchoolPool() {
  const pool  = hrSchoolCache; // already jurisdiction-filtered server-side
  const fDist = document.getElementById('hrFilterDistrict').value;
  const fWing = document.getElementById('hrFilterWing').value;
  const fTeh  = document.getElementById('hrFilterTehsil').value;
  const fMark = document.getElementById('hrFilterMarkaz').value;

  return pool.filter(s => {
    if (fDist && s.d !== fDist) return false;
    if (fWing && s.w !== fWing) return false;
    if (fTeh  && s.t !== fTeh)  return false;
    if (fMark && s.m !== fMark) return false;
    return true;
  });
}
function _ensureAllSchoolCache(callback) {
  // If the cache is already populated, run the callback immediately
  if (hrAllSchoolCache && hrAllSchoolCache.length > 0) { 
    callback(); 
    return; 
  }
  
  // Otherwise, fetch it once
  google.script.run
    .withSuccessHandler(data => {
      hrAllSchoolCache = data || [];
      callback();
    })
    .withFailureHandler(err => {
      hrShowToast('Error loading school data: ' + err.message, false);
      hrAllSchoolCache = hrAllSchoolCache || [];
      callback();  // still resolve the caller so it doesn't hang waiting forever
    })
    .getSchoolHierarchy();
}

// ──────────────────────────────────────────────────────────────────
//  RETIRING SOON MODAL
// ──────────────────────────────────────────────────────────────────
function openRetiringModal() {
  const rows  = window._hrRetiringRows || [];
  const modal = document.getElementById('hrRetiringSoonModal');
  const body  = document.getElementById('hrRetiringSoonBody');

  if (!rows.length) {
    body.innerHTML = '<p style="color:#6B7280;text-align:center;padding:20px 0;">No staff retiring within the next 12 months in the current filter.</p>';
    modal.style.display = 'flex';
    return;
  }

  const sorted = [...rows].sort((a, b) => {
    const da = _parseHrDate((a['DATE OF RETIREMENT'] || a['Date of Retirement'] || '').toString());
    const db = _parseHrDate((b['DATE OF RETIREMENT'] || b['Date of Retirement'] || '').toString());
    return (da || 0) - (db || 0);
  });

  const rows_html = sorted.map(r => {
    const retDate  = (r['DATE OF RETIREMENT'] || r['Date of Retirement'] || '').toString();
    const parsed   = _parseHrDate(retDate);
    const daysLeft = parsed ? Math.ceil((parsed - new Date()) / 86400000) : '?';
    const urgency  = daysLeft !== '?' && daysLeft <= 90 ? 'color:#DC2626;font-weight:700;' : '';
    return `<tr>
      <td>${r['PERSONAL NO.'] || ''}</td>
      <td>${r['NAME OF TEACHER'] || ''}</td>
      <td>${r['DESIGNATION'] || ''}</td>
      <td>${r['SCHOOL EMIS CODE'] || ''}</td>
      <td>${r['MARKAZ NAME'] || ''}</td>
      <td style="${urgency}">${retDate}</td>
      <td style="${urgency}">${daysLeft !== '?' ? daysLeft + ' days' : '?'}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `
    <p style="font-size:13px;color:#475569;margin-bottom:14px;">
      <b>${rows.length}</b> staff member(s) in current filter are retiring within the next 12 months.
      <span style="color:#DC2626;font-weight:600;">Red = within 90 days.</span>
    </p>
    <div style="overflow-x:auto;">
      <table class="retiring-table">
        <thead>
          <tr><th>P.No.</th><th>Name</th><th>Designation</th><th>EMIS</th><th>Markaz</th><th>Retirement Date</th><th>Days Left</th></tr>
        </thead>
        <tbody>${rows_html}</tbody>
      </table>
    </div>`;
  modal.style.display = 'flex';
}

// ──────────────────────────────────────────────────────────────────
//  SCHOOLS WITH NO HEAD MODAL
// ──────────────────────────────────────────────────────────────────
function openNoHeadModal() {
  const schools = window._hrNoHeadSchools || [];
  const modal   = document.getElementById('hrNoHeadModal');
  const body    = document.getElementById('hrNoHeadBody');

  if (!schools.length) {
    body.innerHTML = '<p style="color:#6B7280;text-align:center;padding:20px 0;">All schools in the current filter have an active Head Teacher assigned.</p>';
    modal.style.display = 'flex';
    return;
  }

  const rows_html = schools.map(s => `
    <tr>
      <td>${s.e || ''}</td>
      <td>${s.d || ''}</td>
      <td>${s.w || ''}</td>
      <td>${s.t || ''}</td>
      <td>${s.m || ''}</td>
    </tr>`).join('');

  body.innerHTML = `
    <p style="font-size:13px;color:#475569;margin-bottom:14px;">
      <b>${schools.length}</b> school(s) in the current filter have no staff with <b>Working as Head = Yes</b>.
    </p>
    <div style="overflow-x:auto;">
      <table class="nohead-table">
        <thead>
          <tr><th>EMIS Code</th><th>District</th><th>Wing</th><th>Tehsil</th><th>Markaz</th></tr>
        </thead>
        <tbody>${rows_html}</tbody>
      </table>
    </div>`;
  modal.style.display = 'flex';
}

// ──────────────────────────────────────────────────────────────────
//  STAFF EMIS NOT IN PUBLIC SCHOOLS MODAL
//  Unlike the Retiring/No-Head cards (which recompute from data
//  already loaded for the HR filters), this needs the full national
//  public_schools EMIS list, which isn't loaded on this page — so it's
//  fetched fresh from the backend the first time the card is opened,
//  then cached for the rest of the session.
// ──────────────────────────────────────────────────────────────────
function openEmisMismatchModal() {
  const modal = document.getElementById('hrEmisMismatchModal');
  const body  = document.getElementById('hrEmisMismatchBody');

  if (window._hrEmisMismatchRows) {
    _renderEmisMismatchModal(window._hrEmisMismatchRows);
    return;
  }

  body.innerHTML = '<p style="color:#6B7280;text-align:center;padding:20px 0;">Checking staff EMIS codes against Public Schools…</p>';
  modal.style.display = 'flex';

  const userPayload = typeof currentUser !== 'undefined' ? currentUser : null;
  google.script.run
    .withSuccessHandler(res => {
      if (!res || res.success === false) {
        body.innerHTML = '<p style="color:#DC2626;text-align:center;padding:20px 0;">Could not check EMIS codes: ' + (res && res.message ? res.message : 'Unknown error') + '</p>';
        return;
      }
      window._hrEmisMismatchRows = res.rows || [];
      document.getElementById('scEmisMismatch').textContent = res.count || 0;
      document.getElementById('scEmisMismatchSub').textContent =
        (res.count || 0) > 0 ? 'Check list (' + res.count + ')' : 'No mismatches found';
      _renderEmisMismatchModal(window._hrEmisMismatchRows);
    })
    .withFailureHandler(err => {
      body.innerHTML = '<p style="color:#DC2626;text-align:center;padding:20px 0;">Could not check EMIS codes: ' + (err && err.message ? err.message : 'Unknown error') + '</p>';
    })
    .getStaffEmisNotInPublicSchools(userPayload);
}

function _renderEmisMismatchModal(rows) {
  const modal = document.getElementById('hrEmisMismatchModal');
  const body  = document.getElementById('hrEmisMismatchBody');

  if (!rows.length) {
    body.innerHTML = '<p style="color:#6B7280;text-align:center;padding:20px 0;">Every active staff member\u2019s School EMIS Code was found in Public Schools.</p>';
    modal.style.display = 'flex';
    return;
  }

  const rows_html = rows.map(r => `
    <tr>
      <td>${r['PERSONAL NO.'] || ''}</td>
      <td>${r['NAME OF TEACHER'] || ''}</td>
      <td>${r['DESIGNATION'] || ''}</td>
      <td style="color:#DC2626;font-weight:600;">${r['SCHOOL EMIS CODE'] || '(blank)'}</td>
      <td>${r['SCHOOL NAME'] || ''}</td>
      <td>${r['MARKAZ NAME'] || ''}</td>
      <td>${r['Tehsil'] || ''}</td>
    </tr>`).join('');

  body.innerHTML = `
    <p style="font-size:13px;color:#475569;margin-bottom:14px;">
      <b>${rows.length}</b> active staff member(s) have a School EMIS Code that doesn\u2019t match any record in Public Schools
      — likely a typo, a merged/closed school, or a code that was never entered correctly.
    </p>
    <div style="overflow-x:auto;">
      <table class="nohead-table">
        <thead>
          <tr><th>P.No.</th><th>Name</th><th>Designation</th><th>EMIS</th><th>School Name (on staff record)</th><th>Markaz</th><th>Tehsil</th></tr>
        </thead>
        <tbody>${rows_html}</tbody>
      </table>
    </div>`;
  modal.style.display = 'flex';
}

// ──────────────────────────────────────────────────────────────────
//  DOWNLOAD HEAD TEACHERS (UPDATED – base64 Excel, no Drive file)
// ──────────────────────────────────────────────────────────────────
function downloadHeadTeachers() {
  // Use the currently filtered results (respects all active filters)
  const headTeachers = hrFilteredResults.filter(r =>
    (r['WORKING AS HEAD'] || '').toString().trim().toLowerCase() === 'yes'
  );

  if (!headTeachers.length) {
    hrShowToast('No Head Teachers (Working as Head = Yes) found in the current filter.', false);
    return;
  }

  // Export ALL columns that are present in the current sheet headers
  const exportCols = hrCurrentHeaders.length > 0
    ? hrCurrentHeaders
    : Object.values(SF_MAP); // fallback if headers not yet populated

  const userPayload = typeof currentUser !== 'undefined' ? currentUser : { name: 'Admin' };
  const cleanRows   = headTeachers.map(r => {
    const obj = {};
    exportCols.forEach(col => { obj[col] = r[col] !== undefined ? r[col] : ''; });
    return obj;
  });

  // Use base64 export via backend; fallback to CSV
  try {
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.base64) {
          // Decode base64 and download as Excel
          const binary = atob(res.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'Head_Teachers_Filtered_' + new Date().toISOString().slice(0,10) + '.xlsx';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          hrShowToast('Head Teachers list downloaded (' + headTeachers.length + ' records, ' + exportCols.length + ' columns).', true);
        } else if (res && res.url) {
          // Fallback for backward compatibility (old Drive URL)
          window.open(res.url, '_blank');
          hrShowToast('Head Teachers Excel opened successfully.', true);
        } else {
          _hrDownloadCsv(headTeachers, exportCols);
        }
      })
      .withFailureHandler(() => {
        _hrDownloadCsv(headTeachers, exportCols);
      })
      .exportHeadTeachersToExcel(cleanRows, exportCols, userPayload);
  } catch (e) {
    _hrDownloadCsv(headTeachers, exportCols);
  }
}

// ──────────────────────────────────────────────────────────────────
//  NEW: DOWNLOAD ACTIVE STAFF (filtered, all columns)
// ──────────────────────────────────────────────────────────────────
function downloadActiveStaff() {
  // Use the currently filtered results (respects all active filters)
  const rows = hrFilteredResults;

  if (!rows || !rows.length) {
    hrShowToast('No active staff records in the current filter.', false);
    return;
  }

  // Export ALL columns that are present in the current sheet headers
  const exportCols = hrCurrentHeaders.length > 0
    ? hrCurrentHeaders
    : Object.values(SF_MAP); // fallback

  const userPayload = typeof currentUser !== 'undefined' ? currentUser : { name: 'Admin' };
  const cleanRows = rows.map(r => {
    const obj = {};
    exportCols.forEach(col => { obj[col] = r[col] !== undefined ? r[col] : ''; });
    return obj;
  });

  // Attempt backend Excel export via base64; fallback to CSV
  try {
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.base64) {
          // Decode base64 and download as Excel
          const binary = atob(res.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'Active_Staff_Filtered_' + new Date().toISOString().slice(0,10) + '.xlsx';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          hrShowToast('Active Staff list downloaded (' + rows.length + ' records, ' + exportCols.length + ' columns).', true);
        } else if (res && res.url) {
          // Fallback for backward compatibility (old Drive URL)
          window.open(res.url, '_blank');
          hrShowToast('Active Staff Excel opened successfully.', true);
        } else {
          _hrDownloadCsv(rows, exportCols);
        }
      })
      .withFailureHandler(() => {
        _hrDownloadCsv(rows, exportCols);
      })
      .exportActiveStaffToExcel(cleanRows, exportCols, userPayload);
  } catch (e) {
    _hrDownloadCsv(rows, exportCols);
  }
}

/**
 * Pure client‑side CSV download — exports every column passed in cols[].
 */
function _hrDownloadCsv(rows, cols) {
  const escape = v => {
    const s = (v === null || v === undefined) ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };
  const lines = [cols.map(escape).join(',')];
  rows.forEach(r => lines.push(cols.map(c => escape(r[c] !== undefined ? r[c] : '')).join(',')));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'Export_' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  hrShowToast('List downloaded (' + rows.length + ' records, ' + cols.length + ' columns).', true);
}

// ──────────────────────────────────────────────────────────────────
//  DOWNLOAD SNE (Sanctioned / Filled / Vacant, grade-wise per school)
// ──────────────────────────────────────────────────────────────────
function downloadSNE() {
  const userPayload = typeof currentUser !== 'undefined' ? currentUser : { name: 'Admin' };
  showLoading();
  google.script.run
    .withFailureHandler(err => {
      hideLoading();
      hrShowToast('SNE export failed: ' + (err && err.message ? err.message : 'Unknown error'), false);
    })
    .withSuccessHandler(res => {
      hideLoading();
      if (!res || !res.success || !res.rows || !res.rows.length) {
        hrShowToast('No SNE data available for the current scope.', false);
        return;
      }
      _buildSneExcel(res.rows);
    })
    .getSneSummary(userPayload);
}

function _buildSneExcel(rows) {
  // Sort by Markaz then School Name for a readable report.
  const sorted = rows.slice().sort((a, b) => {
    const m = (a.markaz_name || '').localeCompare(b.markaz_name || '');
    return m !== 0 ? m : (a.school_name || '').localeCompare(b.school_name || '');
  });

  const headerRow1 = ['Sr No.', 'Markaz Name', 'Emis', 'School Name',
    'Grade 16', '', '', 'Grade 15', '', '', 'Grade 14', '', '', 'Non-Teaching', '', ''];
  const headerRow2 = ['', '', '', '',
    'Sanctioned', 'Filled', 'Vacant', 'Sanctioned', 'Filled', 'Vacant',
    'Sanctioned', 'Filled', 'Vacant', 'Sanctioned', 'Filled', 'Vacant'];

  const aoa = [headerRow1, headerRow2];
  sorted.forEach((r, i) => {
    aoa.push([
      i + 1, r.markaz_name || '', r.emis || '', r.school_name || '',
      r.grade16_sanctioned || 0, r.grade16_filled || 0, r.grade16_vacant || 0,
      r.grade15_sanctioned || 0, r.grade15_filled || 0, r.grade15_vacant || 0,
      r.grade14_sanctioned || 0, r.grade14_filled || 0, r.grade14_vacant || 0,
      r.nonteaching_sanctioned || 0, r.nonteaching_filled || 0, r.nonteaching_vacant || 0,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Merge Sr No./Markaz/Emis/School Name down both header rows, and
  // each grade group across its 3 sub-columns.
  ws['!merges'] = [
    { s: { r: 0, c: 0 },  e: { r: 1, c: 0 } },  // Sr No.
    { s: { r: 0, c: 1 },  e: { r: 1, c: 1 } },  // Markaz Name
    { s: { r: 0, c: 2 },  e: { r: 1, c: 2 } },  // Emis
    { s: { r: 0, c: 3 },  e: { r: 1, c: 3 } },  // School Name
    { s: { r: 0, c: 4 },  e: { r: 0, c: 6 } },  // Grade 16
    { s: { r: 0, c: 7 },  e: { r: 0, c: 9 } },  // Grade 15
    { s: { r: 0, c: 10 }, e: { r: 0, c: 12 } }, // Grade 14
    { s: { r: 0, c: 13 }, e: { r: 0, c: 15 } }, // Non-Teaching
  ];

  ws['!cols'] = [
    { wch: 6 }, { wch: 22 }, { wch: 10 }, { wch: 30 },
    { wch: 10 }, { wch: 8 }, { wch: 8 },
    { wch: 10 }, { wch: 8 }, { wch: 8 },
    { wch: 10 }, { wch: 8 }, { wch: 8 },
    { wch: 12 }, { wch: 8 }, { wch: 8 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SNE Summary');
  XLSX.writeFile(wb, 'SNE_Summary_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  hrShowToast('SNE report downloaded (' + sorted.length + ' schools).', true);
}

// ──────────────────────────────────────────────────────────────────
//  TABLE RENDER
// ──────────────────────────────────────────────────────────────────
function renderHrTable() {
  const container = document.getElementById('hrResultsContainer');
  if (!hrFilteredResults.length) {
    container.innerHTML = '<div class="hr-empty-state">No matching records found.</div>';
    return;
  }
  const totalPages = Math.ceil(hrFilteredResults.length / hrPageSize);
  if (hrCurrentPage > totalPages) hrCurrentPage = totalPages || 1;
  const start      = (hrCurrentPage - 1) * hrPageSize;
  const pageRows   = hrFilteredResults.slice(start, start + hrPageSize);

  const head = '<tr><th class="hr-actions-col">☰</th>' +
    hrCurrentHeaders.map(h => `<th>${h}</th>`).join('') + '</tr>';
  const body = pageRows.map((row, idx) => {
    const cells = hrCurrentHeaders.map(h => `<td>${row[h] !== undefined && row[h] !== null ? row[h] : ''}</td>`).join('');
    return `<tr><td class="hr-actions-col"><button type="button" class="hr-btn-ghost action-menu-btn" style="padding:3px 8px;" onclick="openHrMenu(this,${start+idx})">⋮</button></td>${cells}</tr>`;
  }).join('');

  const pagination = totalPages > 1 ? `
    <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <button type="button" class="hr-btn-ghost" onclick="hrGoPage(${hrCurrentPage-1})" ${hrCurrentPage===1?'disabled':''}>‹ Prev</button>
      <span style="font-size:13px;color:#475569;">Page ${hrCurrentPage} of ${totalPages}</span>
      <button type="button" class="hr-btn-ghost" onclick="hrGoPage(${hrCurrentPage+1})" ${hrCurrentPage===totalPages?'disabled':''}>Next ›</button>
    </div>` : '';

  container.innerHTML = `
    <div style="margin-bottom:10px;font-size:12px;font-weight:700;color:#475569;">
      ${hrFilteredResults.length} Records Found
      ${totalPages > 1 ? '· Page ' + hrCurrentPage + ' / ' + totalPages : ''}
    </div>
    <div class="hr-table-wrap">
      <table class="hr-data-table">
        <thead>${head}</thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${pagination}`;
}

function hrGoPage(p) {
  const total = Math.ceil(hrFilteredResults.length / hrPageSize);
  if (p < 1 || p > total) return;
  hrCurrentPage = p; renderHrTable();
}

// ──────────────────────────────────────────────────────────────────
//  CONTEXT MENU
// ──────────────────────────────────────────────────────────────────
function openHrMenu(btn, idx) {
  if (hrActiveMenu) hrActiveMenu.remove();
  const isStaff  = hrCurrentSheetView === 'Staff';
  const isRevert = REVERT_SHEETS.includes(hrCurrentSheetView);

  const menu = document.createElement('div');
  menu.className = 'hr-fixed-menu';

  let items = `<button type="button" class="hr-action-item" onclick="openStaffFormModal('view', hrFilteredResults[${idx}]); hrActiveMenu&&hrActiveMenu.remove(); hrActiveMenu=null;">👁 View Details</button>`;

  if (isStaff) {
    const isAdminUser = typeof currentUser !== 'undefined' && currentUser &&
      String(currentUser.role || '').toLowerCase() === 'admin';
    items += `
      <button type="button" class="hr-action-item" onclick="openStaffFormModal('edit', hrFilteredResults[${idx}]); hrActiveMenu&&hrActiveMenu.remove(); hrActiveMenu=null;">✏️ Edit Record</button>
      <button type="button" class="hr-action-item" onclick="openTransferModal(hrFilteredResults[${idx}]); hrActiveMenu&&hrActiveMenu.remove(); hrActiveMenu=null;">🔄 Transfer</button>
      <button type="button" class="hr-action-item" onclick="openPromotionModal(hrFilteredResults[${idx}]); hrActiveMenu&&hrActiveMenu.remove(); hrActiveMenu=null;">⬆️ Promotion</button>
      <button type="button" class="hr-action-item" onclick="openSeparationModal('retirement', hrFilteredResults[${idx}]); hrActiveMenu&&hrActiveMenu.remove(); hrActiveMenu=null;">🎓 Retirement</button>
      <button type="button" class="hr-action-item" onclick="openSeparationModal('resignation', hrFilteredResults[${idx}]); hrActiveMenu&&hrActiveMenu.remove(); hrActiveMenu=null;">📝 Resignation</button>
      <button type="button" class="hr-action-item" onclick="openSeparationModal('termination', hrFilteredResults[${idx}]); hrActiveMenu&&hrActiveMenu.remove(); hrActiveMenu=null;">🚫 Termination</button>
      <button type="button" class="hr-action-item" onclick="openSeparationModal('death', hrFilteredResults[${idx}]); hrActiveMenu&&hrActiveMenu.remove(); hrActiveMenu=null;">✝️ Death Case</button>
      ${isAdminUser ? `<button type="button" class="hr-action-item danger" onclick="confirmDeleteHrRow(hrFilteredResults[${idx}]); hrActiveMenu&&hrActiveMenu.remove(); hrActiveMenu=null;">🗑 Delete</button>` : ''}`;
  } else if (isRevert) {
    const revertLabel = hrCurrentSheetView === 'Transfer_History'  ? '↩ Undo Transfer'
                      : hrCurrentSheetView === 'Promotions_History' ? '↩ Undo Promotion'
                      : '↩ Revert to Active Staff';
    items += `<button type="button" class="hr-action-item" onclick="revertHrRow(hrFilteredResults[${idx}]); hrActiveMenu&&hrActiveMenu.remove(); hrActiveMenu=null;">${revertLabel}</button>`;
  }

  menu.innerHTML = items;
  document.body.appendChild(menu);
  const rect = btn.getBoundingClientRect();
  let top  = rect.bottom + 4;
  let left = rect.left;
  menu.style.top  = top  + 'px';
  menu.style.left = left + 'px';
  const mRect = menu.getBoundingClientRect();
  if (mRect.bottom > window.innerHeight) menu.style.top  = (rect.top - mRect.height - 4) + 'px';
  if (mRect.right  > window.innerWidth)  menu.style.left = (rect.right - mRect.width)    + 'px';
  hrActiveMenu = menu;
}

// ──────────────────────────────────────────────────────────────────
//  STAFF FORM MODAL
// ──────────────────────────────────────────────────────────────────
function openStaffFormModal(mode, row) {
  sfmMode = mode;
  sfmCurrentRow = row || null;

  const modal   = document.getElementById('hrStaffFormModal');
  const chip    = document.getElementById('sfmModeChip');
  const title   = document.getElementById('sfmTitle');
  const saveBtn = document.getElementById('sfmSaveBtn');
  const form    = document.getElementById('hrActualStaffForm');

  form.reset();
  document.getElementById('sf_emis_msg').style.display  = 'none';
  document.getElementById('sf_pno_msg').style.display   = 'none';
  document.getElementById('sf_cnic_msg').style.display  = 'none';
  document.getElementById('sf_emis').style.borderColor  = '#CBD5E1';
  document.getElementById('sf_retirementDate').value    = '';

  Object.keys(SF_MAP).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.removeAttribute('disabled');
    if (!el.classList.contains('hr-readonly')) el.removeAttribute('readonly');
  });

  if (mode === 'add') {
    hrPnoStatus = 'unchecked';
    hrCnicStatus = 'unchecked';
    hrIbanStatus = 'unchecked';
    chip.textContent      = 'NEW';
    chip.style.background = 'rgba(16,185,129,0.35)';
    title.textContent     = 'Add New Staff Member';
    saveBtn.style.display = 'inline-flex';
    toggleRegularizationField();
  } else if (mode === 'edit') {
    hrCnicStatus = 'unchecked';
    hrIbanStatus = 'unchecked';
    chip.textContent      = 'EDIT';
    chip.style.background = 'rgba(245,158,11,0.35)';
    title.textContent     = 'Edit Staff Record';
    saveBtn.style.display = 'inline-flex';
    _sfmFillForm(row);
    const pnoEl = document.getElementById('sf_personalNo');
    pnoEl.setAttribute('readonly', 'true');
    pnoEl.classList.add('hr-readonly');
  } else {
    chip.textContent      = 'VIEW';
    chip.style.background = 'rgba(255,255,255,0.2)';
    title.textContent     = 'View Staff Details';
    saveBtn.style.display = 'none';
    _sfmFillForm(row);
    Object.keys(SF_MAP).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('disabled', 'true');
    });
  }

  // ── EMIS data guard: lazy-load hrSchoolCache if not yet populated ──
  // (mirrors the same pattern used by openHrModule / openTransferModal so
  // the EMIS lookup never silently fails because the cache is still empty)
  if (hrSchoolCache.length === 0) {
    const emisMsg = document.getElementById('sf_emis_msg');
    emisMsg.textContent   = '⏳ Loading school data…';
    emisMsg.style.color   = '#D97706';
    emisMsg.style.display = 'block';
    google.script.run
      .withSuccessHandler(data => {
        hrSchoolCache = data || [];
        emisMsg.style.display = 'none';
        // Refresh the StaffForm's own EMIS map (if that module is loaded)
        // so add/edit/transfer/promotion lookups work immediately too.
        if (typeof buildSfmEmisMap === 'function') buildSfmEmisMap();
      })
      .withFailureHandler(() => {
        emisMsg.textContent   = '⚠ Failed to load school data.';
        emisMsg.style.color   = '#EF4444';
        emisMsg.style.display = 'block';
      })
      .getSchoolHierarchyForUser(typeof currentUser !== 'undefined' ? currentUser : null);
  } else if (typeof buildSfmEmisMap === 'function') {
    // Cache already populated — make sure the StaffForm EMIS map is in sync.
    buildSfmEmisMap();
  }

  modal.style.display = 'flex';
}

function _sfmFillForm(row) {
  if (!row) return;
  Object.keys(SF_MAP).forEach(id => {
    const el  = document.getElementById(id);
    const key = SF_MAP[id];
    if (!el) return;
    let val = (row[key] !== undefined && row[key] !== null) ? row[key].toString() : '';
    if (el.type === 'date' && val) {
      const cv = _toDateInput(val);
      if (cv) val = cv;
    }
    el.value = val;
  });
  calcRetirementDate();
  toggleRegularizationField();
}

// ──────────────────────────────────────────────────────────────────
//  EMIS LOOKUP
// ──────────────────────────────────────────────────────────────────
function triggerEmisLookup(emisValue) {
  const valStr = emisValue.toString().trim();
  const msg    = document.getElementById('sf_emis_msg');
  const emisEl = document.getElementById('sf_emis');

  ['sf_district','sf_wing','sf_tehsil','sf_markaz'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  msg.style.display        = 'none';
  emisEl.style.borderColor = '#CBD5E1';

  if (!valStr || valStr.length === 0) return;

  if (valStr.length !== 8 || !/^\d{8}$/.test(valStr)) {
    msg.textContent          = '⚠ EMIS must be exactly 8 digits.';
    msg.style.display        = 'block';
    emisEl.style.borderColor = '#EF4444';
    return;
  }

  const school = hrSchoolCache.find(s => s.e && s.e.toString().trim() === valStr);

  if (school) {
    document.getElementById('sf_district').value = school.d || '';
    document.getElementById('sf_wing').value      = school.w || '';
    document.getElementById('sf_tehsil').value    = school.t || '';
    document.getElementById('sf_markaz').value    = school.m || '';
    emisEl.style.borderColor = '#10B981';
    msg.textContent          = '✓ ' + school.d + ' › ' + school.w + ' › ' + school.t + ' › ' + school.m;
    msg.style.color          = '#059669';
    msg.style.display        = 'block';
  } else {
    msg.textContent          = '⚠ EMIS not found in Schools data.';
    msg.style.color          = '#EF4444';
    msg.style.display        = 'block';
    emisEl.style.borderColor = '#EF4444';
  }
}

// ──────────────────────────────────────────────────────────────────
//  PERSONAL NO. LIVE CHECK
// ──────────────────────────────────────────────────────────────────
function triggerPnoCheck(pno) {
  const msg = document.getElementById('sf_pno_msg');
  msg.style.display = 'none';
  hrPnoStatus = 'unchecked';

  if (!pno || sfmMode !== 'add') return;
  if (pno.length < 8) return;

  // ── 1. Client-side — main sheets (col D) ─────────────────────
  const mainSheets = ['Staff','Deleted_Archive','s_History',
                      'Deceased','Termination','Retirement','Resignation'];
  let foundIn = null;

  mainSheets.forEach(sh => {
    if (foundIn) return;
    const cache = hrSheetDataCache[sh];
    if (!cache) return;
    const pnoHdr = (cache.headers || []).find(h =>
      h && h.toString().trim().toUpperCase() === 'PERSONAL NO.'
    );
    if (!pnoHdr) return;
    if (cache.rows.some(r => (r[pnoHdr] || '').toString().trim() === pno))
      foundIn = sh;
  });

  // ── 2. Client-side — Transfer_History (col B) ────────────────
  if (!foundIn) {
    const thCache = hrSheetDataCache['Transfer_History'];
    if (thCache) {
      const thHdr = (thCache.headers || []).find(h =>
        h && h.toString().trim() === 'Employee Personal No'
      );
      if (thHdr && thCache.rows.some(r =>
        (r[thHdr] || '').toString().trim() === pno
      )) foundIn = 'Transfer_History';
    }
  }

  if (foundIn) {
    hrPnoStatus = 'duplicate';
    msg.textContent   = '⚠ Personal No. already exists in "' + foundIn + '".';
    msg.style.color   = '#D97706';
    msg.style.display = 'block';
    return;
  }

  // ── 3. Server-side fallback ───────────────────────────────────
  hrPnoStatus = 'checking';
  msg.textContent   = '⏳ Verifying across all records…';
  msg.style.color   = '#475569';
  msg.style.display = 'block';

  google.script.run
    .withSuccessHandler(res => {
      if ((document.getElementById('sf_personalNo').value || '').trim() !== pno) return;
      if (res && res.found) {
        hrPnoStatus = 'duplicate';
        msg.textContent = '⚠ Personal No. already exists in "' + res.sheet + '".';
        msg.style.color = '#D97706';
      } else {
        hrPnoStatus = 'available';
        msg.textContent = '✓ Personal No. is available.';
        msg.style.color = '#059669';
      }
    })
    .withFailureHandler(() => {
      hrPnoStatus = 'unchecked';
      msg.style.display = 'none';
    })
    .checkPersonalNoDuplicate(pno, null);
}
// ──────────────────────────────────────────────────────────────────
//  CNIC LIVE CHECK
// ──────────────────────────────────────────────────────────────────
function triggerCnicCheck(cnic) {
  const msg = document.getElementById('sf_cnic_msg');
  msg.style.display = 'none';
  hrCnicStatus = 'unchecked';

  if (!cnic || cnic.length < 13) return;
  if (!/^\d{13}$/.test(cnic)) {
    msg.textContent   = '⚠ CNIC must be exactly 13 digits.';
    msg.style.color   = '#EF4444';
    msg.style.display = 'block';
    return;
  }

  // Skip check in edit mode for the same record's own CNIC
  const ownCnic = sfmCurrentRow ? (sfmCurrentRow['CNIC'] || '').toString().trim() : '';
  if (sfmMode === 'edit' && cnic === ownCnic) {
    hrCnicStatus = 'available';
    return;
  }

  // ── 1. Client-side — main sheets (col W) ─────────────────────
  const mainSheets = ['Staff','Deleted_Archive','s_History',
                      'Deceased','Termination','Retirement','Resignation'];
  let foundIn = null;

  mainSheets.forEach(sh => {
    if (foundIn) return;
    const cache = hrSheetDataCache[sh];
    if (!cache) return;
    const cnicHdr = (cache.headers || []).find(h =>
      h && h.toString().trim().toUpperCase() === 'CNIC'
    );
    if (!cnicHdr) return;
    if (cache.rows.some(r => (r[cnicHdr] || '').toString().trim() === cnic))
      foundIn = sh;
  });

  // ── 2. Client-side — Transfer_History (col C) ────────────────
  if (!foundIn) {
    const thCache = hrSheetDataCache['Transfer_History'];
    if (thCache) {
      const thHdr = (thCache.headers || []).find(h =>
        h && h.toString().trim() === 'Employee CNIC'
      );
      if (thHdr && thCache.rows.some(r =>
        (r[thHdr] || '').toString().trim() === cnic
      )) foundIn = 'Transfer_History';
    }
  }

  if (foundIn) {
    hrCnicStatus = 'duplicate';
    msg.textContent   = '⚠ CNIC already exists in "' + foundIn + '".';
    msg.style.color   = '#D97706';
    msg.style.display = 'block';
    return;
  }

  // ── 3. Server-side fallback ───────────────────────────────────
  hrCnicStatus = 'checking';
  msg.textContent   = '⏳ Verifying CNIC across all records…';
  msg.style.color   = '#475569';
  msg.style.display = 'block';

  const excludeSheet = sfmMode === 'edit' ? 'Staff' : null;

  google.script.run
    .withSuccessHandler(res => {
      if ((document.getElementById('sf_cnic').value || '').trim() !== cnic) return;
      if (res && res.found) {
        hrCnicStatus = 'duplicate';
        msg.textContent = '⚠ CNIC already exists in "' + res.sheet + '".';
        msg.style.color = '#D97706';
      } else {
        hrCnicStatus = 'available';
        msg.textContent = '✓ CNIC is available.';
        msg.style.color = '#059669';
      }
    })
    .withFailureHandler(() => {
      hrCnicStatus = 'unchecked';
      msg.style.display = 'none';
    })
    .checkCnicDuplicate(cnic, excludeSheet);
}
function triggerIbanCheck(iban) {
  const msg = document.getElementById('sf_iban_msg');
  if (!msg) return;
  msg.style.display = 'none';
  hrIbanStatus = 'unchecked';

  if (!iban || iban.length < 24) return;

  if (!/^PK\d{2}[A-Z0-9]{20}$/i.test(iban)) {
    msg.textContent   = '⚠ Pakistani IBAN: PK + 2 digits + 20 alphanumeric chars (24 total).';
    msg.style.color   = '#EF4444';
    msg.style.display = 'block';
    return;
  }

  // Skip check in edit mode for the same record's own IBAN
  const ownIban = sfmCurrentRow ? (sfmCurrentRow['SALARY ACCOUNT IBAN NO.'] || '').toString().trim().toUpperCase() : '';
  if (sfmMode === 'edit' && iban === ownIban) {
    hrIbanStatus = 'available';
    return;
  }

  // ── 1. Client-side — main sheets (col Z) ─────────────────────
  const mainSheets = ['Staff','Deleted_Archive','s_History',
                      'Deceased','Termination','Retirement','Resignation'];
  let foundIn = null;

  mainSheets.forEach(sh => {
    if (foundIn) return;
    const cache = hrSheetDataCache[sh];
    if (!cache) return;
    const ibanHdr = (cache.headers || []).find(h =>
      h && h.toString().trim().toUpperCase() === 'SALARY ACCOUNT IBAN NO.'
    );
    if (!ibanHdr) return;
    if (cache.rows.some(r =>
      (r[ibanHdr] || '').toString().trim().toUpperCase() === iban
    )) foundIn = sh;
  });

  if (foundIn) {
    hrIbanStatus = 'duplicate';
    msg.textContent   = '⚠ IBAN already exists in "' + foundIn + '".';
    msg.style.color   = '#D97706';
    msg.style.display = 'block';
    return;
  }

  // ── 2. Server-side fallback ───────────────────────────────────
  hrIbanStatus = 'checking';
  msg.textContent   = '⏳ Verifying IBAN across all records…';
  msg.style.color   = '#475569';
  msg.style.display = 'block';

  const excludeSheet = sfmMode === 'edit' ? 'Staff' : null;

  google.script.run
    .withSuccessHandler(res => {
      if ((document.getElementById('sf_iban').value || '').trim().toUpperCase() !== iban) return;
      if (res && res.found) {
        hrIbanStatus = 'duplicate';
        msg.textContent = '⚠ IBAN already exists in "' + res.sheet + '".';
        msg.style.color = '#D97706';
      } else {
        hrIbanStatus = 'available';
        msg.textContent = '✓ IBAN is available.';
        msg.style.color = '#059669';
      }
    })
    .withFailureHandler(() => {
      hrIbanStatus = 'unchecked';
      msg.style.display = 'none';
    })
    .checkIbanDuplicate(iban, excludeSheet);
}
// ──────────────────────────────────────────────────────────────────
//  REGULARIZATION FIELD TOGGLE
// ──────────────────────────────────────────────────────────────────
function toggleRegularizationField() {
  const natureVal = document.getElementById('sf_natureOfJob').value;
  const regGroup  = document.getElementById('sf_regularizationGroup');
  if (natureVal === 'Contract') {
    regGroup.style.display = 'none';
    document.getElementById('sf_regularizationDate').value = '';
  } else {
    regGroup.style.display = '';
  }
}

// ──────────────────────────────────────────────────────────────────
//  RETIREMENT DATE AUTO-CALC
// ──────────────────────────────────────────────────────────────────
function calcRetirementDate() {
  const dobVal = document.getElementById('sf_dob').value;
  const retEl  = document.getElementById('sf_retirementDate');
  if (!dobVal) { retEl.value = ''; return; }

  const parts = dobVal.split('-');
  if (parts.length !== 3) { retEl.value = ''; return; }

  const year  = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day   = parseInt(parts[2], 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) { retEl.value = ''; return; }

  let retYear  = year + 60;
  let retMonth = month;
  let retDay   = day - 1;

  if (retDay === 0) {
    retMonth = retMonth - 1;
    if (retMonth === 0) {
      retMonth = 12;
      retYear  = retYear - 1;
    }
    retDay = new Date(retYear, retMonth, 0).getDate();
  }

  retEl.value = `${retYear}-${String(retMonth).padStart(2,'0')}-${String(retDay).padStart(2,'0')}`;
}

// ──────────────────────────────────────────────────────────────────
//  SUBMIT FORM
// ──────────────────────────────────────────────────────────────────
function sfmSubmit() {
  calcRetirementDate();
  
  // ── Personal No. duplicate gate ──────────────────────────────
  if (sfmMode === 'add') {
    if (hrPnoStatus === 'duplicate') {
      hrShowToast('Personal No. already exists in another record. Cannot save.', false);
      return;
    }
    if (hrPnoStatus === 'checking') {
      hrShowToast('Still verifying Personal No. — please wait a moment and try again.', false);
      return;
    }
  }

  // ── CNIC duplicate gate ───────────────────────────────────────
  if (sfmMode === 'add' || sfmMode === 'edit') {
    if (hrCnicStatus === 'duplicate') {
      hrShowToast('CNIC already exists in another record. Cannot save.', false);
      return;
    }
    if (hrCnicStatus === 'checking') {
      hrShowToast('Still verifying CNIC — please wait a moment and try again.', false);
      return;
    }
  }

  // ── IBAN duplicate gate ───────────────────────────────────────
  if (sfmMode === 'add' || sfmMode === 'edit') {
    if (hrIbanStatus === 'duplicate') {
      hrShowToast('IBAN already exists in another record. Cannot save.', false);
      return;
    }
    if (hrIbanStatus === 'checking') {
      hrShowToast('Still verifying IBAN — please wait a moment and try again.', false);
      return;
    }
  }

  const emisVal = (document.getElementById('sf_emis').value || '').trim();
  if (!/^\d{8}$/.test(emisVal)) {
    hrShowToast('Please enter a valid 8-digit EMIS code.', false); return;
  }
  if (!document.getElementById('sf_personalNo').value.trim()) {
    hrShowToast('Personal No. is required.', false); return;
  }
  if (!document.getElementById('sf_name').value.trim()) {
    hrShowToast('Name of Teacher is required.', false); return;
  }
  if (!document.getElementById('sf_govtEntry').value) {
    hrShowToast('Date of Entry in Govt. Service is required.', false); return;
  }

  let data = sfmCurrentRow ? { _row: sfmCurrentRow._row } : {};
  Object.keys(SF_MAP).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    let val = el.value || '';
    if (el.type === 'date' && val) val = _fromDateInput(val);
    data[SF_MAP[id]] = val;
  });

  document.getElementById('hrStaffFormModal').style.display = 'none';
  document.getElementById('hrResultsContainer').innerHTML = '<div class="hr-empty-state">Saving to Database…</div>';
  const userPayload = typeof currentUser !== 'undefined' ? currentUser : { name: 'Admin' };

  if (sfmMode === 'add') {
    google.script.run
      .withSuccessHandler(res => {
        hrShowToast(res.success ? (res.message || 'Added successfully.') : (res.errors ? res.errors.join(', ') : res.error), res.success);
        hrInvalidateCache('Staff'); applyHrFilter();
      })
      .withFailureHandler(err => hrShowToast('Save failed: ' + err.message, false))
      .addStaffRow(data, userPayload);
  } else {
    google.script.run
      .withSuccessHandler(res => {
        hrShowToast(res.success ? 'Record updated successfully.' : (res.error || 'Update failed.'), res.success);
        hrInvalidateCache('Staff'); applyHrFilter();
      })
      .withFailureHandler(err => hrShowToast('Update failed: ' + err.message, false))
      .updateStaffRow(data, userPayload);
  }
}

// ──────────────────────────────────────────────────────────────────
//  TRANSFER MODAL
// ──────────────────────────────────────────────────────────────────
function openTransferModal(row) {
  hrTransferRow = row;
  _ensureAllSchoolCache(() => {
    const teacherName = row['NAME OF TEACHER'] || '';
    const currentEmis = row['SCHOOL EMIS CODE'] || '';
    document.getElementById('hrTransferBody').innerHTML = `
      <div class="hr-info-box" style="margin-bottom:18px;">
        <strong>📋 Current Assignment</strong>
        <div><b>Teacher:</b> ${teacherName} &nbsp;|&nbsp; <b>P.No:</b> ${row['PERSONAL NO.'] || ''}</div>
        <div><b>EMIS:</b> ${currentEmis} &nbsp;|&nbsp; <b>Markaz:</b> ${row['MARKAZ NAME'] || ''}</div>
      </div>
      <div class="transfer-step">
        <label>Target EMIS Code (New School) <span style="color:#EF4444">*</span></label>
        <input type="text" id="tf_emis" maxlength="8" inputmode="numeric" placeholder="8-digit EMIS" oninput="hrVerifyTargetEmis()">
        <div class="transfer-err" id="tfe_emis"></div>
        <div id="tf_school_info" style="display:none;" class="hr-info-box"></div>
      </div>
      <div class="transfer-step">
        <label>Notification No. <span style="color:#EF4444">*</span></label>
        <input type="text" id="tf_notif" placeholder="Transfer order number">
        <div class="transfer-err" id="tfe_notif"></div>
      </div>
      <div class="transfer-step">
        <label>Date of Joining New School <span style="color:#EF4444">*</span></label>
        <input type="date" id="tf_date">
        <div class="transfer-hint">Replaces Date of Posting in Present School.</div>
        <div class="transfer-err" id="tfe_date"></div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
        <button type="button" class="hr-btn-primary" onclick="submitHrTransfer()">✅ Confirm Transfer</button>
        <button type="button" class="hr-btn-ghost" onclick="document.getElementById('hrTransferModal').style.display='none'">Cancel</button>
      </div>`;
    document.getElementById('hrTransferModal').style.display = 'flex';
  });
}

function hrVerifyTargetEmis() {
  const emis   = (document.getElementById('tf_emis').value || '').trim();
  const errEl  = document.getElementById('tfe_emis');
  const infoEl = document.getElementById('tf_school_info');
  const emisEl = document.getElementById('tf_emis');
  errEl.textContent = ''; infoEl.style.display = 'none';
  emisEl.className  = emisEl.className.replace(/valid|invalid/g,'').trim();
  if (emis.length !== 8 || !/^\d{8}$/.test(emis)) return;
  const school = hrAllSchoolCache.find(s => s.e && s.e.toString().trim() === emis);
  if (!school) {
    errEl.textContent = '⚠ EMIS not found in Schools data.';
    emisEl.classList.add('invalid'); return;
  }
  emisEl.classList.add('valid');
  infoEl.style.display = 'block';
  infoEl.innerHTML = '<strong>✓ New School Found</strong>' +
    '<div><b>District:</b> ' + school.d + ' | <b>Wing:</b> ' + school.w + '</div>' +
    '<div><b>Tehsil:</b> ' + school.t + ' | <b>Markaz:</b> ' + school.m + '</div>';
}

function submitHrTransfer() {
  const emis  = (document.getElementById('tf_emis').value || '').trim();
  const notif = (document.getElementById('tf_notif').value || '').trim();
  const date  = (document.getElementById('tf_date').value || '').trim();
  let ok = true;
  document.querySelectorAll('.transfer-err').forEach(e => e.textContent = '');
  if (!emis || !/^\d{8}$/.test(emis) || !hrAllSchoolCache.find(s => s.e && s.e.toString().trim() === emis)) {
    document.getElementById('tfe_emis').textContent = 'Valid 8-digit EMIS required.'; ok = false;
  }
  if (!notif) { document.getElementById('tfe_notif').textContent = 'Notification No. required.'; ok = false; }
  if (!date)  { document.getElementById('tfe_date').textContent  = 'Date is required.'; ok = false; }
  if (!ok) return;

  if (!confirm('Confirm transfer of "' + hrTransferRow['NAME OF TEACHER'] + '" to EMIS ' + emis + '?\nNotification: ' + notif + '\nJoining Date: ' + date)) return;

  document.getElementById('hrTransferModal').style.display = 'none';
  document.getElementById('hrResultsContainer').innerHTML  = '<div class="hr-empty-state">Processing Transfer…</div>';
  const userPayload = typeof currentUser !== 'undefined' ? currentUser : { name:'Admin' };
  google.script.run
    .withSuccessHandler(res => {
      hrShowToast(res.success ? (res.message || 'Transfer completed.') : (res.error || 'Failed.'), res.success);
      hrInvalidateCache('Staff'); applyHrFilter();
    })
    .withFailureHandler(err => hrShowToast('Transfer failed: ' + err.message, false))
    .executeTransfer({ personalNo: hrTransferRow['PERSONAL NO.'], rowNum: hrTransferRow._row,
                       targetEmis: emis, notificationNo: notif, newJoiningDate: _fromDateInput(date) }, userPayload);
}

// ──────────────────────────────────────────────────────────────────
//   MODAL
// ──────────────────────────────────────────────────────────────────
function openPromotionModal(row) {
  hrPromotionRow = row;
  document.getElementById('hrPromotionBody').innerHTML = `
    <div class="hr-info-box" style="margin-bottom:18px;">
      <strong>📋 Current Record</strong>
      <div><b>Teacher:</b> ${row['NAME OF TEACHER']||''} | <b>P.No:</b> ${row['PERSONAL NO.']||''}</div>
      <div><b>Designation:</b> ${row['DESIGNATION']||''} | <b>BPS:</b> ${row['BPS']||''}</div>
    </div>
    <div class="transfer-step">
      <label>Notification No. <span style="color:#EF4444">*</span></label>
      <input type="text" id="pm_notif" placeholder="Promotion order number">
      <div class="transfer-err" id="pme_notif"></div>
    </div>
    <div class="transfer-step">
      <label>New Designation <span style="color:#EF4444">*</span></label>
      <select id="pm_desig">
        <option value="">Select…</option>
        ${['PST','ESE','EST','PET','SESE','SST','SSE','Headmaster','Headmistress','School Guard','Secuirty Guard','Naib Qasid','Chowkidar','Mali','C.IV'].map(d => `<option${d===row['DESIGNATION']?' selected':''}>${d}</option>`).join('')}
      </select>
      <div class="transfer-err" id="pme_desig"></div>
    </div>
    <div class="transfer-step">
      <label>New BPS (1–22) <span style="color:#EF4444">*</span></label>
      <input type="number" id="pm_bps" min="1" max="22" value="${row['BPS']||''}">
      <div class="transfer-err" id="pme_bps"></div>
    </div>
    <div class="transfer-step">
      <label>Target EMIS Code (New School) <span style="color:#EF4444">*</span></label>
      <input type="text" id="pm_emis" maxlength="8" inputmode="numeric" placeholder="8-digit EMIS" oninput="hrVerifyPromoEmis()">
      <div class="transfer-err" id="pme_emis"></div>
      <div id="pm_school_info" style="display:none;" class="hr-info-box"></div>
    </div>
    <div class="transfer-step">
      <label>Date of Posting in Present School</label>
      <input type="date" id="pm_postDate">
      <div class="transfer-hint">Leave blank to keep existing value.</div>
    </div>
    <div class="transfer-step">
      <label>Date of Joining in Present Scale <span style="color:#EF4444">*</span></label>
      <input type="date" id="pm_scaleDate">
      <div class="transfer-err" id="pme_scale"></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
      <button type="button" class="hr-btn-primary" onclick="submitHrPromotion()">✅ Confirm Promotion</button>
      <button type="button" class="hr-btn-ghost" onclick="document.getElementById('hrPromotionModal').style.display='none'">Cancel</button>
    </div>`;
  document.getElementById('hrPromotionModal').style.display = 'flex';
}

function hrVerifyPromoEmis() {
  const emis   = (document.getElementById('pm_emis').value || '').trim();
  const errEl  = document.getElementById('pme_emis');
  const infoEl = document.getElementById('pm_school_info');
  const emisEl = document.getElementById('pm_emis');
  errEl.textContent = ''; infoEl.style.display = 'none';
  if (emis.length !== 8 || !/^\d{8}$/.test(emis)) return;
  const school = hrSchoolCache.find(s => s.e && s.e.toString().trim() === emis);
  if (!school) { errEl.textContent = '⚠ EMIS not found in Schools data.'; return; }
  infoEl.style.display = 'block';
  infoEl.innerHTML = '<strong>✓ Target School</strong><div><b>Markaz:</b> ' + school.m + ' | <b>District:</b> ' + school.d + '</div>';
}

function submitHrPromotion() {
  const notif     = (document.getElementById('pm_notif').value || '').trim();
  const desig     = (document.getElementById('pm_desig').value || '').trim();
  const bps       = (document.getElementById('pm_bps').value || '').trim();
  const emis      = (document.getElementById('pm_emis').value || '').trim();
  const postDate  = (document.getElementById('pm_postDate').value || '').trim();
  const scaleDate = (document.getElementById('pm_scaleDate').value || '').trim();
  let ok = true;
  document.querySelectorAll('#hrPromotionBody .transfer-err').forEach(e => e.textContent = '');
  if (!notif) { document.getElementById('pme_notif').textContent = 'Required.'; ok = false; }
  if (!desig) { document.getElementById('pme_desig').textContent = 'Required.'; ok = false; }
  if (!bps || isNaN(bps) || +bps < 1 || +bps > 22) { document.getElementById('pme_bps').textContent = 'BPS must be 1–22.'; ok = false; }
  if (!emis || !/^\d{8}$/.test(emis)) { document.getElementById('pme_emis').textContent = 'Valid 8-digit EMIS required.'; ok = false; }
  else if (!hrSchoolCache.find(s => s.e && s.e.toString().trim() === emis)) { document.getElementById('pme_emis').textContent = '⚠ EMIS not found.'; ok = false; }
  if (!scaleDate) { document.getElementById('pme_scale').textContent = 'Date of Joining in Present Scale is required.'; ok = false; }
  if (!ok) return;

  document.getElementById('hrPromotionModal').style.display = 'none';
  document.getElementById('hrResultsContainer').innerHTML = '<div class="hr-empty-state">Processing Promotion…</div>';
  const userPayload = typeof currentUser !== 'undefined' ? currentUser : { name:'Admin' };
  google.script.run
    .withSuccessHandler(res => {
      hrShowToast(res.success ? (res.message || 'Promotion recorded.') : (res.error || 'Failed.'), res.success);
      hrInvalidateCache('Staff'); applyHrFilter();
    })
    .withFailureHandler(err => hrShowToast('Promotion failed: ' + err.message, false))
    .executePromotion({
      personalNo:          hrPromotionRow['PERSONAL NO.'],
      rowNum:              hrPromotionRow._row,
      newDesignation:      desig,
      newBps:              bps,
      targetEmis:          emis,
      newPostingDate:      postDate ? _fromDateInput(postDate) : '',
      newScaleJoiningDate: _fromDateInput(scaleDate),
      notificationNo:      notif
    }, userPayload);
}

// ──────────────────────────────────────────────────────────────────
//  SEPARATION MODAL
// ──────────────────────────────────────────────────────────────────
function openSeparationModal(actionType, row) {
  const labels = {
    retirement:  '🎓 Retirement',
    resignation: '📝 Resignation',
    termination: '🚫 Termination',
    death:       '✝️ Death Case'
  };
  const requiresNotif = ['retirement','death','termination'].includes(actionType);

  document.getElementById('hrActionModalTitle').textContent = labels[actionType] || actionType;
  document.getElementById('hrActionBody').innerHTML = `
    <div class="hr-info-box" style="margin-bottom:18px;">
      <strong>📋 Staff</strong>
      <div><b>Name:</b> ${row['NAME OF TEACHER']||''} | <b>P.No:</b> ${row['PERSONAL NO.']||''}</div>
      <div><b>Designation:</b> ${row['DESIGNATION']||''} | <b>BPS:</b> ${row['BPS']||''}</div>
    </div>
    <div class="transfer-step">
      <label>Notification No. ${requiresNotif ? '<span style="color:#EF4444">*</span>' : '(Optional)'}</label>
      <input type="text" id="sa_notif" placeholder="${requiresNotif ? 'Required' : 'e.g. letter/order reference'}">
      <div class="transfer-err" id="sae_notif"></div>
    </div>
    <div class="transfer-step">
      <label>Effective Date${requiresNotif ? ' <span style="color:#EF4444">*</span>' : ''}</label>
      <input type="date" id="sa_date">
      <div class="transfer-err" id="sae_date"></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
      <button type="button" class="hr-btn-danger" onclick="submitSeparation('${actionType}', hrFilteredResults.find(r=>r['PERSONAL NO.']==='${(row['PERSONAL NO.']||'').replace(/'/g,"\\'")}'))">
        Submit ${labels[actionType].replace(/^[^ ]+ /, '')}
      </button>
      <button type="button" class="hr-btn-ghost" onclick="document.getElementById('hrActionModal').style.display='none'">Cancel</button>
    </div>`;
  document.getElementById('hrActionModal').style.display = 'flex';
}

function submitSeparation(actionType, row) {
  if (!row) { hrShowToast('Row not found.', false); return; }
  const notif   = (document.getElementById('sa_notif').value || '').trim();
  const effDate = (document.getElementById('sa_date').value || '').trim();
  const requiresNotif = ['retirement','death','termination'].includes(actionType);
  document.querySelectorAll('#hrActionBody .transfer-err').forEach(e => e.textContent = '');
  if (requiresNotif && !notif) { document.getElementById('sae_notif').textContent = 'Notification No. is required.'; return; }
  if (!confirm('Confirm ' + actionType + ' for ' + row['NAME OF TEACHER'] + '?\nRecord will be moved out of Active Staff.')) return;

  document.getElementById('hrActionModal').style.display = 'none';
  document.getElementById('hrResultsContainer').innerHTML = '<div class="hr-empty-state">Processing…</div>';
  const userPayload = typeof currentUser !== 'undefined' ? currentUser : { name:'Admin' };
  google.script.run
    .withSuccessHandler(res => {
      hrShowToast(res.success ? (res.message || 'Action completed.') : (res.errors ? res.errors.join(', ') : res.error), res.success);
      hrInvalidateCache('Staff');
      hrInvalidateCache(res.targetSheet || '');
      applyHrFilter();
    })
    .withFailureHandler(err => hrShowToast('Action failed: ' + err.message, false))
    .executeStaffAction({ personalNo: row['PERSONAL NO.'], actionType, effectiveDate: effDate ? _fromDateInput(effDate) : '', notificationNo: notif }, userPayload);
}

// ──────────────────────────────────────────────────────────────────
//  DELETE & REVERT
// ──────────────────────────────────────────────────────────────────
function confirmDeleteHrRow(row) {
  if (!confirm('Delete ' + (row['NAME OF TEACHER']||'this record') + '?\nWill be archived in Deleted_Archive.')) return;
  document.getElementById('hrResultsContainer').innerHTML = '<div class="hr-empty-state">Deleting…</div>';
  const userPayload = typeof currentUser !== 'undefined' ? currentUser : { name:'Admin' };
  google.script.run
    .withSuccessHandler(res => {
      hrShowToast(res.success ? (res.message||'Archived.') : (res.error||'Failed.'), res.success);
      hrInvalidateCache('Staff'); hrInvalidateCache('Deleted_Archive'); applyHrFilter();
    })
    .withFailureHandler(err => hrShowToast('Delete failed: ' + err.message, false))
    .deleteStaffRow(row['PERSONAL NO.'], userPayload);
}

// REPLACE THE ENTIRE revertHrRow function with this:
function revertHrRow(row) {
  // Transfer_History uses different column names than Staff sheet
  const pno  = row['PERSONAL NO.'] || row['Employee Personal No'] || '';
  const name = row['NAME OF TEACHER'] || row['Employee Name'] || pno || 'this record';

  let msg = 'Revert "' + name + '" back to Active Staff?\nRemoves record from ' + hrCurrentSheetView + '.';
  if (hrCurrentSheetView === 'Transfer_History') {
    msg = 'Undo transfer for "' + name + '"?\nThis will revert their school assignment back to:\nFrom EMIS: ' + (row['From EMIS'] || '?') + ' (' + (row['From Markaz'] || '?') + ')';
  } else if (hrCurrentSheetView === 'Promotions_History') {
    msg = 'Undo promotion for "' + name + '"?\nThis will overwrite their current Active Staff record with the pre-promotion snapshot.';
  }

  if (!confirm(msg)) return;
  document.getElementById('hrResultsContainer').innerHTML = '<div class="hr-empty-state">Reverting…</div>';
  const userPayload = typeof currentUser !== 'undefined' ? currentUser : { name: 'Admin' };
  google.script.run
    .withSuccessHandler(res => {
      hrShowToast(res.success ? (res.message || 'Reverted.') : (res.error || 'Failed.'), res.success);
      hrInvalidateCache(hrCurrentSheetView);
      hrInvalidateCache('Staff');
      applyHrFilter();
    })
    .withFailureHandler(err => hrShowToast('Revert failed: ' + err.message, false))
    .revertToActiveStaff({ personalNo: pno, sourceSheetName: hrCurrentSheetView, rowNum: row._row }, userPayload);
}

// ──────────────────────────────────────────────────────────────────
//  UTILITY
// ──────────────────────────────────────────────────────────────────
function hrInvalidateCache(sheetName) {
  if (sheetName) {
    delete hrSheetDataCache[sheetName];
    if (sheetName === 'Staff') hrStaffFullRows = [];
  }
}

function hrShowToast(msg, ok) {
  if (typeof showToast === 'function') { showToast(msg, ok); return; }
  alert(msg);
}

function _parseHrDate(str) {
  if (!str) return null;
  str = str.toString().trim();
  const m = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const mo = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
    const mn = mo[m[2].toLowerCase()];
    if (mn === undefined) return null;
    return new Date(parseInt(m[3]), mn, parseInt(m[1]));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const parts = str.split('-');
    return new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function _toDateInput(str) {
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const m = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const mo = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    const mn = mo[m[2].toLowerCase()];
    return mn ? (m[3] + '-' + mn + '-' + m[1].padStart(2,'0')) : '';
  }
  return '';
}

function _fromDateInput(str) {
  if (!str) return '';
  const p = str.split('-');
  if (p.length !== 3) return str;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return p[2] + '-' + months[parseInt(p[1],10)-1] + '-' + p[0];
}
