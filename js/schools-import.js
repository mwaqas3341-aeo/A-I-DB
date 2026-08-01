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
 * Duplicates are detected by School Name AND Registeration No (either
 * one matching an existing record — or another row earlier in the same
 * file — is enough to flag it); names are compared with whitespace
 * collapsed so stray tabs/double-spaces in messy source files don't
 * slip past the check. Flagged rows default to filling in blank DB
 * cells only; the reviewer can tick "Add as new anyway" per row to
 * insert it as a separate record regardless.
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
    colMap: () => getPubColMap(),
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
    colMap: () => getPrivColMap(),
    hasWing: false, // private_schools has no Wing column in this system
    updateOnly: false,
    dupCheckHeader: 'School Name', // also cross-checked against Registeration No — see _siBuildPrivatePreview
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
      instructions = "Download the template below, fill in whatever historical records you have (leave columns blank if unknown), then upload it here. New schools are added as new records; a row that matches an existing school by School Name OR Registration No is flagged as a possible duplicate — its empty DB cells get filled in from the file (fields that already have a value are never overwritten), and it's not inserted as a second record unless you tick \"Add anyway\" on the Review step.";
      scopeNote.style.display = 'none';
    } else if (_siJurMode.mode === 'single') {
      const j = _siJurMode.jur[0];
      instructions = `District/Tehsil/Markaz aren't in the template — every row you upload will automatically be saved under your own jurisdiction (${_siJurLabel(j)}). Just fill in the school details. A row matching an existing school by School Name OR Registration No is flagged as a possible duplicate — its empty DB cells get filled in from the file, and it's not inserted as a second record unless you tick "Add anyway" on the Review step.`;
      scopeNote.style.display = 'none';
    } else {
      instructions = "You're assigned to more than one jurisdiction, so District/Tehsil/Markaz can't be guessed automatically — on the Review step you'll pick which of your assigned jurisdictions each row belongs to from a dropdown. A row matching an existing school by School Name OR Registration No is flagged as a possible duplicate — its empty DB cells get filled in from the file, and it's not inserted as a second record unless you tick \"Add anyway\".";
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
  const reverseMap = Object.fromEntries(Object.entries(cfg.colMap()).map(([col, header]) => [header, col]));

  let existingByEmis = new Map();
  if (uploadedKeys.length) {
    // Select every column the template can possibly map to (not just
    // the location columns) so real per-field diffing is possible —
    // previously only district/tehsil/markaz/wing were fetched, so
    // every other mapped column was blind-overwritten with whatever
    // was in the file, with no "keep existing" / "flag the conflict"
    // check at all.
    const cols = [...new Set(['emis', 'district', 'tehsil', 'markaz_name']
      .concat(cfg.hasWing ? ['wing'] : [])
      .concat(targetHeaders.map(h => reverseMap[h]).filter(Boolean)))];
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

    const diffs = (status === 'ok') ? _siComputeDiffs(row, existing, reverseMap, targetHeaders, []) : [];

    return { row, status, missing, uniqueVal: key, location: existing || {}, mode: 'update', existing, diffs };
  });
}

// Compares the uploaded (sanitized) row against the existing DB row,
// field by field, and returns only the fields whose imported value is
// non-blank AND differs from a non-blank existing value — i.e. the
// set that needs a human decision (Update All / Skip All) before
// being written. Blank imported cells and cells that already match
// are never included here; those are applied/skipped automatically.
function _siComputeDiffs(row, existing, reverseMap, targetHeaders, excludeHeaders) {
  const diffs = [];
  targetHeaders.forEach(h => {
    if (excludeHeaders.includes(h)) return;
    const col = reverseMap[h];
    if (!col) return;
    const incoming = (row[h] || '').toString().trim();
    if (!incoming) return; // blank upload -> never a conflict, existing value is kept
    const existingVal = (existing && existing[col] != null) ? String(existing[col]).trim() : '';
    if (!existingVal) return;               // existing blank -> fill in automatically, not a conflict
    if (existingVal === incoming) return;    // identical -> no-op
    diffs.push({ header: h, existing: existingVal, incoming });
  });
  return diffs;
}

async function _siBuildPrivatePreview(cfg, targetHeaders) {
  const get = (raw, h) => _siMapping[h] ? String(raw[_siMapping[h]] || '').trim() : '';
  const reverseMap = Object.fromEntries(Object.entries(cfg.colMap()).map(([col, header]) => [header, col]));

  // Collapse internal whitespace (stray tabs, double spaces from messy
  // source files) so "Foo  Bar" and "Foo Bar" are recognized as the
  // same school instead of silently creating a second record.
  const normName = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
  const REGNO_BLANKS = new Set(['', 'na', 'n/a', 'none', 'nil', '-', '--']);
  const normReg = s => {
    const v = (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
    return REGNO_BLANKS.has(v) ? '' : v;
  };

  // Fetch full existing rows (not just the name) so duplicates can be
  // diffed field-by-field and their blank cells filled in, instead of
  // just being flagged and skipped.
  const { data: existingRows } = await _sb.from(cfg.table).select('*');
  const existingByName = new Map();
  const existingByReg = new Map();
  (existingRows || []).forEach(r => {
    const n = normName(r.school_name);
    if (n) existingByName.set(n, r);
    const g = normReg(r.registration_no);
    if (g) existingByReg.set(g, r);
  });

  // Two rows in the SAME upload that share a name or reg no would both
  // sail through as "new" under a DB-only check — track what's already
  // been claimed earlier in this file so the second one gets flagged too.
  const seenNameInFile = new Map();
  const seenRegInFile = new Map();

  _siPreviewRows = _siRawRows.map((raw, rowIdx) => {
    const row = {};
    targetHeaders.forEach(h => { row[h] = get(raw, h); });
    const missing = cfg.requiredHeaders.filter(h => !row[h]);

    const nName = normName(row['School Name']);
    const nReg = normReg(row['Registeration No']);

    const dbNameHit = nName ? existingByName.get(nName) : null;
    const dbRegHit = nReg ? existingByReg.get(nReg) : null;
    const fileNameHitIdx = nName ? seenNameInFile.get(nName) : undefined;
    const fileRegHitIdx = nReg ? seenRegInFile.get(nReg) : undefined;

    const existing = dbNameHit || dbRegHit || null; // best DB record to diff/fill against
    const isDbDuplicate = !!(dbNameHit || dbRegHit);
    const isFileDuplicate = fileNameHitIdx !== undefined || fileRegHitIdx !== undefined;
    const isDuplicate = isDbDuplicate || isFileDuplicate;

    const dupReasons = [];
    if (dbNameHit) dupReasons.push('School Name matches an existing record');
    if (dbRegHit && dbRegHit !== dbNameHit) dupReasons.push(`Registration No "${row['Registeration No']}" matches an existing record`);
    if (isFileDuplicate) dupReasons.push(`Also appears earlier in this file (row ${((fileNameHitIdx ?? fileRegHitIdx)) + 2})`);

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

    // Location is only required for rows that will actually be inserted
    // as new records. Duplicates default to a "fill blank cells" action
    // (or, for a same-file-only duplicate with no DB match, to being
    // skipped) — neither needs location. It becomes required again the
    // moment the reviewer ticks "Add as new anyway" (see forceAdd toggle).
    const locMissingRaw = [];
    if (_siJurMode.mode === 'admin' && !location.district) locMissingRaw.push('District');
    if (_siJurMode.mode === 'admin' && !location.tehsil) locMissingRaw.push('Tehsil');
    if (!location.markaz_name) locMissingRaw.push('Markaz Name');
    const locMissing = isDuplicate ? [] : locMissingRaw;

    let status = 'ok';
    if (missing.length || locMissing.length) status = 'missing';
    else if (isDuplicate) status = 'duplicate';

    // For duplicates matched to a real existing DB record: figure out
    // which existing columns are blank and would get filled in, plus any
    // fields where both sides are non-blank but differ (a real conflict —
    // left untouched, never silently overwritten).
    let blankFields = [], diffs = [];
    if (existing) {
      targetHeaders.forEach(h => {
        if (h === 'School Name' || SI_LOCATION_HEADERS.includes(h)) return;
        const col = reverseMap[h];
        if (!col) return;
        const incoming = (row[h] || '').toString().trim();
        if (!incoming) return; // nothing uploaded for this cell -> nothing to do
        const existingVal = (existing[col] != null) ? String(existing[col]).trim() : '';
        if (!existingVal) blankFields.push(col);          // DB cell empty -> fill it in
        else if (existingVal !== incoming) diffs.push({ header: h, existing: existingVal, incoming }); // both set, differ -> leave alone
      });
    }

    if (nName && !seenNameInFile.has(nName)) seenNameInFile.set(nName, rowIdx);
    if (nReg && !seenRegInFile.has(nReg)) seenRegInFile.set(nReg, rowIdx);

    return {
      row, status, missing: missing.concat(locMissing), uniqueVal: row['School Name'], location, jurIndex,
      existing, blankFields, diffs, dupReasons, locMissingRaw,
      forceAdd: false, // reviewer can flip this on to insert a flagged row as a brand-new record anyway
    };
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
  const isDuplicate = r.status === 'duplicate';
  r.jurIndex = Number(newJurIndex);
  r.location = _siResolveJurEntry(_siJurMode.jur[r.jurIndex], r.row);
  r.locMissingRaw = r.location.markaz_name ? [] : ['Markaz Name'];
  const locMissing = isDuplicate ? [] : r.locMissingRaw;
  const baseMissing = SCHOOL_IMPORT_CONFIG.private.requiredHeaders.filter(h => !r.row[h]);
  r.missing = baseMissing.concat(locMissing);
  r.status = (baseMissing.length || locMissing.length) ? 'missing' : (isDuplicate ? 'duplicate' : 'ok');
  _siRenderPreview(SCHOOL_IMPORT_CONFIG.private);
}

function _siRenderPreview(cfg) {
  const counts = _siPreviewRows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  document.getElementById('si_previewCount').textContent = _siPreviewRows.length;

  const isPrivate = _siKind === 'private';
  const fillableDupes = _siPreviewRows.filter(r => r.status === 'duplicate' && !r.forceAdd && r.blankFields && r.blankFields.length).length;
  const forcedDupes = _siPreviewRows.filter(r => r.status === 'duplicate' && r.forceAdd).length;
  const noopDupes = (counts.duplicate || 0) - fillableDupes - forcedDupes;

  const parts = [`<span style="color:var(--ok)"><i class="bi bi-check-circle"></i> ${counts.ok || 0} ready to ${cfg.updateOnly ? 'update' : 'import'}</span>`];
  if (cfg.updateOnly) {
    parts.push(`<span style="color:var(--warn)"><i class="bi bi-question-circle"></i> ${counts.notfound || 0} Emis not found</span>`);
    parts.push(`<span style="color:var(--warn)"><i class="bi bi-geo-alt"></i> ${counts.outside || 0} outside your jurisdiction</span>`);
  } else {
    parts.push(`<span style="color:var(--warn)"><i class="bi bi-pencil-square"></i> ${fillableDupes} possible duplicate(s) — will fill empty cells only</span>`);
    if (forcedDupes) parts.push(`<span style="color:var(--ok)"><i class="bi bi-plus-circle"></i> ${forcedDupes} added anyway (your override)</span>`);
    if (noopDupes) parts.push(`<span style="color:var(--t3)"><i class="bi bi-copy"></i> ${noopDupes} already exist, nothing new to fill in</span>`);
  }
  parts.push(`<span style="color:var(--bad)"><i class="bi bi-exclamation-triangle"></i> ${counts.missing || 0} missing required info</span>`);
  document.getElementById('si_previewSummary').innerHTML = parts.join(' &nbsp;·&nbsp; ') + ' <span style="color:var(--t3)">(rows marked missing are skipped, not errored)</span>';

  const badge = { ok: 'var(--ok)', duplicate: 'var(--warn)', notfound: 'var(--warn)', outside: 'var(--warn)', missing: 'var(--bad)' };
  const statusLabel = {
    ok: cfg.updateOnly ? '✓ Will update' : '✓ Ready',
    notfound: 'Emis not found', outside: 'Outside jurisdiction',
  };
  const dupLabel = (r) => {
    if (r.forceAdd) return '✓ Adding as new (override)';
    if (r.blankFields && r.blankFields.length) return `Possible duplicate — filling ${r.blankFields.length} empty cell(s)`;
    return 'Possible duplicate — nothing new to fill';
  };
  const dupDetail = (r) => {
    const bits = (r.dupReasons || []).map(escHtml);
    if (r.existing) {
      const ex = r.existing;
      bits.push(`Existing record: ${escHtml([ex.district, ex.tehsil, ex.markaz_name].filter(Boolean).join(' → ') || '—')}${ex.registration_no ? `, Reg No ${escHtml(String(ex.registration_no))}` : ''}`);
    }
    return bits.join('<br>');
  };
  const showJurPicker = isPrivate && _siJurMode.mode === 'multi';

  document.getElementById('si_previewBody').innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:.78rem">
      <thead><tr style="border-bottom:2px solid var(--b0);text-align:left">
        <th style="padding:6px">Status</th>
        ${cfg.updateOnly ? '<th style="padding:6px">Emis</th>' : ''}
        <th style="padding:6px">School Name</th>
        ${showJurPicker ? '<th style="padding:6px;min-width:220px">Your Jurisdiction</th>' : '<th style="padding:6px">District</th><th style="padding:6px">Tehsil</th><th style="padding:6px">Markaz</th>'}
        ${isPrivate ? '<th style="padding:6px">Details</th><th style="padding:6px;text-align:center">Add anyway</th>' : ''}
      </tr></thead>
      <tbody>
        ${_siPreviewRows.map((r, idx) => {
          const willChange = r.status === 'ok' || (r.status === 'duplicate' && (r.forceAdd || (r.blankFields && r.blankFields.length)));
          return `
          <tr style="border-bottom:1px solid var(--b0);${willChange ? '' : 'opacity:.7'}">
            <td style="padding:6px;color:${badge[r.status]};font-weight:700;white-space:nowrap">
              ${r.status === 'duplicate' ? dupLabel(r) : (statusLabel[r.status] || ('Missing: ' + r.missing.join(', ')))}
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
            ${isPrivate ? `
            <td style="padding:6px;color:var(--t3);font-size:.72rem">${r.status === 'duplicate' ? dupDetail(r) : ''}</td>
            <td style="padding:6px;text-align:center">${r.status === 'duplicate' ? `<input type="checkbox" ${r.forceAdd ? 'checked' : ''} onchange="siToggleForcePrivateAdd(${idx}, this.checked)">` : ''}</td>` : ''}
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  document.getElementById('si_step2').style.display = 'none';
  document.getElementById('si_step3').style.display = 'block';
  document.getElementById('si_previewBtn').style.display = 'none';
  document.getElementById('si_confirmBtn').style.display = 'inline-block';
  document.getElementById('si_confirmBtn').innerHTML = `<i class="bi bi-check2-circle"></i> ${cfg.confirmLabel}`;
}

// Reviewer explicitly wants a flagged (possible-duplicate) row inserted
// as its own new record anyway — e.g. two genuinely different schools
// that happen to share a name, or a stale/reused registration number.
// This bypasses the fill-blanks path entirely for that row.
function siToggleForcePrivateAdd(idx, checked) {
  const r = _siPreviewRows[idx];
  if (checked) {
    // Forcing an insert means this row now needs everything a normal
    // new row needs, including location — which duplicates are normally
    // exempt from since they don't need it for a blanks-only fill.
    if (r.locMissingRaw && r.locMissingRaw.length) {
      showToast(`Can't add as new — missing: ${r.locMissingRaw.join(', ')}`, false);
      return;
    }
  }
  r.forceAdd = checked;
  _siRenderPreview(SCHOOL_IMPORT_CONFIG.private);
}

// ── Step 4: confirm — update (public) or insert (private) the "ok" rows ──
async function _siRunWithConcurrency(items, worker, concurrency) {
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
}

function _siGenId() {
  const year = new Date().getFullYear();
  return `PS-${year}-` + Array.from({ length: 8 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('');
}

async function confirmSchoolImport() {
  const cfg = SCHOOL_IMPORT_CONFIG[_siKind];
  const reverseMap = Object.fromEntries(Object.entries(cfg.colMap()).map(([col, header]) => [header, col]));
  // "ok" rows plus any duplicate the reviewer explicitly overrode with
  // "Add anyway" — both go through the normal insert path.
  const toInsert = _siPreviewRows.filter(r => r.status === 'ok' || (r.status === 'duplicate' && r.forceAdd));
  // Duplicates left un-overridden that have at least one blank DB cell
  // this file can fill in. Any field that already has a value in the DB
  // is left alone — only genuinely empty cells get written.
  const toFillBlanks = (_siKind === 'private')
    ? _siPreviewRows.filter(r => r.status === 'duplicate' && !r.forceAdd && r.blankFields && r.blankFields.length)
    : [];
  const total = toInsert.length + toFillBlanks.length;

  const btn = document.getElementById('si_confirmBtn');
  btn.disabled = true;
  let inserted = 0, updated = 0, failed = 0;
  const verbing = cfg.updateOnly ? 'Updating' : 'Importing';
  const paint = () => { btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> ${verbing}… ${inserted + updated + failed} / ${total}`; };
  paint();

  const buildRow = (item) => {
    const dbRow = {};
    for (const [header, val] of Object.entries(item.row)) {
      if (_siKind === 'private' && SI_LOCATION_HEADERS.includes(header)) continue;
      const col = reverseMap[header];
      if (col && val !== '') dbRow[col] = val;
    }
    dbRow.updated_at = new Date().toISOString();
    return dbRow;
  };

  if (cfg.updateOnly) {
    // Public: each row updates by its own Emis — different rows, same
    // request shape, but a real bulk "update many with different values"
    // isn't a single REST call, so these run many-at-once instead of
    // one-at-a-time, which is still a large speedup over fully sequential.
    await _siRunWithConcurrency(toInsert, async (item) => {
      const dbRow = buildRow(item);
      const { error } = await _sb.from(cfg.table).update(dbRow).eq(cfg.uniqueCol, item.uniqueVal);
      if (error) failed++; else updated++;
      paint();
    }, 20);
  } else {
    // Private: brand-new rows have nothing they depend on each other for,
    // so they go in as real batch inserts — hundreds per request instead
    // of one request per school. If a chunk fails (e.g. an astronomically
    // unlikely unique_id collision), fall back to inserting that chunk's
    // rows one at a time so a single bad row can't sink the whole batch.
    const CHUNK = 300;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunkItems = toInsert.slice(i, i + CHUNK);
      const chunkRows = chunkItems.map(item => {
        const dbRow = buildRow(item);
        dbRow.district = item.location.district;
        dbRow.tehsil = item.location.tehsil;
        dbRow.markaz_name = item.location.markaz_name;
        dbRow.status = dbRow.status || 'Active';
        dbRow.unique_id = _siGenId();
        return dbRow;
      });
      const { error } = await _sb.from(cfg.table).insert(chunkRows);
      if (!error) {
        inserted += chunkRows.length;
      } else {
        for (const row of chunkRows) {
          let { error: rowErr } = await _sb.from(cfg.table).insert([row]);
          if (rowErr && rowErr.code === '23505') {
            row.unique_id = _siGenId();
            ({ error: rowErr } = await _sb.from(cfg.table).insert([row]));
          }
          if (rowErr) failed++; else inserted++;
        }
      }
      paint();
    }

    // Duplicates: patch ONLY the columns that were blank in the DB and
    // non-blank in the uploaded file for that row. Never touches School
    // Name, District, Tehsil, Markaz, or any column that already had a
    // value — this is a fill-in-the-blanks, not an overwrite.
    await _siRunWithConcurrency(toFillBlanks, async (item) => {
      const patch = {};
      item.blankFields.forEach(col => {
        const header = cfg.colMap()[col];
        const val = (item.row[header] || '').toString().trim();
        if (val !== '') patch[col] = val;
      });
      if (!Object.keys(patch).length) { paint(); return; }
      patch.updated_at = new Date().toISOString();
      const q = _sb.from(cfg.table).update(patch);
      const { error } = item.existing.unique_id
        ? await q.eq('unique_id', item.existing.unique_id)
        : await q.eq('school_name', item.existing.school_name);
      if (error) failed++; else updated++;
      paint();
    }, 20);
  }

  btn.disabled = false;
  btn.innerHTML = `<i class="bi bi-check2-circle"></i> ${cfg.confirmLabel}`;

  const skipped = _siPreviewRows.length - toInsert.length - toFillBlanks.length;
  const verb = cfg.updateOnly ? 'Updated' : (toFillBlanks.length ? 'Imported/updated' : 'Imported');
  const parts = [];
  if (inserted) parts.push(`${inserted} new`);
  if (updated) parts.push(`${updated} ${cfg.updateOnly ? 'updated' : 'existing filled in'}`);
  if (failed) parts.push(`${failed} failed`);
  if (skipped) parts.push(`${skipped} skipped`);
  showToast(`${verb}: ${parts.join(', ') || 'nothing to do'}.`, failed === 0);
  if (inserted > 0 || updated > 0) {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('schoolImportModal')).hide();
    cfg.reload();
  }
}
