// ═══════════════════════════════════════════════════════════════════
//  INSPECTION ALLOWANCE — bill preparation module
//  Self-service: any logged-in user prepares & downloads their own
//  3-page bill (Adjustment Form + Bill F + Bill B) as one PDF.
//  Admins additionally get a Batch Generate tab.
// ═══════════════════════════════════════════════════════════════════

const IA_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const IA_MAX_ROWS = 4;

let iaState = {
  rate: 25000,
  profile: null,
  rows: [],       // My Bill tab rows: [{id, year, month, deduction}]
  batchRows: [],  // Batch tab month rows (shared across selected users)
  batchUsers: [], // full roster from listInspectionAllowanceUsers
  batchSelected: new Set(),
};
let iaRowSeq = 1;

// ─── Entry point (dashboard card) ──────────────────────────────────
async function openInspectionAllowanceView() {
  if (typeof switchGlobalTab === 'function') switchGlobalTab('inspectionAllowanceView', null);

  const isAdmin = String(currentUser?.role).toLowerCase() === 'admin';
  const isTr = Array.isArray(currentUser?.tr_tehsils) && currentUser.tr_tehsils.length > 0;
  document.getElementById('iaTabBatchBtn').style.display = isAdmin ? 'inline-flex' : 'none';
  document.getElementById('iaTabBudgetPrepBtn').style.display = (isAdmin || isTr) ? 'inline-flex' : 'none';
  iaSwitchTab('myBill');

  iaState.rows = [];
  document.getElementById('iaMonthRows').innerHTML = '';
  iaAddMonthRow();

  await iaLoadRate();
  await iaLoadProfile();
  await iaLoadHistory();
}

function iaSwitchTab(tab) {
  document.getElementById('iaMyBillTab').style.display     = tab === 'myBill'     ? 'block' : 'none';
  document.getElementById('iaBudgetPrepTab').style.display = tab === 'budgetprep' ? 'block' : 'none';
  document.getElementById('iaBatchTab').style.display      = tab === 'batch'      ? 'block' : 'none';
  document.getElementById('iaTabMyBillBtn').classList.toggle('active', tab === 'myBill');
  document.getElementById('iaTabBudgetPrepBtn').classList.toggle('active', tab === 'budgetprep');
  document.getElementById('iaTabBatchBtn').classList.toggle('active', tab === 'batch');

  if (tab === 'budgetprep' && typeof bpInit === 'function') bpInit();

  if (tab === 'batch' && !iaState.batchUsers.length) {
    iaLoadBatchUsers();
    if (!iaState.batchRows.length) iaAddMonthRow(true);
  }
}

// ─── Rate & Profile ─────────────────────────────────────────────────
async function iaLoadRate() {
  const res = await apiCall('getInspectionAllowanceRate');
  if (res && res.success) {
    iaState.rate = Number(res.rate) || 25000;
    document.getElementById('iaRateDisplay').textContent = 'PKR ' + iaState.rate.toLocaleString();
  }
}

async function iaLoadProfile() {
  const grid = document.getElementById('iaProfileGrid');
  const res = await apiCall('getMyProfile');
  if (!res || !res.success) {
    grid.innerHTML = `<div style="color:var(--bad)">Could not load your profile: ${res?.message || 'Unknown error'}</div>`;
    return;
  }
  iaState.profile = res;

  const items = [
    ['Personal No.', res.personal_no], ['Name', res.name],
    ['Designation', res.designation], ['CNIC', res.cnic],
    ['Markaz', res.markaz_name], ['Tehsil', res.tehsil],
    ['Wing', res.wing], ['District', res.district],
    ['Page No.', res.page_no || '—'], ['DDEO Code', res.ddeo_code || '—'],
    ['BPS Scale', res.bps_scale || '—'], ['Dy Office Detail', res.dy_office_detail || '—'],
  ];
  grid.innerHTML = items.map(([lbl, val]) => `
    <div class="ia-profile-item"><span class="lbl">${lbl}</span><span class="val">${val || '—'}</span></div>
  `).join('');

  const incomplete = !res.page_no || !res.ddeo_code || !res.bps_scale;
  document.getElementById('iaProfileIncompleteWarn').style.display = incomplete ? 'block' : 'none';
  document.getElementById('iaSubmitBtn').disabled = incomplete;
}

// ─── Month rows (My Bill tab) ───────────────────────────────────────
function iaAddMonthRow(isBatch) {
  const rows = isBatch ? iaState.batchRows : iaState.rows;
  if (rows.length >= IA_MAX_ROWS) { showToast(`Maximum ${IA_MAX_ROWS} months per bill.`, false); return; }

  const now = new Date();
  const row = { id: iaRowSeq++, year: now.getFullYear(), month: now.getMonth() + 1, deduction: 0 };
  rows.push(row);
  iaRenderMonthRows(isBatch);
}

function iaRemoveMonthRow(isBatch, id) {
  const rows = isBatch ? iaState.batchRows : iaState.rows;
  const idx = rows.findIndex(r => r.id === id);
  if (idx > -1) rows.splice(idx, 1);
  iaRenderMonthRows(isBatch);
}

function iaRenderMonthRows(isBatch) {
  const rows = isBatch ? iaState.batchRows : iaState.rows;
  const container = document.getElementById(isBatch ? 'iaBatchMonthRows' : 'iaMonthRows');
  const yearNow = new Date().getFullYear();
  const years = [yearNow - 1, yearNow, yearNow + 1];

  container.innerHTML = rows.map(r => `
    <div class="ia-month-row" data-row-id="${r.id}">
      <div class="ff-mini"><label>Year</label>
        <select onchange="iaUpdateRow(${isBatch}, ${r.id}, 'year', this.value)">
          ${years.map(y => `<option value="${y}" ${y === r.year ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
      </div>
      <div class="ff-mini"><label>Month</label>
        <select onchange="iaUpdateRow(${isBatch}, ${r.id}, 'month', this.value)">
          ${IA_MONTH_NAMES.map((m, i) => `<option value="${i + 1}" ${i + 1 === r.month ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="ff-mini"><label>Deduction (PKR)</label>
        <input type="number" min="0" value="${r.deduction}" oninput="iaUpdateRow(${isBatch}, ${r.id}, 'deduction', this.value)">
      </div>
      <div class="ff-mini"><label>Due</label>
        <div class="ia-due-badge">PKR ${(iaState.rate - (Number(r.deduction) || 0)).toLocaleString()}</div>
      </div>
      <button class="btn btn-outline-secondary btn-sm" onclick="iaRemoveMonthRow(${isBatch}, ${r.id})" title="Remove">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>
  `).join('') || `<div style="color:var(--t3);font-size:.85rem;padding:8px 0">No months added yet.</div>`;

  if (!isBatch) iaUpdateNetTotal();
}

function iaUpdateRow(isBatch, id, field, value) {
  const rows = isBatch ? iaState.batchRows : iaState.rows;
  const row = rows.find(r => r.id === id);
  if (!row) return;
  row[field] = (field === 'deduction' || field === 'year' || field === 'month') ? Number(value) : value;
  iaRenderMonthRows(isBatch); // re-render so the Due badge updates live
}

function iaUpdateNetTotal() {
  const total = iaState.rows.reduce((sum, r) => sum + (iaState.rate - (Number(r.deduction) || 0)), 0);
  document.getElementById('iaNetTotalDisplay').textContent = 'PKR ' + total.toLocaleString();
}

// ─── Submit (My Bill) ───────────────────────────────────────────────
async function iaSubmitClaim() {
  if (!iaState.rows.length) { showToast('Add at least one month.', false); return; }
  const claims = iaState.rows.map(r => ({ year: r.year, month: r.month, deduction: Number(r.deduction) || 0 }));

  const btn = document.getElementById('iaSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating…';
  try {
    const res = await apiCall('submitInspectionAllowanceClaim', { claims });
    if (!res || !res.success) { showToast(res?.message || 'Failed to submit claim.', false); return; }

    const pdfBytes = await iaBuildBillPdfBytes(res.bill);
    iaDownloadPdf(pdfBytes, `Inspection_Allowance_${res.bill.user.personal_no}_${Date.now()}.pdf`);
    showToast('Bill generated and downloaded.', true);

    iaState.rows = [];
    document.getElementById('iaMonthRows').innerHTML = '';
    iaAddMonthRow();
    await iaLoadHistory();
  } catch (err) {
    showToast('Error generating bill: ' + err.message, false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-file-earmark-pdf-fill"></i> Submit &amp; Download Bill (PDF)';
  }
}

// ─── History ────────────────────────────────────────────────────────
async function iaLoadHistory() {
  const body = document.getElementById('iaHistoryBody');
  const res = await apiCall('getInspectionAllowanceHistory');
  if (!res || !res.success) { body.innerHTML = `<div style="color:var(--bad);font-size:.85rem">${res?.message || 'Could not load history.'}</div>`; return; }
  if (!res.data.length) { body.innerHTML = `<div style="color:var(--t3);font-size:.85rem;padding:8px 0">No claims yet.</div>`; return; }

  body.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:.85rem">
      <thead><tr style="text-align:left;border-bottom:2px solid var(--b0)">
        <th style="padding:8px">Year</th><th style="padding:8px">Month</th>
        <th style="padding:8px">Rate</th><th style="padding:8px">Deduction</th>
        <th style="padding:8px">Due</th><th style="padding:8px">Claimed On</th>
      </tr></thead>
      <tbody>
        ${res.data.map(r => `
          <tr style="border-bottom:1px solid var(--s2)">
            <td style="padding:8px">${r.year}</td>
            <td style="padding:8px">${IA_MONTH_NAMES[r.month - 1]}</td>
            <td style="padding:8px">${Number(r.allowance_rate).toLocaleString()}</td>
            <td style="padding:8px">${Number(r.deduction).toLocaleString()}</td>
            <td style="padding:8px;font-weight:600;color:#0d9488">${Number(r.due).toLocaleString()}</td>
            <td style="padding:8px;color:var(--t3)">${new Date(r.created_at).toLocaleDateString()}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

// ─── Admin: Batch Generate ──────────────────────────────────────────
async function iaLoadBatchUsers() {
  const box = document.getElementById('iaBatchUserList');
  const res = await apiCall('listInspectionAllowanceUsers');
  if (!res || !res.success) { box.innerHTML = `<div style="padding:16px;color:var(--bad)">${res?.message || 'Failed to load users.'}</div>`; return; }

  iaState.batchUsers = res.data || [];
  box.innerHTML = iaState.batchUsers.map(u => `
    <label style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--s2);cursor:pointer">
      <input type="checkbox" onchange="iaToggleBatchUser('${u.id}', this.checked)">
      <div>
        <div style="font-weight:600;font-size:.85rem">${u.name}</div>
        <div style="font-size:.72rem;color:var(--t3)">${u.personal_no} · ${u.designation || ''} · ${u.tehsil || ''} (${u.wing || ''})</div>
      </div>
    </label>
  `).join('') || `<div style="padding:16px;color:var(--t3)">No users found.</div>`;
}

function iaToggleBatchUser(id, checked) {
  if (checked) iaState.batchSelected.add(id); else iaState.batchSelected.delete(id);
}

async function iaSubmitBatch() {
  if (!iaState.batchSelected.size) { showToast('Select at least one employee.', false); return; }
  if (!iaState.batchRows.length) { showToast('Add at least one month.', false); return; }

  const claims = iaState.batchRows.map(r => ({ year: r.year, month: r.month, deduction: Number(r.deduction) || 0 }));
  const btn = document.getElementById('iaBatchSubmitBtn');
  btn.disabled = true;

  const { PDFDocument } = PDFLib;
  const mergedPdf = await PDFDocument.create();
  let done = 0, failed = [];

  for (const userId of iaState.batchSelected) {
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Generating ${++done}/${iaState.batchSelected.size}…`;
    try {
      const res = await apiCall('submitInspectionAllowanceClaim', { userId, claims });
      if (!res || !res.success) { failed.push(res?.message || userId); continue; }
      const bytes = await iaBuildBillPdfBytes(res.bill);
      const singlePdf = await PDFDocument.load(bytes);
      const copiedPages = await mergedPdf.copyPages(singlePdf, singlePdf.getPageIndices());
      copiedPages.forEach(p => mergedPdf.addPage(p));
    } catch (err) {
      failed.push(err.message);
    }
  }

  const mergedBytes = await mergedPdf.save();
  iaDownloadPdf(mergedBytes, `Inspection_Allowance_Batch_${Date.now()}.pdf`);

  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-file-earmark-pdf-fill"></i> Generate Bills for Selected Employees';

  showToast(
    failed.length ? `Generated with ${failed.length} failure(s). Check console for details.` : 'Batch bill generated and downloaded.',
    !failed.length
  );
  if (failed.length) console.warn('Inspection Allowance batch failures:', failed);
}

// ─── PDF generation (3 pages: Adjustment Form / Bill F / Bill B) ────
function iaDownloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function iaBuildBillPdfBytes(bill) {
  const target = document.getElementById('iaPdfRenderTarget');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const pages = [
    iaAdjustmentFormHtml(bill),
    iaBillFHtml(bill),
    iaBillBHtml(bill),
  ];

  for (let i = 0; i < pages.length; i++) {
    target.innerHTML = pages[i];
    await new Promise(r => setTimeout(r, 120));
    const canvas = await html2canvas(target, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const ratio = pageWidth / canvas.width;
    const scaledHeight = canvas.height * ratio;
    if (i > 0) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, Math.min(scaledHeight, pageHeight));
  }
  target.innerHTML = '';
  return pdf.output('arraybuffer');
}

// Shared page shell styling
function iaPageShell(title, bodyHtml) {
  return `
    <div style="width:794px;min-height:1123px;padding:40px 46px;font-family:'Times New Roman',serif;color:#111;box-sizing:border-box">
      <div style="text-align:center;margin-bottom:4px;font-size:12px;letter-spacing:.04em">GOVERNMENT OF THE PUNJAB</div>
      <div style="text-align:center;font-size:15px;font-weight:700;text-transform:uppercase;margin-bottom:14px">${title}</div>
      ${bodyHtml}
    </div>`;
}

function iaFieldRow(pairs) {
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:10px;font-size:12px">
    ${pairs.map(row => `<tr>${row.map(([lbl, val]) => `
        <td style="padding:3px 6px;width:15%;font-weight:700">${lbl}</td>
        <td style="padding:3px 6px;border-bottom:1px solid #999">${val ?? ''}</td>
      `).join('')}</tr>`).join('')}
  </table>`;
}

// Fixed allowance line-items — only Inspection Allowance is populated for this bill type,
// mirroring the source Adjustment Form / Bill F templates (rest of the standard
// pay-element rows are printed at zero, matching the government format).
const IA_ALLOWANCE_LINES = [
  'Basic Pay', 'Personal Pay', 'House Rent Allowance', 'Conveyance Allowance', 'Medical Allowance',
  'Personal Allowance', 'Social Security Ben - 30%', 'Health Sector Reforms Allowance',
  'Health Professional Allowance', 'Non-Practicing Allowance', 'Mess Allowance', 'Dress Allowance',
  'Qualification Allowance', 'M.Phil / Ph.D Allowance', 'INSPECTION ALLOWANCE',
];

function iaAllowanceTable(inspectionAmount) {
  const rows = IA_ALLOWANCE_LINES.map(label => {
    const amt = label === 'INSPECTION ALLOWANCE' ? inspectionAmount : 0;
    return `<tr><td style="padding:2px 6px;border-bottom:1px solid #ddd">${label}</td>
             <td style="padding:2px 6px;border-bottom:1px solid #ddd;text-align:right">${amt.toLocaleString()}</td></tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px">
    <thead><tr><th style="text-align:left;padding:3px 6px;border-bottom:2px solid #333">Pay / Allowance</th>
      <th style="text-align:right;padding:3px 6px;border-bottom:2px solid #333">Amount (PKR)</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function iaAdjustmentFormHtml(bill) {
  const u = bill.user;
  const claim = bill.claims[0]; // Adjustment Form is per period; primary claim shown
  const totalDeduction = bill.claims.reduce((s, c) => s + Number(c.deduction), 0);
  const period = bill.claims.map(c => `${IA_MONTH_NAMES[c.month - 1]} ${c.year}`).join(', ');

  const body = `
    ${iaFieldRow([
      [['DDO Code / Cost Centre', u.ddeo_code], ['Personal No.', u.personal_no]],
      [['Name', u.name], ['Designation', u.designation]],
      [['Markaz', u.markaz_name], ['Period of Bill', period]],
    ])}
    ${iaAllowanceTable(iaState.rate * bill.claims.length)}
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px">
      <tr><td style="padding:4px 6px;font-weight:700">Total Pay &amp; Allowances</td>
          <td style="padding:4px 6px;text-align:right;font-weight:700">${(iaState.rate * bill.claims.length).toLocaleString()}</td></tr>
    </table>
    <div style="font-size:12px;font-weight:700;margin:10px 0 4px">Deductions</div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px">
      ${['GP Fund', 'Benevolent Fund (Provincial)', 'Benevolent Fund (District)', 'Group Insurance (Provincial)', 'Group Insurance (District)', 'Building Rent 5%', 'Adj. ROP'].map(l =>
        `<tr><td style="padding:2px 6px;border-bottom:1px solid #ddd">${l}</td><td style="padding:2px 6px;border-bottom:1px solid #ddd;text-align:right">0</td></tr>`
      ).join('')}
      <tr><td style="padding:2px 6px;border-bottom:1px solid #ddd">Inspection Allowance Deduction</td>
          <td style="padding:2px 6px;border-bottom:1px solid #ddd;text-align:right">${totalDeduction.toLocaleString()}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:24px">
      <tr><td style="padding:4px 6px;font-weight:700">Total Deductions</td><td style="padding:4px 6px;text-align:right;font-weight:700">${totalDeduction.toLocaleString()}</td></tr>
      <tr><td style="padding:4px 6px;font-weight:700;font-size:13px">Net Total</td><td style="padding:4px 6px;text-align:right;font-weight:700;font-size:13px">${bill.net_total.toLocaleString()}</td></tr>
    </table>
    <p style="font-size:11px;margin-bottom:40px">Certified that the amount claimed above is correct and has not been drawn previously.</p>
    <table style="width:100%;font-size:11px"><tr>
      <td style="width:50%;text-align:center;padding-top:30px;border-top:1px solid #333">Assistant Education Officer</td>
      <td style="width:50%;text-align:center;padding-top:30px;border-top:1px solid #333">District Account Officer</td>
    </tr></table>`;
  return iaPageShell('Payment of Arrears Pay &amp; Allowances Through Adjustments', body);
}

function iaBillFHtml(bill) {
  const u = bill.user;
  const totalGross = iaState.rate * bill.claims.length;
  const totalDeduction = bill.claims.reduce((s, c) => s + Number(c.deduction), 0);
  const period = bill.claims.map(c => `${IA_MONTH_NAMES[c.month - 1]} ${c.year}`).join(', ');

  const body = `
    <div style="text-align:center;font-size:11px;margin-bottom:10px">Form No. STR-18 — Pay Bill of Gazetted Officer</div>
    ${iaFieldRow([
      [['DDO Code', u.ddeo_code], ['Personal No.', u.personal_no]],
      [['Name', u.name], ['Month/Period', period]],
      [['Markaz', u.markaz_name], ['Object Classification', 'A011 — Inspection Allowance']],
    ])}
    ${iaAllowanceTable(totalGross)}
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px">
      <tr><td style="padding:4px 6px;font-weight:700">Gross Claim</td><td style="padding:4px 6px;text-align:right;font-weight:700">${totalGross.toLocaleString()}</td></tr>
      <tr><td style="padding:4px 6px">Less: Fund Deduction</td><td style="padding:4px 6px;text-align:right">0</td></tr>
      <tr><td style="padding:4px 6px">Income Tax</td><td style="padding:4px 6px;text-align:right">0</td></tr>
      <tr><td style="padding:4px 6px">Advance Recoveries / Inspection Allowance Deduction</td><td style="padding:4px 6px;text-align:right">${totalDeduction.toLocaleString()}</td></tr>
      <tr><td style="padding:6px;font-weight:700;font-size:13px;border-top:1px solid #333">Net Amount Payable</td>
          <td style="padding:6px;text-align:right;font-weight:700;font-size:13px;border-top:1px solid #333">${bill.net_total.toLocaleString()}</td></tr>
    </table>
    <p style="font-size:11px;margin-bottom:6px"><b>Net Amount in Words:</b> ${iaNumberToWordsPKR(bill.net_total)}</p>

    <div style="font-size:10.5px;margin:16px 0;line-height:1.55">
      <p>(a) Certified that the amount claimed above has not been drawn previously.</p>
      <p>(b) Certified that the officer named above actually performed inspection duties for the period claimed.</p>
      <p>(c) Certified that the deductions shown above have been correctly worked out.</p>
      <p>(d) Certified that the claim is preferred within the prescribed time limit.</p>
      <p>(e) Certified that the details furnished are true and correct to the best of my knowledge.</p>
    </div>
    <table style="width:100%;font-size:11px;margin-top:30px"><tr>
      <td style="width:50%;text-align:center;padding-top:30px;border-top:1px solid #333">Drawing &amp; Disbursing Officer</td>
      <td style="width:50%;text-align:center;padding-top:30px;border-top:1px solid #333">Countersigned</td>
    </tr></table>`;
  return iaPageShell('Pay Bill — Bill F (STR-18)', body);
}

function iaBillBHtml(bill) {
  const u = bill.user;
  const rows = bill.claims.map(c => `
    <tr>
      <td style="padding:5px 8px;border:1px solid #999">${IA_MONTH_NAMES[c.month - 1]} ${c.year}</td>
      <td style="padding:5px 8px;border:1px solid #999;text-align:right">${Number(c.due).toLocaleString()}</td>
      <td style="padding:5px 8px;border:1px solid #999;text-align:right">0</td>
      <td style="padding:5px 8px;border:1px solid #999;text-align:right">${Number(c.due).toLocaleString()}</td>
      <td style="padding:5px 8px;border:1px solid #999;text-align:right">${Number(c.due).toLocaleString()}</td>
    </tr>`).join('');

  const body = `
    ${iaFieldRow([
      [['Personal No.', u.personal_no], ['Name', u.name]],
      [['Designation', u.designation], ['Markaz', u.markaz_name]],
    ])}
    <table style="width:100%;border-collapse:collapse;font-size:11.5px;margin:14px 0">
      <thead><tr style="background:#f2f2f2">
        <th style="padding:6px 8px;border:1px solid #999">Period</th>
        <th style="padding:6px 8px;border:1px solid #999">Due</th>
        <th style="padding:6px 8px;border:1px solid #999">Drawn</th>
        <th style="padding:6px 8px;border:1px solid #999">Difference</th>
        <th style="padding:6px 8px;border:1px solid #999">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px">
      <tr><td style="padding:6px;font-weight:700">Net Claim</td><td style="padding:6px;text-align:right;font-weight:700">${bill.net_total.toLocaleString()}</td></tr>
    </table>
    <p style="font-size:11px"><b>Net Amount in Words:</b> ${iaNumberToWordsPKR(bill.net_total)}</p>
    <table style="width:100%;font-size:11px;margin-top:40px"><tr>
      <td style="width:50%;text-align:center;padding-top:30px;border-top:1px solid #333">Assistant Education Officer</td>
      <td style="width:50%;text-align:center;padding-top:30px;border-top:1px solid #333">District Account Officer</td>
    </tr></table>`;
  return iaPageShell('Detail of Inspection Allowance — Bill B', body);
}

// ─── Number → words (Pakistani/Indian numbering: Lakh, Crore) ──────
function iaNumberToWordsPKR(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function twoDigits(n) {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  }
  function threeDigits(n) {
    if (n < 100) return twoDigits(n);
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + twoDigits(n % 100) : '');
  }

  let crore = Math.floor(num / 10000000); num %= 10000000;
  let lakh = Math.floor(num / 100000); num %= 100000;
  let thousand = Math.floor(num / 1000); num %= 1000;
  let rest = num;

  let parts = [];
  if (crore) parts.push(threeDigits(crore) + ' Crore');
  if (lakh) parts.push(threeDigits(lakh) + ' Lakh');
  if (thousand) parts.push(threeDigits(thousand) + ' Thousand');
  if (rest) parts.push(threeDigits(rest));

  return parts.join(' ') + ' Rupees Only';
}
