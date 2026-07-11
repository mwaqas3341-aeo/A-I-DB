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
    subject: document.getElementById('rpt_subject')?.value,
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
    document.getElementById('rpt_subject').value = d.subject || '';
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
  const align = isUr ? 'right' : 'left';

  const dispatchNo = document.getElementById('rpt_dispatchPreview').value || '';
  const date = document.getElementById('rpt_date').value;
  const subject = document.getElementById('rpt_subject').value;
  const category = document.getElementById('rpt_category').value;
  const schoolType = document.getElementById('rpt_schoolType').value;
  const emis = document.getElementById('rpt_emis').value;
  const schoolName = document.getElementById('rpt_schoolName').value;
  const accused = document.getElementById('rpt_accused').value;
  const description = document.getElementById('rpt_description').value;
  const remarks = document.getElementById('rpt_remarks').value;

  const toOptions = Array.from(document.getElementById('rpt_contactPicker').selectedOptions);
  const toText = toOptions.length
    ? toOptions.map(o => o.textContent.trim()).join(isUr ? '، ' : ', ')
    : (isUr ? 'منتخب کردہ دفاتر' : 'Office(s) chosen from contacts');

  const name = currentUser.name || '';
  const designation = currentUser.designation || (isUr ? 'اسسٹنٹ ایجوکیشن آفیسر' : 'Assistant Education Officer');
  const markaz = currentUser.markaz_name || currentUser.markaz || '';
  const sigUrl = (_reportGoogleStatus && _reportGoogleStatus.signature_url) || '';

  const dateDisplay = date
    ? new Date(date).toLocaleDateString(isUr ? 'ur-PK' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';

  const refLine = [
    category ? (isUr ? 'قسم: ' : 'Category: ') + escHtml(category) : '',
    schoolType ? (isUr ? 'اسکول: ' : 'School: ') + escHtml(schoolType) : '',
    emis ? 'EMIS: ' + escHtml(emis) + (schoolName ? ' — ' + escHtml(schoolName) : '') : '',
    accused ? (isUr ? 'ملوث شخص: ' : 'Concerned: ') + escHtml(accused) : '',
  ].filter(Boolean).join('&nbsp;&nbsp;|&nbsp;&nbsp;');

  const L = {
    from: isUr ? 'از' : 'From',
    to: isUr ? 'بنام' : 'To',
    dispatch: isUr ? 'ڈسپیچ نمبر' : 'Dispatch No.',
    dated: isUr ? 'تاریخ' : 'Dated',
    subject: isUr ? 'موضوع' : 'Subject',
    description: isUr ? 'تفصیل' : 'Description',
    remarks: isUr ? 'تبصرہ' : 'Remarks',
    signature: isUr ? 'دستخط' : 'Signature',
    designationDefault: isUr ? 'اسسٹنٹ ایجوکیشن آفیسر' : 'Assistant Education Officer',
    markazLabel: isUr ? 'مرکز' : 'Markaz',
    copy: isUr ? 'نقول' : 'Copy',
  };

  // Everything below is intentionally black-only (#000) — no theme colors —
  // so the printed/PDF report always comes out in plain black ink.
  const boxStyle = 'border:1.4px solid #000;border-radius:3px;padding:7px 10px;color:#000;';
  const rowStyle = 'display:flex;align-items:flex-start;gap:10px;margin-bottom:14px;';
  const labelStyle = 'font-weight:700;min-width:110px;color:#000;padding-top:7px;';

  return `
    <div style="direction:${dir};font-family:${font};padding:50px 56px;width:794px;box-sizing:border-box;color:#000;line-height:1.7;background:#fff">

      <div style="${rowStyle}">
        <div style="${labelStyle}">${L.from}</div>
        <div style="flex:1;${boxStyle}"><b>${isUr ? 'دفتر اسسٹنٹ ایجوکیشن آفیسر،' : 'Office of the Assistant Education Officer,'}</b> ${escHtml(markaz)}</div>
      </div>

      <div style="${rowStyle}">
        <div style="${labelStyle}">${L.to}</div>
        <div style="flex:1;${boxStyle}">${escHtml(toText)}</div>
      </div>

      <div style="display:flex;gap:16px;margin-bottom:14px">
        <div style="flex:1;${rowStyle}margin-bottom:0">
          <div style="${labelStyle}min-width:90px">${L.dispatch}</div>
          <div style="flex:1;${boxStyle}">${escHtml(dispatchNo) || (isUr ? 'ارسال پر تفویض ہوگا' : 'Assigned on send')}</div>
        </div>
        <div style="flex:1;${rowStyle}margin-bottom:0">
          <div style="${labelStyle}min-width:70px">${L.dated}</div>
          <div style="flex:1;${boxStyle}">${escHtml(dateDisplay)}</div>
        </div>
      </div>

      <div style="${rowStyle}">
        <div style="${labelStyle}">${L.subject}</div>
        <div style="flex:1;${boxStyle}"><b>${escHtml(subject)}</b></div>
      </div>

      ${refLine ? `<div style="font-size:.78rem;color:#000;margin:-6px 0 16px 120px">${refLine}</div>` : ''}

      <div style="margin-bottom:10px;font-weight:700;color:#000">${L.description}</div>
      <div style="white-space:pre-wrap;text-align:${align};color:#000;min-height:140px;margin-bottom:22px">${escHtml(description)}</div>

      ${remarks ? `<div style="margin-bottom:22px">
        <div style="font-weight:700;margin-bottom:6px;color:#000">${L.remarks}:</div>
        <div style="white-space:pre-wrap;text-align:${align};color:#000">${escHtml(remarks)}</div>
      </div>` : ''}

      <div style="margin-top:50px;display:flex;justify-content:flex-end">
        <div style="width:240px;text-align:center">
          <div style="font-style:italic;color:#000;margin-bottom:4px">${L.signature}</div>
          ${sigUrl ? `<img src="${sigUrl}" crossorigin="anonymous" style="max-height:60px;max-width:200px;display:block;margin:0 auto 4px;filter:grayscale(1) contrast(1.4) brightness(.8)">` : `<div style="height:60px"></div>`}
          <div style="border-top:1.4px solid #000;padding-top:6px;font-size:.85rem;color:#000">
            <div style="font-weight:700">${escHtml(name)}</div>
            <div>${escHtml(designation)}</div>
            <div>${L.markazLabel} ${escHtml(markaz)}</div>
          </div>
        </div>
      </div>

      <div style="margin-top:40px;font-size:.85rem;color:#000">
        <div style="font-weight:700;margin-bottom:6px">${L.copy}:</div>
        <div>1. ${isUr ? 'منتخب کردہ تمام دفاتر — بغیر علیحدہ کور لیٹر کے، ایک ایک نقل' : 'All addressee offices selected above — one copy each, no separate covering letter.'}</div>
        <div>2. ${isUr ? 'دفتری نقل (ریکارڈ کے لیے)' : 'Office copy (for record).'}</div>
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

  // Merge every attachment (images + PDFs) in as extra pages so the whole
  // thing — report letter + attachments — downloads/sends as ONE PDF file.
  const baseBytes = pdf.output('arraybuffer');
  const mergedBytes = await _mergeAttachmentsIntoPdf(baseBytes);
  return new Blob([mergedBytes], { type: 'application/pdf' });
}

// ── Appends each selected attachment as additional page(s) of the same
//    PDF: image attachments become one full page each, PDF attachments
//    have every one of their pages copied in as-is. ─────────────────────
async function _mergeAttachmentsIntoPdf(baseBytes) {
  if (!reportAttachments.length) return baseBytes;
  if (typeof PDFLib === 'undefined') {
    console.warn('pdf-lib not loaded — attachments will not be merged into the report PDF.');
    return baseBytes;
  }

  const { PDFDocument } = PDFLib;
  const mergedPdf = await PDFDocument.load(baseBytes);
  const PAGE_W = 595.28, PAGE_H = 841.89; // A4 in points
  const MARGIN = 40;

  for (const att of reportAttachments) {
    try {
      const bytes = await att.blob.arrayBuffer();
      if (att.type === 'application/pdf') {
        const attDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const copiedPages = await mergedPdf.copyPages(attDoc, attDoc.getPageIndices());
        copiedPages.forEach(p => mergedPdf.addPage(p));
      } else {
        // Compressed image attachments are always re-encoded to JPEG
        // (see _compressImage), regardless of the original file type.
        const img = await mergedPdf.embedJpg(bytes);
        const maxW = PAGE_W - MARGIN * 2, maxH = PAGE_H - MARGIN * 2;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        const page = mergedPdf.addPage([PAGE_W, PAGE_H]);
        page.drawImage(img, { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, width: w, height: h });
      }
    } catch (e) {
      console.warn('Could not merge attachment into PDF:', att.name, e);
    }
  }

  return mergedPdf.save();
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
  const subject = document.getElementById('rpt_subject').value.trim();
  const description = document.getElementById('rpt_description').value.trim();
  const selectedContactIds = Array.from(document.getElementById('rpt_contactPicker').selectedOptions).map(o => o.value);

  if (!date) { showToast('Date is required.', false); return; }
  if (!subject) { showToast('Subject is required.', false); return; }
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
      subject,
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
        subject: `Report Dispatch — ${dispatchNumber} — ${subject}`,
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
