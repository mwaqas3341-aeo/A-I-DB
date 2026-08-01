// =====================================================================
//  TEMPORARY DUTY MODULE
//  Employees posted temporarily to a school other than their permanent
//  one. Independent of the transfer engine by design: no vacancy, SNE,
//  or eligibility checks. The employee stays visible at BOTH the
//  original and temporary school while a Temporary Duty is active.
//  Backed by staff_temporary_duty (see Supabase RPCs create/complete/
//  cancel_temporary_duty).
// =====================================================================
let tdRows = [];
let tdAssignSourceRow = null;   // staff row from HR "Active Staff" menu, if opened from there
let tdAssignAwaitingId = null;  // set when opened from the Awaiting Posting Assign flow (unused here, kept for clarity)

const TD_STATUS_LABELS = {
  active:     'Active',
  completed:  'Completed',
  cancelled:  'Cancelled',
};

// ── OPEN VIEW ─────────────────────────────────────────────────────────
// Per request: this should open just like Active Staff / Retirement /
// etc. — a tab inside the same HR grid, not a separate page. Reuses
// the sidebar button's own click handler (title, filter reset, data
// load) rather than duplicating that logic here.
function openTemporaryDutyView() {
  if (typeof openHrModule === 'function') openHrModule();
  const btn = document.querySelector('.hr-view-btn[data-sheet="TemporaryDuty"]');
  if (btn) btn.click();
}

// Complete/Cancel can be triggered either from the HR grid (normal
// path now) or, if still reachable, the old dedicated view — refresh
// whichever one is actually on screen.
function _tdRefreshAfterAction() {
  if (typeof hrCurrentSheetView !== 'undefined' && hrCurrentSheetView === 'TemporaryDuty') {
    hrInvalidateCache('TemporaryDuty');
    applyHrFilter();
  } else if (document.getElementById('temporaryDutyView')?.classList.contains('active-view')) {
    applyTemporaryDutyFilter();
  }
}

function applyTemporaryDutyFilter() {
  const payload = {
    status:  document.getElementById('tdFilterStatus')?.value  || '',
    keyword: document.getElementById('tdFilterKeyword')?.value || '',
  };
  const container = document.getElementById('tdResultsContainer');
  container.innerHTML = '<div class="hr-empty-state"><span class="spinner-border"></span> Loading…</div>';

  google.script.run
    .withSuccessHandler(res => {
      if (!res.success) { showToast('Error: ' + res.message, 'error'); return; }
      tdRows = res.rows || [];
      tdRenderTable();
    })
    .withFailureHandler(err => showToast('Server error: ' + err.message, 'error'))
    .loadTemporaryDuty(payload);
}

function tdRenderTable() {
  const container = document.getElementById('tdResultsContainer');
  if (!tdRows.length) {
    container.innerHTML = `<div class="hr-empty-state">No Temporary Duty records match the current filters.</div>`;
    return;
  }
  const bodyRows = tdRows.map(r => {
    const staff = r.staff || {};
    const isActive = r.status === 'active';
    return `<tr>
      <td>${escHtmlAp(staff.name_of_teacher || '')}</td>
      <td>${escHtmlAp(r.personal_no || '')}</td>
      <td>${escHtmlAp(staff.designation || '')}</td>
      <td>${escHtmlAp(r.original_school_name || '')} <span style="color:var(--t3);font-size:.74rem">(${escHtmlAp(r.original_school_emis || '')})</span></td>
      <td>${escHtmlAp(r.temporary_school_name || '')} <span style="color:var(--t3);font-size:.74rem">(${escHtmlAp(r.temporary_school_emis || '')})</span></td>
      <td>${escHtmlAp(r.start_date || '')}</td>
      <td>${escHtmlAp(r.end_date || '—')}</td>
      <td>${escHtmlAp(r.order_number || '')}</td>
      <td><span class="ap-status-badge ap-status-${r.status === 'active' ? 'awaiting' : 'assigned'}">${TD_STATUS_LABELS[r.status] || r.status}</span></td>
      <td class="actions-col">
        ${isActive
          ? `<button class="hr-btn-primary" style="padding:6px 10px;font-size:.76rem" onclick="tdComplete('${r.id}')">
               <span class="material-icons-round" style="font-size:.9rem">check_circle</span> Complete
             </button>
             <button class="hr-btn-ghost" style="padding:6px 10px;font-size:.76rem" onclick="tdCancel('${r.id}')">
               <span class="material-icons-round" style="font-size:.9rem">cancel</span> Cancel
             </button>`
          : `<span style="color:var(--t3);font-size:.78rem">—</span>`}
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="export-bar">
      <span class="result-count">${tdRows.length} record${tdRows.length !== 1 ? 's' : ''} found</span>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Employee Name</th><th>Personal No.</th><th>Designation</th>
          <th>Original School</th><th>Temporary School</th>
          <th>Start Date</th><th>Till Date</th><th>Order No.</th><th>Status</th><th>Action</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

function tdComplete(tdId) {
  if (!confirm('Mark this Temporary Duty as completed? The employee will show as returned to their original school.')) return;
  showLoading();
  google.script.run
    .withSuccessHandler(res => {
      hideLoading();
      if (res.success) {
        showToast(res.message || 'Temporary Duty completed.', 'success');
        _tdRefreshAfterAction();
        if (typeof refreshHrDashboardCounts === 'function') refreshHrDashboardCounts();
      } else showToast('Error: ' + res.message, 'error');
    })
    .withFailureHandler(err => { hideLoading(); showToast('Server error: ' + err.message, 'error'); })
    .completeTemporaryDuty({ tdId });
}

function tdCancel(tdId) {
  if (!confirm('Cancel this Temporary Duty? This cannot be undone.')) return;
  showLoading();
  google.script.run
    .withSuccessHandler(res => {
      hideLoading();
      if (res.success) {
        showToast(res.message || 'Temporary Duty cancelled.', 'success');
        _tdRefreshAfterAction();
        if (typeof refreshHrDashboardCounts === 'function') refreshHrDashboardCounts();
      } else showToast('Error: ' + res.message, 'error');
    })
    .withFailureHandler(err => { hideLoading(); showToast('Server error: ' + err.message, 'error'); })
    .cancelTemporaryDuty({ tdId });
}

// ── ASSIGN MODAL (used both from this view's "+ New Temporary Duty" and
//    from the Active Staff row menu in hr_view.js) ──────────────────────
function openTdAssignModal(row) {
  tdAssignSourceRow = row || null;
  const personalNoRow = document.getElementById('tdAssignPersonalNoRow');
  const personalNoInput = document.getElementById('tdAssignPersonalNo');

  if (row) {
    // Opened from an existing staff row (HR Active Staff menu) — personal no. is known.
    document.getElementById('tdAssignEmpName').textContent = row['NAME OF TEACHER'] || row.personal_no || '';
    document.getElementById('tdAssignEmpMeta').textContent =
      `${row['DESIGNATION'] || ''} · P.No ${row['PERSONAL NO.'] || ''} · Currently at EMIS ${row['SCHOOL EMIS CODE'] || '—'}`;
    personalNoInput.value = row['PERSONAL NO.'] || '';
    personalNoRow.style.display = 'none';
  } else {
    document.getElementById('tdAssignEmpName').textContent = 'New Temporary Duty';
    document.getElementById('tdAssignEmpMeta').textContent = 'Enter the employee\'s Personal No. and the temporary school below.';
    personalNoInput.value = '';
    personalNoRow.style.display = 'block';
  }

  document.getElementById('tdAssignSchoolSearch').value = '';
  document.getElementById('tdAssignSchoolResults').innerHTML = '';
  document.getElementById('tdAssignTargetEmis').value = '';
  document.getElementById('tdAssignOrderNumber').value = '';
  document.getElementById('tdAssignOrderDate').value = '';
  document.getElementById('tdAssignStart').value = '';
  document.getElementById('tdAssignEnd').value = '';
  document.getElementById('tdAssignRemarks').value = '';
  document.getElementById('tdAssignModal').classList.remove('hidden');
}

function closeTdAssignModal() {
  document.getElementById('tdAssignModal').classList.add('hidden');
  tdAssignSourceRow = null;
}

let tdSchoolSearchDebounce = null;
function tdSearchSchool() {
  const kw = document.getElementById('tdAssignSchoolSearch').value.trim();
  const resultsEl = document.getElementById('tdAssignSchoolResults');
  clearTimeout(tdSchoolSearchDebounce);
  if (kw.length < 2) { resultsEl.innerHTML = ''; return; }
  resultsEl.innerHTML = '<div style="padding:8px;color:var(--t3);font-size:.82rem">Searching…</div>';
  tdSchoolSearchDebounce = setTimeout(() => {
    google.script.run
      .withSuccessHandler(res => {
        if (!res.success) { resultsEl.innerHTML = ''; return; }
        const matches = res.rows || [];
        if (!matches.length) {
          resultsEl.innerHTML = '<div style="padding:8px;color:var(--t3);font-size:.82rem">No matching school.</div>';
          return;
        }
        resultsEl.innerHTML = matches.map(s => `
          <div class="ap-school-result" onclick="tdSelectSchool('${s.emis}', '${escHtmlAp(s.school_name || '').replace(/'/g, "\\'")}')">
            <strong>${escHtmlAp(s.school_name || '')}</strong>
            <span style="color:var(--t3);font-size:.78rem"> — EMIS ${escHtmlAp(s.emis || '')} · ${escHtmlAp(s.tehsil || '')}, ${escHtmlAp(s.district || '')}</span>
          </div>`).join('');
      })
      .withFailureHandler(() => { resultsEl.innerHTML = '<div style="padding:8px;color:var(--bad);font-size:.82rem">Search failed.</div>'; })
      .searchSchoolsForAssignment({ keyword: kw });
  }, 300);
}
function tdSelectSchool(emis, name) {
  document.getElementById('tdAssignSchoolSearch').value = `${name} (EMIS ${emis})`;
  document.getElementById('tdAssignSchoolResults').innerHTML = '';
  document.getElementById('tdAssignTargetEmis').value = emis;
}

function submitTdAssign() {
  const personalNo = (document.getElementById('tdAssignPersonalNo').value || '').trim();
  const tempEmis   = document.getElementById('tdAssignTargetEmis').value;
  const orderNumber = document.getElementById('tdAssignOrderNumber').value.trim();
  const orderDate    = document.getElementById('tdAssignOrderDate').value;
  const startDate    = document.getElementById('tdAssignStart').value;
  const endDate       = document.getElementById('tdAssignEnd').value; // optional
  const remarks        = document.getElementById('tdAssignRemarks').value.trim();

  if (!personalNo) { showToast('Employee Personal No. is required.', 'warning'); return; }
  if (!tempEmis)    { showToast('Please select the temporary school.', 'warning'); return; }
  if (!startDate)   { showToast('Start Date is required.', 'warning'); return; }

  if (!confirm(`Assign Temporary Duty for Personal No. ${personalNo}?\n\nNo vacancy/transfer checks apply.`)) return;

  showLoading();
  google.script.run
    .withSuccessHandler(res => {
      hideLoading();
      if (res.success) {
        showToast(res.message || 'Temporary Duty created.', 'success');
        closeTdAssignModal();
        _tdRefreshAfterAction();
        if (typeof hrInvalidateCache === 'function') hrInvalidateCache('Staff');
        if (typeof refreshHrDashboardCounts === 'function') refreshHrDashboardCounts();
      } else {
        showToast('Error: ' + res.message, 'error');
      }
    })
    .withFailureHandler(err => { hideLoading(); showToast('Server error: ' + err.message, 'error'); })
    .createTemporaryDuty({
      personalNo, tempEmis, startDate, endDate: endDate || null,
      remarks: remarks || null, orderNumber: orderNumber || null, orderDate: orderDate || null,
    });
}
