// ═══════════════════════════════════════════════════════════════════
//  INSPECTION ALLOWANCE — bill preparation module
//  Deductions are set centrally by the Tehsil Representative during
//  Budget Preparation. An AEO can only download a month once their
//  tehsil+month has been prepared; their own deduction defaults to 0
//  (full rate) if the TR didn't specifically adjust it for them.
// ═══════════════════════════════════════════════════════════════════

const IA_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const IA_MAX_SELECTED = 4;

let iaState = {
  rate: 25000,
  profile: null,
  year: new Date().getFullYear(),
  months: [],       // [{month, prepared, deduction, due}] for the selected year, from getMyInspectionAllowanceMonths
  selected: new Set(), // month numbers currently checked for the bill
};

// ─── Entry point (dashboard card) ──────────────────────────────────
async function openInspectionAllowanceView() {
  if (typeof switchGlobalTab === 'function') switchGlobalTab('inspectionAllowanceView', null);

  const isAdmin = String(currentUser?.role).toLowerCase() === 'admin';
  const isTr = Array.isArray(currentUser?.tr_tehsils) && currentUser.tr_tehsils.length > 0;
  document.getElementById('iaTabBudgetPrepBtn').style.display = (isAdmin || isTr) ? 'inline-flex' : 'none';
  iaSwitchTab('myBill');

  const yearSel = document.getElementById('ia_year');
  const yNow = new Date().getFullYear();
  yearSel.innerHTML = [yNow - 2, yNow - 1, yNow, yNow + 1].map(y => `<option value="${y}" ${y === yNow ? 'selected' : ''}>${y}</option>`).join('');
  iaState.year = yNow;
  iaState.selected = new Set();

  await iaLoadRate();
  await iaLoadProfile();
  await iaLoadMonths();
}

function iaSwitchTab(tab) {
  document.getElementById('iaMyBillTab').style.display     = tab === 'myBill'     ? 'block' : 'none';
  document.getElementById('iaBudgetPrepTab').style.display = tab === 'budgetprep' ? 'block' : 'none';
  document.getElementById('iaTabMyBillBtn').classList.toggle('active', tab === 'myBill');
  document.getElementById('iaTabBudgetPrepBtn').classList.toggle('active', tab === 'budgetprep');

  if (tab === 'budgetprep' && typeof bpInit === 'function') bpInit();
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
  if (incomplete) document.getElementById('iaSubmitBtn').disabled = true;
}

// ─── Months grid (My Bill tab) ───────────────────────────────────────
async function iaLoadMonths() {
  iaState.year = Number(document.getElementById('ia_year').value);
  iaState.selected = new Set();
  const grid = document.getElementById('iaMonthsGrid');
  grid.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3)"><span class="spinner-border spinner-border-sm"></span> Loading months…</div>`;

  const res = await apiCall('getMyInspectionAllowanceMonths', { year: iaState.year });
  if (!res || !res.success) { grid.innerHTML = `<div style="color:var(--bad);padding:12px">${res?.message || 'Could not load months.'}</div>`; return; }

  iaState.months = res.months;
  iaRenderMonthsGrid();
}

function iaRenderMonthsGrid() {
  const grid = document.getElementById('iaMonthsGrid');
  grid.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:.85rem">
      <thead><tr style="text-align:left;border-bottom:2px solid var(--b0);background:var(--s2)">
        <th style="padding:8px;width:36px"></th><th style="padding:8px">Month</th>
        <th style="padding:8px">Status</th><th style="padding:8px">Deduction</th><th style="padding:8px">Due</th>
      </tr></thead>
      <tbody>
        ${iaState.months.map(m => {
          const disabled = !m.prepared;
          const checked = iaState.selected.has(m.month);
          return `<tr style="border-bottom:1px solid var(--s2);${disabled ? 'opacity:.5' : ''}">
            <td style="padding:8px">
              <input type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} onchange="iaToggleMonth(${m.month}, this.checked)">
            </td>
            <td style="padding:8px;font-weight:600">${IA_MONTH_NAMES[m.month - 1]}</td>
            <td style="padding:8px">${m.prepared ? '<span style="color:#0d9488">✅ Prepared</span>' : '<span style="color:var(--t3)">Not prepared yet</span>'}</td>
            <td style="padding:8px">${m.prepared ? 'PKR ' + m.deduction.toLocaleString() : '—'}</td>
            <td style="padding:8px;font-weight:700;color:#0d9488">${m.prepared ? 'PKR ' + m.due.toLocaleString() : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  iaUpdateNetTotal();
}

function iaToggleMonth(month, checked) {
  if (checked) {
    if (iaState.selected.size >= IA_MAX_SELECTED) {
      showToast(`Maximum ${IA_MAX_SELECTED} months per bill.`, false);
      iaRenderMonthsGrid(); // re-render to uncheck the box that triggered this
      return;
    }
    iaState.selected.add(month);
  } else {
    iaState.selected.delete(month);
  }
  iaUpdateNetTotal();
  document.getElementById('iaSubmitBtn').disabled = iaState.selected.size === 0;
}

function iaUpdateNetTotal() {
  let total = 0;
  iaState.selected.forEach(m => {
    const row = iaState.months.find(x => x.month === m);
    if (row) total += row.due;
  });
  document.getElementById('iaNetTotalDisplay').textContent = 'PKR ' + total.toLocaleString();
}

// ─── Download (no submit step — data already set during Budget Prep) ─
async function iaDownloadBill() {
  if (!iaState.selected.size) { showToast('Select at least one prepared month.', false); return; }
  if (!iaState.profile) { showToast('Profile not loaded yet.', false); return; }

  const btn = document.getElementById('iaSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating…';
  try {
    const claims = [...iaState.selected].sort((a, b) => a - b).map(m => {
      const row = iaState.months.find(x => x.month === m);
      return { year: iaState.year, month: m, allowance_rate: iaState.rate, deduction: row.deduction, due: row.due };
    });
    const netTotal = claims.reduce((s, c) => s + c.due, 0);
    const bill = { user: iaState.profile, claims, net_total: netTotal };

    const pdfBytes = await iaBuildBillPdfBytes(bill);
    iaDownloadPdf(pdfBytes, `Inspection_Allowance_${iaState.profile.personal_no}_${iaState.year}_${Date.now()}.pdf`);
    showToast('Bill downloaded.', true);
  } catch (err) {
    showToast('Error generating bill: ' + err.message, false);
  } finally {
    btn.disabled = iaState.selected.size === 0;
    btn.innerHTML = '<i class="bi bi-file-earmark-pdf-fill"></i> Download Bill (PDF)';
  }
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
