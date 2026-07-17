/**
 * HR / Staff — "Template System" for uploading previous (historical)
 * employee data. Same shape as the Schools importer: download a
 * template → fill it in Excel/CSV → upload → map columns (auto-
 * matched if the template's own headers are still intact) → review →
 * confirm.
 *
 * MATCHING: an uploaded row is matched against an existing employee
 * by PERSONAL NO. first, then by CNIC. If a match is found, ONLY the
 * currently-blank fields on that existing record are filled in from
 * the sheet — anything already on file is left untouched. If no match
 * is found, the row is inserted as a brand-new employee.
 *
 * LOCATION: District/Wing/Tehsil/Markaz are never typed in the sheet
 * — they're looked up from SCHOOL EMIS CODE against the same school
 * directory the manual Add/Edit Staff form uses (sfmEmisMap), exactly
 * the way the manual form auto-fills them today.
 *
 * JURISDICTION: an admin can update any employee. Everyone else can
 * only touch employees whose school falls inside their own assigned
 * jurisdiction(s) — same District/Wing/Tehsil/Markaz check used
 * elsewhere in HR (_getUserJurisdictions / _schoolInJurisdiction).
 *
 * SANITIZING: CNIC, Cell No, WhatsApp No, Personal No, and School
 * EMIS Code are reduced to digits only. IBAN is reduced to letters
 * and digits only (no spaces/dashes). Every other text field has
 * special characters stripped, keeping only letters/numbers/spaces.
 * Email is left exactly as typed. Date fields are converted to the
 * system's YYYY-MM-DD format automatically; every converted date is
 * shown — editable — in the Review step so a bad conversion can be
 * fixed by hand before anything is saved.
 *
 * Depends on: STAFF_COL_MAP (js/api.js), _sb (js/api.js),
 * _getUserJurisdictions() / _schoolInJurisdiction() (js/hr_view.js),
 * sfmEmisMap / sfmEnsureSchoolCache() / toDateInputVal() (js/staffform.js),
 * the SheetJS XLSX global.
 */

// Which sanitizer applies to each column — anything not listed here
// defaults to 'text' (strip everything but letters/numbers/spaces).
const HR_FIELD_SANITIZER = {
  'CNIC': 'digits',
  'CELL NO': 'digits',
  'WHATSAPP NO.': 'digits',
  'PERSONAL NO.': 'digits',
  'SCHOOL EMIS CODE': 'digits',
  'SALARY ACCOUNT IBAN NO.': 'alnum',
  'EMAIL ID': 'none',
  'DATE OF BIRTH': 'date',
  'date of regularization': 'date',
  'DATE OF ENTRY IN GOVT- SERVICE': 'date',
  'DATE OF POSTING IN PRESENT SCHOOL': 'date',
  'DATE OF JOINING IN PRESENT SCALE': 'date',
  'DATE OF RETIREMENT': 'date',
};

const HR_DATE_HEADERS = Object.keys(HR_FIELD_SANITIZER).filter(h => HR_FIELD_SANITIZER[h] === 'date');

// Not asked for in the template — auto-derived (District/Wing/Tehsil/
// Markaz from EMIS) or system-managed (Status / Changes Made by / Time).
const HR_EXCLUDED_HEADERS = ['District', 'Wing', 'Tehsil', 'MARKAZ NAME', 'Status', 'Changes Made by', 'Time'];

let _hiRawRows = [];
let _hiHeaders = [];
let _hiMapping = {};
let _hiPreviewRows = [];

function _hiTemplateHeaders() {
  return Object.values(STAFF_COL_MAP).filter(h => !HR_EXCLUDED_HEADERS.includes(h));
}

function _hiSanitize(header, raw) {
  const v = (raw === undefined || raw === null) ? '' : String(raw).trim();
  if (!v) return { value: '', dateRaw: '' };
  const kind = HR_FIELD_SANITIZER[header] || 'text';
  if (kind === 'digits') return { value: v.replace(/\D/g, '') };
  if (kind === 'alnum')  return { value: v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() };
  if (kind === 'none')   return { value: v };
  if (kind === 'date') {
    const converted = (typeof toDateInputVal === 'function') ? (toDateInputVal(v) || '') : '';
    return { value: converted || v, dateRaw: v, dateOk: !!converted };
  }
  return { value: v.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim() };
}

// ── Step 0: download a ready-made template ─────────────────────────
function downloadHrImportTemplate() {
  const headers = _hiTemplateHeaders();
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(14, Math.min(28, h.length + 4)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Staff Import');
  XLSX.writeFile(wb, 'HR_Staff_Import_Template.xlsx');
}

// ── Open modal ───────────────────────────────────────────────────
function openHrImportModal() {
  _hiRawRows = []; _hiHeaders = []; _hiMapping = {}; _hiPreviewRows = [];

  document.getElementById('si_title').innerHTML = '<i class="bi bi-cloud-arrow-up-fill"></i> Update / Import Staff Data';
  document.getElementById('si_fileInput').value = '';
  document.getElementById('si_downloadTemplateBtn').onclick = downloadHrImportTemplate;
  document.getElementById('si_step1').style.display = 'block';
  document.getElementById('si_step2').style.display = 'none';
  document.getElementById('si_step3').style.display = 'none';
  document.getElementById('si_nextBtn').style.display = 'none';
  document.getElementById('si_previewBtn').style.display = 'none';
  document.getElementById('si_confirmBtn').style.display = 'none';
  document.getElementById('si_fileInput').onchange = function () { handleHrImportFileSelected(this); };
  document.getElementById('si_nextBtn').onclick = hrImportGoToMapping;
  document.getElementById('si_previewBtn').onclick = hrImportGoToPreview;
  document.getElementById('si_confirmBtn').onclick = confirmHrImport;

  const jur = (typeof _getUserJurisdictions === 'function') ? _getUserJurisdictions() : null;
  const scopeNote = document.getElementById('si_scopeNote');
  document.getElementById('si_instructions').textContent =
    'District/Wing/Tehsil/Markaz aren\'t in the template — they\'re looked up automatically from each employee\'s School EMIS Code. Matching an existing employee (by Personal No. or CNIC) only fills in that employee\'s BLANK fields; anything already on file is left as-is. An unmatched Personal No./CNIC is added as a new employee.';
  if (jur) {
    const parts = jur.map(j => [j.district, j.wing, j.tehsil, j.markaz].filter(Boolean).join(' → ') || 'All').join(' | ');
    scopeNote.innerHTML = `<i class="bi bi-shield-lock"></i> You can only update employees whose school is within your jurisdiction (<b>${escHtml(parts)}</b>) — others will be skipped.`;
    scopeNote.style.display = '';
  } else {
    scopeNote.style.display = 'none';
  }

  bootstrap.Modal.getOrCreateInstance(document.getElementById('schoolImportModal')).show();
}

// ── Step 1: read the uploaded file ──────────────────────────────
function handleHrImportFileSelected(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true, codepage: 65001 });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: false });
      if (!rows.length) { showToast('That file has no data rows.', false); return; }
      _hiRawRows = rows;
      _hiHeaders = Object.keys(rows[0]);
      document.getElementById('si_nextBtn').style.display = 'inline-block';
      showToast(`Loaded ${rows.length} rows with ${_hiHeaders.length} columns.`, true);
    } catch (err) {
      showToast('Could not read that file: ' + err.message, false);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ── Step 2: map columns ──────────────────────────────────────────
function hrImportGoToMapping() {
  if (!_hiRawRows.length) { showToast('Upload a file first.', false); return; }
  const targetHeaders = _hiTemplateHeaders();

  const box = document.getElementById('si_mappingBody');
  box.innerHTML = targetHeaders.map(h => {
    const required = (h === 'SCHOOL EMIS CODE' || h === 'NAME OF TEACHER' || h === 'PERSONAL NO.' || h === 'CNIC');
    return `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <label style="min-width:280px;font-size:.82rem">${escHtml(h)}${required ? ' <span style="color:var(--bad)">*</span>' : ''}</label>
      <select id="si_map_${_hiFieldId(h)}" style="flex:1;height:34px;border:1px solid var(--b0);border-radius:6px;padding:0 8px">
        <option value="">— None —</option>
        ${_hiHeaders.map(sh => `<option value="${escHtml(sh)}" ${_hiGuessColumn(h, sh) ? 'selected' : ''}>${escHtml(sh)}</option>`).join('')}
      </select>
    </div>`;
  }).join('');
  box.insertAdjacentHTML('afterbegin', `<div style="font-size:.76rem;color:var(--t3);margin-bottom:8px">Every row needs a School EMIS Code, a Name, and at least one of Personal No. / CNIC.</div>`);

  document.getElementById('si_step1').style.display = 'none';
  document.getElementById('si_step2').style.display = 'block';
  document.getElementById('si_nextBtn').style.display = 'none';
  document.getElementById('si_previewBtn').style.display = 'inline-block';
}

function _hiFieldId(header) { return header.replace(/[^a-zA-Z0-9]/g, '_'); }
function _hiGuessColumn(targetHeader, uploadedHeader) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(targetHeader) === norm(uploadedHeader);
}

// ── Step 3: preview — resolve EMIS, sanitize, match, review ─────────
function hrImportGoToPreview() {
  const targetHeaders = _hiTemplateHeaders();
  targetHeaders.forEach(h => { _hiMapping[h] = document.getElementById(`si_map_${_hiFieldId(h)}`).value; });

  if (!_hiMapping['SCHOOL EMIS CODE']) { showToast('Please map School EMIS Code.', false); return; }
  if (!_hiMapping['NAME OF TEACHER'])  { showToast('Please map Name of Teacher.', false); return; }
  if (!_hiMapping['PERSONAL NO.'] && !_hiMapping['CNIC']) {
    showToast('Please map at least one of Personal No. or CNIC.', false); return;
  }

  const previewBtn = document.getElementById('si_previewBtn');
  previewBtn.disabled = true;
  previewBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Checking existing employees…';

  if (typeof sfmEnsureSchoolCache === 'function') {
    sfmEnsureSchoolCache(() => _hiFetchExistingAndBuildPreview(targetHeaders).finally(() => {
      previewBtn.disabled = false;
      previewBtn.innerHTML = 'Next: Preview';
    }));
  } else {
    showToast('School directory isn\'t loaded yet — open HR once first, then retry.', false);
    previewBtn.disabled = false;
    previewBtn.innerHTML = 'Next: Preview';
  }
}

// Pulls every existing staff row, a page at a time. Deliberately NOT a
// single `.in('personal_no', [...thousands of values])` query — at a
// few thousand rows that filter list makes the request URL too long
// and Supabase/PostgREST rejects it, which was silently emptying the
// duplicate-check maps and making every row look "new" even when the
// employee was already on file.
async function _hiFetchAllStaff() {
  const PAGE = 1000;
  let from = 0, all = [];
  while (true) {
    const { data, error } = await _sb.from('staff').select('*').range(from, from + PAGE - 1);
    if (error) {
      showToast('Could not load existing staff for duplicate-checking: ' + error.message, false);
      break;
    }
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function _hiFetchExistingAndBuildPreview(targetHeaders) {
  const get = (raw, h) => _hiMapping[h] ? String(raw[_hiMapping[h]] || '').trim() : '';

  const allStaff = await _hiFetchAllStaff();
  const byPno = new Map(), byCnic = new Map();
  allStaff.forEach(r => {
    const pnoKey  = (r.personal_no !== null && r.personal_no !== undefined) ? String(r.personal_no).trim() : '';
    const cnicKey = (r.cnic !== null && r.cnic !== undefined) ? String(r.cnic).trim() : '';
    if (pnoKey)  byPno.set(pnoKey, r);
    if (cnicKey) byCnic.set(cnicKey, r);
  });

  const jur = (typeof _getUserJurisdictions === 'function') ? _getUserJurisdictions() : null;

  _hiPreviewRows = _hiRawRows.map(raw => {
    const sanitized = {};
    const dateFlags = {};
    targetHeaders.forEach(h => {
      const r = _hiSanitize(h, get(raw, h));
      sanitized[h] = r.value;
      if (HR_FIELD_SANITIZER[h] === 'date' && get(raw, h)) dateFlags[h] = { ok: r.dateOk, raw: r.dateRaw };
    });

    const emis = sanitized['SCHOOL EMIS CODE'];
    const pno  = sanitized['PERSONAL NO.'];
    const cnic = sanitized['CNIC'];
    const missing = [];
    if (!emis) missing.push('School EMIS Code');
    if (!sanitized['NAME OF TEACHER']) missing.push('Name of Teacher');
    if (!pno && !cnic) missing.push('Personal No. or CNIC');

    const existing = (pno && byPno.get(pno)) || (cnic && byCnic.get(cnic)) || null;
    const mode = existing ? 'update' : 'insert';

    const school = (emis && typeof sfmEmisMap !== 'undefined') ? sfmEmisMap[emis.toLowerCase()] : null;
    let status = 'ok';
    if (missing.length) status = 'missing';
    else if (!school) status = 'emis_notfound';
    else if (typeof _schoolInJurisdiction === 'function' && !_schoolInJurisdiction(school, jur)) status = 'outside';

    return {
      raw: sanitized, mode, existing, school, status, missing, dateFlags,
      key: pno || cnic,
    };
  });

  _hiRenderPreview();
}

function _hiRenderPreview() {
  const counts = _hiPreviewRows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const inserts = _hiPreviewRows.filter(r => r.status === 'ok' && r.mode === 'insert').length;
  const updates = _hiPreviewRows.filter(r => r.status === 'ok' && r.mode === 'update').length;

  document.getElementById('si_previewCount').textContent = _hiPreviewRows.length;
  document.getElementById('si_previewSummary').innerHTML = `
    <span style="color:var(--ok)"><i class="bi bi-check-circle"></i> ${updates} to update</span>
    &nbsp;·&nbsp; <span style="color:var(--ok)"><i class="bi bi-person-plus"></i> ${inserts} new employees</span>
    &nbsp;·&nbsp; <span style="color:var(--warn)"><i class="bi bi-question-circle"></i> ${counts.emis_notfound || 0} EMIS not found</span>
    &nbsp;·&nbsp; <span style="color:var(--warn)"><i class="bi bi-geo-alt"></i> ${counts.outside || 0} outside your jurisdiction</span>
    &nbsp;·&nbsp; <span style="color:var(--bad)"><i class="bi bi-exclamation-triangle"></i> ${counts.missing || 0} missing required info</span>
    <div style="color:var(--t3);margin-top:4px">Any converted date shown in red needs a quick check — click it to correct.</div>`;

  const badge = { ok: 'var(--ok)', emis_notfound: 'var(--warn)', outside: 'var(--warn)', missing: 'var(--bad)' };
  const statusLabel = { emis_notfound: 'EMIS not found', outside: 'Outside jurisdiction' };

  const mappedDateHeaders = HR_DATE_HEADERS.filter(h => _hiMapping[h]);

  document.getElementById('si_previewBody').innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:.76rem">
      <thead><tr style="border-bottom:2px solid var(--b0);text-align:left">
        <th style="padding:6px">Status</th><th style="padding:6px">Mode</th>
        <th style="padding:6px">Personal No.</th><th style="padding:6px">CNIC</th>
        <th style="padding:6px">Name</th><th style="padding:6px">EMIS</th>
        <th style="padding:6px">Location</th>
        ${mappedDateHeaders.map(h => `<th style="padding:6px;min-width:130px">${escHtml(h)}</th>`).join('')}
      </tr></thead>
      <tbody>
        ${_hiPreviewRows.map((r, idx) => `
          <tr style="border-bottom:1px solid var(--b0);${r.status === 'ok' ? '' : 'opacity:.7'}">
            <td style="padding:6px;color:${badge[r.status]};font-weight:700;white-space:nowrap">
              ${r.status === 'ok' ? (r.mode === 'insert' ? '✓ New' : '✓ Update') : (statusLabel[r.status] || ('Missing: ' + r.missing.join(', ')))}
            </td>
            <td style="padding:6px">${r.mode}</td>
            <td style="padding:6px">${escHtml(r.raw['PERSONAL NO.'] || '')}</td>
            <td style="padding:6px">${escHtml(r.raw['CNIC'] || '')}</td>
            <td style="padding:6px">${escHtml(r.raw['NAME OF TEACHER'] || '')}</td>
            <td style="padding:6px">${escHtml(r.raw['SCHOOL EMIS CODE'] || '')}</td>
            <td style="padding:6px">${r.school ? escHtml([r.school.d, r.school.w, r.school.t, r.school.m].filter(Boolean).join(' → ')) : '—'}</td>
            ${mappedDateHeaders.map(h => {
              const flag = r.dateFlags[h];
              const val = r.raw[h] || '';
              const needsCheck = flag && !flag.ok;
              return `<td style="padding:6px">
                <input type="date" value="${val && /^\d{4}-\d{2}-\d{2}$/.test(val) ? val : ''}"
                  onchange="hiOnDateEdit(${idx}, '${h.replace(/'/g, "\\'")}', this.value)"
                  style="width:100%;height:28px;border:1px solid ${needsCheck ? 'var(--bad)' : 'var(--b0)'};border-radius:5px;font-size:.74rem">
                ${needsCheck ? `<div style="color:var(--bad);font-size:.68rem">from "${escHtml(flag.raw)}" — please check</div>` : ''}
              </td>`;
            }).join('')}
          </tr>`).join('')}
      </tbody>
    </table>`;

  document.getElementById('si_step2').style.display = 'none';
  document.getElementById('si_step3').style.display = 'block';
  document.getElementById('si_previewBtn').style.display = 'none';
  document.getElementById('si_confirmBtn').style.display = 'inline-block';
  document.getElementById('si_confirmBtn').innerHTML = '<i class="bi bi-check2-circle"></i> Save These Records';
}

// Lets the reviewer hand-correct a date the automatic converter got
// wrong, right there in the review table, before anything is saved.
function hiOnDateEdit(idx, header, newValue) {
  const r = _hiPreviewRows[idx];
  r.raw[header] = newValue || '';
  if (r.dateFlags[header]) r.dateFlags[header].ok = true; // reviewer confirmed it
}

// ── Step 4: confirm ──────────────────────────────────────────────
function _hiBuildDbRow(item, reverseMap) {
  const dbRow = {};
  for (const [header, val] of Object.entries(item.raw)) {
    const col = reverseMap[header];
    if (!col || val === '') continue;
    if (item.mode === 'update' && item.existing && item.existing[col] !== null && item.existing[col] !== undefined && String(item.existing[col]).trim() !== '') {
      continue; // existing field already has a value — never overwrite it
    }
    dbRow[col] = val;
  }
  if (item.school) {
    dbRow.district = item.school.d || '';
    dbRow.wing = item.school.w || '';
    dbRow.tehsil = item.school.t || '';
    dbRow.markaz_name = item.school.m || '';
  }
  dbRow.changes_made_by = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.name : '';
  dbRow.changes_made_at = new Date().toISOString();
  return dbRow;
}

// Runs `worker` over `items` with up to `concurrency` requests in flight
// at once, instead of awaiting them one at a time — for thousands of
// rows this is the difference between ~30 minutes and ~a couple of
// minutes, since the browser is no longer sitting idle waiting for each
// single round-trip to Supabase before starting the next one.
async function _hiRunWithConcurrency(items, worker, concurrency) {
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
}

async function confirmHrImport() {
  const reverseMap = Object.fromEntries(Object.entries(STAFF_COL_MAP).map(([col, header]) => [header, col]));
  const toApply = _hiPreviewRows.filter(r => r.status === 'ok');
  const inserts = toApply.filter(r => r.mode === 'insert');
  const updates = toApply.filter(r => r.mode === 'update');
  const total = toApply.length;

  const btn = document.getElementById('si_confirmBtn');
  btn.disabled = true;
  let done = 0;
  const paint = () => { btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Saving… ${done} / ${total}`; };
  paint();

  let updated = 0, inserted = 0, failed = 0;

  // New employees don't need per-row logic (nothing to "leave untouched"
  // yet), so they go in as real batch inserts — hundreds of rows in a
  // single request instead of one request each.
  const INSERT_CHUNK = 500;
  for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
    const chunk = inserts.slice(i, i + INSERT_CHUNK).map(item => {
      const row = _hiBuildDbRow(item, reverseMap);
      row.status = 'active';
      return row;
    });
    const { error } = await _sb.from('staff').insert(chunk);
    if (error) failed += chunk.length; else inserted += chunk.length;
    done += chunk.length;
    paint();
  }

  // Updates each fill in a different set of blank columns per employee,
  // so they can't be batched into one request the way inserts can — but
  // running many of them at once (instead of one at a time) is still a
  // large speedup.
  await _hiRunWithConcurrency(updates, async (item) => {
    const dbRow = _hiBuildDbRow(item, reverseMap);
    delete dbRow.personal_no; // never overwrite the primary key
    const { error } = await _sb.from('staff').update(dbRow).eq('personal_no', item.existing.personal_no);
    if (error) failed++; else updated++;
    done++;
    paint();
  }, 20);

  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-check2-circle"></i> Save These Records';

  const skipped = _hiPreviewRows.length - toApply.length;
  showToast(`Updated ${updated}, added ${inserted}${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}.`, failed === 0);
  if (updated + inserted > 0) {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('schoolImportModal')).hide();
    if (typeof hrSheetDataCache !== 'undefined') delete hrSheetDataCache['Staff'];
    if (typeof hrStaffFullRows !== 'undefined') hrStaffFullRows = [];
    if (typeof applyHrFilter === 'function') applyHrFilter();
  }
}
