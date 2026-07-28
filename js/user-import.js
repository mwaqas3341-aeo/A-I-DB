/**
 * USERS (AEOs) — "Template System" bulk import, admin-only.
 * Same shared step-wizard shell as Schools/Staff import (schoolImportModal,
 * "si_" prefixed elements): download a template → fill it in Excel/CSV →
 * upload → map columns (auto-matched if headers are intact) → review →
 * confirm.
 *
 * MATCHING: an uploaded row is matched against an existing app_user by
 * PERSONAL NO. first, then by CNIC. If matched, ONLY the currently-blank
 * fields on that user are filled in — anything already on file is left
 * untouched ("update only available information; the rest can be added
 * later"). If no match is found, a brand-new AEO account is created.
 *
 * BATCH DEFAULTS: this import is normally done one Tehsil/Wing/District
 * roster at a time, so District/Wing/Tehsil can be set once for the whole
 * batch instead of repeated in every row. A per-row column, if mapped,
 * always wins over the batch default.
 *
 * WRITES: every row — insert or update — goes through the exact same
 * saveUser() API the manual Add/Edit User form already uses, so all its
 * existing behavior (CNIC-based match confirmation, RLS error messages,
 * Tehsil Representative sync, and — for brand-new AEOs — real Supabase
 * Auth account creation via the createUser Edge Function) applies here
 * too, instead of being re-implemented.
 *
 * NEW AEOs are created with sensible defaults (Role: User, Access Type:
 * Editor, Scope Type: Markaz) so the admin can finish configuring each
 * one later from Edit User — matching "update only available info, the
 * rest gets updated later."
 *
 * Depends on: UH (js/admin.js), apiCall (js/api.js), escHtml/showToast,
 * the SheetJS XLSX global, the shared schoolImportModal markup.
 */

// Template columns, in a sensible fill-in order. District/Wing/Tehsil are
// included so a mixed-jurisdiction sheet still works, but are optional
// per-row since the modal's batch defaults can supply them instead.
const UI_TEMPLATE_HEADERS = [
  UH.PERSONAL_NO, UH.CNIC, UH.NAME, UH.CELL, UH.EMAIL,
  UH.MARKAZ, UH.MARKAZ_UR, UH.DESIGNATION_UR,
  UH.PAGE_NO, UH.DDEO_CODE, UH.BPS_SCALE,
  UH.DISTRICT, UH.WING, UH.TEHSIL,
];

const UI_FIELD_SANITIZER = {
  [UH.CNIC]:  'digits',
  [UH.CELL]:  'digits',
  [UH.PERSONAL_NO]: 'digits',
  [UH.EMAIL]: 'none',
  [UH.MARKAZ_UR]: 'none',       // Urdu text — never strip non-ASCII
  [UH.DESIGNATION_UR]: 'none',  // Urdu text — never strip non-ASCII
};

let _uiRawRows = [];
let _uiHeaders = [];
let _uiMapping = {};
let _uiPreviewRows = [];
let _uiExistingUsers = [];
let _uiDefaults = { district: '', wing: '', tehsil: '' };

function _uiSanitize(header, raw) {
  const v = (raw === undefined || raw === null) ? '' : String(raw).trim();
  if (!v) return '';
  const kind = UI_FIELD_SANITIZER[header] || 'text';
  if (kind === 'digits') return v.replace(/\D/g, '');
  if (kind === 'none') return v;
  // 'text' — trim only; strip angle brackets so nothing can inject markup
  // into the review table or the saved record, but keep everything else
  // (including Urdu/other unicode in Name-adjacent fields) intact.
  return v.replace(/[<>]/g, '').trim();
}

// ── Step 0: download a ready-made template ─────────────────────────
function downloadUserImportTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([UI_TEMPLATE_HEADERS]);
  ws['!cols'] = UI_TEMPLATE_HEADERS.map(h => ({ wch: Math.max(14, Math.min(28, h.length + 4)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'AEO Import');
  XLSX.writeFile(wb, 'AEO_Users_Import_Template.xlsx');
}

// ── Open modal ───────────────────────────────────────────────────
function openUserImportModal() {
  if (!currentUser || String(currentUser.role).toLowerCase() !== 'admin') {
    showToast('Admin access required.', false); return;
  }
  _uiRawRows = []; _uiHeaders = []; _uiMapping = {}; _uiPreviewRows = [];
  _uiDefaults = { district: '', wing: '', tehsil: '' };

  document.getElementById('si_title').innerHTML = '<i class="bi bi-cloud-arrow-up-fill"></i> Import / Update AEO Users';
  document.getElementById('si_fileInput').value = '';
  document.getElementById('si_downloadTemplateBtn').onclick = downloadUserImportTemplate;
  document.getElementById('si_step1').style.display = 'block';
  document.getElementById('si_step2').style.display = 'none';
  document.getElementById('si_step3').style.display = 'none';
  document.getElementById('si_nextBtn').style.display = 'none';
  document.getElementById('si_previewBtn').style.display = 'none';
  document.getElementById('si_confirmBtn').style.display = 'none';
  document.getElementById('si_fileInput').onchange = function () { handleUserImportFileSelected(this); };
  document.getElementById('si_nextBtn').onclick = userImportGoToMapping;
  document.getElementById('si_previewBtn').onclick = userImportGoToPreview;
  document.getElementById('si_confirmBtn').onclick = confirmUserImport;

  document.getElementById('si_instructions').innerHTML =
    'Matching an existing AEO (by Personal No. or CNIC) only fills in that AEO\'s BLANK fields — anything already on file is left as-is. ' +
    'An unmatched Personal No./CNIC creates a brand-new AEO account (Role: User, Access Type: Editor, Scope: Markaz by default — finish setting those up later from Edit User).';
  document.getElementById('si_scopeNote').style.display = 'block';
  document.getElementById('si_scopeNote').innerHTML = `
    <div style="margin-bottom:8px"><i class="bi bi-signpost-split"></i> If every AEO in this sheet shares the same District/Wing/Tehsil, set it once here — used for any row that doesn't have its own value:</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input type="text" id="ui_defDistrict" placeholder="District" value="" oninput="_uiDefaults.district=this.value" style="height:32px;border:1px solid var(--b0);border-radius:6px;padding:0 8px;flex:1;min-width:120px">
      <input type="text" id="ui_defWing" placeholder="Wing (e.g. M-EE)" value="" oninput="_uiDefaults.wing=this.value" style="height:32px;border:1px solid var(--b0);border-radius:6px;padding:0 8px;flex:1;min-width:120px">
      <input type="text" id="ui_defTehsil" placeholder="Tehsil" value="" oninput="_uiDefaults.tehsil=this.value" style="height:32px;border:1px solid var(--b0);border-radius:6px;padding:0 8px;flex:1;min-width:120px">
    </div>`;

  bootstrap.Modal.getOrCreateInstance(document.getElementById('schoolImportModal')).show();
}

// ── Step 1: read the uploaded file ──────────────────────────────
function handleUserImportFileSelected(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true, codepage: 65001 });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: false });
      if (!rows.length) { showToast('That file has no data rows.', false); return; }
      _uiRawRows = rows;
      _uiHeaders = Object.keys(rows[0]);
      document.getElementById('si_nextBtn').style.display = 'inline-block';
      showToast(`Loaded ${rows.length} rows with ${_uiHeaders.length} columns.`, true);
    } catch (err) {
      showToast('Could not read that file: ' + err.message, false);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ── Step 2: map columns ──────────────────────────────────────────
function _uiFieldId(header) { return header.replace(/[^a-zA-Z0-9]/g, '_'); }
function _uiGuessColumn(targetHeader, uploadedHeader) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(targetHeader) === norm(uploadedHeader);
}

function userImportGoToMapping() {
  if (!_uiRawRows.length) { showToast('Upload a file first.', false); return; }

  const box = document.getElementById('si_mappingBody');
  box.innerHTML = UI_TEMPLATE_HEADERS.map(h => {
    const required = (h === UH.PERSONAL_NO || h === UH.NAME || h === UH.CNIC);
    return `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <label style="min-width:200px;font-size:.82rem">${escHtml(h)}${required ? ' <span style="color:var(--bad)">*</span>' : ''}</label>
      <select id="si_map_${_uiFieldId(h)}" style="flex:1;height:34px;border:1px solid var(--b0);border-radius:6px;padding:0 8px">
        <option value="">— None —</option>
        ${_uiHeaders.map(sh => `<option value="${escHtml(sh)}" ${_uiGuessColumn(h, sh) ? 'selected' : ''}>${escHtml(sh)}</option>`).join('')}
      </select>
    </div>`;
  }).join('');
  box.insertAdjacentHTML('afterbegin', `<div style="font-size:.76rem;color:var(--t3);margin-bottom:8px">Every row needs a Name, and at least one of Personal No. / CNIC.</div>`);

  document.getElementById('si_step1').style.display = 'none';
  document.getElementById('si_step2').style.display = 'block';
  document.getElementById('si_nextBtn').style.display = 'none';
  document.getElementById('si_previewBtn').style.display = 'inline-block';
}

// ── Step 3: preview — sanitize, match against existing AEOs, review ──
async function userImportGoToPreview() {
  UI_TEMPLATE_HEADERS.forEach(h => { _uiMapping[h] = document.getElementById(`si_map_${_uiFieldId(h)}`).value; });

  if (!_uiMapping[UH.NAME]) { showToast('Please map Name.', false); return; }
  if (!_uiMapping[UH.PERSONAL_NO] && !_uiMapping[UH.CNIC]) {
    showToast('Please map at least one of Personal No. or CNIC.', false); return;
  }

  const previewBtn = document.getElementById('si_previewBtn');
  previewBtn.disabled = true;
  previewBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Checking existing AEOs…';

  try {
    const res = await apiCall('getUsers');
    if (!res || !res.success) { showToast(res?.message || 'Could not load existing users.', false); return; }
    _uiExistingUsers = res.data || [];
    _uiBuildPreview();
  } finally {
    previewBtn.disabled = false;
    previewBtn.innerHTML = 'Next: Preview';
  }
}

function _uiBuildPreview() {
  const get = (raw, h) => _uiMapping[h] ? String(raw[_uiMapping[h]] || '').trim() : '';

  const byPno = new Map(), byCnic = new Map();
  _uiExistingUsers.forEach(r => {
    const pnoKey  = r[UH.PERSONAL_NO] ? String(r[UH.PERSONAL_NO]).trim() : '';
    const cnicKey = r[UH.CNIC] ? String(r[UH.CNIC]).trim() : '';
    if (pnoKey)  byPno.set(pnoKey, r);
    if (cnicKey) byCnic.set(cnicKey, r);
  });

  _uiPreviewRows = _uiRawRows.map(raw => {
    const sanitized = {};
    UI_TEMPLATE_HEADERS.forEach(h => { sanitized[h] = _uiSanitize(h, get(raw, h)); });

    // Batch defaults fill in only if the row itself didn't supply a value.
    if (!sanitized[UH.DISTRICT] && _uiDefaults.district) sanitized[UH.DISTRICT] = _uiDefaults.district.trim();
    if (!sanitized[UH.WING]     && _uiDefaults.wing)     sanitized[UH.WING]     = _uiDefaults.wing.trim();
    if (!sanitized[UH.TEHSIL]   && _uiDefaults.tehsil)   sanitized[UH.TEHSIL]   = _uiDefaults.tehsil.trim();

    const pno  = sanitized[UH.PERSONAL_NO];
    const cnic = sanitized[UH.CNIC];
    const missing = [];
    if (!sanitized[UH.NAME]) missing.push('Name');
    if (!pno && !cnic) missing.push('Personal No. or CNIC');

    const existing = (pno && byPno.get(pno)) || (cnic && byCnic.get(cnic)) || null;
    const mode = existing ? 'update' : 'insert';
    if (mode === 'insert' && (!sanitized[UH.DISTRICT] || !sanitized[UH.WING] || !sanitized[UH.TEHSIL])) {
      missing.push('District/Wing/Tehsil (new AEO)');
    }

    return { raw: sanitized, mode, existing, status: missing.length ? 'missing' : 'ok', missing };
  });

  _uiRenderPreview();
}

function _uiRenderPreview() {
  const counts = _uiPreviewRows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const inserts = _uiPreviewRows.filter(r => r.status === 'ok' && r.mode === 'insert').length;
  const updates = _uiPreviewRows.filter(r => r.status === 'ok' && r.mode === 'update').length;

  document.getElementById('si_previewCount').textContent = _uiPreviewRows.length;
  document.getElementById('si_previewSummary').innerHTML = `
    <span style="color:var(--ok)"><i class="bi bi-pencil-square"></i> ${updates} existing AEOs to update (blank fields only)</span>
    &nbsp;·&nbsp; <span style="color:var(--ok)"><i class="bi bi-person-plus"></i> ${inserts} new AEO accounts to create</span>
    &nbsp;·&nbsp; <span style="color:var(--bad)"><i class="bi bi-exclamation-triangle"></i> ${counts.missing || 0} missing required info</span>`;

  document.getElementById('si_previewBody').innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:.76rem">
      <thead><tr style="border-bottom:2px solid var(--b0);text-align:left">
        <th style="padding:6px">Status</th><th style="padding:6px">Mode</th>
        <th style="padding:6px">Personal No.</th><th style="padding:6px">CNIC</th>
        <th style="padding:6px">Name</th><th style="padding:6px">Tehsil/Wing</th>
      </tr></thead>
      <tbody>
        ${_uiPreviewRows.map(r => `
          <tr style="border-bottom:1px solid var(--b0);${r.status === 'ok' ? '' : 'opacity:.7'}">
            <td style="padding:6px;color:${r.status === 'ok' ? 'var(--ok)' : 'var(--bad)'};font-weight:700;white-space:nowrap">
              ${r.status === 'ok' ? (r.mode === 'insert' ? '✓ New' : '✓ Update') : ('Missing: ' + r.missing.join(', '))}
            </td>
            <td style="padding:6px">${r.mode}</td>
            <td style="padding:6px">${escHtml(r.raw[UH.PERSONAL_NO] || '')}</td>
            <td style="padding:6px">${escHtml(r.raw[UH.CNIC] || '')}</td>
            <td style="padding:6px">${escHtml(r.raw[UH.NAME] || '')}</td>
            <td style="padding:6px">${escHtml([r.raw[UH.TEHSIL], r.raw[UH.WING]].filter(Boolean).join(' / '))}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  document.getElementById('si_step2').style.display = 'none';
  document.getElementById('si_step3').style.display = 'block';
  document.getElementById('si_previewBtn').style.display = 'none';
  document.getElementById('si_confirmBtn').style.display = 'inline-block';
  document.getElementById('si_confirmBtn').innerHTML = '<i class="bi bi-check2-circle"></i> Save These AEOs';
}

// ── Step 4: confirm — one saveUser() call per row (reuses all its
// existing validation, RLS handling, and new-account creation) ──────
function _uiBuildSaveUserPayload(item) {
  const dataObj = {};
  UI_TEMPLATE_HEADERS.forEach(h => {
    const val = item.raw[h];
    if (val === '') return;
    if (item.mode === 'update' && item.existing && String(item.existing[h] || '').trim() !== '') {
      return; // existing field already has a value — never overwrite it
    }
    dataObj[h] = val;
  });
  if (item.mode === 'update') {
    dataObj._id = item.existing._id;
  } else {
    // Sensible defaults for a brand-new AEO account — the admin finishes
    // configuring Role/Access/Scope precisely later via Edit User.
    dataObj[UH.ROLE] = dataObj[UH.ROLE] || 'user';
    dataObj[UH.ACCESS_TYPE] = dataObj[UH.ACCESS_TYPE] || 'Editor';
    dataObj[UH.SCOPE_TYPE] = dataObj[UH.SCOPE_TYPE] || 'Markaz';
  }
  return dataObj;
}

async function _uiRunWithConcurrency(items, worker, concurrency) {
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
}

async function confirmUserImport() {
  const toApply = _uiPreviewRows.filter(r => r.status === 'ok');
  const total = toApply.length;
  if (!total) { showToast('Nothing valid to save.', false); return; }

  const btn = document.getElementById('si_confirmBtn');
  btn.disabled = true;
  let done = 0;
  const paint = () => { btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Saving… ${done} / ${total}`; };
  paint();

  let updated = 0, inserted = 0, failed = 0;
  const failMessages = [];

  // Each row is its own saveUser() call (new accounts go through the
  // createUser Edge Function, which can't be batched) — a modest
  // concurrency keeps this fast without hammering the Edge Function.
  await _uiRunWithConcurrency(toApply, async (item) => {
    const payload = _uiBuildSaveUserPayload(item);
    try {
      const res = await apiCall('saveUser', payload);
      if (res && res.success) { item.mode === 'insert' ? inserted++ : updated++; }
      else { failed++; failMessages.push(`${item.raw[UH.NAME] || item.raw[UH.PERSONAL_NO]}: ${res?.message || 'Unknown error'}`); }
    } catch (err) {
      failed++; failMessages.push(`${item.raw[UH.NAME] || item.raw[UH.PERSONAL_NO]}: ${err.message}`);
    }
    done++; paint();
  }, 5);

  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-check2-circle"></i> Save These AEOs';

  const skipped = _uiPreviewRows.length - toApply.length;
  showToast(
    `Updated ${updated}, added ${inserted}${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}.` +
    (failMessages.length ? ' First error: ' + failMessages[0] : ''),
    failed === 0
  );
  if (updated + inserted > 0) {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('schoolImportModal')).hide();
    if (typeof loadUsers === 'function') loadUsers();
  }
}
