/**
 * Public / Private Schools — "Template System" for uploading previous
 * (historical) data. Download a template → fill it in Excel/CSV →
 * upload → map columns (auto-matched if the template's own headers
 * are still intact) → review → confirm.
 *
 * PUBLIC SCHOOLS: update-only. Public Schools has no "Add" path
 * anywhere in the portal (EMIS records come from the government
 * register), so this can only update fields on an Emis that already
 * exists — never insert a new school. Only Emis is required; every
 * other column is an optional partial update (blank cells leave that
 * field untouched). Jurisdiction is checked against the EXISTING
 * record being updated, since the sheet itself doesn't need to carry
 * location data for an update.
 *
 * PRIVATE SCHOOLS: inserts new records. No "Unique ID" column in the
 * template — that ID is system-generated on save, same as the manual
 * Add Private School form, so asking for it would just confuse people.
 * Duplicates are detected by School Name (not an ID nobody has yet).
 * District/Tehsil/Markaz handling depends on the uploader's own
 * assigned jurisdiction(s):
 *   • Admin (no restriction)         → typed freely in the sheet.
 *   • One assigned jurisdiction      → auto-filled for every row; not
 *                                       even asked for in the template.
 *   • Several assigned jurisdictions → too ambiguous to guess, so the
 *                                       sheet's own values are ignored
 *                                       and the reviewer instead picks
 *                                       the correct one of their own
 *                                       assigned jurisdictions from a
 *                                       dropdown, per row.
 *
 * Depends on: PUB_COL_MAP / PRIV_COL_MAP (js/api.js), _sb (js/api.js),
 * _getUserJurisdictions() (js/hr_view.js), the SheetJS XLSX global.
 */

const SCHOOL_IMPORT_CONFIG = {
  public: {
    label: 'Public Schools',
    table: 'public_schools',
    colMap: () => PUB_COL_MAP,
    uniqueCol: 'emis', uniqueHeader: 'Emis',
    hasWing: true,
    updateOnly: true,
    requiredHeaders: ['Emis'],
    instructions: 'This updates EXISTING public schools only — it never creates a new school. Every row must have an Emis code that already exists in the system; blank cells leave that field unchanged. Rows with an unrecognized Emis, or an Emis outside your jurisdiction, are skipped.',
    confirmLabel: 'Update These Records',
    templateFile: 'Public_Schools_Update_Template.xlsx',
    reload: () => { if (typeof openPublicModule === 'function' && typeof currentPubSheet !== 'undefined') openPublicModule(currentPubSheet || 'Public'); },
  },
  private: {
    label: 'Private Schools',
    table: 'private_schools',
    colMap: () => PRIV_COL_MAP,
    hasWing: false, // private_schools has no Wing column in this system
    updateOnly: false,
    dupCheckHeader: 'School Name',
    requiredHeaders: ['School Name'],
    confirmLabel: 'Import These Records',
    templateFile: 'Private_Schools_Import_Template.xlsx',
    reload: () => { if (typeof openPrivateModule === 'function' && typeof currentPrivSheet !== 'undefined') openPrivateModule(currentPrivSheet || 'Active'); },
  },
};

const SI_LOCATION_HEADERS = ['District', 'Tehsil', 'Markaz Name'];

let _siKind = 'public';       // 'public' | 'private' — which config is active
let _siRawRows = [];
let _siHeaders = [];
let _siMapping = {};          // targetHeader -> uploaded file's column header
let _siPreviewRows = [];      // normalized rows ready to review/import
let _siJurMode = { mode: 'admin', jur: null };

// ── Whose data can this user even touch? ────────────────────────────
function _siJurisdictionMode() {
  const jur = (typeof _getUserJurisdictions === 'function') ? _getUserJurisdictions() : null;
  if (!jur) return { mode: 'admin', jur: null };
  if (jur.length === 1) return { mode: 'single', jur };
  return { mode: 'multi', jur };
}

function _siJurLabel(j) {
  return [j.district, j.wing, j.tehsil, j.markaz].filter(Boolean).join(' → ') || 'All';
}

function _siTemplateHeaders(kind) {
  const cfg = SCHOOL_IMPORT_CONFIG[kind];
  let headers = Object.values(cfg.colMap());
  if (kind === 'private') {
    headers = headers.filter(h => h !== 'Unique ID');
    if (_siJurMode.mode === 'single') {
      headers = headers.filter(h => !SI_LOCATION_HEADERS.includes(h));
    }
  }
  return headers;
}

// ── Step 0: download a ready-made template ─────────────────────────
function downloadSchoolImportTemplate(kind) {
  const cfg = SCHOOL_IMPORT_CONFIG[kind];
  if (!cfg) return;
  const headers = _siTemplateHeaders(kind);
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(14, Math.min(28, h.length + 4)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, cfg.label.slice(0, 31));
  XLSX.writeFile(wb, cfg.templateFile);
}

// ── Open modal ───────────────────────────────────────────────────
function openSchoolImportModal(kind) {
  _siKind = kind;
  _siJurMode = _siJurisdictionMode();
  const cfg = SCHOOL_IMPORT_CONFIG[kind];
  _siRawRows = []; _siHeaders = []; _siMapping = {}; _siPreviewRows = [];

  document.getElementById('si_title').innerHTML =
    `<i class="bi bi-cloud-arrow-up-fill"></i> ${cfg.updateOnly ? 'Update' : 'Import Previous'} ${cfg.label} Data`;
  document.getElementById('si_fileInput').value = '';
  document.getElementById('si_fileInput').onchange = function () { handleSchoolImportFileSelected(this); };
  document.getElementById('si_downloadTemplateBtn').onclick = () => downloadSchoolImportTemplate(kind);
  document.getElementById('si_nextBtn').onclick = schoolImportGoToMapping;
  document.getElementById('si_previewBtn').onclick = schoolImportGoToPreview;
  document.getElementById('si_confirmBtn').onclick = confirmSchoolImport;
  document.getElementById('si_step1').style.display = 'block';
  document.getElementById('si_step2').style.display = 'none';
  document.getElementById('si_step3').style.display = 'none';
  document.getElementById('si_nextBtn').style.display = 'none';
  document.getElementById('si_previewBtn').style.display = 'none';
  document.getElementById('si_confirmBtn').style.display = 'none';

  const scopeNote = document.getElementById('si_scopeNote');
  let instructions = cfg.instructions || '';
  if (kind === 'private') {
    if (_siJurMode.mode === 'admin') {
      instructions = 'Download the template below, fill in whatever historical records you have (leave columns blank if unknown), then upload it here. Rows whose School Name already exists are skipped automatically so nothing gets duplicated.';
      scopeNote.style.display = 'none';
    } else if (_siJurMode.mode === 'single') {
      const j = _siJurMode.jur[0];
      instructions = `District/Tehsil/Markaz aren't in the template — every row you upload will automatically be saved under your own jurisdiction (${_siJurLabel(j)}). Just fill in the school details. Rows whose School Name already exists are skipped automatically.`;
      scopeNote.style.display = 'none';
    } else {
      instructions = "You're assigned to more than one jurisdiction, so District/Tehsil/Markaz can't be guessed automatically — on the Review step you'll pick which of your assigned jurisdictions each row belongs to from a dropdown. Rows whose School Name already exists are skipped automatically.";
      scopeNote.innerHTML = `<i class="bi bi-shield-lock"></i> Your assigned jurisdictions: <b>${_siJurMode.jur.map(_siJurLabel).map(escHtml).join(' &nbsp;|&nbsp; ')}</b>`;
      scopeNote.style.display = '';
    }
  } else {
    if (_siJurMode.mode !== 'admin') {
      scopeNote.innerHTML = `<i class="bi bi-shield-lock"></i> Only Emis codes within your jurisdiction (<b>${_siJurMode.jur.map(_siJurLabel).map(escHtml).join(' &nbsp;|&nbsp; ')}</b>) can be updated — others will be skipped.`;
      scopeNote.style.display = '';
    } else {
      scopeNote.style.display = 'none';
    }
  }
  document.getElementById('si_instructions').textContent = instructions;

  bootstrap.Modal.getOrCreateInstance(document.getElementById('schoolImportModal')).show();
}

// ── Step 1: read the uploaded file ──────────────────────────────
function handleSchoolImportFileSelected(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true, codepage: 65001 });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: false });
      if (!rows.length) { showToast('That file has no data rows.', false); return; }
      _siRawRows = rows;
      _siHeaders = Object.keys(rows[0]);
      document.getElementById('si_nextBtn').style.display = 'inline-block';
      showToast(`Loaded ${rows.length} rows with ${_siHeaders.length} columns.`, true);
    } catch (err) {
      showToast('Could not read that file: ' + err.message, false);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ── Step 2: map columns (auto-matched when headers == the template's) ─
function schoolImportGoToMapping() {
  if (!_siRawRows.length) { showToast('Upload a file first.', false); return; }
  const cfg = SCHOOL_IMPORT_CONFIG[_siKind];
  const targetHeaders = _siTemplateHeaders(_siKind);

  const box = document.getElementById('si_mappingBody');
  box.innerHTML = targetHeaders.map(h => {
    const required = cfg.requiredHeaders.includes(h);
    return `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <label style="min-width:260px;font-size:.82rem">${escHtml(h)}${required ? ' <span style="color:var(--bad)">*</span>' : ''}</label>
      <select id="si_map_${_siFieldId(h)}" style="flex:1;height:34px;border:1px solid var(--b0);border-radius:6px;padding:0 8px">
        <option value="">— None —</option>
        ${_siHeaders.map(sh => `<option value="${escHtml(sh)}" ${_siGuessColumn(h, sh) ? 'selected' : ''}>${escHtml(sh)}</option>`).join('')}
      </select>
    </div>`;
  }).join('');

  document.getElementById('si_step1').style.display = 'none';
  document.getElementById('si_step2').style.display = 'block';
  document.getElementById('si_nextBtn').style.display = 'none';
  document.getElementById('si_previewBtn').style.display = 'inline-block';
}

function _siFieldId(header) { return header.replace(/[^a-zA-Z0-9]/g, '_'); }

function _siGuessColumn(targetHeader, uploadedHeader) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(targetHeader) === norm(uploadedHeader);
}

// ── Step 3: preview — validate + resolve each row, then let the admin review ──
async function schoolImportGoToPreview() {
  const cfg = SCHOOL_IMPORT_CONFIG[_siKind];
  const targetHeaders = _siTemplateHeaders(_siKind);
  targetHeaders.forEach(h => { _siMapping[h] = document.getElementById(`si_map_${_siFieldId(h)}`).value; });

  const missingRequired = cfg.requiredHeaders.filter(h => targetHeaders.includes(h) && !_siMapping[h]);
  if (missingRequired.length) {
    showToast('Please map: ' + missingRequired.join(', '), false);
    return;
  }

  if (_siKind === 'public') {
    await _siBuildPublicPreview(cfg, targetHeaders);
  } else {
    await _siBuildPrivatePreview(cfg, targetHeaders);
  }

  _siRenderPreview(cfg);
}

async function _siBuildPublicPreview(cfg, targetHeaders) {
  const get = (raw, h) => _siMapping[h] ? String(raw[_siMapping[h]] || '').trim() : '';
  const uploadedKeys = _siRawRows.map(r => get(r, 'Emis')).filter(Boolean);

  let existingByEmis = new Map();
  if (uploadedKeys.length) {
    const cols = ['emis', 'district', 'tehsil', 'markaz_name'].concat(cfg.hasWing ? ['wing'] : []);
    const { data } = await _sb.from(cfg.table).select(cols.join(',')).in('emis', uploadedKeys);
    (data || []).forEach(r => existingByEmis.set(String(r.emis), r));
  }

  _siPreviewRows = _siRawRows.map(raw => {
    const row = {};
    targetHeaders.forEach(h => { row[h] = get(raw, h); });
    const key = row['Emis'];
    const missing = cfg.requiredHeaders.filter(h => !row[h]);
    const existing = key ? existingByEmis.get(key) : null;

    let status = 'ok';
    if (missing.length) status = 'missing';
    else if (!existing) status = 'notfound';
    else if (_siJurMode.jur && !_siJurMode.jur.some(j => {
      if (j.district && existing.district !== j.district) return false;
      if (cfg.hasWing && j.wing && existing.wing !== j.wing) return false;
      if (j.tehsil && existing.tehsil !== j.tehsil) return false;
      if (j.markaz && existing.markaz_name !== j.markaz) return false;
      return true;
    })) status = 'outside';

    return { row, status, missing, uniqueVal: key, location: existing || {} };
  });
}

async function _siBuildPrivatePreview(cfg, targetHeaders) {
  const get = (raw, h) => _siMapping[h] ? String(raw[_siMapping[h]] || '').trim() : '';

  const norm = s => s.trim().toLowerCase();
  const { data: existingRows } = await _sb.from(cfg.table).select('school_name');
  const existingNames = new Set((existingRows || []).map(r => norm(r.school_name || '')));

  _siPreviewRows = _siRawRows.map((raw) => {
    const row = {};
    targetHeaders.forEach(h => { row[h] = get(raw, h); });
    const missing = cfg.requiredHeaders.filter(h => !row[h]);
    const isDuplicate = row['School Name'] && existingNames.has(norm(row['School Name']));

    let location, jurIndex = null;
    if (_siJurMode.mode === 'single') {
      const j = _siJurMode.jur[0];
      location = { district: j.district, tehsil: j.tehsil, markaz_name: j.markaz };
    } else if (_siJurMode.mode === 'multi') {
      jurIndex = _siBestJurMatch(row);
      location = _siResolveJurEntry(_siJurMode.jur[jurIndex], row);
    } else {
      location = { district: row['District'] || '', tehsil: row['Tehsil'] || '', markaz_name: row['Markaz Name'] || '' };
    }

    const locMissing = [];
    if (_siJurMode.mode === 'admin' && !location.district) locMissing.push('District');
    if (_siJurMode.mode === 'admin' && !location.tehsil) locMissing.push('Tehsil');
    if (!location.markaz_name) locMissing.push('Markaz Name');

    let status = 'ok';
    if (missing.length || locMissing.length) status = 'missing';
    else if (isDuplicate) status = 'duplicate';

    return { row, status, missing: missing.concat(locMissing), uniqueVal: row['School Name'], location, jurIndex };
  });
}

function _siBestJurMatch(row) {
  const jur = _siJurMode.jur;
  let bestIdx = 0, bestScore = -1;
  jur.forEach((j, i) => {
    let score = 0;
    if (j.district && row['District'] === j.district) score++;
    if (j.tehsil && row['Tehsil'] === j.tehsil) score++;
    if (j.markaz && row['Markaz Name'] === j.markaz) score++;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  });
  return bestIdx;
}

function _siResolveJurEntry(j, row) {
  return {
    district: j.district || row['District'] || '',
    tehsil: j.tehsil || row['Tehsil'] || '',
    markaz_name: j.markaz || row['Markaz Name'] || '',
  };
}

function siOnRowJurisdictionChange(idx, newJurIndex) {
  const r = _siPreviewRows[idx];
  r.jurIndex = Number(newJurIndex);
  r.location = _siResolveJurEntry(_siJurMode.jur[r.jurIndex], r.row);
  const locMissing = r.location.markaz_name ? [] : ['Markaz Name'];
  const baseMissing = SCHOOL_IMPORT_CONFIG.private.requiredHeaders.filter(h => !r.row[h]);
  r.missing = baseMissing.concat(locMissing);
  const wasDuplicate = r.status === 'duplicate';
  r.status = (baseMissing.length || locMissing.length) ? 'missing' : (wasDuplicate ? 'duplicate' : 'ok');
  _siRenderPreview(SCHOOL_IMPORT_CONFIG.private);
}

function _siRenderPreview(cfg) {
  const counts = _siPreviewRows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  document.getElementById('si_previewCount').textContent = _siPreviewRows.length;

  const parts = [`<span style="color:var(--ok)"><i class="bi bi-check-circle"></i> ${counts.ok || 0} ready to ${cfg.updateOnly ? 'update' : 'import'}</span>`];
  if (cfg.updateOnly) {
    parts.push(`<span style="color:var(--warn)"><i class="bi bi-question-circle"></i> ${counts.notfound || 0} Emis not found</span>`);
    parts.push(`<span style="color:var(--warn)"><i class="bi bi-geo-alt"></i> ${counts.outside || 0} outside your jurisdiction</span>`);
  } else {
    parts.push(`<span style="color:var(--warn)"><i class="bi bi-copy"></i> ${counts.duplicate || 0} already exist</span>`);
  }
  parts.push(`<span style="color:var(--bad)"><i class="bi bi-exclamation-triangle"></i> ${counts.missing || 0} missing required info</span>`);
  document.getElementById('si_previewSummary').innerHTML = parts.join(' &nbsp;·&nbsp; ') + ' <span style="color:var(--t3)">(non-ready rows are skipped, not errored)</span>';

  const badge = { ok: 'var(--ok)', duplicate: 'var(--warn)', notfound: 'var(--warn)', outside: 'var(--warn)', missing: 'var(--bad)' };
  const statusLabel = { ok: cfg.updateOnly ? '✓ Will update' : '✓ Ready', duplicate: 'Duplicate name', notfound: 'Emis not found', outside: 'Outside jurisdiction' };
  const showJurPicker = _siKind === 'private' && _siJurMode.mode === 'multi';

  document.getElementById('si_previewBody').innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:.78rem">
      <thead><tr style="border-bottom:2px solid var(--b0);text-align:left">
        <th style="padding:6px">Status</th>
        ${cfg.updateOnly ? '<th style="padding:6px">Emis</th>' : ''}
        <th style="padding:6px">School Name</th>
        ${showJurPicker ? '<th style="padding:6px;min-width:220px">Your Jurisdiction</th>' : '<th style="padding:6px">District</th><th style="padding:6px">Tehsil</th><th style="padding:6px">Markaz</th>'}
      </tr></thead>
      <tbody>
        ${_siPreviewRows.map((r, idx) => `
          <tr style="border-bottom:1px solid var(--b0);${r.status === 'ok' ? '' : 'opacity:.7'}">
            <td style="padding:6px;color:${badge[r.status]};font-weight:700;white-space:nowrap">
              ${statusLabel[r.status] || ('Missing: ' + r.missing.join(', '))}
            </td>
            ${cfg.updateOnly ? `<td style="padding:6px">${escHtml(r.row['Emis'])}</td>` : ''}
            <td style="padding:6px">${escHtml(r.row['School Name'])}</td>
            ${showJurPicker
              ? `<td style="padding:6px">
                   <select onchange="siOnRowJurisdictionChange(${idx}, this.value)" style="width:100%;height:30px;border:1px solid var(--b0);border-radius:5px;font-size:.76rem">
                     ${_siJurMode.jur.map((j, ji) => `<option value="${ji}" ${ji === r.jurIndex ? 'selected' : ''}>${escHtml(_siJurLabel(j))}</option>`).join('')}
                   </select>
                 </td>`
              : `<td style="padding:6px">${escHtml(r.location.district || '')}</td><td style="padding:6px">${escHtml(r.location.tehsil || '')}</td><td style="padding:6px">${escHtml(r.location.markaz_name || '')}</td>`}
          </tr>`).join('')}
      </tbody>
    </table>`;

  document.getElementById('si_step2').style.display = 'none';
  document.getElementById('si_step3').style.display = 'block';
  document.getElementById('si_previewBtn').style.display = 'none';
  document.getElementById('si_confirmBtn').style.display = 'inline-block';
  document.getElementById('si_confirmBtn').innerHTML = `<i class="bi bi-check2-circle"></i> ${cfg.confirmLabel}`;
}

// ── Step 4: confirm — update (public) or insert (private) the "ok" rows ──
async function confirmSchoolImport() {
  const cfg = SCHOOL_IMPORT_CONFIG[_siKind];
  const reverseMap = Object.fromEntries(Object.entries(cfg.colMap()).map(([col, header]) => [header, col]));
  const toApply = _siPreviewRows.filter(r => r.status === 'ok');

  const btn = document.getElementById('si_confirmBtn');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> ${cfg.updateOnly ? 'Updating…' : 'Importing…'}`;

  let done = 0, failed = 0;
  for (const item of toApply) {
    const dbRow = {};
    for (const [header, val] of Object.entries(item.row)) {
      if (_siKind === 'private' && SI_LOCATION_HEADERS.includes(header)) continue;
      const col = reverseMap[header];
      if (col && val !== '') dbRow[col] = val;
    }
    dbRow.updated_at = new Date().toISOString();

    if (cfg.updateOnly) {
      const { error } = await _sb.from(cfg.table).update(dbRow).eq(cfg.uniqueCol, item.uniqueVal);
      if (error) failed++; else done++;
    } else {
      dbRow.district = item.location.district;
      dbRow.tehsil = item.location.tehsil;
      dbRow.markaz_name = item.location.markaz_name;
      dbRow.status = dbRow.status || 'Active';
      const year = new Date().getFullYear();
      dbRow.unique_id = `PS-${year}-` + Array.from({ length: 8 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('');
      let { error } = await _sb.from(cfg.table).insert([dbRow]);
      if (error && error.code === '23505') {
        dbRow.unique_id = `PS-${year}-` + Array.from({ length: 8 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('');
        ({ error } = await _sb.from(cfg.table).insert([dbRow]));
      }
      if (error) failed++; else done++;
    }
  }

  btn.disabled = false;
  btn.innerHTML = `<i class="bi bi-check2-circle"></i> ${cfg.confirmLabel}`;

  const skipped = _siPreviewRows.length - toApply.length;
  const verb = cfg.updateOnly ? 'Updated' : 'Imported';
  showToast(`${verb} ${done} record(s)${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}.`, failed === 0);
  if (done > 0) {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('schoolImportModal')).hide();
    cfg.reload();
  }
}
