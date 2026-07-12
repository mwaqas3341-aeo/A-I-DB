/**
 * Report Dispatch System — Write Report form logic.
 * Depends on: _sb, currentUser, showToast, escHtml, bootstrap (all
 * already global via api.js/index.js), plus html2canvas + jsPDF
 * (loaded via CDN — see index.html changes).
 */

let reportLanguage = 'en';
let reportAttachments = []; // [{file, compressedBlob, name, type, size}]
let reportSchoolMatch = null; // { school_name, district, wing, tehsil, markaz_name }
let draftAutosaveTimer = null;
let _reportEmisRequestSeq = 0; // guards against out-of-order EMIS lookup responses

const DRAFT_KEY = 'dispatchReportDraft';

// ── Language toggle ────────────────────────────────────────────────
function setReportLanguage(lang) {
  reportLanguage = lang;
  document.getElementById('langBtnEn').classList.toggle('btn-primary', lang === 'en');
  document.getElementById('langBtnEn').classList.toggle('btn-outline-secondary', lang !== 'en');
  document.getElementById('langBtnUr').classList.toggle('btn-primary', lang === 'ur');
  document.getElementById('langBtnUr').classList.toggle('btn-outline-secondary', lang !== 'ur');

  const desc = document.getElementById('rpt_description');
  desc.dir = lang === 'ur' ? 'rtl' : 'ltr';
  desc.style.fontFamily = lang === 'ur' ? "'Noto Nastaliq Urdu', serif" : "inherit";
  desc.style.textAlign = lang === 'ur' ? 'right' : 'left';
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

// Dispatch number format: {seq}/{markaz initials}/{year} — e.g. "23/FPM/2026"
// for "FATEH PUR - MALE". No zero-padding, no full Markaz name spelled out.
function markazInitials(markaz) {
  return (markaz || '')
    .split(/\s+/)
    .map(w => w.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean)
    .map(w => w[0].toUpperCase())
    .join('');
}

// ── Recipient selection helpers (checkbox-based, hierarchy-sorted) ──────
// Official order regardless of tick order: CEO > DEO > Dy. DEO > AEO >
// Assistant Director > Head Teacher > Other. Used everywhere a report
// needs its final recipient list — the letter body, the live "Sending
// to" preview, and the actual send.
function getSelectedReportContacts() {
  const checkedIds = Array.from(document.querySelectorAll('.rpt-contact-check:checked')).map(el => el.value);
  return dispatchContactsCache
    .filter(c => checkedIds.includes(c.id))
    .sort((a, b) => dispatchHierarchyRank(a.designation) - dispatchHierarchyRank(b.designation) || a.name.localeCompare(b.name));
}

function _renderSelectedOfficesLive() {
  const box = document.getElementById('rpt_selectedOfficesBox');
  const list = document.getElementById('rpt_selectedOfficesList');
  const selected = getSelectedReportContacts();

  if (!selected.length) { box.style.display = 'none'; scheduleDraftAutosave(); return; }

  box.style.display = 'block';
  list.innerHTML = selected.map(c => `
    <div style="padding:3px 0;display:flex;justify-content:space-between;gap:10px">
      <span>${escHtml(c.name)}${c.office ? ' — ' + escHtml(c.office) : ''} <span style="font-size:.7rem;color:var(--t3)">(${escHtml(c.designation || 'Other')})</span></span>
      <span style="color:var(--t3);font-size:.78rem">${escHtml((c.emails_to || []).join(', '))}</span>
    </div>
  `).join('');
  scheduleDraftAutosave();
}

function _actuallyOpenWriteReportModal() {
  const modalEl = document.getElementById('writeReportModal');
  bootstrap.Modal.getOrCreateInstance(modalEl).show();

  document.getElementById('rpt_date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('rpt_dispatchPreview').value = 'Calculating…';
  reportAttachments = [];
  document.getElementById('rpt_attachmentsList').innerHTML = '';
  setReportLanguage('en');
  clearReportSchoolLookup(); // sets EMIS-vs-typed-name UI state before any draft/restore runs

  loadDispatchContacts().then(contacts => {
    const sorted = [...contacts].sort((a, b) =>
      dispatchHierarchyRank(a.designation) - dispatchHierarchyRank(b.designation) || a.name.localeCompare(b.name));
    const picker = document.getElementById('rpt_contactPicker');
    picker.innerHTML = sorted.length
      ? sorted.map(c => `
          <div class="form-check" style="margin-bottom:6px">
            <input class="form-check-input rpt-contact-check" type="checkbox" value="${c.id}" id="rpt_contact_${c.id}" onchange="_renderSelectedOfficesLive()">
            <label class="form-check-label" for="rpt_contact_${c.id}" style="cursor:pointer">
              ${escHtml(c.name)}${c.office ? ' — ' + escHtml(c.office) : ''}
              <span style="font-size:.7rem;color:var(--t3)">(${escHtml(c.designation || 'Other')})</span>
            </label>
          </div>
        `).join('')
      : '<div style="color:var(--t3);font-size:.85rem">No contacts saved yet.</div>';

    // Only now that the checkboxes actually exist can a saved draft's
    // recipient selection be restored and the rest of the draft applied.
    _restoreDraftIfAny();
    _renderSelectedOfficesLive();
    onReportDateChange();
  });
}

// ── EMIS lookup. Queries the `public_schools` table directly (columns
//    emis, school_name, district, wing, tehsil, markaz_name) so it works
//    every time, regardless of whether any other screen's cache has
//    loaded yet this session. Name field always stays editable so it
//    can be corrected/typed manually either way. Private schools skip
//    EMIS entirely — name is just typed in directly. ───────────────────
function clearReportSchoolLookup() {
  reportSchoolMatch = null;
  const type = document.getElementById('rpt_schoolType').value;
  const emisWrap = document.getElementById('rpt_emisFieldWrap');
  const emisInput = document.getElementById('rpt_emis');
  const nameInput = document.getElementById('rpt_schoolName');
  const statusEl = document.getElementById('rpt_emisStatus');

  emisInput.value = '';
  statusEl.textContent = '';
  nameInput.value = '';
  nameInput.readOnly = false;
  nameInput.disabled = false;

  if (type === 'Private') {
    emisWrap.style.display = 'none';
    nameInput.placeholder = 'Enter school name';
  } else {
    emisWrap.style.display = '';
    nameInput.placeholder = 'Auto-fills if found — edit if needed';
  }
  scheduleDraftAutosave();
}

async function onReportEmisInput() {
  const emis = document.getElementById('rpt_emis').value.trim();
  const statusEl = document.getElementById('rpt_emisStatus');
  const nameEl = document.getElementById('rpt_schoolName');

  if (!emis) { reportSchoolMatch = null; statusEl.textContent = ''; return; }
  if (!/^\d{8}$/.test(emis)) {
    reportSchoolMatch = null;
    statusEl.textContent = 'EMIS must be 8 digits';
    statusEl.style.color = 'var(--warn)';
    return;
  }

  const myRequestId = ++_reportEmisRequestSeq; // ignore stale responses if the user keeps typing
  statusEl.textContent = 'Looking up…';
  statusEl.style.color = 'var(--t3)';

  try {
    // Uses the dedicated open lookup (any school, any jurisdiction) — a
    // dispatch report legitimately needs to reference schools outside
    // the sender's own Markaz (transfers, inquiries, promotions, etc.).
    const { data, error } = await _sb.rpc('dispatch_lookup_school_by_emis', { p_emis: emis });
    if (myRequestId !== _reportEmisRequestSeq) return; // superseded by a newer lookup
    if (error) throw error;
    const match = Array.isArray(data) ? data[0] : data;

    if (match) {
      reportSchoolMatch = match;
      nameEl.value = match.school_name || '';
      statusEl.textContent = '✓ School found';
      statusEl.style.color = 'var(--ok)';
    } else {
      reportSchoolMatch = null;
      statusEl.textContent = 'EMIS not found — you can still enter the school name manually';
      statusEl.style.color = 'var(--warn)';
    }
  } catch (e) {
    if (myRequestId !== _reportEmisRequestSeq) return;
    reportSchoolMatch = null;
    statusEl.textContent = 'Lookup failed — enter the school name manually';
    statusEl.style.color = 'var(--warn)';
  }
  scheduleDraftAutosave();
}

// ── Dispatch number preview — shows the number this report WOULD get
//    right now. It is only a preview: the real number is still claimed
//    atomically at send time (so two people saving at once never collide),
//    but showing it upfront answers "what will my dispatch no. be?" ──────
async function onReportDateChange() {
  const dateVal = document.getElementById('rpt_date').value;
  const hintEl = document.getElementById('rpt_dateHint');
  const previewEl = document.getElementById('rpt_dispatchPreview');
  if (!dateVal) { hintEl.textContent = ''; previewEl.value = 'Assigned on send'; return; }

  const year = new Date(dateVal).getFullYear();
  const currentYear = new Date().getFullYear();
  const markaz = currentUser.markaz_name || currentUser.markaz || '';

  const { data } = await _sb.from('dispatch_counters').select('last_number').eq('markaz_name', markaz).eq('year', year).maybeSingle();
  const maxUsed = data ? data.last_number : 0;
  const nextSeq = maxUsed + 1;
  previewEl.value = `${nextSeq}/${markazInitials(markaz)}/${year}`;

  if (year === currentYear) {
    hintEl.textContent = 'This is the next dispatch number for your Markaz — it is only finalized once you actually send.';
  } else {
    hintEl.textContent = `Backdated to ${year}: highest dispatch number already used for your Markaz that year is ${maxUsed}. The next one sent will continue from there.`;
  }
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
    schoolName: document.getElementById('rpt_schoolName')?.value,
    accused: document.getElementById('rpt_accused')?.value,
    description: document.getElementById('rpt_description')?.value,
    selectedContactIds: Array.from(document.querySelectorAll('.rpt-contact-check:checked')).map(el => el.value),
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
    clearReportSchoolLookup(); // sets EMIS vs typed-name mode for the restored school type
    document.getElementById('rpt_emis').value = d.emis || '';
    document.getElementById('rpt_accused').value = d.accused || '';
    document.getElementById('rpt_description').value = d.description || '';
    (d.selectedContactIds || []).forEach(id => {
      const el = document.getElementById('rpt_contact_' + id);
      if (el) el.checked = true;
    });
    if (d.schoolType === 'Private') {
      document.getElementById('rpt_schoolName').value = d.schoolName || '';
    } else if (d.emis) {
      onReportEmisInput();
    }
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
  const description = document.getElementById('rpt_description').value;

  // Recipient lines never show a personal name — just "Office of the
  // {full designation title} {jurisdiction}", built from each contact's
  // Designation + Jurisdiction fields. A contact with no recognized
  // designation/jurisdiction falls back to its free-text Office field
  // so nothing renders blank.
  const selectedForLetter = getSelectedReportContacts();
  const toLines = selectedForLetter.length
    ? selectedForLetter.map(c => {
        const title = DISPATCH_DESIGNATION_TITLE[c.designation] || '';
        const line = title
          ? `${title}${c.jurisdiction ? ' ' + c.jurisdiction : ''}`
          : (c.office || c.name);
        return escHtml(line);
      })
    : [escHtml(isUr ? 'منتخب کردہ دفاتر' : 'Office(s) chosen from contacts')];

  const designation = currentUser.designation || (isUr ? 'اسسٹنٹ ایجوکیشن آفیسر' : 'Assistant Education Officer');
  const markaz = currentUser.markaz_name || currentUser.markaz || '';
  const sigUrl = (_reportGoogleStatus && _reportGoogleStatus.signature_url) || '';

  const dateDisplay = date
    ? new Date(date).toLocaleDateString(isUr ? 'ur-PK' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';
  // Compact numeric date for next to the signature, per the format
  // requested (DD/MM/YYYY) — separate from the "Dated" field above,
  // which keeps its existing "12 Jul 2026" style.
  const dateDisplayShort = date
    ? new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

  const L = {
    dispatch: isUr ? 'ڈسپیچ نمبر' : 'Dispatch No.',
    dated: isUr ? 'تاریخ' : 'Dated',
    subject: isUr ? 'موضوع' : 'Subject',
    from: isUr ? 'از' : 'From',
    to: isUr ? 'بجانب' : 'To',
  };

  const fieldLabelStyle = 'font-size:12pt;font-weight:400;color:#000;white-space:nowrap;padding-right:8px';
  const fieldValueStyle = 'font-size:12pt;font-weight:400;color:#000;padding-right:28px';

  // ══════════════════════════════════════════════════════════════════
  // URDU TEMPLATE — kept exactly as it was; not touched by the English
  // layout changes below (the two formats are maintained independently).
  // ══════════════════════════════════════════════════════════════════
  if (isUr) {
    const senderRecipientStyle = 'font-size:14pt;font-weight:700;color:#000';
    const senderLine = `دفتر اسسٹنٹ ایجوکیشن آفیسر ${escHtml(markaz)}`;
    const senderBlock = `<tr><td style="${fieldLabelStyle}vertical-align:top">${L.from}</td><td style="${senderRecipientStyle}padding:4px 0"><b>${senderLine}</b></td></tr>`;
    const recipientBlock = `<tr><td style="${fieldLabelStyle}vertical-align:top">${L.to}</td><td style="${senderRecipientStyle}padding:4px 0">${toLines.join('<br>')}</td></tr>`;
    const dispatchDatedRow = `
      <div style="display:flex;gap:28px;margin:10px 0 18px">
        <span><span style="${fieldLabelStyle}">${L.dispatch}</span><span style="${fieldValueStyle}padding-right:0">${escHtml(dispatchNo) || 'ارسال پر تفویض ہوگا'}</span></span>
        <span><span style="${fieldLabelStyle}">${L.dated}</span><span style="${fieldValueStyle}padding-right:0">${escHtml(dateDisplay)}</span></span>
      </div>`;

    return `
      <div style="direction:rtl;font-family:'Noto Nastaliq Urdu', serif;padding:50px 55px;width:794px;box-sizing:border-box;color:#000;line-height:1.65;background:#fff">
        <table style="width:100%;border-collapse:collapse;margin-bottom:6px">${senderBlock}${recipientBlock}</table>
        ${dispatchDatedRow}
        <div style="display:flex;gap:8px;align-items:baseline;margin-bottom:16px">
          <span style="font-size:12pt;font-weight:700;padding-right:8px">${L.subject}</span>
          <span style="font-size:12pt;font-weight:700">${escHtml(subject)}</span>
        </div>
        <div style="white-space:pre-wrap;text-align:right;color:#000;font-size:11pt;font-weight:400;line-height:1.7;min-height:140px;margin-bottom:24px;word-wrap:break-word">${escHtml(description)}</div>
        <div style="margin-top:46px;display:flex;justify-content:flex-end">
          <div style="width:280px;text-align:center">
            ${sigUrl ? `<img src="${sigUrl}" crossorigin="anonymous" style="max-height:100px;max-width:260px;display:block;margin:0 auto 6px;filter:grayscale(1) contrast(1.4) brightness(.8)">` : `<div style="height:100px"></div>`}
            <div style="font-size:11pt;color:#000;margin-top:6px">${escHtml(designation)}</div>
            <div style="font-size:11pt;color:#000">${escHtml(markaz)}</div>
          </div>
        </div>
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // ENGLISH TEMPLATE
  //  - Sender block: top, center-aligned
  //  - Dispatch No. / Dated: same line, center-aligned
  //  - "To" label + office list: left-aligned
  //  - Subject: left-aligned (unchanged)
  //  - Signature: bigger, with a DD/MM/YYYY date to its right;
  //    Designation + Markaz below it, bold, right-aligned
  // ══════════════════════════════════════════════════════════════════
  const senderLine = `Office of the Assistant Education Officer ${escHtml(markaz)}`;

  return `
    <div style="direction:ltr;font-family:'Segoe UI', Arial, sans-serif;padding:50px 55px;width:794px;box-sizing:border-box;color:#000;line-height:1.65;background:#fff">

      <div style="text-align:center;font-size:14pt;font-weight:700;margin-bottom:14px">${senderLine}</div>

      <div style="display:flex;justify-content:space-between;margin:4px 0 22px">
        <span><span style="${fieldLabelStyle}">${L.dispatch}</span><span style="font-size:12pt;font-weight:400;color:#000">${escHtml(dispatchNo) || 'Assigned on send'}</span></span>
        <span><span style="${fieldLabelStyle}">${L.dated}</span><span style="font-size:12pt;font-weight:400;color:#000">${escHtml(dateDisplay)}</span></span>
      </div>

      <div style="text-align:left;font-size:12pt;font-weight:700;margin-bottom:6px">${L.to}</div>
      <div style="text-align:left;font-size:14pt;font-weight:700;margin-bottom:18px">${toLines.join('<br>')}</div>

      <div style="display:flex;gap:8px;align-items:baseline;margin-bottom:16px">
        <span style="font-size:12pt;font-weight:700;padding-right:8px">${L.subject}</span>
        <span style="font-size:12pt;font-weight:700">${escHtml(subject)}</span>
      </div>

      <div style="white-space:pre-wrap;text-align:left;color:#000;font-size:11pt;font-weight:400;line-height:1.7;min-height:140px;margin-bottom:24px;word-wrap:break-word">${escHtml(description)}</div>

      <div style="margin-top:46px;display:flex;justify-content:flex-end">
        <div style="text-align:center">
          <div style="display:flex;align-items:flex-end;justify-content:flex-end">
            ${sigUrl ? `<img src="${sigUrl}" crossorigin="anonymous" style="max-height:140px;max-width:320px;filter:grayscale(1) contrast(1.4) brightness(.8)">` : `<div style="height:140px;width:200px"></div>`}
          </div>
          <div style="font-weight:700;font-size:11pt;color:#000;margin-top:8px">${escHtml(designation)}</div>
          <div style="font-weight:700;font-size:11pt;color:#000">${escHtml(markaz)}</div>
        </div>
      </div>

    </div>
  `;
}

function previewReport() {
  const container = document.getElementById('reportPreviewContainer');
  container.innerHTML = buildReportTemplateHtml();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('reportPreviewModal')).show();
  // Narrow/mobile screens get a horizontal scrollbar (via the modal
  // body's overflow-x:auto) rather than a JS-computed scale — simpler
  // and can't silently collapse the preview to nothing like the
  // transform-based version did.
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

function _pdfFileName(dispatchNumber) {
  return `${dispatchNumber.replace(/\//g, '-')}.pdf`;
}

// Triggers a normal browser file-save for the already-generated PDF —
// step 4 of Sign & Send ("download the generated PDF to the user's
// device"), done client-side since the blob already exists in memory.
function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ── Sign & Send progress modal — 6 fixed steps, each shown as
//    pending / active / done / failed, plus an overall progress bar. ────
const SEND_STEPS = [
  { key: 'number', label: 'Assigning dispatch number' },
  { key: 'save', label: 'Saving report' },
  { key: 'pdf', label: 'Generating PDF' },
  { key: 'upload', label: 'Uploading to Drive & sending email' },
  { key: 'download', label: 'Downloading your copy' },
  { key: 'done', label: 'Done' },
];
let _sendStepStates = {};

function _sendProgressOpen(dispatchPreviewText) {
  _sendStepStates = {};
  SEND_STEPS.forEach(s => { _sendStepStates[s.key] = 'pending'; });
  document.getElementById('sp_dispatchNumber').textContent = dispatchPreviewText || '';
  document.getElementById('sp_headline').textContent = 'Sending your report…';
  document.getElementById('sp_resultBox').style.display = 'none';
  _sendProgressRender();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('sendProgressModal')).show();
}

function _sendProgressSet(key, state) {
  _sendStepStates[key] = state; // 'active' | 'done' | 'failed'
  const dn = document.getElementById('rpt_dispatchPreview');
  if (dn && dn.value) document.getElementById('sp_dispatchNumber').textContent = dn.value;
  _sendProgressRender();
}

function _sendProgressRender() {
  const icons = { pending: '<i class="bi bi-circle" style="color:var(--t3)"></i>',
    active: '<span class="spinner-border spinner-border-sm"></span>',
    done: '<i class="bi bi-check-circle-fill" style="color:var(--ok)"></i>',
    failed: '<i class="bi bi-x-circle-fill" style="color:var(--bad)"></i>' };

  document.getElementById('sp_steps').innerHTML = SEND_STEPS.map(s => {
    const state = _sendStepStates[s.key] || 'pending';
    return `<div style="display:flex;align-items:center;gap:10px;opacity:${state === 'pending' ? .55 : 1}">
      <span style="width:18px;text-align:center">${icons[state]}</span>
      <span style="${state === 'failed' ? 'color:var(--bad)' : ''}">${s.label}</span>
    </div>`;
  }).join('');

  const doneCount = SEND_STEPS.filter(s => _sendStepStates[s.key] === 'done').length;
  const hasFailed = SEND_STEPS.some(s => _sendStepStates[s.key] === 'failed');
  const pct = Math.round((doneCount / SEND_STEPS.length) * 100);
  const bar = document.getElementById('sp_progressBar');
  bar.style.width = pct + '%';
  bar.className = 'progress-bar' + (hasFailed ? ' bg-danger' : pct === 100 ? ' bg-success' : '');
}

function _sendProgressFinish(headline, isError) {
  document.getElementById('sp_headline').textContent = headline;
  document.getElementById('sp_headline').style.color = isError ? 'var(--bad)' : 'var(--ok)';
  document.getElementById('sp_resultBox').style.display = 'block';
}

// ── Sign & Send — the full orchestration ─────────────────────────────
async function signAndSendReport() {
  const date = document.getElementById('rpt_date').value;
  const subject = document.getElementById('rpt_subject').value.trim();
  const description = document.getElementById('rpt_description').value.trim();
  const selectedContactIds = getSelectedReportContacts().map(c => c.id);

  if (!date) { showToast('Date is required.', false); return; }
  if (!subject) { showToast('Subject is required.', false); return; }
  if (!description) { showToast('Description is required.', false); return; }
  if (!selectedContactIds.length) { showToast('Select at least one recipient.', false); return; }

  const btn = document.getElementById('rpt_signSendBtn');
  btn.disabled = true; // prevent double-submission / duplicate dispatch numbers
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Sending…';
  _sendProgressOpen(document.getElementById('rpt_dispatchPreview').value);
  _sendProgressSet('number', 'active');

  try {
    const markaz = currentUser.markaz_name || currentUser.markaz || '';
    const year = new Date(date).getFullYear();

    // 1. Atomically claim the dispatch number FIRST — once claimed, it
    //    stays associated with this report even if sending needs a retry.
    const { data: seqData, error: seqErr } = await _sb.rpc('get_next_dispatch_number', { p_markaz: markaz, p_year: year });
    if (seqErr) { _sendProgressSet('number', 'failed'); throw new Error('Could not assign a dispatch number: ' + seqErr.message); }
    const seq = seqData;
    const dispatchNumber = `${seq}/${markazInitials(markaz)}/${year}`;
    document.getElementById('rpt_dispatchPreview').value = dispatchNumber;
    _sendProgressSet('number', 'done');
    _sendProgressSet('save', 'active');

    // 2. Build the recipient list from selected contacts
    const selectedContacts = getSelectedReportContacts().filter(c => selectedContactIds.includes(c.id));
    const recipients = {
      to: [...new Set(selectedContacts.flatMap(c => c.emails_to))],
      cc: [...new Set(selectedContacts.flatMap(c => c.emails_cc))],
      bcc: [...new Set(selectedContacts.flatMap(c => c.emails_bcc))],
    };

    // 3. Create the report row (status: sending) — this is what makes
    //    the claimed number safely retryable if the next steps fail.
    const reportRowBase = {
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
      recipients: selectedContacts.map(c => ({ name: c.name, office: c.office || '', to: c.emails_to, cc: c.emails_cc, bcc: c.emails_bcc })),
      signature_url: (_reportGoogleStatus && _reportGoogleStatus.signature_url) || '',
      status: 'sending',
    };

    let { data: reportRow, error: insertErr } = await _sb.from('dispatch_reports')
      .insert([{ ...reportRowBase, subject }]).select().single();

    // The 'subject' column may not exist yet on older installs — fall
    // back to saving without it rather than blocking the whole send.
    // Fix properly with: ALTER TABLE dispatch_reports ADD COLUMN subject text;
    if (insertErr && /subject/i.test(insertErr.message) && /column/i.test(insertErr.message)) {
      showToast('Admin note: add a "subject" column to dispatch_reports — sending without saving it for now.', false);
      ({ data: reportRow, error: insertErr } = await _sb.from('dispatch_reports')
        .insert([reportRowBase]).select().single());
    }
    if (insertErr) { _sendProgressSet('save', 'failed'); throw new Error('Could not save the report: ' + insertErr.message); }
    _sendProgressSet('save', 'done');
    _sendProgressSet('pdf', 'active');

    // 4. Generate the PDF and encode attachments
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating PDF…';
    const pdfBlob = await generateReportPdfBlob();
    const pdfBase64 = await _blobToBase64(pdfBlob);
    _sendProgressSet('pdf', 'done');
    _sendProgressSet('upload', 'active');

    // Attachments are already merged as extra pages into pdfBlob above, so
    // we only need to send their names/sizes for the record — not the raw
    // bytes again (the edge function no longer uploads them separately).
    const attachmentsPayload = reportAttachments.map(a => ({ name: a.name, mimeType: a.type, size: a.finalSize }));

    // 5. Hand off to the Edge Function for the actual Drive upload + Gmail send.
    //    A hard timeout guarantees this never leaves the UI stuck on
    //    "Sending…" indefinitely — if the connection genuinely stalls
    //    (e.g. dropped mid-request), it fails cleanly into the catch
    //    block below like any other error, instead of hanging forever.
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Uploading &amp; sending…';
    const { data: { session } } = await _sb.auth.getSession();
    const sendTimeoutMs = 90000;
    const sendAbort = new AbortController();
    const sendTimeoutId = setTimeout(() => sendAbort.abort(), sendTimeoutMs);
    let res;
    try {
      res = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/dispatch-send-report', {
        method: 'POST',
        signal: sendAbort.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
        body: JSON.stringify({
          reportId: reportRow.id,
          dispatchNumber, dispatchSeq: seq, dispatchYear: year,
          pdfBase64, attachments: attachmentsPayload, recipients,
          subject: `Report Dispatch — ${dispatchNumber} — ${subject}`,
        }),
      });
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') {
        throw new Error(`No response after ${sendTimeoutMs / 1000}s — the connection likely dropped. Your report and dispatch number (${dispatchNumber}) are safely saved; check the Reports list before retrying so you don't send it twice.`);
      }
      throw fetchErr;
    } finally {
      clearTimeout(sendTimeoutId);
    }
    const result = await res.json();

    if (result.success) {
      _sendProgressSet('upload', 'done');
      _sendProgressSet('download', 'active');
      _downloadBlob(pdfBlob, _pdfFileName(dispatchNumber));
      _sendProgressSet('download', 'done');
      _sendProgressSet('done', 'done');
      _sendProgressFinish(`Report ${dispatchNumber} sent successfully.`, false);
      showToast(`Report ${dispatchNumber} generated, saved to Drive, emailed, downloaded, and logged.`, true);
      _clearDraft();
      bootstrap.Modal.getOrCreateInstance(document.getElementById('writeReportModal')).hide();
      if (typeof loadMyDispatchReports === 'function') loadMyDispatchReports();
    } else if (result.partial) {
      _sendProgressSet('upload', 'failed');
      _sendProgressSet('download', 'active');
      _downloadBlob(pdfBlob, _pdfFileName(dispatchNumber));
      _sendProgressSet('download', 'done');
      _sendProgressFinish(`Report ${dispatchNumber} saved, but the email failed.`, true);
      showToast(dispatchNumber + ': ' + result.message + ' A copy was downloaded to your device.', false);
      _clearDraft();
      bootstrap.Modal.getOrCreateInstance(document.getElementById('writeReportModal')).hide();
      if (typeof loadMyDispatchReports === 'function') loadMyDispatchReports();
    } else {
      // Even a full failure (e.g. network drop before upload) shouldn't
      // lose the work — the PDF already exists locally, so hand it over.
      _sendProgressSet('upload', 'failed');
      _sendProgressSet('download', 'active');
      _downloadBlob(pdfBlob, _pdfFileName(dispatchNumber));
      _sendProgressSet('download', 'done');
      _sendProgressFinish('Failed to send — but nothing was lost.', true);
      showToast('Failed to send: ' + result.message + ' A local copy was downloaded. The report is saved under ' + dispatchNumber + ' with status Failed — find it in the Reports list to review or delete it.', false);
    }
  } catch (e) {
    const activeStep = SEND_STEPS.find(s => _sendStepStates[s.key] === 'active');
    if (activeStep) _sendProgressSet(activeStep.key, 'failed');
    _sendProgressFinish(e.message || 'Failed to send report.', true);
    showToast(e.message || 'Failed to send report.', false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-send-check"></i> Sign &amp; Send';
  }
}
