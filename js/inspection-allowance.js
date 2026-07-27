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
  months: [],       // [{month, prepared, deduction, due}] for the selected year
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

// ─── PDF generation helpers ────────────────────────────────────────
function iaDownloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ─── Page shell ────────────────────────────────────────────────────
// IMPORTANT: css/styles.css defines several UNSCOPED, bare-element rules
// (table{min-width:800px}, thead th{position:sticky;background:dark...},
// tbody td{white-space:nowrap}, tbody td:first-child{position:sticky;
// background:...}) meant for the app's dashboard grids. Because they use
// plain element selectors with no class scoping, they silently apply to
// EVERY table on the page — including these bill tables — and were the
// real cause of the right-edge clipping, black header bars, and stray
// sticky/background artifacts seen in generated PDFs. This block resets
// them, scoped to #iaPdfRenderTarget only, so the live app's own tables
// elsewhere are completely unaffected.
const IA_STYLE_RESET = `
  <style>
    #iaPdfRenderTarget table { min-width:0 !important; }
    #iaPdfRenderTarget th, #iaPdfRenderTarget thead th {
      position:static !important; background:#fff !important; color:#111 !important;
      text-transform:none !important; letter-spacing:normal !important; white-space:normal !important;
    }
    #iaPdfRenderTarget td, #iaPdfRenderTarget tbody td {
      white-space:normal !important; position:static !important; background:transparent !important;
    }
    #iaPdfRenderTarget tr:hover, #iaPdfRenderTarget tbody tr:hover { background:transparent !important; }
  </style>`;

function iaPageShell(title, officeHeader, bodyHtml, weight = 700) {
  return `
    ${IA_STYLE_RESET}
    <div style="width:830px;min-height:1174px;padding:40px 34px 40px 18px;font-family:'Arial Narrow',Arial,sans-serif;color:#111;font-weight:${weight};box-sizing:border-box">
      <div style="text-align:center;font-size:15px;font-weight:700;text-transform:uppercase;margin-bottom:2px">${title}</div>
      ${officeHeader ? `<div style="text-align:center;font-size:12px;font-weight:700;margin-bottom:14px">${officeHeader}</div>` : '<div style="margin-bottom:14px"></div>'}
      ${bodyHtml}
    </div>`;
}

// ─── Resolve ALL bill fields ONCE ──────────────────────────────────
function iaResolveBillFields(bill) {
  const u = bill.user || {};
  const claims = bill.claims || [];

  const tehsil = u.tehsil || '';
  const costCentreDescription = u.dy_office_detail || (tehsil ? `DDEO (M) Tehsil ${tehsil}` : '—');
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
    periodDisplay: claims.map((c) => `${IA_MONTH_NAMES[c.month - 1]} ${c.year}`).join(' '),
    monthsCsvPadded: (() => {
      const labels = claims.map((c) => `${IA_MONTH_NAMES[c.month - 1]} ${c.year}`);
      while (labels.length < IA_MAX_SELECTED) labels.push('');
      return labels.join(',');
    })(),
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

// ─── Adjustment Form (Page 1) ──────────────────────────────────────

function iaFieldRow(pairs) {
  return `<table style="min-width:0;width:100%;border-collapse:collapse;margin-bottom:10px;font-size:12px">
    ${pairs.map(row => `<tr>${row.map(([lbl, val]) => `
        <td style="padding:3px 6px;width:15%;font-weight:700;border:1px solid #333">${lbl}</td>
        <td style="padding:3px 6px;border:1px solid #333">${val ?? ''}</td>
      `).join('')}</tr>`).join('')}
  </table>`;
}

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

const IA_COLGROUP_5 = `<colgroup>
  <col style="width:6%"><col style="width:39%"><col style="width:15%"><col style="width:20%"><col style="width:20%">
</colgroup>`;
const IA_COLGROUP_TOTAL = `<colgroup><col style="width:80%"><col style="width:20%"></colgroup>`;

function iaAllowanceTable(inspectionAmount, showAdjustmentHeader) {
  const rows = IA_ALLOWANCE_LINES.map(([label, wageType, glObject], i) => {
    const amt = label === 'INSPECTION ALLOWANCE' ? inspectionAmount : 0;
    return `<tr><td style="padding:2px 6px;border:1px solid #333">${i + 1}</td>
             <td style="padding:2px 6px;border:1px solid #333">${label}${label === 'INSPECTION ALLOWANCE' ? ':' : ''}</td>
             <td style="padding:2px 6px;border:1px solid #333;text-align:center">${wageType}</td>
             <td style="padding:2px 6px;border:1px solid #333;text-align:center">${glObject}</td>
             <td style="padding:2px 6px;border:1px solid #333;text-align:center">${amt.toLocaleString()}</td></tr>`;
  }).join('');
  // NOTE: th{} is styled globally and darkly for dashboard tables elsewhere
  // in this app (see css/styles.css "thead th"), so every <th> below must
  // carry an explicit background/color/position override or it silently
  // inherits that dark sticky styling when captured for the PDF.
  const TH = 'background:#fff;color:#111;position:static;text-transform:none;font-weight:700;';
  return `<table style="min-width:0;width:100%;table-layout:fixed;border-collapse:collapse;font-size:10.5px;margin-bottom:8px">
    ${IA_COLGROUP_5}
    <thead>
      <tr>
        <th style="${TH}text-align:left;padding:3px 6px;border:1.5px solid #333">Sr.#</th>
        <th style="${TH}text-align:left;padding:3px 6px;border:1.5px solid #333">Items</th>
        <th style="${TH}text-align:center;padding:3px 6px;border:1.5px solid #333">${showAdjustmentHeader ? 'Adjustment Wage Type' : 'Wage Type'}</th>
        <th style="${TH}text-align:center;padding:3px 6px;border:1.5px solid #333">G/L Object</th>
        <th style="${TH}text-align:center;padding:3px 6px;border:1.5px solid #333">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody></table>`;
}

const IA_DEDUCTION_LINES = [
  ['G.P Fund',                '6075', 'G06103'],
  ['B.F (Provincial)',        '6001', 'G06201/6201/6214'],
  ['B.F (District)',          '6206', 'G06215'],
  ['GROUP INSURANCE (PROV)',  '6006', 'G06408'],
  ['GROUP INSURANCE (DISTT)', '6207', 'G06411'],
  ['Building Rent 5%',        '6008', 'C02701'],
];

function iaDeductionTable(totalDeduction) {
  const TH = 'background:#fff;color:#111;position:static;text-transform:none;font-weight:700;';
  return `<table style="min-width:0;width:100%;table-layout:fixed;border-collapse:collapse;font-size:10.5px;margin-bottom:8px">
    ${IA_COLGROUP_5}
    <thead><tr>
      <th style="${TH}text-align:left;padding:3px 6px;border:1.5px solid #333">Sr.#</th>
      <th style="${TH}text-align:left;padding:3px 6px;border:1.5px solid #333">Deductions</th>
      <th style="${TH}text-align:center;padding:3px 6px;border:1.5px solid #333">Wage Type</th>
      <th style="${TH}text-align:center;padding:3px 6px;border:1.5px solid #333">G/L Object</th>
      <th style="${TH}text-align:center;padding:3px 6px;border:1.5px solid #333">Amount</th>
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
          <td style="padding:2px 6px;border:1px solid #333;text-align:center">${totalDeduction.toLocaleString()}</td></tr>
      <tr><td style="padding:2px 6px;border:1px solid #333">${IA_DEDUCTION_LINES.length + 2}</td>
          <td style="padding:2px 6px;border:1px solid #333">Adj ROP</td>
          <td style="padding:2px 6px;border:1px solid #333">6126</td>
          <td style="padding:2px 6px;border:1px solid #333"></td>
          <td style="padding:2px 6px;border:1px solid #333"></td></tr>
    </tbody>
  </table>`;
}

function iaAdjustmentFormHtml(bill) {
  const f = bill.fields || iaResolveBillFields(bill);

  const headerBlock = `
    <table style="min-width:0;width:100%;border-collapse:collapse;margin-bottom:10px;font-size:12px">
      <colgroup><col style="width:20%"><col style="width:22%"><col style="width:23%"><col style="width:35%"></colgroup>
      <tr>
        <td style="padding:3px 6px;font-weight:700;border:1px solid #333">DDO Code / Cost Centre</td>
        <td style="padding:3px 6px;border:1px solid #333">${f.ddeoCode}</td>
        <td style="padding:3px 6px;font-weight:700;border:1px solid #333">Description of Cost Centre</td>
        <td style="padding:3px 6px;border:1px solid #333">${f.costCentreDescription}</td>
      </tr>
      <tr>
        <td style="padding:3px 6px;font-weight:700;border:1px solid #333">Personal Number</td>
        <td style="padding:3px 6px;border:1px solid #333">${f.personalNo}</td>
        <td style="padding:3px 6px;border:1px solid #333">${f.name}</td>
        <td style="padding:3px 6px;border:1px solid #333">${f.markaz}</td>
      </tr>
      <tr>
        <td style="padding:3px 6px;font-weight:700;border:1px solid #333">Period of Bill / Claim</td>
        <td colspan="3" style="padding:3px 6px;border:1px solid #333">${f.periodDisplay}</td>
      </tr>
    </table>`;

  const body = `
    ${headerBlock}
    ${iaAllowanceTable(f.totalGross, true)}
    <table style="min-width:0;width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px;margin-bottom:10px">
      ${IA_COLGROUP_TOTAL}
      <tr><td style="padding:4px 6px;font-weight:700;border:1px solid #333">Total Pay &amp; Allowances</td>
          <td style="padding:4px 6px;text-align:right;font-weight:700;border:1px solid #333">${f.totalGross.toLocaleString()}</td></tr>
    </table>
    ${iaDeductionTable(f.totalDeduction)}
    <table style="min-width:0;width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px;margin-bottom:24px">
      ${IA_COLGROUP_TOTAL}
      <tr><td style="padding:4px 6px;font-weight:700;border:1px solid #333">Total Deductions</td><td style="padding:4px 6px;text-align:right;font-weight:700;border:1px solid #333">${f.totalDeduction.toLocaleString()}</td></tr>
      <tr><td style="padding:4px 6px;font-weight:700;font-size:13px;border:1px solid #333">Net Total</td><td style="padding:4px 6px;text-align:right;font-weight:700;font-size:13px;border:1px solid #333">${f.netTotal.toLocaleString()}</td></tr>
    </table>
    <p style="font-size:11px;margin-bottom:40px">Certified that sufficient budget is available to meet the above expenditure for the current financial year.</p>
    <table style="min-width:0;width:100%;font-size:11px"><tr>
      <td style="width:50%;text-align:center;padding-top:20px;font-weight:700">Assistant Education Officer<br>${f.markaz}</td>
      <td style="width:50%;text-align:center;padding-top:20px;font-weight:700">District Account Officer<br>${f.district}</td>
    </tr></table>`;
  return iaPageShell('Payment of Arrears Pay &amp; Allowances Through Adjustments', f.officeHeader, body);
}

// ─── Bill F (STR-18) — Page 2 ──────────────────────────────────────
// This is a direct, cell-by-cell replica of the "Bill F" sheet in
// fresh_bill_copy_to_study.xlsx (verified with openpyxl: column widths,
// merged ranges, border sides/styles, font sizes and bold/italic/underline
// flags were all read from the workbook, not guessed).
//
// KEY STRUCTURAL FACT (this is what earlier revisions got wrong):
// in the real sheet, the description column (B:H) has NO grid at all
// between line items — only a single thick vertical rule down its left
// edge for the whole block. The real grid (thin verticals + occasional
// thick outer edges) lives ONLY in the numeric columns (I = Object
// Classification Code, J = Monthly Rate, K = Amount), and even there,
// horizontal lines only appear under specific milestone/total rows —
// not between every row. This function reproduces that exactly instead
// of boxing every cell.
function iaBillFHtml(bill) {
  const f = bill.fields || iaResolveBillFields(bill);
  const b = (v) => (v || v === 0 ? Number(v).toLocaleString() : '');

  // Column widths, proportional to the workbook's B:H / I / J / K widths,
  // scaled to a fixed total so this lines up with the rest of the page.
  const W_LABEL = 423; // merged B:H (description column)
  const W_CODE  = 94;  // I — Object Classification Code
  const W_RATE  = 101; // J — Monthly Rate
  const W_AMT   = 101; // K — Amount
  const W_TOTAL = W_LABEL + W_CODE + W_RATE + W_AMT;

  // Border weights, matching the workbook's thin/medium/thick styles.
  const THIN   = '1px solid #000';
  const THICK  = '2px solid #000';
  const DOTTED = '1px dotted #000';

  const BL_THICK = `border-left:${THICK};`;
  const BR_THIN  = `border-right:${THIN};`;
  const BR_THICK = `border-right:${THICK};`;

  // Generic cell renderer — every visual property (size/bold/underline/
  // italic/align/border/padding) comes from the row spec below, which
  // mirrors the workbook cell-for-cell.
  function td(html, o = {}) {
    const size = o.size || 11;
    const bold = o.bold ? 'font-weight:700;' : '';
    const underline = o.underline ? 'text-decoration:underline;' : '';
    const italic = o.italic ? 'font-style:italic;' : '';
    const align = o.align || 'left';
    const pad = o.pad || '2px 6px';
    return `<td style="padding:${pad};font-size:${size}px;text-align:${align};${bold}${underline}${italic}${o.border || ''}">${html}</td>`;
  }

  // One "line" of the bill: description cell (only ever gets the thick
  // left rule) + the three numeric cells (which carry the real grid).
  // `milestone: true` adds the thin bottom rule the workbook draws under
  // totals/section boundaries — the ONLY place horizontal lines appear
  // in the numeric columns.
  function gridRow(label, labelOpts, code, codeOpts, rate, rateOpts, amount, amtOpts, milestone) {
    const bb = milestone ? `border-bottom:${THIN};` : '';
    return `<tr>
      ${td(label, { ...labelOpts, align: labelOpts.align || 'left', border: BL_THICK })}
      ${td(code, { ...codeOpts, align: codeOpts.align || 'center', border: BL_THICK + BR_THIN + bb })}
      ${td(rate, { ...rateOpts, align: rateOpts.align || 'center', border: BR_THIN + bb })}
      ${td(amount, { ...amtOpts, align: amtOpts.align || 'center', border: BR_THICK + bb })}
    </tr>`;
  }

  // ── Grant/DDO header block (rows 6-9 in the sheet) ──────────────────
  // Grant info spans 4 rows on the left; DDO Code/Personal No./Name/
  // Month stack on the right, each value spanning the same two columns
  // (rate+amount) that Markaz/Monthly Rate/Amount use further down —
  // so the right edge of this box is always the table's own border.
  const headerRows = `
    <tr>
      <td rowspan="4" style="${BL_THICK}border-top:${THICK};padding:4px 6px;vertical-align:top;font-size:11px;">
        GRANT NO.15<br><br>
        Functional&nbsp;&nbsp;&nbsp;&nbsp;Major&nbsp;&nbsp;&nbsp;&nbsp;40000 = Social Services<br><br>
        Classification&nbsp;&nbsp;&nbsp;&nbsp;Minor&nbsp;&nbsp;&nbsp;&nbsp;41000 = Education<br><br>
        of Expend&nbsp;&nbsp;&nbsp;&nbsp;Detailed
      </td>
      <td style="${BL_THICK}${BR_THICK}border-top:${THICK};border-bottom:${THIN};padding:3px 8px;font-weight:700;font-size:16px;">DDO Code</td>
      <td colspan="2" style="${BR_THICK}border-top:${THICK};border-bottom:${THIN};padding:3px 8px;font-weight:700;font-size:22px;text-align:center;">${f.ddeoCode}</td>
    </tr>
    <tr>
      <td style="${BL_THICK}${BR_THICK}border-bottom:${THIN};padding:3px 8px;font-weight:700;font-size:16px;">Personal No.</td>
      <td colspan="2" style="${BR_THICK}border-top:${THIN};border-bottom:${THIN};padding:3px 8px;font-weight:700;font-size:22px;text-align:center;">${f.personalNo}</td>
    </tr>
    <tr>
      <td style="${BL_THICK}${BR_THICK}border-bottom:${THIN};padding:3px 8px;font-weight:700;font-size:16px;">Name</td>
      <td colspan="2" style="${BR_THICK}border-top:${THIN};border-bottom:${THIN};padding:3px 8px;font-weight:700;font-size:20px;text-align:center;">${f.name}</td>
    </tr>
    <tr>
      <td style="${BL_THICK}${BR_THICK}border-bottom:${THIN};padding:3px 8px;font-weight:700;font-size:16px;">Month</td>
      <td colspan="2" style="${BR_THICK}border-top:${THIN};border-bottom:${THIN};padding:3px 8px;font-weight:700;font-size:20px;text-align:center;">${f.periodDisplay}</td>
    </tr>
    <tr>
      <td style="${BL_THICK}border-right:${THIN};border-bottom:${THICK};padding:0;font-weight:700;font-size:14px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="width:56px;padding:2px 6px;border-right:${THIN};white-space:nowrap;text-align:center;">Name:</td>
            <td style="padding:2px 6px;border-right:${THIN};text-align:center;font-size:16px;">${f.name}</td>
            <td style="width:70px;padding:2px 6px;border-right:${THIN};text-align:center;white-space:nowrap;">Post Held</td>
            <td style="padding:2px 6px;text-align:center;">${f.postHeld}</td>
          </tr>
        </table>
      </td>
      <td style="${BL_THICK}${BR_THICK}border-bottom:${THICK};padding:2px 6px;font-weight:700;font-size:16px;text-align:center;">Markaz:</td>
      <td colspan="2" style="${BR_THICK}border-bottom:${THICK};padding:2px 6px;font-weight:700;font-size:18px;text-align:center;">${f.markaz}</td>
    </tr>
    <tr>
      <td style="${BL_THICK}padding:2px 6px;font-size:10px;">&nbsp;</td>
      <td style="${BL_THICK}${BR_THIN}text-align:center;font-weight:700;padding:2px 6px;font-size:10px;">Object<br><span style="font-size:12px">Classification Code</span></td>
      <td style="${BR_THIN}text-align:center;font-weight:700;padding:2px 6px;font-size:10px;">Monthly<br><span style="font-size:12px">Rate</span></td>
      <td style="${BR_THICK}border-bottom:${THIN};text-align:center;font-weight:700;padding:2px 6px;font-size:10px;">Amount.</td>
    </tr>`;

  // ── Detail rows (rows 13-48 in the sheet) ───────────────────────────
  // "Special Pay" / "Technical Pay" (rows 17-18) are a special case: in
  // the sheet, columns C:H merge ACROSS both rows to hold the single
  // certification note, while column B alone carries "Special Pay" then
  // "Technical Pay" on separate lines. A rowspan on the outer label cell
  // plus a small nested table reproduces that exactly.
  const specialPayRows = `
    <tr>
      <td rowspan="2" style="${BL_THICK}padding:0;">
        <table style="width:100%;height:100%;border-collapse:collapse;">
          <tr>
            <td style="width:62px;padding:2px 4px;font-size:10px;vertical-align:top;">Special Pay</td>
            <td rowspan="2" style="padding:2px 4px;font-size:12px;font-weight:700;font-style:italic;vertical-align:middle;">It is certified that the Inspection Allowance of...................................................has not been recieved by undersigned.</td>
          </tr>
          <tr><td style="padding:2px 4px;font-size:8px;vertical-align:bottom;">Technical Pay</td></tr>
        </table>
      </td>
      ${td('A01153', { size: 10, align: 'center', border: BL_THICK + BR_THIN })}
      ${td('', { border: BR_THIN })}
      ${td('', { border: BR_THICK })}
    </tr>
    <tr>
      ${td('A01104', { size: 12, align: 'center', border: BL_THICK + BR_THIN })}
      ${td('', { border: BR_THIN + `border-bottom:${THIN};` })}
      ${td('', { border: BR_THICK + `border-bottom:${THIN};` })}
    </tr>`;

  const regularAllowanceRows = [
    ['House Rent Allowance', 'A01202'],
    ['Dearness Allowance', 'A01205'],
    ['Special Additonal Allowance', 'A01209'],
    ['Medical Allowance', 'A01274'],
    ['Charge Allowance', 'A01238'],
    ['Sc Allowance 1546', ''],
    ['Special/Relief Allowance 15%', 'A0120A'],
    ['SSB Allowance', 'A04115'],
    ['CONVEYANCE ALLOWANCE 2011', 'AO1203']
  ].map(([label, code]) => gridRow(label, { size: 11 }, code, { size: 12 }, '', {}, '', {}, false)).join('');

  const detailRows = `
    ${gridRow('', {}, 'A01151', { size: 12 }, '', {}, '', {}, false)}
    ${gridRow('the payment as detailed below:-', { size: 11 }, '', {}, '', {}, '', {}, false)}
    ${gridRow('BASIC SALARY', { size: 11 }, '', {}, '', {}, '', {}, false)}
    ${gridRow('My Substantive/ Officiating Pay', { size: 11 }, '', {}, '', {}, '', {}, false)}
    ${specialPayRows}
    ${gridRow('<span style="padding-left:66px">TOTAL BASIC SALARY</span>', { size: 11 }, 'A011', { size: 12, bold: true }, '0', { size: 12, bold: true }, '0', { size: 12, bold: true }, true)}

    ${gridRow('REGULAR ALLOWANCES:', { size: 12, bold: true, underline: true }, '', {}, '', {}, '', {}, false)}
    ${regularAllowanceRows}
    ${gridRow(`<span style="font-weight:700;font-size:13px">Inspection Allowance</span> <span style="font-weight:700;font-size:14px">${f.monthsCsvPadded}</span>`, {}, 'AO1297', { size: 13 }, b(f.totalGross), { size: 13, bold: true }, b(f.totalGross), { size: 13, bold: true }, true)}
    ${gridRow('<span style="padding-left:66px">TOTAL REGULAR ALLOWANCES</span>', { size: 11 }, 'A012', { size: 12, bold: true }, b(f.totalGross), { size: 18, bold: true }, b(f.totalGross), { size: 18, bold: true }, true)}

    ${gridRow('OTHER ALLOWANCES:', { size: 12, bold: true, underline: true }, '', {}, '', {}, '', {}, false)}
    ${gridRow('Leave Salary', { size: 11 }, 'A01278', { size: 12 }, '', {}, '', {}, false)}
    ${gridRow('<span style="padding-left:66px">Total Other Allowance</span>', { size: 11 }, 'A01299', { size: 12 }, '', {}, '', {}, false)}

    ${gridRow('Gross Claim Establishment Charges', { size: 12, bold: true, underline: true }, '&nbsp;0<br>0000', { size: 12, bold: true }, b(f.totalGross), { size: 15, bold: true }, b(f.totalGross), { size: 15, bold: true }, true)}
    ${gridRow('<span style="padding-left:66px">(Pay + Regular Allow + Other Allow)</span>', { size: 11 }, '', {}, '', {}, '', {}, true)}

    ${gridRow('LESS FUND DEDUCTION:', { size: 12, bold: true, underline: true }, '', {}, '', {}, '', {}, false)}
    ${gridRow('G.P.Fund Account No----------------------', { size: 11 }, '11502', { size: 12 }, '', {}, '', {}, false)}
    ${gridRow('G.P.F', { size: 11 }, 'G06103', { size: 12 }, '', {}, '', {}, false)}
    ${gridRow('Benevolent Fund', { size: 11 }, 'G06201', { size: 12 }, '', {}, '', {}, false)}
    ${gridRow('Group Insurance Fund', { size: 11 }, 'G06408', { size: 12 }, '', {}, '', {}, false)}
    ${gridRow('<span style="padding-left:66px">Net Claim:</span>', { size: 11 }, '', {}, '', {}, '', {}, false)}

    ${gridRow('DEDUCTIONS:', { size: 12, bold: true, underline: true }, '', {}, '', {}, '', {}, true)}
    ${gridRow('Income Tax', { size: 9 }, '0 102', { size: 9 }, '', {}, '', { bold: true }, true)}
    ${gridRow('Deductions on account of Advance and Recoveries', { size: 9 }, '', {}, '', {}, '', {}, false)}
    ${gridRow('Advance of Pay:', { size: 9 }, '14101', { size: 9 }, '', {}, '', {}, false)}
    ${gridRow('<span style="padding-left:66px">' + iaNumberToWordsPKR(f.totalGross) + '</span>', { size: 11 }, '', {}, '', {}, b(f.totalDeduction), { size: 18, bold: true, align: 'right' }, true)}
    <tr>
      ${td('Net Amount Payable:-', { size: 11, border: BL_THICK })}
      ${td('', { border: BL_THICK + `border-right:${THIN};` + `border-top:${THICK};border-bottom:${THICK};` })}
      ${td(b(f.totalGross), { size: 18, bold: true, align: 'center', border: `border-right:${THIN};border-top:${THICK};border-bottom:${THICK};` })}
      ${td(b(f.netTotal), { size: 18, bold: true, align: 'center', border: BR_THICK + `border-top:${THICK};border-bottom:${THICK};` })}
    </tr>
  `;

  // The "Rupees:" line sits OUTSIDE the numeric grid in the sheet (no
  // I/J/K columns on that row at all) — just the description column
  // with a dotted rule under it, so it's rendered as its own tiny table.
  const rupeesLine = `<colgroup><col style="width:100px;"><col style="width:${W_TOTAL - 100}px;"></colgroup>
  <tr>
    <td style="${BL_THICK}border-bottom:${DOTTED};padding:2px 6px;font-size:12px;white-space:nowrap;">Rupees:&nbsp;</td>
    <td style="${BR_THICK}border-bottom:${DOTTED};padding:2px 6px;font-size:18px;font-weight:700;white-space:nowrap;">${iaNumberToWordsPKR(f.netTotal)}</td>
  </tr>`;

  const colgroup = `<colgroup>
    <col style="width:${W_LABEL}px;"><col style="width:${W_CODE}px;">
    <col style="width:${W_RATE}px;"><col style="width:${W_AMT}px;">
  </colgroup>`;

  const body = `
    <div style="width:${W_LABEL}px;text-align:right;font-size:13px;margin-bottom:10px">Pay Bill Of Gazetted Officer</div>

    <table style="min-width:0;width:100%;margin-bottom:8px"><tr>
      <td style="width:60%;font-size:11px;vertical-align:top">
        Form No.S.T.R.18<br>
        <span style="font-size:11px">Note:- Government accepts no responsibility for any fraud or misappropriation in respect of money or cheque or bill made over to a messenger.</span>
      </td>
      <td style="width:40%;font-size:12px;font-weight:700;direction:rtl;text-align:right;vertical-align:top">یہ بل ٹوکن رجسٹر پر سیریل نمبر..........................پر درج ہے۔</td>
    </tr></table>

    <table style="min-width:0;width:${W_TOTAL}px;border-collapse:collapse;">
      ${colgroup}
      ${headerRows}
      ${detailRows}
    </table>

    <table style="min-width:0;width:${W_TOTAL}px;border-collapse:collapse;margin-top:0;">
      ${rupeesLine}
    </table>

    <table style="min-width:0;width:100%;font-size:14px;margin-top:16px"><tr>
      <td style="width:100%;text-align:right;padding-top:20px;font-weight:700">Signature and Stamp of Officer</td>
    </tr></table>
  `;

  return iaPageShell(f.officeHeader, '', body, 800);
}

// ─── Bill B (Detail of Inspection Allowance) — Page 3 ──────────────
function iaBillBHtml(bill) {
  const f = bill.fields || iaResolveBillFields(bill);

  // Source form always prints 4 rows (Sr.# 1-4)
  const claimRows = [...bill.claims];
  while (claimRows.length < IA_MAX_SELECTED) claimRows.push(null);

  const rows = claimRows.map((c, i) => {
    if (!c) {
      return `<tr>
        <td style="padding:5px 8px;border:1px solid #333">${i + 1}</td>
        <td style="padding:5px 8px;border:1px solid #333"></td>
        <td style="padding:5px 8px;border:1px solid #333;text-align:right">0</td>
        <td style="padding:5px 8px;border:1px solid #333;text-align:right">0</td>
        <td style="padding:5px 8px;border:1px solid #333;text-align:right">0</td>
        <td style="padding:5px 8px;border:1px solid #333;text-align:right">0</td>
      </tr>`;
    }
    const due = Number(c.due) || 0;
    return `<tr>
      <td style="padding:5px 8px;border:1px solid #333">${i + 1}</td>
      <td style="padding:5px 8px;border:1px solid #333">${IA_MONTH_NAMES[c.month - 1]} ${c.year}</td>
      <td style="padding:5px 8px;border:1px solid #333;text-align:right">${due.toLocaleString()}</td>
      <td style="padding:5px 8px;border:1px solid #333;text-align:right">0</td>
      <td style="padding:5px 8px;border:1px solid #333;text-align:right">${due.toLocaleString()}</td>
      <td style="padding:5px 8px;border:1px solid #333;text-align:right">${due.toLocaleString()}</td>
    </tr>`;
  }).join('');

  const body = `
    <div style="font-size:11px;font-weight:700;margin-bottom:6px">Certified that:-</div>
    <div style="font-size:10px;line-height:1.6;margin-bottom:16px">
      <p>(a) I have neither been provided with accommodation by the Government nor I share any such accommodation with another allottee without necessary permission of the Estate Officer.</p>
      <p>(b) My wife/husband is in the service of the Federal/Provincial Government/Autonomous body.</p>
      <p>(c) My wife/husband who is in the service of Federal/Provincial Government/Autonomous body is in receipt of house rent allowance.</p>
      <p>(d) I am not residing within my work premises.</p>
      <p>(e) I am not maintaining a Motor Cycle/Car No. ………………………….. which is registered in my own name or in the name of my spouse who is not drawing Motor Cycle/Car Allowance for the same.</p>
    </div>
    <p style="font-size:11px;font-weight:700;text-align:right;margin-bottom:20px">Signature and Stamp of Officer</p>

    <div style="text-align:center;font-size:14px;font-weight:700;margin-bottom:14px">DETAIL INSPECTION ALLOWANCE</div>
    <table style="min-width:0;width:100%;table-layout:fixed;border-collapse:collapse;border:1px solid #333;font-size:11.5px;margin-bottom:14px">
      <colgroup>
        <col style="width:8%"><col style="width:34%"><col style="width:14.5%">
        <col style="width:14.5%"><col style="width:14.5%"><col style="width:14.5%">
      </colgroup>
      <tr style="font-weight:700;font-size:13px">
        <td style="padding:8px;border:1px solid #333;text-align:center" colspan="2">${f.name}</td>
        <td style="padding:8px;border:1px solid #333;text-align:center" colspan="4">${f.markaz}</td>
      </tr>
      <tr style="font-weight:700;background:#f2f2f2">
        <td style="padding:6px 8px;border:1px solid #333;text-align:center" colspan="2">Period</td>
        <td style="padding:6px 8px;border:1px solid #333;text-align:center">Due</td>
        <td style="padding:6px 8px;border:1px solid #333;text-align:center">Drawn</td>
        <td style="padding:6px 8px;border:1px solid #333;text-align:center">Difference</td>
        <td style="padding:6px 8px;border:1px solid #333;text-align:center">Total</td>
      </tr>
      ${rows}
      <tr style="font-weight:700">
        <td style="padding:6px 8px;border:1px solid #333" colspan="2">NET CLAIM</td>
        <td style="padding:6px 8px;text-align:right;border:1px solid #333">${f.netTotal.toLocaleString()}</td>
        <td style="padding:6px 8px;text-align:right;border:1px solid #333">0</td>
        <td style="padding:6px 8px;text-align:right;border:1px solid #333">${f.netTotal.toLocaleString()}</td>
        <td style="padding:6px 8px;text-align:right;border:1px solid #333">${f.netTotal.toLocaleString()}</td>
      </tr>
    </table>
    <p style="font-size:11px;text-align:right;margin-bottom:50px"><b>Net Amount (In words):</b> ${iaNumberToWordsPKR(f.netTotal)}</p>
    <table style="min-width:0;width:100%;font-size:11px"><tr>
      <td style="width:100%;text-align:right;padding-top:20px;font-weight:700">Signature and Stamp of Officer</td>
    </tr></table>`;
  return iaPageShell('', '', body);
}

// ─── Number to words ──────────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════
//  BILL PDF ASSEMBLY + DOWNLOAD
//  Wires the HTML-builder helpers above (iaAdjustmentFormHtml,
//  iaBillFHtml, iaBillBHtml) into an actual multi-page PDF using the
//  same off-screen html2canvas + jsPDF pattern already proven working
//  in performance.js (perfBuildCertificatePdfBytes) and
//  budget-preparation.js (bpRenderTargetIntoPdf). Renders into the
//  #iaPdfRenderTarget element that already sits in index.html.
// ═══════════════════════════════════════════════════════════════════

async function iaBuildBillPdfBytes(pagesHtml, fitModes) {
  fitModes = fitModes || pagesHtml.map(() => 'contain');
  const target = document.getElementById('iaPdfRenderTarget');
  if (!target) throw new Error('#iaPdfRenderTarget not found in the page.');

  // Same reliable off-screen-capture pattern used elsewhere in this repo:
  // position it on-screen but visibility:hidden, then let html2canvas's
  // onclone flip it visible only inside its own private capture DOM.
  target.style.position = 'absolute';
  target.style.left = '0';
  target.style.top = '0';
  target.style.width = '830px';
  target.style.visibility = 'hidden';
  target.style.zIndex = '-1';

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pagesHtml.length; i++) {
    target.innerHTML = pagesHtml[i];
    // Give the browser a beat to lay out/paint (esp. any images) before capture.
    await new Promise((r) => setTimeout(r, 250));

    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      onclone: function (clonedDoc) {
        const clonedTarget = clonedDoc.getElementById('iaPdfRenderTarget');
        if (clonedTarget) clonedTarget.style.visibility = 'visible';
      },
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const mode = fitModes[i] || 'contain';
    let scale, drawWidth, drawHeight, offsetX, offsetY;
    if (mode === 'fill-width') {
      // Fill the full page width (this page's content runs taller than
      // A4's aspect ratio, so a plain contain-fit shrinks it to leave
      // empty bands on both sides — fill-width removes those margins).
      scale = pageWidth / canvas.width;
      drawWidth = pageWidth;
      drawHeight = canvas.height * scale;
      offsetX = 0;
      offsetY = 0;
    } else {
      scale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
      drawWidth = canvas.width * scale;
      drawHeight = canvas.height * scale;
      offsetX = (pageWidth - drawWidth) / 2;
      offsetY = (pageHeight - drawHeight) / 2;
    }

    if (i > 0) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', offsetX, offsetY, drawWidth, drawHeight);
  }

  // Clean up — restore the target to its original inert state.
  target.innerHTML = '';
  target.style.position = '';
  target.style.left = '';
  target.style.top = '';
  target.style.width = '';
  target.style.visibility = '';
  target.style.zIndex = '';

  return pdf.output('arraybuffer');
}

// ─── Entry point: "Download Bill (PDF)" button (index.html) ────────
async function iaDownloadBill() {
  if (!iaState.profile) { showToast('Profile not loaded yet.', false); return; }
  if (iaState.selected.size === 0) { showToast('Select at least one prepared month.', false); return; }

  const btn = document.getElementById('iaSubmitBtn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating…';

  try {
    const months = [...iaState.selected].sort((a, b) => a - b);

    // Build one "claim" per selected month from the already-loaded
    // months grid data (deduction/due were computed server-side by
    // getMyInspectionAllowanceMonths; allowance_rate is the flat
    // monthly rate from getInspectionAllowanceRate).
    const claims = months.map((m) => {
      const row = iaState.months.find((x) => x.month === m) || {};
      return {
        month: m,
        year: iaState.year,
        allowance_rate: iaState.rate,
        deduction: Number(row.deduction) || 0,
        due: Number(row.due) || 0,
      };
    });

    const bill = { user: iaState.profile, claims };
    bill.fields = iaResolveBillFields(bill); // resolve once, reuse across all 3 pages

    const pagesHtml = [
      iaAdjustmentFormHtml(bill), // Page 1 — Payment of Arrears Pay & Allowances Through Adjustments
      iaBillFHtml(bill),          // Page 2 — S.T.R.18 Pay Bill
      iaBillBHtml(bill),          // Page 3 — Detail of Inspection Allowance
    ];

    const pdfBytes = await iaBuildBillPdfBytes(pagesHtml, ['contain', 'fill-width', 'contain']);

    const label = months.map((m) => IA_MONTH_NAMES[m - 1]).join('-');
    const filename = `Inspection_Allowance_Bill_${iaState.profile.personal_no || 'AEO'}_${label}_${iaState.year}.pdf`;
    iaDownloadPdf(pdfBytes, filename);
    showToast('Bill downloaded.', true);
  } catch (err) {
    showToast('Error generating bill: ' + err.message, false);
  } finally {
    btn.disabled = iaState.selected.size === 0;
    btn.innerHTML = originalHtml;
  }
}
