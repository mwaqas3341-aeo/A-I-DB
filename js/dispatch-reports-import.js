/**
 * Report Dispatch System — bulk import of previously-existing reports
 * (e.g. from an old Google Sheet register) into dispatch_reports.
 *
 * Flow: upload .xlsx/.xls/.csv (exported from the Google Sheet) → map
 * its columns to report fields → preview → confirm. Rows with a
 * Dispatch No. already present are kept exactly as-is (status
 * 'imported', is_imported = true) so historical numbers never change.
 * Rows with no Dispatch No. are assigned the next available number
 * for the importing user's Markaz/year, in date order. Either way,
 * the live counter is bumped afterwards so a future Sign & Send can
 * never collide with an imported number.
 *
 * Depends on the SheetJS `XLSX` global, already loaded in index.html.
 */

let _irRawRows = [];   // array of objects, keyed by the sheet's own headers
let _irHeaders = [];
let _irMapping = {};   // targetField -> sheet header (or '' for none)
let _irPreviewRows = []; // normalized rows ready to insert

const IR_FIELDS = [
  { key: 'dispatchNumber', label: 'Dispatch No. (leave unmapped to auto-assign)', required: false },
  { key: 'date', label: 'Date', required: true },
  { key: 'subject', label: 'Subject', required: false },
  { key: 'description', label: 'Description', required: true },
  { key: 'remarks', label: 'Remarks', required: false },
  { key: 'category', label: 'Category', required: false },
  { key: 'schoolName', label: 'School Name', required: false },
  { key: 'recipientName', label: 'Recipient / Office Name', required: false },
  { key: 'recipientOffice', label: 'Recipient Office (if separate)', required: false },
  { key: 'reportLink', label: 'Existing Report Link (Drive/PDF URL)', required: false },
];

function openImportReportsModal() {
  _irRawRows = []; _irHeaders = []; _irMapping = {}; _irPreviewRows = [];
  document.getElementById('ir_fileInput').value = '';
  document.getElementById('ir_step1').style.display = 'block';
  document.getElementById('ir_step2').style.display = 'none';
  document.getElementById('ir_step3').style.display = 'none';
  document.getElementById('ir_nextBtn').style.display = 'none';
  document.getElementById('ir_previewBtn').style.display = 'none';
  document.getElementById('ir_confirmBtn').style.display = 'none';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('importReportsModal')).show();
}

function handleImportFileSelected(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      // codepage: 65001 forces UTF-8 interpretation for CSV files without
      // a BOM — without this, SheetJS can misdetect the encoding and
      // corrupt non-ASCII text (this is exactly what corrupted the Urdu
      // rows from the very first import into unreadable "mojibake").
      // .xlsx files aren't affected either way since they don't have
      // this ambiguity, so this is a safe default for both.
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true, codepage: 65001 });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: false });
      if (!rows.length) { showToast('That file has no data rows.', false); return; }
      _irRawRows = rows;
      _irHeaders = Object.keys(rows[0]);
      document.getElementById('ir_nextBtn').style.display = 'inline-block';
      showToast(`Loaded ${rows.length} rows with ${_irHeaders.length} columns.`, true);
    } catch (err) {
      showToast('Could not read that file: ' + err.message, false);
    }
  };
  reader.readAsArrayBuffer(file);
}

function importReportsGoToMapping() {
  if (!_irRawRows.length) { showToast('Upload a file first.', false); return; }

  const box = document.getElementById('ir_mappingBody');
  box.innerHTML = IR_FIELDS.map(f => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <label style="min-width:260px;font-size:.85rem">${f.label}${f.required ? ' <span style="color:var(--bad)">*</span>' : ''}</label>
      <select id="ir_map_${f.key}" style="flex:1;height:36px;border:1px solid var(--b0);border-radius:6px;padding:0 8px">
        <option value="">— None —</option>
        ${_irHeaders.map(h => `<option value="${escHtml(h)}" ${_guessColumn(f.key, h) ? 'selected' : ''}>${escHtml(h)}</option>`).join('')}
      </select>
    </div>
  `).join('');

  document.getElementById('ir_step1').style.display = 'none';
  document.getElementById('ir_step2').style.display = 'block';
  document.getElementById('ir_nextBtn').style.display = 'none';
  document.getElementById('ir_previewBtn').style.display = 'inline-block';
}

// Best-effort auto-guess so the admin usually just has to confirm, not
// hand-map everything on every import.
function _guessColumn(fieldKey, header) {
  const h = header.toLowerCase();
  const guesses = {
    dispatchNumber: ['dispatch no', 'dispatch number', 'dispatch #', 'no.'],
    date: ['date'],
    subject: ['subject'],
    description: ['description', 'details', 'detail'],
    remarks: ['remarks', 'remark', 'notes'],
    category: ['category', 'type'],
    schoolName: ['school', 'school name'],
    recipientName: ['to', 'recipient', 'sent to', 'office'],
    recipientOffice: ['office name'],
    reportLink: ['link', 'drive', 'url', 'report link'],
  };
  return (guesses[fieldKey] || []).some(g => h.includes(g));
}

function importReportsGoToPreview() {
  IR_FIELDS.forEach(f => { _irMapping[f.key] = document.getElementById(`ir_map_${f.key}`).value; });

  const missingRequired = IR_FIELDS.filter(f => f.required && !_irMapping[f.key]);
  if (missingRequired.length) {
    showToast('Please map: ' + missingRequired.map(f => f.label).join(', '), false);
    return;
  }

  _irPreviewRows = _irRawRows.map(row => {
    const get = (key) => _irMapping[key] ? String(row[_irMapping[key]] || '').trim() : '';
    let dateVal = get('date');
    // SheetJS with cellDates:true may hand back a Date object toString'd already via defval/raw:false — normalize common formats
    const parsedDate = dateVal ? new Date(dateVal) : null;
    const isoDate = parsedDate && !isNaN(parsedDate) ? parsedDate.toISOString().slice(0, 10) : '';

    return {
      dispatchNumber: get('dispatchNumber'),
      date: isoDate || dateVal, // keep raw string as fallback so it's visible in preview even if unparseable
      subject: get('subject'),
      description: get('description'),
      remarks: get('remarks'),
      category: get('category'),
      schoolName: get('schoolName'),
      recipientName: get('recipientName'),
      recipientOffice: get('recipientOffice'),
      reportLink: get('reportLink'),
      _dateValid: !!isoDate,
    };
  });

  const invalidCount = _irPreviewRows.filter(r => !r._dateValid).length;
  document.getElementById('ir_previewCount').textContent = _irPreviewRows.length;
  document.getElementById('ir_previewBody').innerHTML = `
    ${invalidCount ? `<div style="padding:8px;color:var(--bad);font-size:.8rem"><i class="bi bi-exclamation-triangle"></i> ${invalidCount} row(s) have an unrecognized date and will be skipped on import.</div>` : ''}
    <table style="width:100%;border-collapse:collapse;font-size:.78rem">
      <thead><tr style="border-bottom:2px solid var(--b0);text-align:left">
        <th style="padding:6px">Dispatch No.</th><th style="padding:6px">Date</th><th style="padding:6px">Subject/Desc.</th><th style="padding:6px">Recipient</th><th style="padding:6px">Link</th>
      </tr></thead>
      <tbody>
        ${_irPreviewRows.map(r => `
          <tr style="border-bottom:1px solid var(--b0);${r._dateValid ? '' : 'opacity:.5'}">
            <td style="padding:6px">${escHtml(r.dispatchNumber || '(auto)')}</td>
            <td style="padding:6px">${escHtml(r.date)}</td>
            <td style="padding:6px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.subject || r.description)}</td>
            <td style="padding:6px">${escHtml(r.recipientName)}</td>
            <td style="padding:6px">${r.reportLink ? '<i class="bi bi-link-45deg"></i>' : ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.getElementById('ir_step2').style.display = 'none';
  document.getElementById('ir_step3').style.display = 'block';
  document.getElementById('ir_previewBtn').style.display = 'none';
  document.getElementById('ir_confirmBtn').style.display = 'inline-block';
}

async function confirmImportReports() {
  const btn = document.getElementById('ir_confirmBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Importing…';

  const markaz = currentUser.markaz_name || currentUser.markaz || '';
  const rows = _irPreviewRows.filter(r => r._dateValid).slice().sort((a, b) => a.date.localeCompare(b.date));

  let imported = 0, failed = 0;
  const maxSeqByYear = {}; // year -> highest numeric seq encountered, for the post-import counter bump

  for (const r of rows) {
    const year = new Date(r.date).getFullYear();
    let dispatchNumber = r.dispatchNumber;
    let dispatchSeq = null;

    if (dispatchNumber) {
      // Keep the legacy number exactly as it was in the sheet. Try to pull
      // out its leading numeric part so the post-import counter bump can
      // still take it into account; if it doesn't parse, that's fine —
      // it just won't influence the counter.
      const m = dispatchNumber.match(/^(\d+)/);
      if (m) dispatchSeq = parseInt(m[1], 10);
    } else {
      try {
        const { data: seqData, error: seqErr } = await _sb.rpc('get_next_dispatch_number', { p_markaz: markaz, p_year: year });
        if (seqErr) throw seqErr;
        dispatchSeq = seqData;
        dispatchNumber = `${dispatchSeq}/${markazInitials(markaz)}/${year}`;
      } catch (e) {
        failed++;
        continue;
      }
    }

    if (dispatchSeq != null) {
      maxSeqByYear[year] = Math.max(maxSeqByYear[year] || 0, dispatchSeq);
    }

    const recipients = r.recipientName
      ? [{ name: r.recipientName, office: r.recipientOffice || r.recipientName, to: [], cc: [], bcc: [] }]
      : [];

    const { error: insertErr } = await _sb.from('dispatch_reports').insert([{
      dispatch_seq: dispatchSeq,
      dispatch_number: dispatchNumber,
      dispatch_year: year,
      sender_id: currentUser.id,
      sender_name: currentUser.name,
      sender_designation: currentUser.designation || '',
      sender_markaz: markaz,
      report_date: r.date,
      language: 'en',
      category: r.category,
      school_name: r.schoolName,
      subject: r.subject || r.description.slice(0, 120),
      description: r.description,
      remarks: r.remarks,
      recipients,
      drive_file_link: r.reportLink || null,
      status: 'imported',
      is_imported: true,
    }]);

    if (insertErr) failed++; else imported++;
  }

  // Make sure no future live Sign & Send can collide with any imported number.
  for (const [year, seq] of Object.entries(maxSeqByYear)) {
    try {
      await _sb.rpc('bump_dispatch_counter', { p_markaz: markaz, p_year: parseInt(year, 10), p_at_least: seq });
    } catch (e) { /* best-effort — a duplicate-number retry at send time still catches this */ }
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-check2-circle"></i> Import These Reports';

  showToast(`Imported ${imported} report(s)${failed ? `, ${failed} failed` : ''}.`, failed === 0);
  if (imported > 0) {
    bootstrap.Modal.getOrCreateInstance(document.getElementById('importReportsModal')).hide();
    loadMyDispatchReports();
  }
}