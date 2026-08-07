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

const SEAT_CATEGORY_LABEL = { teaching: 'Teaching', non_teaching: 'Non-Teaching' };

function openSeatManagement(category) {
  seatState.category = category === 'non_teaching' ? 'non_teaching' : 'teaching';
  openHrModule();
  switchGlobalTab('seatManagementView', null);
  document.getElementById('seatMgmtTitle').textContent =
    `${SEAT_CATEGORY_LABEL[seatState.category]} Sanctioned & Abolished Seats`;
  document.getElementById('seat_designationRow').style.display = '';
  document.getElementById('seat_subjectRow').style.display = seatState.category === 'teaching' ? '' : 'none';
  _seatPopulateJurisdictionFilters();
  applySeatFilter();
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
                <button class="hr-btn-ghost" style="padding:5px 10px;font-size:.74rem" onclick="openSeatModal('${r.id}')">Edit</button>
                <button class="hr-btn-ghost" style="padding:5px 10px;font-size:.74rem;color:#DC2626" onclick="deleteSeatRecord('${r.id}')">Delete</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── ADD / EDIT MODAL ──────────────────────────────────────────────
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
  document.getElementById('seat_designation').value = row?.designation || '';
  document.getElementById('seat_subject').value = row?.subjects || '';
  document.getElementById('seat_grade').value = row?.grade || '';
  document.getElementById('seat_sanctioned').value = row?.sanctioned_count ?? 0;
  document.getElementById('seat_abolished').value = row?.abolished_count ?? 0;
  document.getElementById('seat_filled').value = row?.filled_count ?? 0;
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
  const reader = new FileReader();
  reader.onload = e => {
    const wb = XLSX.read(e.target.result, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) { showToast('No rows found in the file.', false); return; }
    if (!confirm(`Import ${rows.length} row(s) into ${SEAT_CATEGORY_LABEL[seatState.category]} Seats? Existing EMIS+Grade+Subject+Designation records will be updated; new ones will be added.`)) return;
    _seatImportRows(rows, 0, { ok: 0, fail: 0 });
  };
  reader.readAsArrayBuffer(file);
  input.value = '';
}

function _seatImportRows(rows, idx, tally) {
  if (idx >= rows.length) {
    showToast(`Import complete: ${tally.ok} saved, ${tally.fail} failed.`, tally.fail === 0);
    applySeatFilter();
    return;
  }
  const r = rows[idx];
  const emis = String(r['EMIS'] || r['EMIS Code'] || '').trim();
  const designation = String(r['Designation'] || '').trim();
  const grade = Number(r['Grade/BPS'] || r['Grade'] || 0);
  const sanctioned = Number(r['Total Sanctioned'] || r['Sanctioned'] || 0);
  const abolished = Number(r['Abolished'] || 0);
  const filled = Number(r['Filled'] || 0);
  if (!emis || !designation || !grade) { tally.fail++; _seatImportRows(rows, idx + 1, tally); return; }

  google.script.run
    .withSuccessHandler(res => { if (res && res.success) tally.ok++; else tally.fail++; _seatImportRows(rows, idx + 1, tally); })
    .withFailureHandler(() => { tally.fail++; _seatImportRows(rows, idx + 1, tally); })
    .saveSeatRecord({
      category: seatState.category, emis, designation, subject: String(r['Subject'] || '').trim(), grade,
      sanctionedCount: sanctioned, abolishedCount: abolished, filledCount: filled,
      remarks: String(r['Remarks'] || '').trim(), reason: 'Bulk import',
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
