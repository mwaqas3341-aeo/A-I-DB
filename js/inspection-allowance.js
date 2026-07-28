// ═══════════════════════════════════════════════════════════════════
//  INSPECTION ALLOWANCE — bill preparation module
//  Two workflows depending on the AEO's tehsil+wing budget type:
//   - Collective: a Tehsil Representative prepares deductions centrally
//     during Budget Preparation. The AEO just clicks Download Bill —
//     no questions asked — for whatever prepared months are pending.
//   - Individual: no TR is assigned (or tehsil+wing is explicitly set
//     to Individual). The AEO picks 1-4 months themselves (any year)
//     and enters their own deduction (blank/0 = full rate), then
//     generates the bill directly.
//  Either way, a read-only history table below shows the last 18
//  months on file — for viewing only, never for interaction.
// ═══════════════════════════════════════════════════════════════════

const IA_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const IA_MAX_SELECTED = 4;

let iaState = {
  rate: 25000,
  profile: null,
  mode: 'individual',     // 'collective' | 'individual'
  tehsil: '', wing: '',
  pendingCollective: [],  // collective mode: prepared-but-not-yet-downloaded rows
  wizardEntries: [],      // individual mode: [{year, month, deduction}] from the dropdown wizard
};

// ─── Entry point (dashboard card) ──────────────────────────────────
async function openInspectionAllowanceView() {
  if (typeof switchGlobalTab === 'function') switchGlobalTab('inspectionAllowanceView', null);

  const isAdmin = String(currentUser?.role).toLowerCase() === 'admin';
  const isTr = Array.isArray(currentUser?.tr_scopes) && currentUser.tr_scopes.length > 0;
  document.getElementById('iaTabBudgetPrepBtn').style.display = (isAdmin || isTr) ? 'inline-flex' : 'none';
  iaSwitchTab('myBill');

  await iaLoadRate();
  await iaLoadProfile();
  await iaLoadMode();
  iaLoadHistory();
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

  const incomplete = !res.ddeo_code || !res.bps_scale;
  document.getElementById('iaProfileIncompleteWarn').style.display = incomplete ? 'block' : 'none';
  iaState.profileIncomplete = incomplete;
  if (incomplete) {
    document.getElementById('iaSubmitBtn').disabled = true;
    document.getElementById('iaCollectiveDownloadBtn').disabled = true;
  }
}

// ─── Mode resolution (Collective vs Individual) ─────────────────────
async function iaLoadMode() {
  document.getElementById('iaModeLoading').style.display = 'block';
  document.getElementById('iaCollectiveBox').style.display = 'none';
  document.getElementById('iaIndividualBox').style.display = 'none';

  const res = await apiCall('getMyBudgetMode');
  document.getElementById('iaModeLoading').style.display = 'none';
  if (!res || !res.success) { showToast(res?.message || 'Could not determine your budget type.', false); return; }

  iaState.mode = res.mode;
  iaState.tehsil = res.tehsil;
  iaState.wing = res.wing;

  if (res.mode === 'collective') {
    document.getElementById('iaCollectiveBox').style.display = 'block';
    await iaLoadPendingCollective();
  } else {
    document.getElementById('iaIndividualBox').style.display = 'block';
    iaRenderWizardRows();
  }
}

// ─── Collective mode: one-click download, zero questions ───────────
async function iaLoadPendingCollective() {
  const statusEl = document.getElementById('iaCollectiveStatus');
  const btn = document.getElementById('iaCollectiveDownloadBtn');
  statusEl.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Checking for prepared months…';
  btn.disabled = true;

  const res = await apiCall('getMyPendingCollectiveBill');
  if (!res || !res.success) { statusEl.innerHTML = `<span style="color:var(--bad)">${res?.message || 'Could not load your bill.'}</span>`; return; }

  iaState.pendingCollective = res.months || [];
  if (!iaState.pendingCollective.length) {
    statusEl.innerHTML = `Nothing to download yet for <b>${iaState.tehsil} / ${iaState.wing}</b> — ask your Tehsil Representative to prepare this month's budget.`;
    btn.disabled = true;
    return;
  }
  const label = iaState.pendingCollective.map(m => `${IA_MONTH_NAMES[m.month - 1]} ${m.year}`).join(', ');
  const total = iaState.pendingCollective.reduce((s, m) => s + Number(m.due || 0), 0);
  statusEl.innerHTML = `Ready to download: <b>${label}</b> — Net Total <b style="color:#0d9488">PKR ${total.toLocaleString()}</b>`;
  btn.disabled = !!iaState.profileIncomplete;
}

async function iaDownloadCollectiveBill() {
  if (!iaState.profile) { showToast('Profile not loaded yet.', false); return; }
  if (!iaState.pendingCollective.length) { showToast('Nothing to download.', false); return; }

  const btn = document.getElementById('iaCollectiveDownloadBtn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating…';

  try {
    const claims = iaState.pendingCollective.map(m => ({
      month: m.month, year: m.year, allowance_rate: Number(m.allowance_rate) || iaState.rate,
      deduction: Number(m.deduction) || 0, due: Number(m.due) || 0,
    }));
    const filename = await iaBuildAndDownloadBill(claims);

    const ids = iaState.pendingCollective.map(m => m.id);
    await apiCall('markInspectionAllowanceDownloaded', { ids });

    showToast('Bill downloaded.', true);
    iaLoadHistory();
    iaRedirectToPerformance(claims);
    iaState.pendingCollective = [];
    document.getElementById('iaCollectiveStatus').innerHTML = 'Downloaded. Check back once your TR prepares the next month.';
  } catch (err) {
    showToast('Error generating bill: ' + err.message, false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// ─── Individual mode: Number of Months → cascading pickers → deductions ─
function iaRenderWizardRows() {
  const count = Number(document.getElementById('ia_wizardCount').value) || 1;
  const wrap = document.getElementById('iaWizardRows');
  const yNow = new Date().getFullYear();
  const years = [yNow - 1, yNow, yNow + 1];

  // Preserve any rows already filled in when the count changes.
  const prev = iaState.wizardEntries;
  iaState.wizardEntries = Array.from({ length: count }, (_, i) => prev[i] || { year: yNow, month: new Date().getMonth() + 1, deduction: '' });

  wrap.innerHTML = iaState.wizardEntries.map((e, i) => `
    <div style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;padding:10px 0;border-bottom:1px dashed var(--s2)">
      <div class="ff" style="min-width:110px">
        <span class="flabel">Year</span>
        <select onchange="iaWizardUpdate(${i}, 'year', this.value)" style="height:36px;border:1px solid var(--b0);border-radius:6px;padding:0 8px">
          ${years.map(y => `<option value="${y}" ${y === e.year ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
      </div>
      <div class="ff" style="min-width:150px">
        <span class="flabel">Month</span>
        <select onchange="iaWizardUpdate(${i}, 'month', this.value)" style="height:36px;border:1px solid var(--b0);border-radius:6px;padding:0 8px">
          ${IA_MONTH_NAMES.map((name, mi) => `<option value="${mi + 1}" ${mi + 1 === e.month ? 'selected' : ''}>${name}</option>`).join('')}
        </select>
      </div>
      <div class="ff" style="min-width:180px">
        <span class="flabel">Deduction by DDEO (if any)</span>
        <input type="number" min="0" step="1" placeholder="0 = full amount" value="${e.deduction}"
          oninput="iaWizardUpdate(${i}, 'deduction', this.value)"
          style="height:36px;border:1px solid var(--b0);border-radius:6px;padding:0 8px;width:100%">
      </div>
    </div>`).join('');

  iaUpdateWizardTotal();
}

function iaWizardUpdate(i, field, value) {
  const e = iaState.wizardEntries[i];
  if (!e) return;
  e[field] = (field === 'deduction') ? value : Number(value);
  iaUpdateWizardTotal();
}

function iaUpdateWizardTotal() {
  const total = iaState.wizardEntries.reduce((s, e) => s + Math.max(0, iaState.rate - (Number(e.deduction) || 0)), 0);
  document.getElementById('iaNetTotalDisplay').textContent = 'PKR ' + total.toLocaleString();
}

async function iaGenerateIndividualBill() {
  if (!iaState.profile) { showToast('Profile not loaded yet.', false); return; }
  if (iaState.profileIncomplete) { showToast('Complete your profile (DDEO Code / BPS Scale) before generating a bill.', false); return; }
  const entries = iaState.wizardEntries;

  // Validate before hitting the server: no duplicate year+month pairs.
  const keys = entries.map(e => `${e.year}-${e.month}`);
  if (new Set(keys).size !== keys.length) { showToast('You picked the same month/year twice — choose different months.', false); return; }

  const btn = document.getElementById('iaSubmitBtn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating…';

  try {
    const payloadEntries = entries.map(e => ({ year: e.year, month: e.month, deduction: Number(e.deduction) || 0 }));
    const res = await apiCall('submitIndividualBill', { entries: payloadEntries });
    if (!res || !res.success) throw new Error(res?.message || 'Could not save your bill.');

    const rate = Number(res.rate) || iaState.rate;
    const claims = (res.entries || []).map(r => ({
      month: r.month, year: r.year, allowance_rate: rate, deduction: Number(r.deduction) || 0, due: Number(r.due) || 0,
    }));

    await iaBuildAndDownloadBill(claims);
    showToast('Bill generated and downloaded.', true);
    iaLoadHistory();
    iaRedirectToPerformance(claims);
  } catch (err) {
    showToast('Error generating bill: ' + err.message, false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// ─── Shared PDF build+download (used by both modes) ─────────────────
async function iaBuildAndDownloadBill(claims) {
  claims = claims.slice().sort((a, b) => (a.year - b.year) || (a.month - b.month));
  const bill = { user: iaState.profile, claims };
  bill.fields = iaResolveBillFields(bill); // resolve once, reuse across all 3 pages

  const pagesHtml = [
    iaAdjustmentFormHtml(bill), // Page 1 — Payment of Arrears Pay & Allowances Through Adjustments
    iaBillFHtml(bill),          // Page 2 — S.T.R.18 Pay Bill
    iaBillBHtml(bill),          // Page 3 — Detail of Inspection Allowance
  ];
  const pdfBytes = await iaBuildBillPdfBytes(pagesHtml, ['contain', 'fill-width', 'contain']);

  const label = claims.map(c => `${IA_MONTH_NAMES[c.month - 1]}-${c.year}`).join('_');
  const filename = `Inspection_Allowance_Bill_${iaState.profile.personal_no || 'AEO'}_${label}.pdf`;
  iaDownloadPdf(pdfBytes, filename);
  return filename;
}

// Bill generation and Performance Preparation must always stay in sync —
// after a successful download, jump straight to Performance with the
// exact same months (and years) already selected.
function iaRedirectToPerformance(claims) {
  const monthYearPairs = claims.map(c => ({ year: c.year, month: c.month }));
  iaSwitchTab('performance');
  if (typeof perfInitWithPreselected === 'function') {
    setTimeout(() => perfInitWithPreselected(monthYearPairs), 50);
  }
}

// ─── Read-only Bill History (both modes) ─────────────────────────────
async function iaLoadHistory() {
  const wrap = document.getElementById('iaHistoryTable');
  wrap.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3)"><span class="spinner-border spinner-border-sm"></span> Loading…</div>`;

  const res = await apiCall('getInspectionAllowanceHistory');
  if (!res || !res.success) { wrap.innerHTML = `<div style="color:var(--bad);padding:12px">${res?.message || 'Could not load history.'}</div>`; return; }

  const rows = res.data || [];
  if (!rows.length) { wrap.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3)">No records yet.</div>`; return; }

  wrap.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:.85rem">
      <thead><tr style="text-align:left;border-bottom:2px solid var(--b0);background:var(--s2)">
        <th style="padding:8px">Month</th><th style="padding:8px">Deduction</th>
        <th style="padding:8px">Due</th><th style="padding:8px">Downloaded</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr style="border-bottom:1px solid var(--s2)">
          <td style="padding:8px;font-weight:600">${IA_MONTH_NAMES[r.month - 1]} ${r.year}</td>
          <td style="padding:8px">PKR ${Number(r.deduction).toLocaleString()}</td>
          <td style="padding:8px;font-weight:700;color:#0d9488">PKR ${Number(r.due).toLocaleString()}</td>
          <td style="padding:8px;color:var(--t3)">${r.downloaded_at ? new Date(r.downloaded_at).toLocaleDateString() : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
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

function iaPageShell(title, officeHeader, bodyHtml, weight = 700, titleSize = 16, officeHeaderSize = 14) {
  return `
    ${IA_STYLE_RESET}
    <div style="width:830px;min-height:1174px;padding:40px 34px 40px 18px;font-family:'Arial Narrow',Arial,sans-serif;color:#111;font-weight:${weight};line-height:1.35;box-sizing:border-box">
      <div style="text-align:center;font-size:${titleSize}px;font-weight:700;text-transform:uppercase;margin-bottom:2px">${title}</div>
      ${officeHeader ? `<div style="text-align:center;font-size:${officeHeaderSize}px;font-weight:700;margin-bottom:14px">${officeHeader}</div>` : '<div style="margin-bottom:14px"></div>'}
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
    monthsCsvPadded: claims.map((c) => `${IA_MONTH_NAMES[c.month - 1]} ${c.year}`).join(', '),
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
    const isInspection = label === 'INSPECTION ALLOWANCE';
    const amt = isInspection ? inspectionAmount : 0;
    const labelStyle = isInspection ? 'font-size:16px;font-weight:700;' : '';
    const numStyle = isInspection ? 'font-size:22px;font-weight:700;' : '';
    return `<tr><td style="padding:3px 6px;border:1px solid #333">${i + 1}</td>
             <td style="padding:3px 6px;border:1px solid #333;${labelStyle}">${label}${isInspection ? ':' : ''}</td>
             <td style="padding:3px 6px;border:1px solid #333;text-align:center">${wageType}</td>
             <td style="padding:3px 6px;border:1px solid #333;text-align:center;${numStyle}">${glObject}</td>
             <td style="padding:3px 6px;border:1px solid #333;text-align:center;${numStyle}">${amt.toLocaleString()}</td></tr>`;
  }).join('');
  // NOTE: th{} is styled globally and darkly for dashboard tables elsewhere
  // in this app (see css/styles.css "thead th"), so every <th> below must
  // carry an explicit background/color/position override or it silently
  // inherits that dark sticky styling when captured for the PDF.
  const TH = 'background:#fff;color:#111;position:static;text-transform:none;font-weight:700;font-size:12px;';
  return `<table style="min-width:0;width:100%;table-layout:fixed;border-collapse:collapse;font-size:11px;margin-bottom:8px">
    ${IA_COLGROUP_5}
    <thead>
      <tr>
        <th style="${TH}text-align:left;padding:4px 6px;border:1.5px solid #333">Sr.#</th>
        <th style="${TH}text-align:left;padding:4px 6px;border:1.5px solid #333">Items</th>
        <th style="${TH}text-align:center;padding:4px 6px;border:1.5px solid #333">${showAdjustmentHeader ? 'Adjustment Wage Type' : 'Wage Type'}</th>
        <th style="${TH}text-align:center;padding:4px 6px;border:1.5px solid #333">G/L Object</th>
        <th style="${TH}text-align:center;padding:4px 6px;border:1.5px solid #333">Amount</th>
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
  const TH = 'background:#fff;color:#111;position:static;text-transform:none;font-weight:700;font-size:12px;';
  return `<table style="min-width:0;width:100%;table-layout:fixed;border-collapse:collapse;font-size:11px;margin-bottom:8px">
    ${IA_COLGROUP_5}
    <thead><tr>
      <th style="${TH}text-align:left;padding:4px 6px;border:1.5px solid #333">Sr.#</th>
      <th style="${TH}text-align:left;padding:4px 6px;border:1.5px solid #333">Deductions</th>
      <th style="${TH}text-align:center;padding:4px 6px;border:1.5px solid #333">Wage Type</th>
      <th style="${TH}text-align:center;padding:4px 6px;border:1.5px solid #333">G/L Object</th>
      <th style="${TH}text-align:center;padding:4px 6px;border:1.5px solid #333">Amount</th>
    </tr></thead>
    <tbody>
      ${IA_DEDUCTION_LINES.map(([label, wageType, glObject], i) => `
        <tr><td style="padding:3px 6px;border:1px solid #333">${i + 1}</td>
            <td style="padding:3px 6px;border:1px solid #333">${label}</td>
            <td style="padding:3px 6px;border:1px solid #333;text-align:center">${wageType}</td>
            <td style="padding:3px 6px;border:1px solid #333;text-align:center">${glObject}</td>
            <td style="padding:3px 6px;border:1px solid #333"></td></tr>`
      ).join('')}
      <tr><td style="padding:3px 6px;border:1px solid #333">${IA_DEDUCTION_LINES.length + 1}</td>
          <td style="padding:3px 6px;border:1px solid #333">Inspection allowance</td>
          <td style="padding:3px 6px;border:1px solid #333"></td>
          <td style="padding:3px 6px;border:1px solid #333"></td>
          <td style="padding:3px 6px;border:1px solid #333;text-align:center">${totalDeduction.toLocaleString()}</td></tr>
      <tr><td style="padding:3px 6px;border:1px solid #333">${IA_DEDUCTION_LINES.length + 2}</td>
          <td style="padding:3px 6px;border:1px solid #333">Adj ROP</td>
          <td style="padding:3px 6px;border:1px solid #333">6126</td>
          <td style="padding:3px 6px;border:1px solid #333"></td>
          <td style="padding:3px 6px;border:1px solid #333"></td></tr>
    </tbody>
  </table>`;
}

function iaAdjustmentFormHtml(bill) {
  const f = bill.fields || iaResolveBillFields(bill);

  const headerBlock = `
    <table style="min-width:0;width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11px">
      <colgroup><col style="width:20%"><col style="width:22%"><col style="width:23%"><col style="width:35%"></colgroup>
      <tr>
        <td style="padding:4px 6px;font-weight:700;border:1px solid #333">DDO Code / Cost Centre</td>
        <td style="padding:4px 6px;border:1px solid #333;font-size:18px;font-weight:700;">${f.ddeoCode}</td>
        <td style="padding:4px 6px;font-weight:700;border:1px solid #333;font-size:18px;">Description of Cost Centre</td>
        <td style="padding:4px 6px;border:1px solid #333;font-size:18px;font-weight:700;">${f.costCentreDescription}</td>
      </tr>
      <tr>
        <td style="padding:4px 6px;font-weight:700;border:1px solid #333">Personal Number</td>
        <td style="padding:4px 6px;border:1px solid #333;font-size:20px;font-weight:700;">${f.personalNo}</td>
        <td style="padding:4px 6px;border:1px solid #333;font-size:18px;font-weight:700;">${f.name}</td>
        <td style="padding:4px 6px;border:1px solid #333;font-size:18px;font-weight:700;">${f.markaz}</td>
      </tr>
      <tr>
        <td style="padding:4px 6px;font-weight:700;border:1px solid #333">Period of Bill / Claim</td>
        <td colspan="3" style="padding:4px 6px;border:1px solid #333;font-size:16px;font-weight:700;">${f.periodDisplay}</td>
      </tr>
    </table>`;

  const body = `
    ${headerBlock}
    ${iaAllowanceTable(f.totalGross, true)}
    <table style="min-width:0;width:100%;table-layout:fixed;border-collapse:collapse;font-size:16px;margin-bottom:10px">
      ${IA_COLGROUP_TOTAL}
      <tr><td style="padding:5px 6px;font-weight:700;border:1px solid #333">Total Pay &amp; Allowances</td>
          <td style="padding:5px 6px;text-align:right;font-weight:700;border:1px solid #333">${f.totalGross.toLocaleString()}</td></tr>
    </table>
    ${iaDeductionTable(f.totalDeduction)}
    <table style="min-width:0;width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px;margin-bottom:24px">
      ${IA_COLGROUP_TOTAL}
      <tr><td style="padding:5px 6px;font-weight:700;border:1px solid #333">Total Deductions</td><td style="padding:5px 6px;text-align:right;font-weight:700;border:1px solid #333">${f.totalDeduction.toLocaleString()}</td></tr>
      <tr><td style="padding:5px 6px;font-weight:700;font-size:18px;border:1px solid #333">Net Total</td><td style="padding:5px 6px;text-align:right;font-weight:700;font-size:18px;border:1px solid #333">${f.netTotal.toLocaleString()}</td></tr>
    </table>
    <p style="font-size:12px;margin-bottom:40px">Certified that sufficient budget is available to meet the above expenditure for the current financial year.</p>
    <table style="min-width:0;width:100%;font-size:12px"><tr>
      <td style="width:50%;text-align:center;padding-top:20px;font-weight:700">Assistant Education Officer<br>${f.markaz}</td>
      <td style="width:50%;text-align:center;padding-top:20px;font-weight:700">District Account Officer<br>${f.district}</td>
    </tr></table>`;
  return iaPageShell('Payment of Arrears Pay &amp; Allowances Through Adjustments', f.officeHeader, body, 700, 16, 14);
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
    const pad = o.pad || '5px 6px';
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
            <td style="width:62px;padding:4px 6px;font-size:10px;vertical-align:top;">Special Pay</td>
            <td rowspan="2" style="padding:4px 6px;font-size:12px;font-weight:700;font-style:italic;vertical-align:middle;">It is certified that the Inspection Allowance of ${f.period} has not been recieved by undersigned.</td>
          </tr>
          <tr><td style="padding:4px 6px;font-size:8px;vertical-align:bottom;">Technical Pay</td></tr>
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

  return iaPageShell(f.officeHeader, '', body, 800, 20);
}

// ─── Bill B (Detail of Inspection Allowance) — Page 3 ──────────────
function iaBillBHtml(bill) {
  const f = bill.fields || iaResolveBillFields(bill);

  // Source form always prints 4 rows (Sr.# 1-4)
  const claimRows = [...bill.claims];
  while (claimRows.length < IA_MAX_SELECTED) claimRows.push(null);

  const rows = claimRows.map((c, i) => {
    if (!c) {
      return `<tr style="font-size:14px">
        <td style="padding:5px 8px;border:1px solid #333">${i + 1}</td>
        <td style="padding:5px 8px;border:1px solid #333"></td>
        <td style="padding:5px 8px;border:1px solid #333;text-align:right;font-weight:700">0</td>
        <td style="padding:5px 8px;border:1px solid #333;text-align:right;font-weight:700">0</td>
        <td style="padding:5px 8px;border:1px solid #333;text-align:right;font-weight:700">0</td>
        <td style="padding:5px 8px;border:1px solid #333;text-align:right;font-weight:700">0</td>
      </tr>`;
    }
    const due = Number(c.due) || 0;
    return `<tr style="font-size:14px">
      <td style="padding:5px 8px;border:1px solid #333">${i + 1}</td>
      <td style="padding:5px 8px;border:1px solid #333;font-weight:700">${IA_MONTH_NAMES[c.month - 1]} ${c.year}</td>
      <td style="padding:5px 8px;border:1px solid #333;text-align:right;font-weight:700">${due.toLocaleString()}</td>
      <td style="padding:5px 8px;border:1px solid #333;text-align:right;font-weight:700">0</td>
      <td style="padding:5px 8px;border:1px solid #333;text-align:right;font-weight:700">${due.toLocaleString()}</td>
      <td style="padding:5px 8px;border:1px solid #333;text-align:right;font-weight:700">${due.toLocaleString()}</td>
    </tr>`;
  }).join('');

  const body = `
    <div style="font-size:11px;font-weight:700;margin-bottom:6px">Certified that:-</div>
    <div style="font-size:11px;line-height:1.6;margin-bottom:16px">
      <p>(a) I have neither been provided with accommodation by the Government nor I share any such accommodation with another allottee without necessary permission of the Estate Officer.</p>
      <p>(b) My wife/husband is in the service of the Federal/Provincial Government/Autonomous body.</p>
      <p>(c) My wife/husband who is in the service of Federal/Provincial Government/Autonomous body is in receipt of house rent allowance.</p>
      <p>(d) I am not residing within my work premises.</p>
      <p>(e) I am not maintaining a Motor Cycle/Car No. ………………………….. which is registered in my own name or in the name of my spouse who is not drawing Motor Cycle/Car Allowance for the same.</p>
    </div>
    <p style="font-size:14px;font-weight:700;text-align:right;margin-bottom:20px">Signature and Stamp of Officer</p>

    <div style="text-align:center;font-size:16px;font-weight:700;margin-bottom:14px">DETAIL INSPECTION ALLOWANCE</div>
    <table style="min-width:0;width:100%;table-layout:fixed;border-collapse:collapse;border:1px solid #333;font-size:11.5px;margin-bottom:14px">
      <colgroup>
        <col style="width:8%"><col style="width:34%"><col style="width:14.5%">
        <col style="width:14.5%"><col style="width:14.5%"><col style="width:14.5%">
      </colgroup>
      <tr style="font-weight:700;font-size:18px">
        <td style="padding:8px;border:1px solid #333;text-align:center" colspan="2">${f.name}</td>
        <td style="padding:8px;border:1px solid #333;text-align:center" colspan="4">${f.markaz}</td>
      </tr>
      <tr style="font-weight:700;background:#f2f2f2;font-size:12px">
        <td style="padding:6px 8px;border:1px solid #333;text-align:center" colspan="2">Period</td>
        <td style="padding:6px 8px;border:1px solid #333;text-align:center">Due</td>
        <td style="padding:6px 8px;border:1px solid #333;text-align:center">Drawn</td>
        <td style="padding:6px 8px;border:1px solid #333;text-align:center">Difference</td>
        <td style="padding:6px 8px;border:1px solid #333;text-align:center">Total</td>
      </tr>
      ${rows}
      <tr style="font-weight:700;font-size:14px">
        <td style="padding:6px 8px;border:1px solid #333" colspan="2">NET CLAIM</td>
        <td style="padding:6px 8px;text-align:right;border:1px solid #333">${f.netTotal.toLocaleString()}</td>
        <td style="padding:6px 8px;text-align:right;border:1px solid #333">0</td>
        <td style="padding:6px 8px;text-align:right;border:1px solid #333">${f.netTotal.toLocaleString()}</td>
        <td style="padding:6px 8px;text-align:right;border:1px solid #333">${f.netTotal.toLocaleString()}</td>
      </tr>
    </table>
    <table style="min-width:0;width:100%;table-layout:fixed;border-collapse:collapse;margin-bottom:50px">
      <colgroup>
        <col style="width:8%"><col style="width:34%"><col style="width:14.5%">
        <col style="width:14.5%"><col style="width:14.5%"><col style="width:14.5%">
      </colgroup>
      <tr>
        <td colspan="2"></td>
        <td colspan="4" style="padding:8px 8px 0 8px;font-size:16px;font-weight:800;">
          <b>Net Amount (In words):</b> ${iaNumberToWordsPKR(f.netTotal)}
        </td>
      </tr>
    </table>
    <table style="min-width:0;width:100%;font-size:14px"><tr>
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
  const pdf = new jsPDF('p', 'pt', 'legal');
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
      // Always draw at exactly pageWidth x pageHeight (full-bleed), so
      // the page is completely filled with no side margins AND nothing
      // — including the stamp line at the very bottom — ever falls
      // outside the visible page area.
      drawWidth = pageWidth;
      drawHeight = pageHeight;
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

