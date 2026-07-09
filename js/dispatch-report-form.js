/**
 * Report Dispatch System — Write Report form logic.
 * Depends on: _sb, currentUser, showToast, escHtml, bootstrap (all
 * already global via api.js/index.js), plus html2canvas + jsPDF
 * (loaded via CDN — see index.html changes).
 */

let reportLanguage = 'en';
let reportAttachments = []; // [{file, compressedBlob, name, type, size}]
let reportSchoolMatch = null; // { district, wing, tehsil, markaz, emis }
let draftAutosaveTimer = null;

const DRAFT_KEY = 'dispatchReportDraft';

// ── Language toggle ────────────────────────────────────────────────
function setReportLanguage(lang) {
  reportLanguage = lang;
  document.getElementById('langBtnEn').classList.toggle('btn-primary', lang === 'en');
  document.getElementById('langBtnEn').classList.toggle('btn-outline-secondary', lang !== 'en');
  document.getElementById('langBtnUr').classList.toggle('btn-primary', lang === 'ur');
  document.getElementById('langBtnUr').classList.toggle('btn-outline-secondary', lang !== 'ur');

  const desc = document.getElementById('rpt_description');
  const rem = document.getElementById('rpt_remarks');
  [desc, rem].forEach(el => {
    el.dir = lang === 'ur' ? 'rtl' : 'ltr';
    el.style.fontFamily = lang === 'ur' ? "'Noto Nastaliq Urdu', serif" : "inherit";
    el.style.textAlign = lang === 'ur' ? 'right' : 'left';
  });
  scheduleDraftAutosave();
}

// ── Opening the form ───────────────────────────────────────────────
function openWriteReportModal() {
  getGoogleConnectionStatus(status => {
    if (!status.connected) {
      showToast('Please connect your Google account first (My Profile → Report Dispatch).', false);
      bootstrap.Modal.getOrCreateInstance(document.getElementById('googleConnectModal')).show();
      return;
    }
    if (!status.signature_url) {
      showToast('Please upload your signature first (My Profile → Report Dispatch).', false);
      bootstrap.Modal.getOrCreateInstance(document.getElementById('googleConnectModal')).show();
      return;
    }
    _reportGoogleStatus = status;
    _actuallyOpenWriteReportModal();
  });
}

let _reportGoogleStatus = null;

function _actuallyOpenWriteReportModal() {
  const modalEl = document.getElementById('writeReportModal');
  bootstrap.Modal.getOrCreateInstance(modalEl).show();

  document.getElementById('rpt_date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('rpt_dispatchPreview').value = 'Assigned when sent';
  reportAttachments = [];
  document.getElementById('rpt_attachmentsList').innerHTML = '';
  setReportLanguage('en');

  loadDispatchContacts().then(contacts => {
    const picker = document.getElementById('rpt_contactPicker');
    picker.innerHTML = contacts.map(c =>
      `<option value="${c.id}">${escHtml(c.name)}${c.office ? ' — ' + escHtml(c.office) : ''}</option>`
    ).join('');
  });

  _restoreDraftIfAny();
  onReportDateChange();
}

// ── EMIS lookup (reuses the existing school hierarchy cache already
//    built elsewhere in the app — hrSchoolCache / schoolCache) ──────
function clearReportSchoolLookup() {
  reportSchoolMatch = null;
  document.getElementById('rpt_schoolName').value = '';
  document.getElementById('rpt_emisStatus').textContent = '';
}

function onReportEmisInput() {
  const emis = document.getElementById('rpt_emis').value.trim();
  const statusEl = document.getElementById('rpt_emisStatus');
  const nameEl = document.getElementById('rpt_schoolName');
  if (!emis) { clearReportSchoolLookup(); return; }

  const pool = (typeof hrSchoolCache !== 'undefined' && hrSchoolCache.length) ? hrSchoolCache
             : (typeof schoolCache !== 'undefined' ? schoolCache : []);
  const match = pool.find(s => s.e && s.e.toString().trim() === emis);

  if (match) {
    reportSchoolMatch = match;
    nameEl.value = `${match.m || ''} (${match.d || ''})`;
    statusEl.textContent = '✓ School found';
    statusEl.style.color = 'var(--ok)';
  } else {
    reportSchoolMatch = null;
    nameEl.value = '';
    statusEl.textContent = 'EMIS not found in records';
    statusEl.style.color = 'var(--warn)';
  }
  scheduleDraftAutosave();
}

// ── Dispatch number preview (informational only — the real number is
//    claimed atomically at send time, never before) ─────────────────
async function onReportDateChange() {
  const dateVal = document.getElementById('rpt_date').value;
  const hintEl = document.getElementById('rpt_dateHint');
  if (!dateVal) { hintEl.textContent = ''; return; }

  const year = new Date(dateVal).getFullYear();
  const currentYear = new Date().getFullYear();
  const markaz = currentUser.markaz_name || currentUser.markaz || '';

  if (year === currentYear) {
    hintEl.textContent = 'The next dispatch number for your Markaz will be assigned automatically.';
    scheduleDraftAutosave();
    return;
  }

  const { data } = await _sb.from('dispatch_counters').select('last_number').eq('markaz_name', markaz).eq('year', year).maybeSingle();
  const maxUsed = data ? data.last_number : 0;
  hintEl.textContent = `Backdated to ${year}: highest dispatch number already used for your Markaz that year is ${String(maxUsed).padStart(3, '0')}. The next one sent will continue from there.`;
  scheduleDraftAutosave();
}

// ── Attachments (images + PDF only, compressed before upload) ───────
async function onAttachmentsSelected(input) {
  const files = Array.from(input.files || []);
  for (const file of files) {
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    if (!isImage && !isPdf) {
      showToast(`"${file.name}" skipped — only images and PDFs are allowed.`, false);
      continue;
    }
    const compressedBlob = isImage ? await _compressImage(file) : file;
    reportAttachments.push({
      file, blob: compressedBlob, name: file.name, type: file.type,
      originalSize: file.size, finalSize: compressedBlob.size,
    });
  }
  input.value = '';
  _renderAttachmentsList();
}

function _compressImage(file, maxDim = 1600, quality = 0.72) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function _renderAttachmentsList() {
  const box = document.getElementById('rpt_attachmentsList');
  box.innerHTML = reportAttachments.map((a, i) => {
    const savedPct = a.originalSize > a.finalSize ? Math.round((1 - a.finalSize / a.originalSize) * 100) : 0;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border:1px solid var(--b0);border-radius:6px;margin-bottom:4px;font-size:.8rem">
      <span><i class="bi bi-${a.type === 'application/pdf' ? 'file-earmark-pdf' : 'image'}"></i> ${escHtml(a.name)}
        <span style="color:var(--t3)">(${(a.finalSize / 1024).toFixed(0)}KB${savedPct > 0 ? ', ' + savedPct + '% smaller' : ''})</span></span>
      <button type="button" onclick="removeReportAttachment(${i})" style="border:none;background:none;color:var(--bad);cursor:pointer"><i class="bi bi-x-lg"></i></button>
    </div>`;
  }).join('');
}

function removeReportAttachment(i) {
  reportAttachments.splice(i, 1);
  _renderAttachmentsList();
}

// ── Draft autosave ───────────────────────────────────────────────────
function scheduleDraftAutosave() {
  clearTimeout(draftAutosaveTimer);
  draftAutosaveTimer = setTimeout(_saveDraft, 800);
}

function _saveDraft() {
  const draft = {
    language: reportLanguage,
    date: document.getElementById('rpt_date')?.value,
    category: document.getElementById('rpt_category')?.value,
    schoolType: document.getElementById('rpt_schoolType')?.value,
    emis: document.getElementById('rpt_emis')?.value,
    accused: document.getElementById('rpt_accused')?.value,
    description: document.getElementById('rpt_description')?.value,
    remarks: document.getElementById('rpt_remarks')?.value,
    savedAt: Date.now(),
  };
  localStorage.setItem(DRAFT_KEY + '_' + currentUser.id, JSON.stringify(draft));
  const statusEl = document.getElementById('rpt_draftStatus');
  if (statusEl) statusEl.textContent = 'Draft saved ' + new Date().toLocaleTimeString();
}

function _restoreDraftIfAny() {
  const raw = localStorage.getItem(DRAFT_KEY + '_' + currentUser.id);
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    setReportLanguage(d.language || 'en');
    if (d.date) document.getElementById('rpt_date').value = d.date;
    document.getElementById('rpt_category').value = d.category || '';
    document.getElementById('rpt_schoolType').value = d.schoolType || '';
    document.getElementById('rpt_emis').value = d.emis || '';
    document.getElementById('rpt_accused').value = d.accused || '';
    document.getElementById('rpt_description').value = d.description || '';
    document.getElementById('rpt_remarks').value = d.remarks || '';
    if (d.emis) onReportEmisInput();
  } catch (e) { /* ignore a corrupt draft */ }
}

function _clearDraft() {
  localStorage.removeItem(DRAFT_KEY + '_' + currentUser.id);
}

// ── Report HTML template — the SAME markup is used for both the
//    on-screen Preview and the actual PDF (rendered via html2canvas),
//    guaranteeing what you preview is exactly what gets sent. ────────
function buildReportTemplateHtml() {
  const isUr = reportLanguage === 'ur';
  const dir = isUr ? 'rtl' : 'ltr';
  const font = isUr ? "'Noto Nastaliq Urdu', serif" : "'Segoe UI', Arial, sans-serif";
  const stampAlign = isUr ? 'left' : 'right';

  const date = document.getElementById('rpt_date').value;
  const category = document.getElementById('rpt_category').value;
  const schoolType = document.getElementById('rpt_schoolType').value;
  const emis = document.getElementById('rpt_emis').value;
  const schoolName = document.getElementById('rpt_schoolName').value;
  const accused = document.getElementById('rpt_accused').value;
  const description = document.getElementById('rpt_description').value;
  const remarks = document.getElementById('rpt_remarks').value;

  const name = currentUser.name || '';
  const designation = currentUser.designation || '';
  const markaz = currentUser.markaz_name || currentUser.markaz || '';
  const sigUrl = (_reportGoogleStatus && _reportGoogleStatus.signature_url) || '';

  return `
    <div style="direction:${dir};font-family:${font};padding:48px 56px;width:794px;box-sizing:border-box;color:#1a1a1a;line-height:1.8">
      <div style="text-align:center;border-bottom:2px solid #0B6E4F;padding-bottom:14px;margin-bottom:24px">
        <div style="font-size:1.3rem;font-weight:700;color:#0B6E4F">${isUr ? 'رپورٹ' : 'OFFICIAL REPORT'}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:.92rem">
        <tr><td style="padding:4px 0;font-weight:700;width:160px">${isUr ? 'تاریخ' : 'Date'}:</td><td>${escHtml(date)}</td></tr>
        ${category ? `<tr><td style="padding:4px 0;font-weight:700">${isUr ? 'قسم' : 'Category'}:</td><td>${escHtml(category)}</td></tr>` : ''}
        ${schoolType ? `<tr><td style="padding:4px 0;font-weight:700">${isUr ? 'اسکول کی قسم' : 'School Type'}:</td><td>${escHtml(schoolType)}</td></tr>` : ''}
        ${emis ? `<tr><td style="padding:4px 0;font-weight:700">EMIS:</td><td>${escHtml(emis)} ${schoolName ? '— ' + escHtml(schoolName) : ''}</td></tr>` : ''}
        ${accused ? `<tr><td style="padding:4px 0;font-weight:700">${isUr ? 'ملوث شخص' : 'Accused / Concerned'}:</td><td>${escHtml(accused)}</td></tr>` : ''}
      </table>

      <div style="margin-bottom:20px">
        <div style="font-weight:700;margin-bottom:6px">${isUr ? 'تفصیل' : 'Description'}:</div>
        <div style="white-space:pre-wrap;text-align:${isUr ? 'right' : 'left'}">${escHtml(description)}</div>
      </div>

      ${remarks ? `<div style="margin-bottom:20px">
        <div style="font-weight:700;margin-bottom:6px">${isUr ? 'تبصرہ' : 'Remarks'}:</div>
        <div style="white-space:pre-wrap;text-align:${isUr ? 'right' : 'left'}">${escHtml(remarks)}</div>
      </div>` : ''}

      <div style="margin-top:60px;display:flex;justify-content:${stampAlign === 'right' ? 'flex-end' : 'flex-start'}">
        <div style="position:relative;width:220px;text-align:center">
          <div style="border:2px solid #0B6E4F;border-radius:6px;padding:14px 10px;font-size:.8rem;color:#0B6E4F">
            <div style="font-weight:700">${escHtml(name)}</div>
            <div>${escHtml(designation)}</div>
            <div>${escHtml(markaz)}</div>
          </div>
          ${sigUrl ? `<img src="${sigUrl}" crossorigin="anonymous" style="position:absolute;top:-24px;left:50%;transform:translateX(-50%);max-height:70px;max-width:180px">` : ''}
        </div>
      </div>
    </div>
  `;
}

function previewReport() {
  document.getElementById('reportPreviewContainer').innerHTML = buildReportTemplateHtml();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('reportPreviewModal')).show();
}

async function generateReportPdfBlob() {
  const target = document.getElementById('reportPdfRenderTarget');
  target.innerHTML = buildReportTemplateHtml();

  // Give any external image (the signature) a moment to load before capture.
  await new Promise(r => setTimeout(r, 400));

  const canvas = await html2canvas(target, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgProps = { width: canvas.width, height: canvas.height };
  const ratio = pageWidth / imgProps.width;
  const scaledHeight = imgProps.height * ratio;

  let heightLeft = scaledHeight;
  let position = 0;
  const imgData = canvas.toDataURL('image/jpeg', 0.85);

  pdf.addImage(imgData, 'JPEG', 0, position, pageWidth, scaledHeight);
  heightLeft -= pageHeight;
  while (heightLeft > 0) {
    position = heightLeft - scaledHeight;
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, position, pageWidth, scaledHeight);
    heightLeft -= pageHeight;
  }

  target.innerHTML = '';
  return pdf.output('blob');
}

function _blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]); // strip data: prefix
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Sign & Send — the full orchestration ─────────────────────────────
async function signAndSendReport() {
  const date = document.getElementById('rpt_date').value;
  const description = document.getElementById('rpt_description').value.trim();
  const selectedContactIds = Array.from(document.getElementById('rpt_contactPicker').selectedOptions).map(o => o.value);

  if (!date) { showToast('Date is required.', false); return; }
  if (!description) { showToast('Description is required.', false); return; }
  if (!selectedContactIds.length) { showToast('Select at least one recipient.', false); return; }

  const btn = document.getElementById('rpt_signSendBtn');
  btn.disabled = true; // prevent double-submission / duplicate dispatch numbers
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Sending…';

  try {
    const markaz = currentUser.markaz_name || currentUser.markaz || '';
    const year = new Date(date).getFullYear();

    // 1. Atomically claim the dispatch number FIRST — once claimed, it
    //    stays associated with this report even if sending needs a retry.
    const { data: seqData, error: seqErr } = await _sb.rpc('get_next_dispatch_number', { p_markaz: markaz, p_year: year });
    if (seqErr) throw new Error('Could not assign a dispatch number: ' + seqErr.message);
    const seq = seqData;
    const dispatchNumber = `${String(seq).padStart(3, '0')}/${markaz}/${year}`;
    document.getElementById('rpt_dispatchPreview').value = dispatchNumber;

    // 2. Build the recipient list from selected contacts
    const selectedContacts = dispatchContactsCache.filter(c => selectedContactIds.includes(c.id));
    const recipients = {
      to: [...new Set(selectedContacts.flatMap(c => c.emails_to))],
      cc: [...new Set(selectedContacts.flatMap(c => c.emails_cc))],
      bcc: [...new Set(selectedContacts.flatMap(c => c.emails_bcc))],
    };

    // 3. Create the report row (status: sending) — this is what makes
    //    the claimed number safely retryable if the next steps fail.
    const { data: reportRow, error: insertErr } = await _sb.from('dispatch_reports').insert([{
      dispatch_seq: seq,
      dispatch_number: dispatchNumber,
      dispatch_year: year,
      sender_id: currentUser.id,
      sender_name: currentUser.name,
      sender_designation: currentUser.designation || '',
      sender_markaz: markaz,
      report_date: date,
      language: reportLanguage,
      category: document.getElementById('rpt_category').value.trim(),
      school_type: document.getElementById('rpt_schoolType').value,
      school_emis: document.getElementById('rpt_emis').value.trim(),
      school_name: document.getElementById('rpt_schoolName').value,
      accused_name: document.getElementById('rpt_accused').value.trim(),
      description,
      remarks: document.getElementById('rpt_remarks').value.trim(),
      recipients: selectedContacts.map(c => ({ name: c.name, to: c.emails_to, cc: c.emails_cc, bcc: c.emails_bcc })),
      signature_url: (_reportGoogleStatus && _reportGoogleStatus.signature_url) || '',
      status: 'sending',
    }]).select().single();
    if (insertErr) throw new Error('Could not save the report: ' + insertErr.message);

    // 4. Generate the PDF and encode attachments
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating PDF…';
    const pdfBlob = await generateReportPdfBlob();
    const pdfBase64 = await _blobToBase64(pdfBlob);

    const attachmentsPayload = [];
    for (const a of reportAttachments) {
      attachmentsPayload.push({ name: a.name, mimeType: a.type, base64: await _blobToBase64(a.blob) });
    }

    // 5. Hand off to the Edge Function for the actual Drive upload + Gmail send
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Uploading &amp; sending…';
    const { data: { session } } = await _sb.auth.getSession();
    const res = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/dispatch-send-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
      body: JSON.stringify({
        reportId: reportRow.id,
        dispatchNumber, dispatchSeq: seq, dispatchYear: year,
        pdfBase64, attachments: attachmentsPayload, recipients,
        subject: `Report Dispatch — ${dispatchNumber}${document.getElementById('rpt_category').value ? ' — ' + document.getElementById('rpt_category').value : ''}`,
      }),
    });
    const result = await res.json();

    if (result.success) {
      showToast(`Report ${dispatchNumber} sent successfully.`, true);
      _clearDraft();
      bootstrap.Modal.getOrCreateInstance(document.getElementById('writeReportModal')).hide();
      if (typeof loadMyDispatchReports === 'function') loadMyDispatchReports();
    } else if (result.partial) {
      showToast(dispatchNumber + ': ' + result.message, false);
      _clearDraft();
      bootstrap.Modal.getOrCreateInstance(document.getElementById('writeReportModal')).hide();
    } else {
      showToast('Failed to send: ' + result.message, false);
    }
  } catch (e) {
    showToast(e.message || 'Failed to send report.', false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-send-check"></i> Sign &amp; Send';
  }
}
