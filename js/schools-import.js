/**
 * Public / Private Schools — "Template System" for uploading previous
 * (historical) data. Same shape as the Report Dispatch bulk importer:
 * download a template → fill it in Excel/CSV → upload → map columns
 * (auto-matched if the template's own headers are still intact) →
 * preview → confirm.
 *
 * Available to ANY logged-in user, not just admins — but every row is
 * checked against that user's own assigned jurisdiction (District /
 * Wing / Tehsil / Markaz) before it's allowed to import, using the
 * same _getUserJurisdictions() helper the HR module already uses for
 * jurisdiction-based visibility. Admins (jurisdictions === null) can
 * import for any jurisdiction. A District/Wing/Tehsil/Markaz value
 * that doesn't already exist elsewhere in the system is NOT an error —
 * it's simply saved as-is (schools have no separate "locations" table,
 * so a new Markaz name, say, just becomes part of the school row and
 * will show up in jurisdiction dropdowns from then on).
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
    // Fields a row can't be imported without.
    requiredHeaders: ['Emis', 'School Name', 'District', 'Wing', 'Tehsil', 'Markaz Name'],
    templateFile: 'Public_Schools_Import_Template.xlsx',
    reload: () => { if (typeof openPublicModule === 'function' && typeof currentPubSheet !== 'undefined') openPublicModule(currentPubSheet || 'Public'); },
  },
  private: {
    label: 'Private Schools',
    table: 'private_schools',
    colMap: () => PRIV_COL_MAP,
    uniqueCol: 'unique_id', uniqueHeader: 'Unique ID',
    hasWing: false, // private_schools has no Wing column in this system
    requiredHeaders: ['Unique ID', 'School Name', 'District', 'Tehsil', 'Markaz Name'],
    templateFile: 'Private_Schools_Import_Template.xlsx',
    reload: () => { if (typeof openPrivateModule === 'function' && typeof currentPrivSheet !== 'undefined') openPrivateModule(currentPrivSheet || 'Active'); },
  },
};

let _siKind = 'public';       // 'public' | 'private' — which config is active
let _siRawRows = [];
let _siHeaders = [];
let _siMapping = {};          // targetHeader -> uploaded file's column header
let _siPreviewRows = [];      // normalized rows ready to review/import

// ── Step 0: download a ready-made template ─────────────────────────
function downloadSchoolImportTemplate(kind) {
  const cfg = SCHOOL_IMPORT_CONFIG[kind];
  if (!cfg) return;
  const headers = Object.values(cfg.colMap());
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(14, Math.min(28, h.length + 4)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, cfg.label.slice(0, 31));
  XLSX.writeFile(wb, cfg.templateFile);
}

// ── Open modal ───────────────────────────────────────────────────
function openSchoolImportModal(kind) {
  _siKind = kind;
  const cfg = SCHOOL_IMPORT_CONFIG[kind];
  _siRawRows = []; _siHeaders = []; _siMapping = {}; _siPreviewRows = [];

  document.getElementById('si_title').innerHTML =
    `<i class="bi bi-file-earmark-arrow-up"></i> Import Previous ${cfg.label} Data`;
  document.getElementById('si_fileInput').value = '';
  document.getElementById('si_downloadTemplateBtn').onclick = () => downloadSchoolImportTemplate(kind);
  document.getElementById('si_step1').style.display = 'block';
  document.getElementById('si_step2').style.display = 'none';
  document.getElementById('si_step3').style.display = 'none';
  document.getElementById('si_nextBtn').style.display = 'none';
  document.getElementById('si_previewBtn').style.display = 'none';
  document.getElementById('si_confirmBtn').style.display = 'none';

  const jur = (typeof _getUserJurisdictions === 'function') ? _getUserJurisdictions() : null;
  const scopeNote = document.getElementById('si_scopeNote');
  if (jur) {
    const parts = jur.map(j => [j.district, j.wing, j.tehsil, j.markaz].filter(Boolean).join(' → ') || 'All').join(' | ');
    scopeNote.innerHTML = `<i class="bi bi-shield-lock"></i> Rows outside your jurisdiction (<b>${escHtml(parts)}</b>) will be skipped automatically.`;
    scopeNote.style.display = '';
  } else {
    scopeNote.style.display = 'none'; // admin — no restriction note needed
  }

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
  const targetHeaders = Object.values(cfg.colMap());

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

// Since the template's own headers exactly match the DB's field
// headers, an unmodified re-upload auto-maps 100%; this normalized
// comparison also tolerates minor case/spacing/punctuation drift if
// the admin's own old sheet is close-but-not-identical.
function _siGuessColumn(targetHeader, uploadedHeader) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(targetHeader) === norm(uploadedHeader);
}

// ── Step 3: preview — validate required fields, jurisdiction, dupes ──
async function schoolImportGoToPreview() {
  const cfg = SCHOOL_IMPORT_CONFIG[_siKind];
  const targetHeaders = Object.values(cfg.colMap());
  targetHeaders.forEach(h => { _siMapping[h] = document.getElementById(`si_map_${_siFieldId(h)}`).value; });

  const missingRequired = cfg.requiredHeaders.filter(h => !_siMapping[h]);
  if (missingRequired.length) {
    showToast('Please map: ' + missingRequired.join(', '), false);
    return;
  }

  const jur = (typeof _getUserJurisdictions === 'function') ? _getUserJurisdictions() : null;

  // Pull existing unique-key values once, to flag duplicates in the preview
  // (skipped automatically on import rather than erroring the whole batch).
  const uploadedKeys = _siRawRows
    .map(r => String(r[_siMapping[cfg.uniqueHeader]] || '').trim())
    .filter(Boolean);
  let existingKeys = new Set();
  if (uploadedKeys.length) {
    const { data: existingRows } = await _sb.from(cfg.table).select(cfg.uniqueCol).in(cfg.uniqueCol, uploadedKeys);
    existingKeys = new Set((existingRows || []).map(r => String(r[cfg.uniqueCol])));
  }

  _siPreviewRows = _siRawRows.map(raw => {
    const get = (h) => _siMapping[h] ? String(raw[_siMapping[h]] || '').trim() : '';
    const row = {};
    targetHeaders.forEach(h => { row[h] = get(h); });

    const key = row[cfg.uniqueHeader];
    const missing = cfg.requiredHeaders.filter(h => !row[h]);
    const isDuplicate = key && existingKeys.has(key);

    const inJurisdiction = !jur || jur.some(j => {
      if (j.district && row['District'] !== j.district) return false;
      if (cfg.hasWing && j.wing && row['Wing'] !== j.wing) return false;
      if (j.tehsil && row['Tehsil'] !== j.tehsil) return false;
      if (j.markaz && row['Markaz Name'] !== j.markaz) return false;
      return true;
    });

    let status = 'ok';
    if (missing.length) status = 'missing';
    else if (isDuplicate) status = 'duplicate';
    else if (!inJurisdiction) status = 'outside';

    return { row, status, missing };
  });

  const counts = _siPreviewRows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  document.getElementById('si_previewCount').textContent = _siPreviewRows.length;
  document.getElementById('si_previewSummary').innerHTML = `
    <span style="color:var(--ok)"><i class="bi bi-check-circle"></i> ${counts.ok || 0} ready to import</span>
    &nbsp;·&nbsp; <span style="color:var(--warn)"><i class="bi bi-copy"></i> ${counts.duplicate || 0} already exist (will be skipped)</span>
    &nbsp;·&nbsp; <span style="color:var(--warn)"><i class="bi bi-geo-alt"></i> ${counts.outside || 0} outside your jurisdiction (will be skipped)</span>
    &nbsp;·&nbsp; <span style="color:var(--bad)"><i class="bi bi-exclamation-triangle"></i> ${counts.missing || 0} missing required fields (will be skipped)</span>`;

  const badge = { ok: 'var(--ok)', duplicate: 'var(--warn)', outside: 'var(--warn)', missing: 'var(--bad)' };
  document.getElementById('si_previewBody').innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:.78rem">
      <thead><tr style="border-bottom:2px solid var(--b0);text-align:left">
        <th style="padding:6px">Status</th><th style="padding:6px">${escHtml(cfg.uniqueHeader)}</th>
        <th style="padding:6px">School Name</th><th style="padding:6px">District</th>
        <th style="padding:6px">Tehsil</th><th style="padding:6px">Markaz</th>
      </tr></thead>
      <tbody>
        ${_siPreviewRows.map(r => `
          <tr style="border-bottom:1px solid var(--b0);${r.status === 'ok' ? '' : 'opacity:.6'}">
            <td style="padding:6px;color:${badge[r.status]};font-weight:700;white-space:nowrap">
              ${r.status === 'ok' ? '✓ Ready' : r.status === 'duplicate' ? 'Duplicate' : r.status === 'outside' ? 'Outside jurisdiction' : 'Missing: ' + r.missing.join(', ')}
            </td>
            <td style="padding:6px">${escHtml(r.row[cfg.uniqueHeader])}</td>
            <td style="padding:6px">${escHtml(r.row['School Name'])}</td>
            <td style="padding:6px">${escHtml(r.row['District'])}</td>
            <td style="padding:6px">${escHtml(r.row['Tehsil'])}</td>
            <td style="padding:6px">${escHtml(r.row['Markaz Name'])}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  document.getElementById('si_step2').style.display = 'none';
  document.getElementById('si_step3').style.display = 'block';
  document.getElementById('si_previewBtn').style.display = 'none';
  document.getElementById('si_confirmBtn').style.display = 'inline-block';
}

// ── Step 4: confirm — insert only the "ok" rows ─────────────────────
async function confirmSchoolImport() {
  const cfg = SCHOOL_IMPORT_CONFIG[_siKind];
  const reverseMap = Object.fromEntries(Object.entries(cfg.colMap()).map(([col, header]) => [header, col]));
  const toImport = _siPreviewRows.filter(r => r.status === 'ok');

  const btn = document.getElementById('si_confirmBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Importing…';

  let imported = 0, failed = 0;
  for (const { row } of toImport) {
    const dbRow = {};
    for (const [header, val] of Object.entries(row)) {
      const col = reverseMap[header];
      if (col && val !== '') dbRow[col] = val;
    }
    if (_siKind === 'public') dbRow.status = dbRow.status || 'Active';
    dbRow.updated_at = new Date().toISOString();

    const { error } = await _sb.from(cfg.table).insert([dbRow]);
    if (error) failed++; else imported++;
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-check2-circle"></i> Import These Records';

  const skipped = _siPreviewRows.length - toImport.length;
  showToast(`Imported ${imported} record(s)${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}.`, failed === 0);
  if (imported > 0) {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('schoolImportModal')).hide();
    cfg.reload();
  }
}
