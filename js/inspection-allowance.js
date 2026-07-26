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
      // FIX: don't stamp every claim with today's live global rate
      // (iaState.rate). If the admin changes the rate after this month's
      // budget was already prepared, that would silently inflate/deflate
      // the printed Gross figure while Deductions/Net Total still reflect
      // the rate that was actually in force for that month — the bill
      // would stop reconciling (Gross - Deductions != Net Total).
      // Instead, reconstruct the rate that was ACTUALLY applied to this
      // specific month from its own recorded numbers: due = rate -
      // deduction, so rate = due + deduction. This is "the rate updated
      // according to the bill's budget deductions" — it always reconciles,
      // no matter what the current global default rate is later changed to.
      const deduction = Number(row.deduction) || 0;
      const due = Number(row.due) || 0;
      const allowance_rate = due + deduction;
      return { year: iaState.year, month: m, allowance_rate, deduction, due };
    });
    const netTotal = claims.reduce((s, c) => s + Number(c.due), 0);
    const bill = { user: iaState.profile, claims, net_total: netTotal };
    // Resolve every field the bill needs — per-user profile data (personal
    // no., DDO/DDEO code, DDEO office detail, name, markaz, tehsil, post
    // held) plus the derived totals (gross/deduction/net) and the month
    // list — ONCE, here, right after the Adjustment Form's underlying data
    // (user + claims) is assembled. Bill F and Bill B are then built from
    // this SAME resolved object instead of each re-deriving their own
    // copies of period/totals/labels, so all three pages are always
    // guaranteed to agree with each other and with whichever AEO is
    // currently logged in.
    bill.fields = iaResolveBillFields(bill);

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
    // IMPORTANT: without windowWidth/windowHeight, html2canvas clones the
    // page into an iframe sized to the CURRENT browser viewport — on a
    // phone that's ~390-430px wide. Since the bill is a fixed 794px-wide
    // document, anything past the phone's screen width was getting sliced
    // off (Amount columns, totals, third field pair, etc). Pinning the
    // capture window to the target's own real size makes it render at full
    // width no matter how narrow the actual device screen is.
    const captureWidth = 794;
    const captureHeight = Math.max(target.scrollHeight, 1123);
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      windowWidth: captureWidth,
      windowHeight: captureHeight,
      width: captureWidth,
      height: captureHeight,
      x: 0,
      y: 0,
      scrollX: 0,
      scrollY: 0,
    });
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const ratio = pageWidth / canvas.width;
    const scaledHeight = canvas.height * ratio;
    if (i > 0) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, Math.min(scaledHeight, pageHeight));
  }
  target.innerHTML = '';
  return pdf.output('arraybuffer');
}

// Shared page shell styling. officeHeader is the dynamic
// "OFFICE OF THE DY. DISTRICT EDUCATION OFFICER {TEHSIL}" line that sits
// under the page title on the real form — pass '' to omit it (Bill B
// doesn't repeat it).
function iaPageShell(title, officeHeader, bodyHtml) {
  return `
    <div style="width:794px;min-height:1123px;padding:40px 46px;font-family:'Times New Roman',serif;color:#111;box-sizing:border-box">
      <div style="text-align:center;font-size:15px;font-weight:700;text-transform:uppercase;margin-bottom:2px">${title}</div>
      ${officeHeader ? `<div style="text-align:center;font-size:12px;font-weight:700;margin-bottom:14px">${officeHeader}</div>` : '<div style="margin-bottom:14px"></div>'}
      ${bodyHtml}
    </div>`;
}

// ─── Resolve ALL bill fields ONCE, from the Adjustment Form's inputs ──
// (bill.user = the currently logged-in AEO's own profile, bill.claims =
// their chosen months). Bill F and Bill B are built from this SAME object,
// so every page always shows the same personal no., DDO/DDEO code, DDEO
// office detail, name, markaz, tehsil, month list and totals for whichever
// user is downloading — nothing is re-derived or hardcoded per page.
function iaResolveBillFields(bill) {
  const u = bill.user || {};
  const claims = bill.claims || [];

  const tehsil = u.tehsil || '';
  // "Description of Cost Centre" on the real form (e.g. "DDEO (M) Tehsil
  // Karor") — use the profile's own dy_office_detail if the TR/admin has
  // set it, otherwise derive a sensible default from the tehsil so the
  // field is never blank.
  const costCentreDescription = u.dy_office_detail || (tehsil ? `DDEO (M) Tehsil ${tehsil}` : '—');
  // "OFFICE OF THE DY. DISTRICT EDUCATION OFFICER {TEHSIL}" — printed
  // under the title on the real Adjustment Form / Bill F pages.
  const officeHeader = `OFFICE OF THE DY. DISTRICT EDUCATION OFFICER ${(tehsil || '').toUpperCase()}`;

  const totalGross = claims.reduce((s, c) => s + Number(c.allowance_rate || 0), 0);
  const totalDeduction = claims.reduce((s, c) => s + Number(c.deduction || 0), 0);
  const netTotal = claims.reduce((s, c) => s + Number(c.due || 0), 0);

  return {
    ddeoCode: u.ddeo_code || '—',
    costCentreDescription,
    officeHeader,
    personalNo: u.personal_no || '—',
    name: u.name || '—',
    designation: u.designation || '—',
    postHeld: u.designation || '—',
    markaz: u.markaz_name || '—',
    tehsil: tehsil || '—',
    district: u.district || 'Layyah',
    wing: u.wing || '',
    period: claims.map((c) => `${IA_MONTH_NAMES[c.month - 1]} ${c.year}`).join(', '),
    months: claims.map((c) => ({ label: `${IA_MONTH_NAMES[c.month - 1]} ${c.year}`, ...c })),
    grantNo: '15',
    functionalMajor: '40000 = Social Services',
    classificationMinor: '41000 = Education',
    objectClassification: 'A01297 — Inspection Allowance',
    totalGross,
    totalDeduction,
    netTotal,
  };
}

function iaFieldRow(pairs) {
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:10px;font-size:12px">
    ${pairs.map(row => `<tr>${row.map(([lbl, val]) => `
        <td style="padding:3px 6px;width:15%;font-weight:700;border:1px solid #333">${lbl}</td>
        <td style="padding:3px 6px;border:1px solid #333">${val ?? ''}</td>
      `).join('')}</tr>`).join('')}
  </table>`;
}

// Fixed allowance line-items — only Inspection Allowance is populated for this bill type,
// mirroring the source Adjustment Form / Bill F templates (rest of the standard
// pay-element rows are printed at zero, matching the government format). Wage Type
// and G/L Object codes are copied verbatim from the real "Payment of Arrears Pay &
// Allowances Through Adjustments" form so the printed page is an exact replica.
const IA_ALLOWANCE_LINES = [
  ['Basic Pay',                        '5801',      'A01101/A01151'],
  ['Personal Pay (Max Scale)',         '5808',      'A01102/A01152'],
  ['House Rent Allowance',             '5002',      'A01202'],
  ['Conveyance Allowance',             '5011',      'A01203'],
  ['Medical Allowance',                '5012',      'A01217'],
  ['Personal Allowance',               '5048',      'A0121N'],
  ['S.S.B Allowance 30%',              '5290',      'A01270/A04115'],
  ['H.S.R.A Allowance Health',         '6144',      'A01270'],
  ['Health Professional Allowance',    '5048',      'A01218'],
  ['Practice Compensatory Allowance',  '5920',      'A01252'],
  ['Non-practice Allowance',           '5210/5045', 'A01270'],
  ['Mess Allowance',                   '5095',      'A01251'],
  ['Dress Allowance',                  '5026',      'A01208'],
  ['Qualification Allowance',          '5053',      'A01216'],
  ['M. Phil / Ph.D Allowance',         '6077',      'A01226'],
  ['INSPECTION ALLOWANCE',             '',          'A01297'],
];

// showAdjustmentHeader adds the "Adjustment" merged super-header over
// Wage Type / G.L Object / Amount, exactly as printed on Page 1's table
// ("Sr.# | Items | Adjustment [spanning Wage Type, G/L Object, Amount]").
function iaAllowanceTable(inspectionAmount, showAdjustmentHeader) {
  const rows = IA_ALLOWANCE_LINES.map(([label, wageType, glObject], i) => {
    // Zero-value rows print a literal "0" on the real form's allowance
    // table (unlike the deduction table, where zero rows are left blank).
    const amt = label === 'INSPECTION ALLOWANCE' ? inspectionAmount : 0;
    return `<tr><td style="padding:2px 6px;border:1px solid #333">${i + 1}</td>
             <td style="padding:2px 6px;border:1px solid #333">${label}${label === 'INSPECTION ALLOWANCE' ? ':' : ''}</td>
             <td style="padding:2px 6px;border:1px solid #333;text-align:center">${wageType}</td>
             <td style="padding:2px 6px;border:1px solid #333;text-align:center">${glObject}</td>
             <td style="padding:2px 6px;border:1px solid #333;text-align:right">${amt.toLocaleString()}</td></tr>`;
  }).join('');
  // Fixed column widths (5% / 40% / 15% / 20% / 20%) shared with
  // iaDeductionTable and the totals rows below both, so every vertical
  // border on the page lines up like one continuous table.
  return `<table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:10.5px;margin-bottom:8px">
    ${IA_COLGROUP_5}
    <thead>
      ${showAdjustmentHeader ? `<tr>
        <th style="border-bottom:1px solid #333"></th><th style="border-bottom:1px solid #333"></th>
        <th colspan="3" style="text-align:center;padding:3px 6px;border-bottom:1px solid #333;font-weight:700">Adjustment</th>
      </tr>` : ''}
      <tr>
        <th style="text-align:left;padding:3px 6px;border:1.5px solid #333">Sr.#</th>
        <th style="text-align:left;padding:3px 6px;border:1.5px solid #333">Items</th>
        <th style="text-align:center;padding:3px 6px;border:1.5px solid #333">Wage Type</th>
        <th style="text-align:center;padding:3px 6px;border:1.5px solid #333">G/L Object</th>
        <th style="text-align:right;padding:3px 6px;border:1.5px solid #333">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody></table>`;
}

// Deduction line-items shown on the Adjustment Form — same order/codes as the
// real form. Rows 1-6 are left BLANK (not "0" — that's how the source form
// prints them). "Inspection allowance" (row 7) carries the actual per-month
// deduction total pulled from the inspection_allowance_deductions table (same
// source getMyInspectionAllowanceMonths / Budget Preparation uses — see
// iaResolveBillFields). "Adj ROP" (row 8, wage type 6126) is also blank.
const IA_DEDUCTION_LINES = [
  ['G.P Fund',                '6075', 'G06103'],
  ['B.F (Provincial)',        '6001', 'G06201/6201/6214'],
  ['B.F (District)',          '6206', 'G06215'],
  ['GROUP INSURANCE (PROV)',  '6006', 'G06408'],
  ['GROUP INSURANCE (DISTT)', '6207', 'G06411'],
  ['Building Rent 5%',        '6008', 'C02701'],
];

// Shared column widths so the Allowance table, Deduction table, and the
// "Total Pay & Allowances" / "Total Deductions" / "Net Total" rows beneath
// them all line up as one continuous grid of vertical borders.
const IA_COLGROUP_5 = `<colgroup>
  <col style="width:6%"><col style="width:39%"><col style="width:15%"><col style="width:20%"><col style="width:20%">
</colgroup>`;
// Same 5 columns collapsed into 2 for total rows: first 3 columns merged (60%) into the label cell.
const IA_COLGROUP_TOTAL = `<colgroup><col style="width:80%"><col style="width:20%"></colgroup>`;

function iaDeductionTable(totalDeduction) {
  return `<table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:10.5px;margin-bottom:8px">
    ${IA_COLGROUP_5}
    <thead><tr>
      <th style="text-align:left;padding:3px 6px;border:1.5px solid #333">Sr.#</th>
      <th style="text-align:left;padding:3px 6px;border:1.5px solid #333">Deductions</th>
      <th style="text-align:center;padding:3px 6px;border:1.5px solid #333">Wage Type</th>
      <th style="text-align:center;padding:3px 6px;border:1.5px solid #333">G/L Object</th>
      <th style="text-align:right;padding:3px 6px;border:1.5px solid #333">Amount</th>
    </tr></thead>
    <tbody>
      ${IA_DEDUCTION_LINES.map(([label, wageType, glObject], i) => `
        <tr><td style="padding:2px 6px;border:1px solid #333">${i + 1}</td>
            <td style="padding:2px 6px;border:1px solid #333">${label}</td>
            <td style="padding:2px 6px;border:1px solid #333;text-align:center">${wageType}</td>
            <td style="padding:2px 6px;border:1px solid #333;text-align:center">${glObject}</td>
            <td style="padding:2px 6px;border:1px solid #333"></td></tr>`
      ).join('')}
      <tr><td style="padding:2px 6px;border:1px solid #333">${IA_DEDUCTION_LINES.length + 1}</td>
          <td style="padding:2px 6px;border:1px solid #333">Inspection allowance</td>
          <td style="padding:2px 6px;border:1px solid #333"></td>
          <td style="padding:2px 6px;border:1px solid #333"></td>
          <td style="padding:2px 6px;border:1px solid #333;text-align:right">${totalDeduction.toLocaleString()}</td></tr>
      <tr><td style="padding:2px 6px;border:1px solid #333">${IA_DEDUCTION_LINES.length + 2}</td>
          <td style="padding:2px 6px;border:1px solid #333">Adj ROP</td>
          <td style="padding:2px 6px;border:1px solid #333">6126</td>
          <td style="padding:2px 6px;border:1px solid #333"></td>
          <td style="padding:2px 6px;border:1px solid #333"></td></tr>
    </tbody>
  </table>`;
}

// ═══ PAGE 1 — Adjustment Form ═══════════════════════════════════════
function iaAdjustmentFormHtml(bill) {
  const f = bill.fields || iaResolveBillFields(bill);

  const body = `
    ${iaFieldRow([
      [['DDO Code / Cost Centre', f.ddeoCode], ['Description of Cost Centre', f.costCentreDescription]],
      [['Personal Number', f.personalNo], ['Name', f.name]],
      [['Markaz', f.markaz], ['Period of Bill / Claim', f.period]],
    ])}
    ${iaAllowanceTable(f.totalGross, true)}
    <table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px;margin-bottom:10px">
      ${IA_COLGROUP_TOTAL}
      <tr><td style="padding:4px 6px;font-weight:700;border:1px solid #333">Total Pay &amp; Allowances</td>
          <td style="padding:4px 6px;text-align:right;font-weight:700;border:1px solid #333">${f.totalGross.toLocaleString()}</td></tr>
    </table>
    ${iaDeductionTable(f.totalDeduction)}
    <table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px;margin-bottom:24px">
      ${IA_COLGROUP_TOTAL}
      <tr><td style="padding:4px 6px;font-weight:700;border:1px solid #333">Total Deductions</td><td style="padding:4px 6px;text-align:right;font-weight:700;border:1px solid #333">${f.totalDeduction.toLocaleString()}</td></tr>
      <tr><td style="padding:4px 6px;font-weight:700;font-size:13px;border:1px solid #333">Net Total</td><td style="padding:4px 6px;text-align:right;font-weight:700;font-size:13px;border:1px solid #333">${f.netTotal.toLocaleString()}</td></tr>
    </table>
    <p style="font-size:11px;margin-bottom:40px">Certified that sufficient budget is available to meet the above expenditure for the current financial year.</p>
    <table style="width:100%;font-size:11px"><tr>
      <td style="width:50%;text-align:center;padding-top:30px;border-top:1px solid #333">Assistant Education Officer<br>${f.markaz}</td>
      <td style="width:50%;text-align:center;padding-top:30px;border-top:1px solid #333">District Account Officer<br>${f.district}</td>
    </tr></table>`;
  return iaPageShell('Payment of Arrears Pay &amp; Allowances Through Adjustments', f.officeHeader, body);
}

// ═══ PAGE 2 — Bill F (STR-18) ═══════════════════════════════════════
// Single continuous 8-column table (colgroup below) so every row on this
// page — header block, line items, totals — shares the same vertical
// borders, matching the real Bill F form exactly. The 8 columns collapse
// via colspan into: a wide "Item" area (cols 1-5, used whole or split into
// label/value/label/value for the Name/Post Held/Markaz row) + Code (col 6)
// + Rate (col 7) + Amount (col 8).
const IA_BILLF_COLGROUP = `<colgroup>
  <col style="width:10%"><col style="width:10%"><col style="width:20%"><col style="width:10%"><col style="width:9%">
  <col style="width:13%"><col style="width:14%"><col style="width:14%">
</colgroup>`;

function iaBillFHtml(bill) {
  const f = bill.fields || iaResolveBillFields(bill);
  const b = (v) => (v || v === 0 ? Number(v).toLocaleString() : '');

  const body = `
    <div style="text-align:center;font-size:12px;font-weight:700;margin-bottom:10px">Pay Bill Of Gazetted Officer</div>

    <table style="width:100%;margin-bottom:8px"><tr>
      <td style="width:60%;font-size:10.5px;vertical-align:top">
        Form No.S.T.R.18<br>
        <span style="font-style:italic;font-size:9.5px">Note:- Government accepts no responsibility for any fraud or misappropriation in respect of money or cheque or bill made over to a messenger.</span>
      </td>
      <td style="width:40%;font-size:10.5px;direction:rtl;text-align:right;vertical-align:top">یہ بل ٹوکن رجسٹر پر سیریل نمبر..........................پر درج ہے۔</td>
    </tr></table>

    <table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:10.5px">
      ${IA_BILLF_COLGROUP}
      <tbody>
        <tr>
          <td rowspan="4" colspan="5" style="padding:4px 6px;border:1px solid #333;vertical-align:top">
            GRANT NO.15<br><br>
            Functional&nbsp;&nbsp;&nbsp;&nbsp;Major&nbsp;&nbsp;&nbsp;&nbsp;40000 = Social Services<br><br>
            Classification&nbsp;&nbsp;&nbsp;&nbsp;Minor&nbsp;&nbsp;&nbsp;&nbsp;41000 = Education<br><br>
            of Expend&nbsp;&nbsp;&nbsp;&nbsp;Detailed
          </td>
          <td style="padding:4px 6px;border:1px solid #333;font-weight:700">DDO Code</td>
          <td colspan="2" style="padding:4px 6px;border:1px solid #333;font-weight:700;font-size:13px">${f.ddeoCode}</td>
        </tr>
        <tr>
          <td style="padding:4px 6px;border:1px solid #333;font-weight:700">Personal No.</td>
          <td colspan="2" style="padding:4px 6px;border:1px solid #333;font-weight:700;font-size:13px">${f.personalNo}</td>
        </tr>
        <tr>
          <td style="padding:4px 6px;border:1px solid #333;font-weight:700">Name</td>
          <td colspan="2" style="padding:4px 6px;border:1px solid #333;font-weight:700;font-size:13px">${f.name}</td>
        </tr>
        <tr>
          <td style="padding:4px 6px;border:1px solid #333;font-weight:700">Month</td>
          <td colspan="2" style="padding:4px 6px;border:1px solid #333;font-weight:700;font-size:13px">${f.period}</td>
        </tr>

        <tr>
          <td style="padding:4px 6px;border:1px solid #333;font-weight:700">Name:</td>
          <td colspan="2" style="padding:4px 6px;border:1px solid #333;font-weight:700">${f.name}</td>
          <td style="padding:4px 6px;border:1px solid #333;font-weight:700">Post Held</td>
          <td style="padding:4px 6px;border:1px solid #333;font-weight:700">${f.postHeld}</td>
          <td style="padding:4px 6px;border:1px solid #333;font-weight:700">Markaz:</td>
          <td colspan="2" style="padding:4px 6px;border:1px solid #333;font-weight:700">${f.markaz}</td>
        </tr>

        <tr style="font-weight:700">
          <td colspan="5" style="border:1px solid #333"></td>
          <td style="padding:3px 6px;border:1px solid #333;text-align:center;font-size:9.5px">Object<br>Classification<br>Code</td>
          <td style="padding:3px 6px;border:1px solid #333;text-align:center;font-size:9.5px">Monthly<br>Rate</td>
          <td style="padding:3px 6px;border:1px solid #333;text-align:center;font-size:9.5px">Amount.</td>
        </tr>

        <tr>
          <td colspan="5" style="border:1px solid #333"></td>
          <td style="border:1px solid #333;text-align:center">A01151</td>
          <td style="border:1px solid #333"></td>
          <td style="border:1px solid #333"></td>
        </tr>
        <tr><td colspan="8" style="padding:4px 6px;border:1px solid #333">the payment as detailed below:-</td></tr>
        <tr><td colspan="8" style="padding:2px 6px;border:1px solid #333;font-weight:700;text-decoration:underline">BASIC SALARY</td></tr>
        <tr>
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">My Substantive/ Officiating Pay</td>
          <td style="border:1px solid #333"></td><td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        </tr>
        <tr>
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">
            Special Pay &nbsp; <i style="font-size:9px">It is certified that the Inspection Allowance of ${IA_MONTH_NAMES[bill.claims[0]?.month - 1] || ''} ${bill.claims[0]?.year || ''} has not been recieved by undersigned.</i>
          </td>
          <td style="border:1px solid #333;text-align:center">A01153</td><td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        </tr>
        <tr>
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">Technical Pay</td>
          <td style="border:1px solid #333;text-align:center">A01104</td><td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        </tr>
        <tr style="font-weight:700">
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">TOTAL BASIC SALARY</td>
          <td style="border:1px solid #333;text-align:center">A011</td>
          <td style="border:1px solid #333;text-align:right">0</td>
          <td style="border:1px solid #333;text-align:right">0</td>
        </tr>

        <tr><td colspan="8" style="padding:2px 6px;border:1px solid #333;font-weight:700;text-decoration:underline">REGULAR ALLOWANCES:</td></tr>
        ${[
          ['House Rent Allowance', 'A01202'], ['Dearness Allowance', 'A01205'],
          ['Special Additonal Allowance', 'A01209'], ['Medical Allowance', 'A01274'],
          ['Charge Allowance', 'A01238'], ['Special/Relief Allowance 15%', 'A0120A'],
          ['SSB Allowance', 'A04115'], ['CONVEYANCE ALLOWANCE 2011', 'AO1203'],
        ].map(([label, code]) => `
          <tr>
            <td colspan="5" style="padding:2px 6px;border:1px solid #333">${label}</td>
            <td style="border:1px solid #333;text-align:center">${code}</td><td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
          </tr>`
        ).join('')}
        <tr style="font-weight:700">
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">Inspection Allowance&nbsp; ${f.period},,,</td>
          <td style="border:1px solid #333;text-align:center">AO1297</td>
          <td style="border:1px solid #333;text-align:right">${b(f.totalGross)}</td>
          <td style="border:1px solid #333;text-align:right">${b(f.totalGross)}</td>
        </tr>
        <tr style="font-weight:700">
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">TOTAL REGULAR ALLOWANCES</td>
          <td style="border:1px solid #333;text-align:center">A012</td>
          <td style="border:1px solid #333;text-align:right">${b(f.totalGross)}</td>
          <td style="border:1px solid #333;text-align:right">${b(f.totalGross)}</td>
        </tr>

        <tr><td colspan="8" style="padding:2px 6px;border:1px solid #333;font-weight:700;text-decoration:underline">OTHER ALLOWANCES:</td></tr>
        <tr>
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">Leave Salary</td>
          <td style="border:1px solid #333;text-align:center">A01278</td><td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        </tr>
        <tr style="font-weight:700">
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">Total Other Allowance</td>
          <td style="border:1px solid #333;text-align:center">A01299</td><td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        </tr>

        <tr style="font-weight:700">
          <td colspan="5" style="padding:2px 6px;border:1px solid #333;text-decoration:underline">Gross Claim Establishment Charges<br>
            <span style="font-weight:400;text-decoration:none;font-size:9.5px">(Pay + Regular Allow + Other Allow)</span></td>
          <td style="border:1px solid #333;text-align:center;font-size:9px">0<br>0000</td>
          <td style="border:1px solid #333;text-align:right">${b(f.totalGross)}</td>
          <td style="border:1px solid #333;text-align:right">${b(f.totalGross)}</td>
        </tr>

        <tr><td colspan="8" style="padding:2px 6px;border:1px solid #333;font-weight:700;text-decoration:underline">LESS FUND DEDUCTION:</td></tr>
        <tr>
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">G.P.Fund Account No----------------------</td>
          <td style="border:1px solid #333;text-align:center">11502</td><td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        </tr>
        <tr>
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">G.P.F</td>
          <td style="border:1px solid #333;text-align:center">G06103</td><td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        </tr>
        <tr>
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">Benevolent Fund</td>
          <td style="border:1px solid #333;text-align:center">G06201</td><td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        </tr>
        <tr>
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">Group Insurance Fund</td>
          <td style="border:1px solid #333;text-align:center">G06408</td><td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        </tr>
        <tr style="font-weight:700">
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">Net Claim:</td>
          <td style="border:1px solid #333"></td><td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        </tr>

        <tr><td colspan="8" style="padding:2px 6px;border:1px solid #333;font-weight:700;text-decoration:underline">DEDUCTIONS:</td></tr>
        <tr>
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">Income Tax</td>
          <td style="border:1px solid #333;text-align:center;font-size:9px">0<br>102</td><td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        </tr>
        <tr><td colspan="8" style="padding:2px 6px;border:1px solid #333;font-style:italic;font-size:9.5px">Deductions on account of Advance and Recoveries</td></tr>
        <tr>
          <td colspan="5" style="padding:2px 6px;border:1px solid #333">Advance of Pay:</td>
          <td style="border:1px solid #333;text-align:center">14101</td><td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
        </tr>
        <tr>
          <td colspan="5" style="padding:2px 6px;border:1px solid #333;border-bottom:1px dotted #333">${iaNumberToWordsPKR(f.totalGross)}</td>
          <td style="border:1px solid #333"></td><td style="border:1px solid #333"></td>
          <td style="border:1px solid #333;text-align:right;font-weight:700">${b(f.totalDeduction)}</td>
        </tr>

        <tr style="font-weight:700;font-size:12px">
          <td colspan="5" style="padding:5px 6px;border:1px solid #333">Net Amount Payable:-</td>
          <td style="border:1px solid #333"></td>
          <td style="border:1px solid #333;text-align:right">${b(f.totalGross)}</td>
          <td style="border:1px solid #333;text-align:right">${b(f.netTotal)}</td>
        </tr>
        <tr>
          <td colspan="8" style="padding:4px 6px;border:1px solid #333">Rupees:&nbsp; <span style="border-bottom:1px dotted #333">${iaNumberToWordsPKR(f.netTotal)}</span></td>
        </tr>
      </tbody>
    </table>

    <p style="font-size:11px;text-align:right;margin:10px 6px 26px">Siganture and Stamp of Officer</p>

    <div style="font-size:11px;font-weight:700;margin-bottom:6px">Certified that:-</div>
    <div style="font-size:10px;line-height:1.6;margin-bottom:20px">
      <p>(a) I have neither been provided with accommodation by the Government nor I share any such accommodation with another allottee without necessary permission of the Estate Officer.</p>
      <p>(b) My wife/husband is in the service of the Federal/Provincial Government/Autonomous body.</p>
      <p>(c) My wife/husband who is in the service of Federal/Provincial Government/Autonomous body is in receipt of house rent allowance.</p>
      <p>(d) I am not residing within my work premises.</p>
      <p>(e) I am not maintaining a Motor Cycle/Car No. ………………………….. which is registered in my own name or in the name of my spouse who is not drawing Motor Cycle/Car Allowance for the same.</p>
    </div>
    <table style="width:100%;font-size:11px;margin-top:10px"><tr>
      <td style="width:100%;text-align:right;padding-top:30px;border-top:1px solid #333">Siganture and Stamp of Officer</td>
    </tr></table>`;
  return iaPageShell(f.officeHeader, '', body);
}

// ═══ PAGE 3 — Bill B (Detail of Inspection Allowance) ═══════════════
function iaBillBHtml(bill) {
  const f = bill.fields || iaResolveBillFields(bill);

  // Source form always prints 4 rows (Sr.# 1-4), one per possible claimed
  // month — actual claims fill the first rows, the rest print as blank/zero.
  const claimRows = [...bill.claims];
  while (claimRows.length < IA_MAX_SELECTED) claimRows.push(null);

  const rows = claimRows.map((c, i) => {
    if (!c) {
      return `<tr>
        <td style="padding:5px 8px;border:1px solid #999">${i + 1}</td>
        <td style="padding:5px 8px;border:1px solid #999"></td>
        <td style="padding:5px 8px;border:1px solid #999;text-align:right">0</td>
        <td style="padding:5px 8px;border:1px solid #999;text-align:right">0</td>
        <td style="padding:5px 8px;border:1px solid #999;text-align:right">0</td>
        <td style="padding:5px 8px;border:1px solid #999;text-align:right">0</td>
      </tr>`;
    }
    const due = Number(c.due) || 0;
    return `<tr>
      <td style="padding:5px 8px;border:1px solid #999">${i + 1}</td>
      <td style="padding:5px 8px;border:1px solid #999">${IA_MONTH_NAMES[c.month - 1]} ${c.year}</td>
      <td style="padding:5px 8px;border:1px solid #999;text-align:right">${due.toLocaleString()}</td>
      <td style="padding:5px 8px;border:1px solid #999;text-align:right">0</td>
      <td style="padding:5px 8px;border:1px solid #999;text-align:right">${due.toLocaleString()}</td>
      <td style="padding:5px 8px;border:1px solid #999;text-align:right">${due.toLocaleString()}</td>
    </tr>`;
  }).join('');

  const body = `
    <p style="font-size:12px;margin-bottom:14px"><b>${f.name}</b> &nbsp; ${f.markaz}</p>
    <table style="width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:14px">
      <thead><tr style="background:#f2f2f2">
        <th style="padding:6px 8px;border:1px solid #999;width:30px">Sr.#</th>
        <th style="padding:6px 8px;border:1px solid #999">Period</th>
        <th style="padding:6px 8px;border:1px solid #999">Due</th>
        <th style="padding:6px 8px;border:1px solid #999">Drawn</th>
        <th style="padding:6px 8px;border:1px solid #999">Difference</th>
        <th style="padding:6px 8px;border:1px solid #999">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px">
      <tr style="font-weight:700">
        <td style="padding:6px 8px;border:1px solid #333" colspan="2">NET CLAIM</td>
        <td style="padding:6px 8px;text-align:right;border:1px solid #333">${f.totalGross.toLocaleString()}</td>
        <td style="padding:6px 8px;text-align:right;border:1px solid #333">0</td>
        <td style="padding:6px 8px;text-align:right;border:1px solid #333">${f.netTotal.toLocaleString()}</td>
        <td style="padding:6px 8px;text-align:right;border:1px solid #333">${f.netTotal.toLocaleString()}</td>
      </tr>
    </table>
    <p style="font-size:11px;margin-bottom:50px"><b>Net Amount (In words):</b> ${iaNumberToWordsPKR(f.netTotal)}</p>
    <table style="width:100%;font-size:11px"><tr>
      <td style="width:100%;text-align:right;padding-top:30px;border-top:1px solid #333">Signature and Stamp of Officer</td>
    </tr></table>`;
  return iaPageShell('Detail Inspection Allowance', '', body);
}


// ═══════════════════════════════════════════════════════════════════
//  PERFORMANCE REPORT generation has moved to js/performance.js
//  (see PERF_* constants and perf* functions there). It still shares
//  IA_MONTH_NAMES, iaState, iaDownloadPdf, and #iaPdfRenderTarget with
//  this file, and iaSwitchTab() below still calls perfInit() to boot
//  the Performance tab's UI.
// ═══════════════════════════════════════════════════════════════════

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
