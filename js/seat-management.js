// =====================================================================
//  SEAT MANAGEMENT — Teaching / Non-Teaching Sanctioned & Abolished Seats
//  Built on the same sne_subject_sanctioned table the SNE export reads
//  (extended with abolished_count/remarks) — one source of truth, so
//  every vacancy check across the app (check_grade_vacancy RPC) picks
//  up abolished seats automatically with no separate sync step.
// =====================================================================
let seatState = {
  category: 'teaching',
  rows: [],
  editingId: null,
};
let seatPermissions = { canEditNonTeaching: false, checked: false };

const SEAT_CATEGORY_LABEL = { teaching: 'Teaching', non_teaching: 'Non-Teaching' };

function openSeatManagement(category) {
  seatState.category = category === 'non_teaching' ? 'non_teaching' : 'teaching';
  openHrModule();
  switchGlobalTab('seatManagementView', null);
  document.getElementById('seatMgmtTitle').textContent =
    `${SEAT_CATEGORY_LABEL[seatState.category]} Sanctioned & Abolished Seats`;
  document.getElementById('seat_designationRow').style.display = '';
  document.getElementById('seat_subjectRow').style.display = seatState.category === 'teaching' ? '' : 'none';
  document.getElementById('seatDownloadTemplateBtn').style.display = seatState.category === 'non_teaching' ? '' : 'none';
  document.getElementById('seatImportErrorsPanel').style.display = 'none';
  _seatApplyButtonPermissions();
  _seatPopulateJurisdictionFilters();
  applySeatFilter();
}

// Teaching Sanctioned Seats are now maintained entirely via direct
// Supabase data upload — Add/Import never appear for Teaching, full
// stop, regardless of who's logged in. Non-Teaching Add/Import are
// restricted to Admins and Tehsil Representatives (checked once per
// session and cached; the real gate is still server-side in
// saveSeatRecord — this only controls what's shown).
function _seatApplyButtonPermissions() {
  const addBtn = document.getElementById('seatAddRecordBtn');
  const importBtn = document.getElementById('seatImportBtn');
  if (seatState.category === 'teaching') {
    addBtn.style.display = 'none';
    importBtn.style.display = 'none';
    return;
  }
  if (seatPermissions.checked) {
    const allowed = seatPermissions.canEditNonTeaching;
    addBtn.style.display = allowed ? '' : 'none';
    importBtn.style.display = allowed ? '' : 'none';
    return;
  }
  addBtn.style.display = 'none';
  importBtn.style.display = 'none';
  google.script.run
    .withSuccessHandler(res => {
      seatPermissions.canEditNonTeaching = !!(res && res.success && res.canEditNonTeaching);
      seatPermissions.checked = true;
      if (seatState.category === 'non_teaching') {
        addBtn.style.display = seatPermissions.canEditNonTeaching ? '' : 'none';
        importBtn.style.display = seatPermissions.canEditNonTeaching ? '' : 'none';
        if (seatState.rows.length) seatRenderTable();
      }
    })
    .withFailureHandler(() => { seatPermissions.checked = true; })
    .checkSeatManagementPermissions();
}

function _seatPopulateJurisdictionFilters() {
  const distSel = document.getElementById('seatFilterDistrict');
  if (!distSel || distSel.dataset.loaded || typeof hrSchoolCache === 'undefined' || !hrSchoolCache.length) return;
  const districts = [...new Set(hrSchoolCache.map(s => s.d).filter(Boolean))].sort();
  hrPopulateSelect('seatFilterDistrict', districts, 'All Districts');
  hrPopulateSelect('seatFilterWing',   [], 'All Wings');
  hrPopulateSelect('seatFilterTehsil', [], 'All Tehsils');
  hrPopulateSelect('seatFilterMarkaz', [], 'All Markazs');
  distSel.dataset.loaded = '1';

  // Convenience preselect of the user's primary location, same as the
  // Staff/HR filter panel.
  const u = typeof currentUser !== 'undefined' ? currentUser : null;
  const isAdmin = u && String(u.role || '').toLowerCase() === 'admin';
  if (u && !isAdmin && u.district) {
    document.getElementById('seatFilterDistrict').value = u.district;
    onSeatDistrictChange();
    if (u.wing) {
      document.getElementById('seatFilterWing').value = u.wing;
      onSeatWingChange();
    }
    if (u.tehsil) {
      document.getElementById('seatFilterTehsil').value = u.tehsil;
      onSeatTehsilChange();
    }
    if (u.markaz) document.getElementById('seatFilterMarkaz').value = u.markaz;
  }

  // Lock/grey out per the user's jurisdiction level — same rules as
  // Public/Private Schools and the Staff/HR filter panel.
  if (typeof applyJurisdictionLock === 'function') {
    applyJurisdictionLock(
      { district: 'seatFilterDistrict', wing: 'seatFilterWing', tehsil: 'seatFilterTehsil', markaz: 'seatFilterMarkaz' },
      u
    );
  }
}
function onSeatDistrictChange() {
  const pool = typeof hrSchoolCache !== 'undefined' ? hrSchoolCache : [];
  const d = document.getElementById('seatFilterDistrict').value;
  const wings = d
    ? [...new Set(pool.filter(x => x.d === d).map(x => x.w).filter(Boolean))].sort()
    : [...new Set(pool.map(x => x.w).filter(Boolean))].sort();
  hrPopulateSelect('seatFilterWing',   wings, 'All Wings');
  hrPopulateSelect('seatFilterTehsil', [],    'All Tehsils');
  hrPopulateSelect('seatFilterMarkaz', [],    'All Markazs');
}
function onSeatWingChange() {
  const pool = typeof hrSchoolCache !== 'undefined' ? hrSchoolCache : [];
  const d = document.getElementById('seatFilterDistrict').value;
  const w = document.getElementById('seatFilterWing').value;
  const tehsils = [...new Set(
    pool.filter(x => (!d || x.d === d) && (!w || x.w === w)).map(x => x.t).filter(Boolean)
  )].sort();
  hrPopulateSelect('seatFilterTehsil', tehsils, 'All Tehsils');
  hrPopulateSelect('seatFilterMarkaz', [],      'All Markazs');
}
function onSeatTehsilChange() {
  const pool = typeof hrSchoolCache !== 'undefined' ? hrSchoolCache : [];
  const d = document.getElementById('seatFilterDistrict').value;
  const w = document.getElementById('seatFilterWing').value;
  const t = document.getElementById('seatFilterTehsil').value;
  const markazs = [...new Set(
    pool.filter(x => (!d || x.d === d) && (!w || x.w === w) && (!t || x.t === t))
        .map(x => x.m).filter(Boolean)
  )].sort();
  hrPopulateSelect('seatFilterMarkaz', markazs, 'All Markazs');
}

// ── LOAD + RENDER ──────────────────────────────────────────────────
function applySeatFilter() {
  const payload = {
    category: seatState.category,
    district: document.getElementById('seatFilterDistrict')?.value || '',
    wing:     document.getElementById('seatFilterWing')?.value || '',
    tehsil:   document.getElementById('seatFilterTehsil')?.value || '',
    markaz:   document.getElementById('seatFilterMarkaz')?.value || '',
    emis:     document.getElementById('seatFilterEmis')?.value.trim() || '',
  };
  const container = document.getElementById('seatResultsContainer');
  container.innerHTML = '<div class="hr-empty-state"><span class="spinner-border"></span> Loading…</div>';

  google.script.run
    .withSuccessHandler(res => {
      if (!res || !res.success) { showToast('Error: ' + (res?.message || 'Could not load.'), false); return; }
      const kw = (document.getElementById('seatFilterKeyword')?.value || '').trim().toLowerCase();
      seatState.rows = kw
        ? (res.rows || []).filter(r => (r.school_name || '').toLowerCase().includes(kw) ||
                                        (r.designation || '').toLowerCase().includes(kw) ||
                                        (r.subject_label || '').toLowerCase().includes(kw))
        : (res.rows || []);
      seatRenderTable();
    })
    .withFailureHandler(err => showToast('Server error: ' + err.message, false))
    .getSeatManagementList(payload);
}

function seatRenderTable() {
  const container = document.getElementById('seatResultsContainer');
  if (!seatState.rows.length) {
    container.innerHTML = `<div class="hr-empty-state">No ${SEAT_CATEGORY_LABEL[seatState.category].toLowerCase()} seat records match the current filters. Click "Add Seat Record" to get started.</div>`;
    return;
  }
  const isTeaching = seatState.category === 'teaching';
  container.innerHTML = `
    <div class="export-bar"><span class="result-count">${seatState.rows.length} record${seatState.rows.length !== 1 ? 's' : ''} found</span></div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>EMIS</th><th>School Name</th><th>Grade/BPS</th>
          ${isTeaching ? '<th>Subject</th>' : ''}<th>Designation</th>
          <th>Sanctioned</th><th>Abolished</th><th>Effective</th><th>Filled</th><th>Vacant</th>
          <th>Remarks</th><th>Action</th>
        </tr></thead>
        <tbody>
          ${seatState.rows.map(r => `
            <tr>
              <td>${escHtmlAp(r.emis || '')}</td>
              <td>${escHtmlAp(r.school_name || '')}</td>
              <td>${r.grade ?? ''}</td>
              ${isTeaching ? `<td>${escHtmlAp(r.subjects || '')}</td>` : ''}
              <td>${escHtmlAp(r.designation || '')}</td>
              <td>${r.sanctioned_count ?? 0}</td>
              <td style="color:${r.abolished_count ? '#DC2626' : 'inherit'}">${r.abolished_count ?? 0}</td>
              <td style="font-weight:700;color:#0d9488">${r.effective_sanctioned_count ?? (r.sanctioned_count - r.abolished_count)}</td>
              <td>${r.filled_count ?? 0}</td>
              <td style="font-weight:700;color:${r.vacant_count > 0 ? '#DC2626' : 'inherit'}">${r.vacant_count ?? 0}</td>
              <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;font-size:.76rem;color:var(--t3)">${escHtmlAp(r.remarks || '')}</td>
              <td class="actions-col">
                ${(seatState.category === 'non_teaching' && !seatPermissions.canEditNonTeaching) ? '' : `
                <button class="hr-btn-ghost" style="padding:5px 10px;font-size:.74rem" onclick="openSeatModal('${r.id}')">Edit</button>
                <button class="hr-btn-ghost" style="padding:5px 10px;font-size:.74rem;color:#DC2626" onclick="deleteSeatRecord('${r.id}')">Delete</button>`}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── ADD / EDIT MODAL ──────────────────────────────────────────────
// Designation options come from the same Admin Panel → General
// Management → Staff Designations list the Staff Form uses
// (see refreshDesignationOptions in staffform.js) — one source of
// truth, so a designation added/renamed/removed there needs no
// separate change here.
function seatRefreshDesignationOptions(keepValue) {
  const sel = document.getElementById('seat_designation');
  if (!sel) return;
  google.script.run
    .withSuccessHandler(res => {
      if (!res || !res.success) { if (keepValue) sel.insertAdjacentHTML('beforeend', `<option>${keepValue}</option>`), sel.value = keepValue; return; }
      sel.innerHTML = '<option value="">Select…</option>' + res.items.map(name => `<option>${name}</option>`).join('');
      if (keepValue) {
        if (res.items.indexOf(keepValue) !== -1) sel.value = keepValue;
        else { sel.insertAdjacentHTML('beforeend', `<option>${keepValue}</option>`); sel.value = keepValue; }
      }
    })
    .withFailureHandler(() => { if (keepValue) { sel.insertAdjacentHTML('beforeend', `<option>${keepValue}</option>`); sel.value = keepValue; } })
    .getStaffDesignations({ category: seatState.category });
}

function seatLookupSchool() {
  const emis = document.getElementById('seat_emis').value.trim();
  const infoEl = document.getElementById('seat_schoolInfo');
  if (!emis) { infoEl.textContent = ''; return; }
  const cached = (typeof hrSchoolCache !== 'undefined' ? hrSchoolCache : []).find(s => s.emis === emis);
  if (cached) { infoEl.textContent = `${cached.name || ''} — ${cached.t || ''}, ${cached.d || ''}`; return; }
  infoEl.textContent = 'Looking up…';
  google.script.run
    .withSuccessHandler(res => {
      if (res && res.success && res.rows && res.rows.length) {
        const s = res.rows.find(x => x.emis === emis) || res.rows[0];
        infoEl.textContent = `${s.school_name || ''} — ${s.tehsil || ''}, ${s.district || ''}`;
      } else {
        infoEl.textContent = 'School not found for this EMIS — you can still save, but double-check the code.';
      }
    })
    .withFailureHandler(() => { infoEl.textContent = ''; })
    .searchSchoolsForAssignment({ keyword: emis });
}

function seatRecalc() {
  const sanctioned = Number(document.getElementById('seat_sanctioned').value) || 0;
  const abolished  = Number(document.getElementById('seat_abolished').value) || 0;
  const filled     = Number(document.getElementById('seat_filled').value) || 0;
  const effective  = Math.max(sanctioned - abolished, 0);
  const vacant     = Math.max(effective - filled, 0);
  document.getElementById('seat_effective').value = effective;
  document.getElementById('seat_vacant').value = vacant;
  document.getElementById('seat_abolished').max = sanctioned;
}

function openSeatModal(id) {
  seatState.editingId = id;
  const row = id ? seatState.rows.find(r => String(r.id) === String(id)) : null;
  document.getElementById('seatModalTitle').textContent = id ? 'Edit Seat Record' : 'Add Seat Record';
  document.getElementById('seat_emis').value = row?.emis || '';
  document.getElementById('seat_schoolInfo').textContent = row ? `${row.school_name || ''} — ${row.tehsil || ''}, ${row.district || ''}` : '';
  seatRefreshDesignationOptions(row?.designation || '');
  if (typeof hrEnsureSubjectCache === 'function') hrEnsureSubjectCache();
  document.getElementById('seat_subject').value = row?.subjects || '';
  document.getElementById('seat_grade').value = row?.grade || '';
  document.getElementById('seat_sanctioned').value = row?.sanctioned_count ?? 0;
  // Teaching Seat Rule: Total Sanctioned is locked once a record
  // exists — only Abolished Seats may be entered from here on.
  // A brand-new (never-saved) teaching record can still take an
  // initial value since there's nothing yet to lock.
  const lockSanctioned = seatState.category === 'teaching' && !!id;
  document.getElementById('seat_sanctioned').disabled = lockSanctioned;
  document.getElementById('seat_sanctioned').style.background = lockSanctioned ? '#f8fafc' : '';
  document.getElementById('seat_sanctionedLabel').innerHTML = lockSanctioned
    ? 'Total Sanctioned Seats <span style="color:var(--t3);font-weight:400">(locked — edit via Abolished Seats only)</span>'
    : 'Total Sanctioned Seats <span style="color:#EF4444">*</span>';
  document.getElementById('seat_abolished').value = row?.abolished_count ?? 0;
  document.getElementById('seat_filled').value = row?.filled_count ?? 0;
  const isNonTeaching = seatState.category === 'non_teaching';
  document.getElementById('seat_filled').disabled = isNonTeaching;
  document.getElementById('seat_filled').style.background = isNonTeaching ? '#f8fafc' : '';
  document.getElementById('seat_filledLabel').innerHTML = isNonTeaching
    ? 'Filled Seats <span style="color:var(--t3);font-weight:400">(auto — from Staff Statement)</span>'
    : 'Filled Seats';
  document.getElementById('seat_remarks').value = row?.remarks || '';
  document.getElementById('seat_reason').value = '';
  document.getElementById('seat_subjectRow').style.display = seatState.category === 'teaching' ? '' : 'none';
  seatRecalc();
  document.getElementById('seatModal').classList.remove('hidden');
}
function closeSeatModal() {
  document.getElementById('seatModal').classList.add('hidden');
  seatState.editingId = null;
}

function submitSeatRecord() {
  const emis = document.getElementById('seat_emis').value.trim();
  const designation = document.getElementById('seat_designation').value.trim();
  const subject = document.getElementById('seat_subject').value.trim();
  const grade = Number(document.getElementById('seat_grade').value);
  const sanctioned = Number(document.getElementById('seat_sanctioned').value);
  const abolished = Number(document.getElementById('seat_abolished').value) || 0;
  const filled = Number(document.getElementById('seat_filled').value) || 0;
  const remarks = document.getElementById('seat_remarks').value.trim();
  const reason = document.getElementById('seat_reason').value.trim();

  if (!emis) { showToast('EMIS Code is required.', false); return; }
  if (!designation) { showToast('Designation is required.', false); return; }
  if (!grade || grade < 1) { showToast('Grade/BPS is required.', false); return; }
  if (!Number.isFinite(sanctioned) || sanctioned < 0) { showToast('Total Sanctioned Seats must be 0 or more.', false); return; }
  if (abolished < 0) { showToast('Abolished Seats cannot be negative.', false); return; }
  if (abolished > sanctioned) { showToast('Abolished Seats cannot exceed Total Sanctioned Seats.', false); return; }

  const btn = document.getElementById('seatSaveBtn');
  btn.disabled = true;
  google.script.run
    .withSuccessHandler(res => {
      btn.disabled = false;
      if (!res || !res.success) { showToast('Error: ' + (res?.message || 'Save failed.'), false); return; }
      showToast(res.message || 'Saved.', true);
      closeSeatModal();
      applySeatFilter();
      if (typeof _seatCheckGateAfterSave === 'function') _seatCheckGateAfterSave();
    })
    .withFailureHandler(err => { btn.disabled = false; showToast('Server error: ' + err.message, false); })
    .saveSeatRecord({
      id: seatState.editingId, category: seatState.category, emis, designation, subject, grade,
      sanctionedCount: sanctioned, abolishedCount: abolished, filledCount: filled, remarks, reason,
    });
}

function deleteSeatRecord(id) {
  if (!confirm('Delete this seat record? This is recorded in the audit log and cannot be undone from here.')) return;
  google.script.run
    .withSuccessHandler(res => {
      if (res && res.success) { showToast('Deleted.', true); applySeatFilter(); }
      else showToast('Error: ' + (res?.message || 'Delete failed.'), false);
    })
    .withFailureHandler(err => showToast('Server error: ' + err.message, false))
    .deleteSeatRecord({ id });
}

// ── IMPORT / EXPORT ───────────────────────────────────────────────
function downloadNonTeachingSeatTemplate() {
  // Note: "Grade/BPS" is included even though the original spec listed
  // only EMIS/Designation/Total Sanctioned — the backend (saveSeatRecord)
  // requires a Grade/BPS value for every seat record, teaching or not,
  // since it's part of the record's uniqueness key. "Filled" is
  // intentionally NOT included: Non-Teaching filled seats are always
  // calculated automatically from the Staff Statement (see item 4).
  const headers = ['EMIS Code', 'Seat/Designation Name', 'BPS', 'Total Sanctioned', 'Remarks'];
  const sample = ['35201001', 'Clerk', '11', '2', ''];
  const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(14, Math.min(28, h.length + 6)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Non-Teaching Seats');
  XLSX.writeFile(wb, 'Non_Teaching_Seat_Upload_Template.xlsx');
}

function exportSeatData() {
  if (!seatState.rows.length) { showToast('Nothing to export for the current filter.', false); return; }
  const isTeaching = seatState.category === 'teaching';
  const headers = ['EMIS', 'School Name', 'District', 'Wing', 'Tehsil', 'Markaz', 'Grade/BPS',
    ...(isTeaching ? ['Subject'] : []), 'Designation', 'Total Sanctioned', 'Abolished', 'Effective Sanctioned', 'Filled', 'Vacant', 'Remarks'];
  const aoa = [headers, ...seatState.rows.map(r => [
    r.emis, r.school_name, r.district, r.wing, r.tehsil, r.markaz_name, r.grade,
    ...(isTeaching ? [r.subjects || ''] : []), r.designation, r.sanctioned_count, r.abolished_count,
    r.effective_sanctioned_count, r.filled_count, r.vacant_count, r.remarks || '',
  ])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SEAT_CATEGORY_LABEL[seatState.category]);
  XLSX.writeFile(wb, `${SEAT_CATEGORY_LABEL[seatState.category]}_Seats_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function handleSeatImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('seatImportErrorsPanel').style.display = 'none';
  const reader = new FileReader();
  reader.onload = e => {
    const wb = XLSX.read(e.target.result, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) { showToast('No rows found in the file.', false); return; }

    // Validate every row up front so the person sees every problem at
    // once, instead of trickling in one failed toast per bad row.
    const valid = [];
    const errors = [];
    rows.forEach((r, i) => {
      const rowNum = i + 2; // +1 for header row, +1 for 1-indexing
      const emis = String(r['EMIS Code'] || r['EMIS'] || '').trim();
      const designation = String(r['Seat/Designation Name'] || r['Designation'] || '').trim();
      const grade = Number(r['BPS'] || r['Grade/BPS'] || r['Grade'] || 0);
      const sanctioned = Number(r['Total Sanctioned'] ?? r['Sanctioned'] ?? '');
      const abolished = Number(r['Abolished'] || 0);
      const subject = String(r['Subject'] || '').trim();
      const remarks = String(r['Remarks'] || '').trim();

      const rowErrs = [];
      if (!emis) rowErrs.push('EMIS Code is missing.');
      else if (!/^\d+$/.test(emis)) rowErrs.push('EMIS Code must be numeric.');
      if (!designation) rowErrs.push('Seat/Designation Name is missing.');
      if (!grade || grade < 1) rowErrs.push('BPS / Grade is missing or invalid.');
      if (!Number.isFinite(sanctioned) || sanctioned < 0) rowErrs.push('Total Sanctioned is missing or invalid.');
      if (abolished < 0) rowErrs.push('Abolished cannot be negative.');
      if (abolished > sanctioned) rowErrs.push('Abolished cannot exceed Total Sanctioned.');

      if (rowErrs.length) {
        errors.push({ row: rowNum, emis, designation, messages: rowErrs });
      } else {
        // Filled is intentionally never read from the file for
        // Non-Teaching — it's auto-calculated server-side (item 4).
        // For Teaching it's still accepted, matching prior behaviour.
        const filled = seatState.category === 'teaching' ? Number(r['Filled'] || 0) : 0;
        valid.push({ emis, designation, subject, grade, sanctioned, abolished, filled, remarks });
      }
    });

    if (!valid.length) {
      _seatShowImportErrors(errors, 0, 0);
      input.value = '';
      return;
    }
    const proceedMsg = errors.length
      ? `${valid.length} valid row(s) will be imported, ${errors.length} row(s) have errors and will be skipped. Continue?`
      : `Import ${valid.length} row(s) into ${SEAT_CATEGORY_LABEL[seatState.category]} Seats? Existing EMIS+Grade+Subject+Designation records will be updated; new ones will be added.`;
    if (!confirm(proceedMsg)) { input.value = ''; return; }
    _seatImportRows(valid, 0, { ok: 0, fail: 0 }, errors);
  };
  reader.readAsArrayBuffer(file);
  input.value = '';
}

function _seatShowImportErrors(errors, ok, fail) {
  const panel = document.getElementById('seatImportErrorsPanel');
  if (!errors.length) { panel.style.display = 'none'; return; }
  const summary = (ok || fail)
    ? `<div style="font-weight:700;margin-bottom:8px;">Import finished: ${ok} saved, ${fail} row(s) skipped due to errors.</div>`
    : `<div style="font-weight:700;margin-bottom:8px;">No rows could be imported — every row had a validation error.</div>`;
  panel.innerHTML = summary + `
    <div style="max-height:220px;overflow-y:auto;font-size:.82rem;">
      ${errors.map(e => `
        <div style="padding:6px 0;border-bottom:1px solid #FECACA;">
          <strong>Row ${e.row}</strong> ${e.emis ? `(EMIS ${escHtmlAp(e.emis)})` : ''} ${e.designation ? `— ${escHtmlAp(e.designation)}` : ''}
          <ul style="margin:4px 0 0 18px;">${e.messages.map(m => `<li>${escHtmlAp(m)}</li>`).join('')}</ul>
        </div>`).join('')}
    </div>
    <button type="button" class="hr-btn-ghost" style="margin-top:10px;" onclick="document.getElementById('seatImportErrorsPanel').style.display='none'">Dismiss</button>`;
  panel.style.display = 'block';
}

function _seatImportRows(rows, idx, tally, errors) {
  if (idx >= rows.length) {
    showToast(`Import complete: ${tally.ok} saved, ${tally.fail} failed.`, tally.fail === 0 && !(errors && errors.length));
    _seatShowImportErrors(errors || [], tally.ok, tally.fail + (errors ? errors.length : 0));
    applySeatFilter();
    return;
  }
  const r = rows[idx];
  google.script.run
    .withSuccessHandler(res => {
      if (res && res.success) tally.ok++;
      else { tally.fail++; (errors || (errors = [])).push({ row: idx + 2, emis: r.emis, designation: r.designation, messages: [res?.message || 'Save failed.'] }); }
      _seatImportRows(rows, idx + 1, tally, errors);
    })
    .withFailureHandler(err => {
      tally.fail++;
      (errors || (errors = [])).push({ row: idx + 2, emis: r.emis, designation: r.designation, messages: [err.message || 'Server error.'] });
      _seatImportRows(rows, idx + 1, tally, errors);
    })
    .saveSeatRecord({
      category: seatState.category, emis: r.emis, designation: r.designation, subject: r.subject, grade: r.grade,
      sanctionedCount: r.sanctioned, abolishedCount: r.abolished, filledCount: r.filled,
      remarks: r.remarks, reason: 'Bulk import',
    });
}

// ── AUDIT LOG ──────────────────────────────────────────────────────
function openSeatAuditLog() {
  document.getElementById('seatAuditModal').classList.remove('hidden');
  document.getElementById('seatAuditBody').innerHTML = '<div class="hr-empty-state"><span class="spinner-border"></span> Loading…</div>';
  google.script.run
    .withSuccessHandler(res => {
      const body = document.getElementById('seatAuditBody');
      if (!res || !res.success || !res.rows.length) { body.innerHTML = '<div class="hr-empty-state">No changes recorded yet.</div>'; return; }
      body.innerHTML = res.rows.map(a => `
        <div style="padding:10px 0;border-bottom:1px solid var(--b0);font-size:.82rem">
          <strong>${a.action.toUpperCase()}</strong> — ${escHtmlAp(a.emis || '')} / ${escHtmlAp(a.subject_code || '')}
          <span style="color:var(--t3)"> by ${escHtmlAp(a.changed_by_name || 'Unknown')} on ${new Date(a.changed_at).toLocaleString()}</span>
          ${a.reason ? `<div style="color:var(--t3);margin-top:2px">Reason: ${escHtmlAp(a.reason)}</div>` : ''}
        </div>`).join('');
    })
    .withFailureHandler(err => { document.getElementById('seatAuditBody').innerHTML = 'Error: ' + err.message; })
    .getSeatAuditLog({});
}

// ── FIRST-TIME ENTRY GATE ─────────────────────────────────────────
// Checked once per session after login. Admins are never gated. This
// is a live existence check (not a stored flag), so if an admin later
// deletes all of a jurisdiction's seat rows, the gate reappears next
// time that jurisdiction's user logs in — no extra bookkeeping needed.
function checkSeatEntryGate() {
  if (typeof currentUser === 'undefined' || !currentUser) return;
  google.script.run
    .withSuccessHandler(res => {
      if (res && res.success && res.required) {
        document.getElementById('seatGateOverlay').classList.remove('hidden');
      }
    })
    .withFailureHandler(() => { /* fail open — never block the app due to a network hiccup */ })
    .getSeatEntryStatus();
}
function _seatCheckGateAfterSave() {
  const overlay = document.getElementById('seatGateOverlay');
  if (overlay && !overlay.classList.contains('hidden')) {
    // Re-check; hide once at least one record exists for this jurisdiction.
    google.script.run
      .withSuccessHandler(res => { if (res && res.success && !res.required) overlay.classList.add('hidden'); })
      .withFailureHandler(() => {})
      .getSeatEntryStatus();
  }
}
