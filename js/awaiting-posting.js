// =====================================================================
//  POSTING AWAITING STAFF MODULE
//  Employees with no permanent school posting -- auto-populated by the
//  DB trigger trg_staff_auto_awaiting_posting (see Supabase migrations)
//  whenever an active employee's school_emis_code is cleared, for any
//  reason (school outsourced/closed, manual removal, transfer left them
//  unassigned). This file is purely the read/search/assign UI on top of
//  that data -- it never decides who ends up on the list, the database
//  trigger does.
// =====================================================================
let apSchoolCache   = [];   // jurisdiction hierarchy, shared shape {d,w,t,m,e}
let apRows          = [];   // rows currently loaded from staff_awaiting_posting
let apCurrentPage    = 1;
const AP_PAGE_SIZE   = 50;
let apAssignTargetRow = null; // the awaiting-posting row currently being assigned

const AP_REASON_LABELS = {
  outsourced_school:   'Outsourced School',
  school_closed:        'School Closed',
  removed:               'Removed',
  transfer_completed:   'Transfer Completed',
  manual_revert:         'Reverted (Awaiting Posting Issues)',
  manual:                'Manual',
};

const AP_STATUS_LABELS = {
  awaiting:           'Awaiting Posting',
  on_temporary_duty:  'On Temporary Duty',
  assigned:            'Assigned',
};

// ── OPEN VIEW ─────────────────────────────────────────────────────────
// Per request: opens as a tab inside the same HR grid Active Staff /
// Retirement / etc. use, not a separate page.
function openAwaitingPostingView() {
  if (typeof openHrModule === 'function') openHrModule();
  const btn = document.querySelector('.hr-view-btn[data-sheet="AwaitingPosting"]');
  if (btn) btn.click();
}

// Refresh whichever context (HR grid vs old dedicated view, if still
// reachable) is actually on screen after an assignment.
function _apRefreshAfterAction() {
  if (typeof hrCurrentSheetView !== 'undefined' && hrCurrentSheetView === 'AwaitingPosting') {
    hrInvalidateCache('AwaitingPosting');
    applyHrFilter();
  } else if (document.getElementById('awaitingPostingView')?.classList.contains('active-view')) {
    applyAwaitingPostingFilter();
  }
}

function _apLoadSchoolHierarchy() {
  const el = document.getElementById('apFilterDistrict');
  if (el) el.innerHTML = '<option>Loading…</option>';
  const userPayload = typeof currentUser !== 'undefined' ? currentUser : null;
  google.script.run
    .withSuccessHandler(data => {
      apSchoolCache = data || [];
      apBuildDistrictDropdown();
    })
    .withFailureHandler(err => {
      showToast('Failed to load school list: ' + err.message, 'error');
      if (el) el.innerHTML = '<option value="">Failed to load</option>';
    })
    .getSchoolHierarchyForUser(userPayload);
}

// ── FILTER DROPDOWNS (District → Wing → Tehsil → Markaz cascade) ──────
function apBuildDistrictDropdown() {
  const pool  = apSchoolCache;
  const dists = [...new Set(pool.map(x => x.d).filter(Boolean))].sort();
  apPopulateSelect('apFilterDistrict', dists, 'All Districts');
  apPopulateSelect('apFilterWing',     [],    'All Wings');
  apPopulateSelect('apFilterTehsil',   [],    'All Tehsils');
  apPopulateSelect('apFilterMarkaz',   [],    'All Markazs');

  const u = typeof currentUser !== 'undefined' ? currentUser : null;
  const isAdmin = u && String(u.role || '').toLowerCase() === 'admin';
  if (u && !isAdmin && u.district) {
    document.getElementById('apFilterDistrict').value = u.district;
    onApDistrictChange();
    if (u.wing)   { document.getElementById('apFilterWing').value   = u.wing;   onApWingChange(); }
    if (u.tehsil) { document.getElementById('apFilterTehsil').value = u.tehsil; onApTehsilChange(); }
    if (u.markaz)   document.getElementById('apFilterMarkaz').value = u.markaz;
  }

  if (typeof applyJurisdictionLock === 'function') {
    applyJurisdictionLock(
      { district: 'apFilterDistrict', wing: 'apFilterWing', tehsil: 'apFilterTehsil', markaz: 'apFilterMarkaz' },
      u
    );
  }
}
function onApDistrictChange() {
  const pool = apSchoolCache;
  const d = document.getElementById('apFilterDistrict').value;
  const wings = [...new Set(pool.filter(x => !d || x.d === d).map(x => x.w).filter(Boolean))].sort();
  apPopulateSelect('apFilterWing',   wings, 'All Wings');
  apPopulateSelect('apFilterTehsil', [],    'All Tehsils');
  apPopulateSelect('apFilterMarkaz', [],    'All Markazs');
}
function onApWingChange() {
  const pool = apSchoolCache;
  const d = document.getElementById('apFilterDistrict').value;
  const w = document.getElementById('apFilterWing').value;
  const tehsils = [...new Set(pool.filter(x => (!d || x.d === d) && (!w || x.w === w)).map(x => x.t).filter(Boolean))].sort();
  apPopulateSelect('apFilterTehsil', tehsils, 'All Tehsils');
  apPopulateSelect('apFilterMarkaz', [],       'All Markazs');
}
function onApTehsilChange() {
  const pool = apSchoolCache;
  const d = document.getElementById('apFilterDistrict').value;
  const w = document.getElementById('apFilterWing').value;
  const t = document.getElementById('apFilterTehsil').value;
  const markazs = [...new Set(
    pool.filter(x => (!d || x.d === d) && (!w || x.w === w) && (!t || x.t === t)).map(x => x.m).filter(Boolean)
  )].sort();
  apPopulateSelect('apFilterMarkaz', markazs, 'All Markazs');
}
function apPopulateSelect(id, values, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<option value="">${placeholder}</option>` +
    values.map(v => `<option value="${escHtmlAp(v)}">${escHtmlAp(v)}</option>`).join('');
}
function clearAwaitingPostingFilters() {
  document.getElementById('apFilterKeyword').value = '';
  document.getElementById('apFilterReason').value   = '';
  document.getElementById('apFilterStatus').value   = 'awaiting';
  apBuildDistrictDropdown();
  applyAwaitingPostingFilter();
}

// ── LOAD + FILTER ──────────────────────────────────────────────────────
function applyAwaitingPostingFilter() {
  const payload = {
    district: document.getElementById('apFilterDistrict')?.value || '',
    wing:     document.getElementById('apFilterWing')?.value     || '',
    tehsil:   document.getElementById('apFilterTehsil')?.value   || '',
    markaz:   document.getElementById('apFilterMarkaz')?.value   || '',
    reason:   document.getElementById('apFilterReason')?.value   || '',
    status:   (function(){ const el = document.getElementById('apFilterStatus'); return el ? el.value : 'awaiting'; })(),
    keyword:  document.getElementById('apFilterKeyword')?.value  || '',
  };
  const container = document.getElementById('apResultsContainer');
  container.innerHTML = '<div class="hr-empty-state"><span class="spinner-border"></span> Loading…</div>';

  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast('Error: ' + res.message, 'error'); return; }
      apRows = res.rows || [];
      apCurrentPage = 1;
      apRenderTable();
    })
    .withFailureHandler(err => showToast('Server error: ' + err.message, 'error'))
    .loadAwaitingPosting(payload);
}

// ── TABLE ──────────────────────────────────────────────────────────────
function apRenderTable() {
  const container = document.getElementById('apResultsContainer');
  if (!apRows.length) {
    container.innerHTML = `<div class="hr-empty-state">No employees match the current filters.</div>`;
    return;
  }
  const totalPages = Math.ceil(apRows.length / AP_PAGE_SIZE);
  const start      = (apCurrentPage - 1) * AP_PAGE_SIZE;
  const pageRows    = apRows.slice(start, start + AP_PAGE_SIZE);

  const bodyRows = pageRows.map(r => {
    const staff = r.staff || {};
    const canAssign = r.status === 'awaiting' || r.status === 'on_temporary_duty';
    return `<tr>
      <td>${escHtmlAp(staff.name_of_teacher || '')}</td>
      <td>${escHtmlAp(r.personal_no || '')}</td>
      <td>${escHtmlAp(staff.cnic || '')}</td>
      <td>${escHtmlAp(staff.designation || '')}</td>
      <td>${escHtmlAp(staff.bps != null ? String(staff.bps) : '')}</td>
      <td><span class="ap-status-badge ap-status-${r.status}">${AP_STATUS_LABELS[r.status] || r.status}</span></td>
      <td>${escHtmlAp(r.previous_school_name || '')}</td>
      <td>${escHtmlAp(r.previous_tehsil || '')}</td>
      <td>${escHtmlAp(r.previous_markaz || '')}</td>
      <td>${escHtmlAp(r.previous_district || '')}</td>
      <td>${escHtmlAp(r.entry_date || '')}</td>
      <td>${escHtmlAp(AP_REASON_LABELS[r.reason] || r.reason || '')}</td>
      <td>${escHtmlAp(r.remarks || '')}</td>
      <td class="actions-col">
        ${canAssign
          ? `<button class="hr-btn-primary" style="padding:6px 12px;font-size:.78rem" onclick="apOpenAssignModal('${r.id}')">
               <span class="material-icons-round" style="font-size:.95rem">how_to_reg</span> Assign
             </button>`
          : `<span style="color:var(--t3);font-size:.78rem">Assigned to ${escHtmlAp(r.assigned_school_emis || '')}</span>`}
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="export-bar">
      <span class="result-count">${apRows.length} employee${apRows.length !== 1 ? 's' : ''} found
        ${apRows.length > AP_PAGE_SIZE ? ` &nbsp;·&nbsp; Page ${apCurrentPage} / ${totalPages}` : ''}
      </span>
      <div class="export-actions">
        <button class="export-btn" onclick="apExportExcel()">↓ Excel</button>
        <button class="export-btn" onclick="apPrint()">🖶 Print</button>
      </div>
    </div>
    <div class="table-wrap" id="apPrintArea">
      <table class="data-table">
        <thead><tr>
          <th>Employee Name</th><th>Personal No.</th><th>CNIC</th><th>Designation</th><th>Grade</th>
          <th>Current Status</th><th>Previous School</th><th>Previous Tehsil</th><th>Previous Markaz</th>
          <th>Previous District</th><th>Date Entered</th><th>Reason</th><th>Remarks</th><th>Action</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    ${totalPages > 1 ? apBuildPagination(totalPages) : ''}
  `;
}
function apBuildPagination(totalPages) {
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - apCurrentPage) <= 2) pages.push(i);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  const btns = pages.map(p => p === '…'
    ? `<span style="padding:0 4px;color:var(--t3)">…</span>`
    : `<button class="page-btn${p === apCurrentPage ? ' active' : ''}" onclick="apGoPage(${p})">${p}</button>`
  ).join('');
  return `<div class="pagination">
    <button class="page-btn" onclick="apGoPage(${apCurrentPage - 1})" ${apCurrentPage === 1 ? 'disabled' : ''}>‹ Prev</button>
    ${btns}
    <button class="page-btn" onclick="apGoPage(${apCurrentPage + 1})" ${apCurrentPage === totalPages ? 'disabled' : ''}>Next ›</button>
  </div>`;
}
function apGoPage(p) {
  const totalPages = Math.ceil(apRows.length / AP_PAGE_SIZE);
  if (p < 1 || p > totalPages) return;
  apCurrentPage = p;
  apRenderTable();
  document.getElementById('apResultsContainer').scrollIntoView({ behavior: 'smooth' });
}

// ── EXPORT / PRINT ─────────────────────────────────────────────────────
function apExportExcel() {
  if (!apRows.length) { showToast('No data to export.', 'warning'); return; }
  const rows = apRows.map(r => {
    const staff = r.staff || {};
    return {
      'Employee Name':      staff.name_of_teacher || '',
      'Personal No.':        r.personal_no || '',
      'CNIC':                staff.cnic || '',
      'Designation':         staff.designation || '',
      'Grade':               staff.bps || '',
      'Current Status':      r.status === 'awaiting' ? 'Awaiting Posting' : 'Assigned',
      'Previous School':     r.previous_school_name || '',
      'Previous Tehsil':     r.previous_tehsil || '',
      'Previous Markaz':     r.previous_markaz || '',
      'Previous District':   r.previous_district || '',
      'Date Entered':        r.entry_date || '',
      'Reason':              AP_REASON_LABELS[r.reason] || r.reason || '',
      'Remarks':             r.remarks || '',
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Awaiting Posting');
  XLSX.writeFile(wb, `Posting_Awaiting_Staff_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
function apPrint() {
  const area = document.getElementById('apPrintArea');
  if (!area) { showToast('Nothing to print yet.', 'warning'); return; }
  const w = window.open('', '_blank');
  w.document.write(`<html><head><title>Posting Awaiting Staff</title>
    <style>
      body{font-family:Arial,sans-serif;padding:16px}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #999;padding:5px 7px;text-align:left}
      th{background:#f1f5f9}
      h2{margin:0 0 12px}
    </style></head><body>
    <h2>Posting Awaiting Staff — ${new Date().toLocaleDateString()}</h2>
    ${area.innerHTML}
    </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

// ── ASSIGN TO SCHOOL ────────────────────────────────────────────────────
function apOpenAssignModal(rowOrId) {
  if (rowOrId && typeof rowOrId === 'object') {
    // Called from the HR grid's Awaiting Posting tab — row is shaped by
    // _awaitingPostingSheetRows (headers/rows), not the raw
    // staff_awaiting_posting record apRows (the old dedicated page) held.
    apAssignTargetRow = {
      id: rowOrId._row,
      personal_no: rowOrId['Personal No'] || rowOrId['PERSONAL NO.'] || '',
      previous_school_name: rowOrId['Previous School'] || '',
      staff: {
        name_of_teacher: rowOrId['Employee Name'] || rowOrId['NAME OF TEACHER'] || '',
        designation: rowOrId['Designation'] || '',
        bps: rowOrId['BPS'] || '',
      },
    };
  } else {
    apAssignTargetRow = apRows.find(r => String(r.id) === String(rowOrId));
  }
  if (!apAssignTargetRow) return;
  const staff = apAssignTargetRow.staff || {};
  document.getElementById('apAssignEmpName').textContent = staff.name_of_teacher || apAssignTargetRow.personal_no;
  document.getElementById('apAssignEmpMeta').textContent =
    `${staff.designation || ''} · BPS-${staff.bps || '—'} · Previously at ${apAssignTargetRow.previous_school_name || '—'}`;
  document.getElementById('apAssignOrderType').value = '';
  document.getElementById('apAssignSchoolSearch').value = '';
  document.getElementById('apAssignSchoolResults').innerHTML = '';
  document.getElementById('apAssignTargetEmis').value = '';
  document.getElementById('apAssignOrderNumber').value = '';
  document.getElementById('apAssignOrderDate').value = '';
  document.getElementById('apAssignTdStart').value = '';
  document.getElementById('apAssignTdEnd').value = '';
  document.getElementById('apAssignTdDates').style.display = 'none';
  document.getElementById('apAssignConfirmBtn').disabled = true;
  document.getElementById('apAssignModal').classList.remove('hidden');
}
function apCloseAssignModal() {
  document.getElementById('apAssignModal').classList.add('hidden');
  apAssignTargetRow = null;
}
function apOnOrderTypeChange() {
  const type = document.getElementById('apAssignOrderType').value;
  document.getElementById('apAssignTdDates').style.display = type === 'temporary_duty' ? 'block' : 'none';
  document.getElementById('apAssignRulesNote').textContent = type === 'permanent_adjustment'
    ? 'Permanent Adjustment: normal transfer rules (vacant post, designation, grade) are checked automatically before this assignment is confirmed.'
    : type === 'temporary_duty'
      ? 'Temporary Duty: no vacancy, SNE, or transfer eligibility checks apply. The employee stays visible at both schools and remains in Awaiting Posting, marked "On Temporary Duty".'
      : 'Select an order type above — Permanent Adjustment checks normal transfer rules (vacant post, designation, grade). Temporary Duty skips those checks.';
}
let apSchoolSearchDebounce = null;
function apSearchAssignSchool() {
  const kw = document.getElementById('apAssignSchoolSearch').value.trim();
  const resultsEl = document.getElementById('apAssignSchoolResults');
  clearTimeout(apSchoolSearchDebounce);
  if (kw.length < 2) { resultsEl.innerHTML = ''; return; }
  resultsEl.innerHTML = '<div style="padding:8px;color:var(--t3);font-size:.82rem">Searching…</div>';
  apSchoolSearchDebounce = setTimeout(() => {
    google.script.run
      .withSuccessHandler(res => {
        if (!res.success) { resultsEl.innerHTML = ''; return; }
        const matches = res.rows || [];
        if (!matches.length) {
          resultsEl.innerHTML = '<div style="padding:8px;color:var(--t3);font-size:.82rem">No matching school.</div>';
          return;
        }
        resultsEl.innerHTML = matches.map(s => `
          <div class="ap-school-result" onclick="apSelectAssignSchool('${s.emis}', '${escHtmlAp(s.school_name || '').replace(/'/g, "\\'")}')">
            <strong>${escHtmlAp(s.school_name || '')}</strong>
            <span style="color:var(--t3);font-size:.78rem"> — EMIS ${escHtmlAp(s.emis || '')} · ${escHtmlAp(s.tehsil || '')}, ${escHtmlAp(s.district || '')}</span>
          </div>`).join('');
      })
      .withFailureHandler(() => { resultsEl.innerHTML = '<div style="padding:8px;color:var(--bad);font-size:.82rem">Search failed.</div>'; })
      .searchSchoolsForAssignment({ keyword: kw });
  }, 300);
}
function apSelectAssignSchool(emis, name) {
  document.getElementById('apAssignSchoolSearch').value = `${name} (EMIS ${emis})`;
  document.getElementById('apAssignSchoolResults').innerHTML = '';
  document.getElementById('apAssignTargetEmis').value = emis;
  document.getElementById('apAssignConfirmBtn').disabled = false;
}
function apConfirmAssign() {
  const targetEmis   = document.getElementById('apAssignTargetEmis').value;
  const orderType    = document.getElementById('apAssignOrderType').value;
  const orderNumber  = document.getElementById('apAssignOrderNumber').value.trim();
  const orderDate    = document.getElementById('apAssignOrderDate').value;
  if (!apAssignTargetRow || !targetEmis) return;
  if (!orderType) { showToast('Please select an Order Type.', 'warning'); return; }
  if (!orderNumber) { showToast('Order Number is required.', 'warning'); return; }
  if (!orderDate)   { showToast('Order Date is required.', 'warning'); return; }

  const staff = apAssignTargetRow.staff || {};
  const empLabel = staff.name_of_teacher || apAssignTargetRow.personal_no;

  if (orderType === 'temporary_duty') {
    const startDate = document.getElementById('apAssignTdStart').value;
    const endDate   = document.getElementById('apAssignTdEnd').value; // optional
    if (!startDate) { showToast('Start Date is required for Temporary Duty.', 'warning'); return; }
    if (!confirm(`Assign Temporary Duty for ${empLabel} to this school?\n\nNo vacancy/transfer checks apply.`)) return;

    showLoading();
    google.script.run
      .withSuccessHandler(res => {
        hideLoading();
        if (res.success) {
          showToast(res.message || 'Temporary Duty created.', 'success');
          apCloseAssignModal();
          _apRefreshAfterAction();
          if (typeof refreshHrDashboardCounts === 'function') refreshHrDashboardCounts();
        } else {
          showToast('Error: ' + res.message, 'error');
        }
      })
      .withFailureHandler(err => { hideLoading(); showToast('Server error: ' + err.message, 'error'); })
      .createTemporaryDuty({
        personalNo: apAssignTargetRow.personal_no,
        tempEmis: targetEmis,
        startDate, endDate: endDate || null,
        orderNumber, orderDate,
        awaitingId: apAssignTargetRow.id,
      });
    return;
  }

  // permanent_adjustment
  if (!confirm(`Permanently assign ${empLabel} to this school?\n\n` +
               `Normal transfer rules (vacancy, grade match) still apply and will be checked.`)) return;

  showLoading();
  google.script.run
    .withSuccessHandler(res => {
      hideLoading();
      if (res.success) {
        showToast(res.message || 'Employee assigned.', 'success');
        apCloseAssignModal();
        _apRefreshAfterAction();
        if (typeof refreshHrDashboardCounts === 'function') refreshHrDashboardCounts();
      } else {
        showToast('Error: ' + res.message, 'error');
      }
    })
    .withFailureHandler(err => { hideLoading(); showToast('Server error: ' + err.message, 'error'); })
    .assignAwaitingStaffToSchool({ awaitingId: apAssignTargetRow.id, targetEmis, orderNumber, orderDate });
}

function escHtmlAp(str) {
  if (!str) return '';
  return str.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
