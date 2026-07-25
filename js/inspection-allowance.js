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
  document.getElementById('iaMyBillTab').style.display      = tab === 'myBill'      ? 'block' : 'none';
  document.getElementById('iaPerformanceTab').style.display = tab === 'performance' ? 'block' : 'none';
  document.getElementById('iaBudgetPrepTab').style.display  = tab === 'budgetprep'  ? 'block' : 'none';
  document.getElementById('iaTabMyBillBtn').classList.toggle('active', tab === 'myBill');
  document.getElementById('iaTabPerfBtn').classList.toggle('active', tab === 'performance');
  document.getElementById('iaTabBudgetPrepBtn').classList.toggle('active', tab === 'budgetprep');

  if (tab === 'performance') perfInit();
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

// ═══════════════════════════════════════════════════════════════════
//  PERFORMANCE CERTIFICATE — "AEO Monthly Performance Certificate"
//  Replicates the two fixed government templates (Open / Closed) exactly
//  as laid out in the source workbook — same wording, column layout,
//  Arial Narrow font, A4 portrait page. Only the AEO's entered indicator
//  achievement (a %age against target, or a Yes/No) varies; the rupee
//  entitlement for each indicator is derived from that automatically —
//  the user never types an amount.
//
//  Indicator "weight" = share of the monthly Inspection Allowance rate
//  that indicator is worth (matches the source sheet's fixed rupee
//  split: 10000+15×1000 = 25000 for Open; an even 16-way split for
//  Closed, which has no printed money column). Weights are applied to
//  whatever iaState.rate currently is, so this stays correct if the
//  configured rate ever changes.
// ═══════════════════════════════════════════════════════════════════

const PERF_MAX_MONTHS = 4;
const PERF_MIN_MONTHS = 1;

// kind: 'percent' → user enters achieved %, credited if achieved >= targetPct
//       'yesno'   → user ticks Achieved/Not Achieved
//       'fixed'   → not editable, always credited (matches template default)
const PERF_OPEN_ROWS = [
  { ind: 'AEO Visits',                                                    tgtLabel: '100',                                                        kind: 'percent', targetPct: 100, weight: 0.40 },
  { ind: 'LND (E,M,U)',                                                   tgtLabel: '80% per Quarter',                                            kind: 'fixed',   fixedAch: 'Not Conducted By PMIU', fixedRmk: 'N/A', weight: 0.04 },
  { ind: 'Student Attendance ECE-8',                                      tgtLabel: '90',                                                          kind: 'percent', targetPct: 90,  weight: 0.04 },
  { ind: 'Teacher Presence',                                              tgtLabel: '85',                                                          kind: 'percent', targetPct: 85,  weight: 0.04 },
  { ind: 'Functioning of facilities (BW, DW, Electricity, Furniture)',    tgtLabel: '80',                                                          kind: 'percent', targetPct: 80,  weight: 0.04 },
  { ind: 'Student Retention',                                             tgtLabel: '85',                                                          kind: 'percent', targetPct: 85,  weight: 0.04 },
  { ind: 'Litnum Material',                                               tgtLabel: '80',                                                          kind: 'percent', targetPct: 80,  weight: 0.04 },
  { ind: 'On time resolution of Hotline Complaint',                       tgtLabel: '90',                                                          kind: 'percent', targetPct: 90,  weight: 0.04 },
  { ind: 'Classroom Observation',                                        tgtLabel: '90',                                                          kind: 'percent', targetPct: 90,  weight: 0.04 },
  { ind: 'Co-curricular activities',                                      tgtLabel: 'As directed by department',                                  kind: 'yesno',   weight: 0.04 },
  { ind: 'School records',                                                tgtLabel: 'Properly maintained Students, Teachers, NSB and FTF',        kind: 'yesno',   weight: 0.04 },
  { ind: 'School based action plan',                                      tgtLabel: 'Ensure SBAP is prepared and present in school',              kind: 'yesno',   weight: 0.04 },
  { ind: 'School Council',                                                tgtLabel: 'Ensure 1 SC meeting per month',                              kind: 'yesno',   weight: 0.04 },
  { ind: 'Attend monthly meeting',                                        tgtLabel: 'As directed by higher authorities',                          kind: 'yesno',   weight: 0.04 },
  { ind: 'Visit ADP schemes under construction',                          tgtLabel: 'Visit of ADP scheme and give status to department when required', kind: 'yesno', weight: 0.04 },
  { ind: 'Update SIS Data',                                               tgtLabel: 'Ensure all schools of markaz have updated data on SIS',      kind: 'yesno',   weight: 0.04 },
];

const PERF_CLOSED_ROWS = [
  { ind: 'Aeo Visits',                                    tgtLabel: 'Once in a Month' },
  { ind: 'Teacher Training',                              tgtLabel: 'Ensure That Teachers Attend Trainings' },
  { ind: 'Cot Analysis Report',                           tgtLabel: 'Submit Analysis Report to Immediate Officer' },
  { ind: 'Ht Orientation',                                tgtLabel: 'Ht Meeting of Markaz and Submit Attendance' },
  { ind: 'Sbap Report',                                   tgtLabel: 'Develop and Submit Sbap Report' },
  { ind: 'Awareness Campaign Smc',                        tgtLabel: '1 Session Regarding Importance of Schooling and Hygiene' },
  { ind: 'Ece Support and Guidance',                      tgtLabel: 'Up Gradation of Ece Room and Material' },
  { ind: 'Oosc Survey',                                   tgtLabel: 'Once a Year' },
  { ind: 'Ece Support for Enrollment Drive',               tgtLabel: 'Smc, Ht and Community Plan for Upcoming Enrollment Drive' },
  { ind: 'Ece Awareness Campaign',                        tgtLabel: 'Creating Awareness of the Importance of Ece in Community' },
  { ind: 'Sis Orientation',                               tgtLabel: 'Collect Feedback from Ht and Submit to Immediate Officer' },
  { ind: 'Dengue Awareness Campaign',                     tgtLabel: 'Creating Awareness Regarding Anti-dengue Activities in Schools Like Seminars' },
  { ind: 'Visit Adp Schemes Under Construction',          tgtLabel: 'Visit of Adp Scheme and Give Status to Department When Required' },
  { ind: 'Observance of Govt. Sops in Private Schools',   tgtLabel: 'Observe Govt. Sops Followed by Private Schools' },
  { ind: 'Update Sis Data',                               tgtLabel: 'Ensure All Schools of Markaz Have Updated Data on Sis' },
  { ind: 'Online Complaint Resolution',                   tgtLabel: 'In-time Resolution of Complaints on Dashboard' },
].map(r => ({ ...r, kind: 'yesno', weight: 1 / 16 }));

const PERF_KPI_NOTICE = 'It is to certify that verifiable KPIs developed and issued by SED vide No. SO (SE-III) 5-226/200 dated 03-08-2020 has been achieved by the above named AEO.   His performance is mentioned above against each indicator. He is entitled to get Inspection';

let perfState = { months: [], selected: new Set(), config: {} };
// config[month] = { status: 'open'|'closed', achieved: { rowIndex: number|boolean } }

// ─── Init / month picker (min 1, max 4 — same cap as My Bill) ──────
function perfInit() {
  const yearSel = document.getElementById('perf_year');
  const yNow = new Date().getFullYear();
  yearSel.innerHTML = [yNow - 2, yNow - 1, yNow, yNow + 1].map(y => `<option value="${y}" ${y === yNow ? 'selected' : ''}>${y}</option>`).join('');
  perfState.selected = new Set();
  perfState.config = {};
  perfLoadMonths();
}

async function perfLoadMonths() {
  const year = Number(document.getElementById('perf_year').value);
  const grid = document.getElementById('perfMonthsGrid');
  const warn = document.getElementById('perf_monthWarn');
  grid.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3)"><span class="spinner-border spinner-border-sm"></span> Loading months…</div>`;

  const res = await apiCall('getMyInspectionAllowanceMonths', { year });
  perfState.selected = new Set();
  perfState.config = {};
  if (!res || !res.success) { grid.innerHTML = ''; warn.style.display = 'block'; perfRenderConfigPanels(); return; }

  perfState.months = (res.months || []).filter(m => m.prepared);
  if (!perfState.months.length) { grid.innerHTML = ''; warn.style.display = 'block'; perfRenderConfigPanels(); return; }

  warn.style.display = 'none';
  perfRenderMonthsGrid();
  perfRenderConfigPanels();
}

function perfRenderMonthsGrid() {
  const grid = document.getElementById('perfMonthsGrid');
  grid.innerHTML = perfState.months.map(m => {
    const checked = perfState.selected.has(m.month);
    return `<label style="display:flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--b0);border-radius:8px;cursor:pointer;font-size:.85rem;${checked ? 'background:#f0fdfa;border-color:#0d9488' : ''}">
      <input type="checkbox" ${checked ? 'checked' : ''} onchange="perfToggleMonth(${m.month}, this.checked)"> ${IA_MONTH_NAMES[m.month - 1]}
    </label>`;
  }).join('');
}

function perfToggleMonth(month, checked) {
  if (checked) {
    if (perfState.selected.size >= PERF_MAX_MONTHS) {
      showToast(`Maximum ${PERF_MAX_MONTHS} months per certificate.`, false);
      perfRenderMonthsGrid();
      return;
    }
    perfState.selected.add(month);
    if (!perfState.config[month]) perfState.config[month] = { status: 'open', achieved: {} };
  } else {
    perfState.selected.delete(month);
    delete perfState.config[month];
  }
  perfRenderMonthsGrid();
  perfRenderConfigPanels();
}

// ─── Per-month config panels (status + indicator entry) ────────────
function perfRenderConfigPanels() {
  const wrap = document.getElementById('perfConfigPanels');
  const months = [...perfState.selected].sort((a, b) => a - b);

  if (!months.length) {
    wrap.innerHTML = `<div style="padding:16px;text-align:center;color:var(--t3);font-size:.85rem">Select at least ${PERF_MIN_MONTHS} prepared month above to begin.</div>`;
    document.getElementById('perf_downloadBtn').disabled = true;
    document.getElementById('perfGrandTotalDisplay').textContent = 'PKR 0';
    return;
  }

  wrap.innerHTML = months.map(month => {
    const cfg = perfState.config[month];
    const rows = cfg.status === 'open' ? PERF_OPEN_ROWS : PERF_CLOSED_ROWS;
    const rowsHtml = rows.map((r, i) => perfIndicatorRowHtml(month, r, i, cfg)).join('');
    const total = perfComputeMonthTotal(month);

    return `
      <div style="background:#fff;border:1px solid var(--b0);border-radius:10px;padding:16px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">
          <div style="font-weight:700;font-size:.95rem">${IA_MONTH_NAMES[month - 1]}</div>
          <div style="display:flex;gap:14px;align-items:center;font-size:.85rem">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="radio" name="perf_status_${month}" ${cfg.status === 'open' ? 'checked' : ''} onchange="perfSetStatus(${month},'open')"> Open
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="radio" name="perf_status_${month}" ${cfg.status === 'closed' ? 'checked' : ''} onchange="perfSetStatus(${month},'closed')"> Closed
            </label>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:.78rem">
          <thead><tr style="text-align:left;border-bottom:1px solid var(--b0);color:var(--t3)">
            <th style="padding:5px 6px;width:4%">Sr</th>
            <th style="padding:5px 6px;width:26%">Indicator</th>
            <th style="padding:5px 6px;width:30%">Target</th>
            <th style="padding:5px 6px;width:20%">Achieved</th>
            <th style="padding:5px 6px;width:20%;text-align:right">Entitlement</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div style="text-align:right;margin-top:8px;padding-top:8px;border-top:1px dashed var(--b0);font-weight:700;font-size:.88rem">
          Month Total: <span style="color:#0d9488" id="perfMonthTotal_${month}">PKR ${total.toLocaleString()}</span>
        </div>
      </div>`;
  }).join('');

  document.getElementById('perf_downloadBtn').disabled = months.length < PERF_MIN_MONTHS;
  perfUpdateGrandTotal();
}

function perfIndicatorRowHtml(month, row, idx, cfg) {
  let achievedCell;
  let entitlement = perfRowAmount(row);

  if (row.kind === 'fixed') {
    achievedCell = `<span style="color:var(--t3)">${row.fixedAch}</span>`;
  } else if (row.kind === 'percent') {
    const val = cfg.achieved[idx] ?? row.targetPct; // default: exactly meets target
    achievedCell = `<input type="number" min="0" max="100" value="${val}" style="width:64px;height:28px;border:1px solid var(--b0);border-radius:5px;padding:0 6px"
      oninput="perfUpdateAchieved(${month}, ${idx}, this.value)"> %`;
  } else { // yesno
    const val = cfg.achieved[idx] ?? true; // default: achieved
    achievedCell = `<label style="display:flex;align-items:center;gap:5px;cursor:pointer">
      <input type="checkbox" ${val ? 'checked' : ''} onchange="perfUpdateAchieved(${month}, ${idx}, this.checked)"> Achieved
    </label>`;
  }

  const credited = perfIsCredited(row, cfg.achieved[idx]);
  return `<tr style="border-bottom:1px solid var(--s2)">
    <td style="padding:5px 6px">${idx + 1}</td>
    <td style="padding:5px 6px">${row.ind}</td>
    <td style="padding:5px 6px;color:var(--t3)">${row.tgtLabel}</td>
    <td style="padding:5px 6px">${achievedCell}</td>
    <td style="padding:5px 6px;text-align:right;font-weight:600;color:${credited ? '#0d9488' : 'var(--t3)'}">PKR ${(credited ? entitlement : 0).toLocaleString()}</td>
  </tr>`;
}

function perfRowAmount(row) {
  return Math.round(row.weight * (iaState.rate || 25000));
}

function perfIsCredited(row, storedVal) {
  if (row.kind === 'fixed') return true;
  if (row.kind === 'percent') {
    const v = storedVal ?? row.targetPct;
    return Number(v) >= row.targetPct;
  }
  return (storedVal ?? true) === true; // yesno defaults to achieved
}

function perfUpdateAchieved(month, idx, value) {
  const cfg = perfState.config[month];
  if (!cfg) return;
  const rows = cfg.status === 'open' ? PERF_OPEN_ROWS : PERF_CLOSED_ROWS;
  const row = rows[idx];
  cfg.achieved[idx] = row.kind === 'percent' ? Number(value) : Boolean(value);
  perfRenderConfigPanels(); // re-render to refresh credited highlighting + totals
}

function perfSetStatus(month, status) {
  const cfg = perfState.config[month];
  if (!cfg) return;
  cfg.status = status;
  cfg.achieved = {}; // indicator sets differ between formats — start fresh
  perfRenderConfigPanels();
}

function perfComputeMonthTotal(month) {
  const cfg = perfState.config[month];
  if (!cfg) return 0;
  const rows = cfg.status === 'open' ? PERF_OPEN_ROWS : PERF_CLOSED_ROWS;
  return rows.reduce((sum, row, idx) => sum + (perfIsCredited(row, cfg.achieved[idx]) ? perfRowAmount(row) : 0), 0);
}

function perfUpdateGrandTotal() {
  const total = [...perfState.selected].reduce((s, m) => s + perfComputeMonthTotal(m), 0);
  document.getElementById('perfGrandTotalDisplay').textContent = 'PKR ' + total.toLocaleString();
}

// ─── Generate + download (one page per selected month) ─────────────
async function perfDownloadCertificate() {
  if (!iaState.profile) { showToast('Profile not loaded yet.', false); return; }
  const months = [...perfState.selected].sort((a, b) => a - b);
  if (months.length < PERF_MIN_MONTHS) { showToast(`Select at least ${PERF_MIN_MONTHS} prepared month.`, false); return; }

  const btn = document.getElementById('perf_downloadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating…';
  try {
    const year = Number(document.getElementById('perf_year').value);
    const pages = months.map(month => {
      const cfg = perfState.config[month];
      const total = perfComputeMonthTotal(month);
      const data = { user: iaState.profile, year, month, amount: total, cfg };
      return cfg.status === 'open' ? perfOpenHtml(data) : perfClosedHtml(data);
    });
    const pdfBytes = await perfBuildCertificatePdfBytes(pages);
    const label = months.map(m => IA_MONTH_NAMES[m - 1]).join('-');
    iaDownloadPdf(pdfBytes, `Performance_Certificate_${iaState.profile.personal_no}_${label}_${year}.pdf`);
    showToast('Certificate downloaded.', true);
  } catch (err) {
    showToast('Error generating certificate: ' + err.message, false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-file-earmark-pdf-fill"></i> Download Certificate (PDF)';
  }
}

// ─── Shared header block for both formats (matches source workbook) ─
function perfHeaderHtml(officeLine, u, monthLabel) {
  return `
    <div style="text-align:center;font-size:16pt;font-weight:700;margin-bottom:2px">${officeLine}</div>
    <div style="text-align:center;font-size:16pt;font-weight:700;text-decoration:underline;margin-bottom:14px">AEO Monthly Performance Certificate</div>
    <table style="width:100%;border-collapse:collapse;font-size:12pt;font-weight:700;margin-bottom:10px">
      <tr>
        <td style="padding:2px 4px;width:50%">AEO Name: ${u.name || ''}</td>
        <td style="padding:2px 4px;width:50%">Cell No: ${u.cell_no || u.cnic || ''}</td>
      </tr>
      <tr>
        <td style="padding:2px 4px">Markaz: ${u.markaz_name || ''}</td>
        <td style="padding:2px 4px">Month: ${monthLabel}</td>
      </tr>
    </table>`;
}

function perfFooterHtml(amount, markazName, isOpen) {
  return `
    <p style="font-size:12pt;font-weight:700;margin:12px 0 40px;line-height:1.45">${PERF_KPI_NOTICE} worth PKR ${Number(amount).toLocaleString()}</p>
    <table style="width:100%;font-size:12pt;font-weight:700"><tr>
      <td style="width:50%;text-align:center">Assistant Education Officer</td>
      <td style="width:50%;text-align:center">
        <div>Deputy District Education Officer</div>
        <div>Tehsil Karor</div>
      </td>
    </tr></table>`;
}

// ─── OPEN format — 7 columns, exact widths from source workbook ────
function perfOpenHtml(data) {
  const u = data.user;
  const cfg = data.cfg;
  const monthLabel = `${IA_MONTH_NAMES[data.month - 1]} ${data.year}`;
  const rows = PERF_OPEN_ROWS.map((r, i) => {
    const stored = cfg.achieved[i];
    const credited = perfIsCredited(r, stored);
    const amt = credited ? perfRowAmount(r) : 0;
    let achCell, rmkCell;
    if (r.kind === 'fixed') { achCell = r.fixedAch; rmkCell = r.fixedRmk; }
    else if (r.kind === 'percent') { achCell = (stored ?? r.targetPct) + '%'; rmkCell = ''; }
    else { achCell = credited ? 'Yes' : 'No'; rmkCell = credited ? 'Acheived' : ''; }
    return `<tr>
      <td style="border:1px solid #000;padding:4px 5px;text-align:center">${i + 1}</td>
      <td style="border:1px solid #000;padding:4px 5px">${r.ind}</td>
      <td style="border:1px solid #000;padding:4px 5px;text-align:center">${r.tgtLabel}</td>
      <td style="border:1px solid #000;padding:4px 5px;text-align:center">${achCell}</td>
      <td style="border:1px solid #000;padding:4px 5px;text-align:center">${amt.toLocaleString()}/-</td>
      <td style="border:1px solid #000;padding:4px 5px;text-align:center">${rmkCell}</td>
      <td style="border:1px solid #000;padding:4px 5px"></td>
    </tr>`;
  }).join('');

  const body = `
    ${perfHeaderHtml('OFFICE OF THE DEPUTY DISTRICT EDUCATION OFFICER (M-EE) TEHSIL KAROR', u, monthLabel)}
    <table style="width:100%;border-collapse:collapse;font-size:10.5pt;font-weight:700;margin-bottom:0">
      <thead>
        <tr>
          <th style="border:1px solid #000;padding:4px 5px;width:14.1%">Sr.</th>
          <th style="border:1px solid #000;padding:4px 5px;width:17.8%">Indicators</th>
          <th style="border:1px solid #000;padding:4px 5px;width:25.8%">Targets %age</th>
          <th style="border:1px solid #000;padding:4px 5px;width:14.1%">Target Achieved by AEO</th>
          <th style="border:1px solid #000;padding:4px 5px;width:9.4%">Entitlement of Allowance rupees</th>
          <th style="border:1px solid #000;padding:4px 5px;width:9.4%">Remarks of Immediate Officer</th>
          <th style="border:1px solid #000;padding:4px 5px;width:9.4%">Initials of DDO</th>
        </tr>
      </thead>
      <tbody style="font-weight:400">${rows}</tbody>
    </table>
    ${perfFooterHtml(data.amount, u.markaz_name, true)}`;
  return `<div style="width:794px;min-height:1123px;padding:96px 72px;font-family:'Arial Narrow','Arial',sans-serif;color:#000;box-sizing:border-box">${body}</div>`;
}

// ─── CLOSED format — 5 columns, exact widths from source workbook ──
function perfClosedHtml(data) {
  const u = data.user;
  const cfg = data.cfg;
  const monthLabel = `${IA_MONTH_NAMES[data.month - 1]} ${data.year}`;
  const rows = PERF_CLOSED_ROWS.map((r, i) => {
    const stored = cfg.achieved[i];
    const credited = perfIsCredited(r, stored);
    return `<tr>
      <td style="border:1px solid #000;padding:4px 6px;text-align:center">${i + 1}</td>
      <td style="border:1px solid #000;padding:4px 6px">${r.ind}</td>
      <td style="border:1px solid #000;padding:4px 6px">${r.tgtLabel}</td>
      <td style="border:1px solid #000;padding:4px 6px;text-align:center">${credited ? 'Acheived' : 'Not Acheived'}</td>
      <td style="border:1px solid #000;padding:4px 6px"></td>
    </tr>`;
  }).join('');

  const body = `
    ${perfHeaderHtml('OFFICE OF THE DY. DISTRICT EDUCATION OFFICER (M-EE) TEHSIL KAROR', u, monthLabel)}
    <table style="width:100%;border-collapse:collapse;font-size:10.5pt;font-weight:700;margin-bottom:0">
      <thead>
        <tr>
          <th style="border:1px solid #000;padding:4px 6px;width:11.4%">Sr.</th>
          <th style="border:1px solid #000;padding:4px 6px;width:17.3%">Indicators</th>
          <th style="border:1px solid #000;padding:4px 6px;width:35.7%">Targets</th>
          <th style="border:1px solid #000;padding:4px 6px;width:18.5%">Performance</th>
          <th style="border:1px solid #000;padding:4px 6px;width:17.1%">Remarks of Immediate Officer</th>
        </tr>
      </thead>
      <tbody style="font-weight:400">${rows}</tbody>
    </table>
    ${perfFooterHtml(data.amount, u.markaz_name, false)}`;
  return `<div style="width:794px;min-height:1123px;padding:96px 72px;font-family:'Arial Narrow','Arial',sans-serif;color:#000;box-sizing:border-box">${body}</div>`;
}

// ─── Multi-page HTML → single PDF (A4 portrait, one page per month) ─
async function perfBuildCertificatePdfBytes(pagesHtml) {
  const target = document.getElementById('iaPdfRenderTarget');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pagesHtml.length; i++) {
    target.innerHTML = pagesHtml[i];
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
