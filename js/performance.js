// ═══════════════════════════════════════════════════════════════════
//  PERFORMANCE REPORT — "AEO Monthly Performance Certificate"
//  Moved out of inspection-allowance.js into its own module (this file)
//  so Performance Report generation is self-contained and easy to find.
//  Depends on globals defined in inspection-allowance.js, which must be
//  loaded first: IA_MONTH_NAMES, iaState, iaDownloadPdf, and the shared
//  #iaPdfRenderTarget element used as the off-screen render surface for
//  html2canvas. Also depends on getGoogleConnectionStatus() (defined in
//  dispatch-google.js) to fetch the AEO's saved signature image.
//
//  Replicates the two fixed government templates (Open / Closed) exactly
//  as laid out in the source workbook — same wording, column layout,
//  Arial Narrow font, A4 portrait page, one month per page. Only the
//  AEO's entered indicator achievement (a %age against target, or a
//  Yes/No) varies; the rupee entitlement for each indicator is derived
//  from that automatically — the user never types an amount.
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

// ─── AEO's saved signature (uploaded via My Profile → Report Dispatch) ─
// Reused here so the AEO's own signature appears on the certificate too,
// instead of a blank line. Resolves to '' (no image, just the printed
// line) if the AEO hasn't uploaded one — the certificate still generates.
function perfGetSignatureUrl() {
  return new Promise(resolve => {
    if (typeof getGoogleConnectionStatus !== 'function') { resolve(''); return; }
    getGoogleConnectionStatus(status => resolve((status && status.signature_url) || ''));
  });
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
    const sigUrl = await perfGetSignatureUrl();
    const pages = months.map(month => {
      const cfg = perfState.config[month];
      const total = perfComputeMonthTotal(month);
      const data = { user: iaState.profile, year, month, amount: total, cfg, sigUrl };
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
    <div style="text-align:center;font-size:13.5pt;font-weight:700;line-height:1.25;margin-bottom:2px">${officeLine}</div>
    <div style="text-align:center;font-size:13.5pt;font-weight:700;text-decoration:underline;margin-bottom:8px">AEO Monthly Performance Certificate</div>
    <table style="width:100%;border-collapse:collapse;font-size:10.5pt;font-weight:700;margin-bottom:6px">
      <tr>
        <td style="padding:1px 4px;width:50%">AEO Name: ${u.name || ''}</td>
        <td style="padding:1px 4px;width:50%">Cell No: ${u.cell_no || u.cnic || ''}</td>
      </tr>
      <tr>
        <td style="padding:1px 4px">Markaz: ${u.markaz_name || ''}</td>
        <td style="padding:1px 4px">Month: ${monthLabel}</td>
      </tr>
    </table>`;
}

// ─── Shared footer block — KPI notice + signature/stamp blocks ─────
// Every page carries BOTH designated signature/stamp positions:
//  • Left  — the AEO's own signature (auto-filled from their saved
//            signature image if uploaded via My Profile → Report
//            Dispatch), over a printed signature line.
//  • Right — a labeled box reserved for the Deputy DEO's wet-ink
//            signature and office stamp. The Deputy doesn't have an
//            account in this system to pre-supply a digital signature,
//            so the certificate prints a clearly bordered, properly
//            positioned space for it instead of leaving a bare line.
function perfFooterHtml(amount, u, sigUrl) {
  return `
    <p style="font-size:9.5pt;font-weight:700;margin:8px 0 16px;line-height:1.28">${PERF_KPI_NOTICE} worth PKR ${Number(amount).toLocaleString()}</p>
    <table style="width:100%;border-collapse:collapse;font-size:9.5pt;font-weight:700">
      <tr>
        <td style="width:50%;text-align:center;vertical-align:bottom;padding:0 16px">
          <div style="height:34px;display:flex;align-items:flex-end;justify-content:center">
            ${sigUrl ? `<img src="${sigUrl}" crossorigin="anonymous" style="max-height:32px;max-width:170px;filter:grayscale(1) contrast(1.4) brightness(.85)">` : ''}
          </div>
          <div style="border-top:1px solid #000;padding-top:3px">Assistant Education Officer</div>
          <div style="font-weight:400;font-size:8.5pt">${u.markaz_name || ''}</div>
        </td>
        <td style="width:50%;text-align:center;vertical-align:bottom;padding:0 16px">
          <div style="height:34px;border:1px dashed #555;border-radius:4px;display:flex;align-items:center;justify-content:center">
            <span style="font-weight:400;font-size:7pt;color:#555">Signature &amp; Office Stamp</span>
          </div>
          <div style="border-top:1px solid #000;padding-top:3px">Deputy District Education Officer</div>
          <div style="font-weight:400;font-size:8.5pt">Tehsil Karor</div>
        </td>
      </tr>
    </table>`;
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
      <td style="border:1px solid #000;padding:2px 4px;text-align:center">${i + 1}</td>
      <td style="border:1px solid #000;padding:2px 4px">${r.ind}</td>
      <td style="border:1px solid #000;padding:2px 4px;text-align:center">${r.tgtLabel}</td>
      <td style="border:1px solid #000;padding:2px 4px;text-align:center">${achCell}</td>
      <td style="border:1px solid #000;padding:2px 4px;text-align:center">${amt.toLocaleString()}/-</td>
      <td style="border:1px solid #000;padding:2px 4px;text-align:center">${rmkCell}</td>
      <td style="border:1px solid #000;padding:2px 4px"></td>
    </tr>`;
  }).join('');

  const body = `
    ${perfHeaderHtml('OFFICE OF THE DEPUTY DISTRICT EDUCATION OFFICER (M-EE) TEHSIL KAROR', u, monthLabel)}
    <table style="width:100%;border-collapse:collapse;font-size:8.7pt;font-weight:700;margin-bottom:0;line-height:1.15">
      <thead>
        <tr>
          <th style="border:1px solid #000;padding:2px 4px;width:14.1%">Sr.</th>
          <th style="border:1px solid #000;padding:2px 4px;width:17.8%">Indicators</th>
          <th style="border:1px solid #000;padding:2px 4px;width:25.8%">Targets %age</th>
          <th style="border:1px solid #000;padding:2px 4px;width:14.1%">Target Achieved by AEO</th>
          <th style="border:1px solid #000;padding:2px 4px;width:9.4%">Entitlement of Allowance rupees</th>
          <th style="border:1px solid #000;padding:2px 4px;width:9.4%">Remarks of Immediate Officer</th>
          <th style="border:1px solid #000;padding:2px 4px;width:9.4%">Initials of DDO</th>
        </tr>
      </thead>
      <tbody style="font-weight:400">${rows}</tbody>
    </table>
    ${perfFooterHtml(data.amount, u, data.sigUrl)}`;
  return `<div style="width:794px;padding:44px 52px 36px;font-family:'Arial Narrow','Arial',sans-serif;color:#000;box-sizing:border-box">${body}</div>`;
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
      <td style="border:1px solid #000;padding:2px 5px;text-align:center">${i + 1}</td>
      <td style="border:1px solid #000;padding:2px 5px">${r.ind}</td>
      <td style="border:1px solid #000;padding:2px 5px">${r.tgtLabel}</td>
      <td style="border:1px solid #000;padding:2px 5px;text-align:center">${credited ? 'Acheived' : 'Not Acheived'}</td>
      <td style="border:1px solid #000;padding:2px 5px"></td>
    </tr>`;
  }).join('');

  const body = `
    ${perfHeaderHtml('OFFICE OF THE DY. DISTRICT EDUCATION OFFICER (M-EE) TEHSIL KAROR', u, monthLabel)}
    <table style="width:100%;border-collapse:collapse;font-size:8.7pt;font-weight:700;margin-bottom:0;line-height:1.15">
      <thead>
        <tr>
          <th style="border:1px solid #000;padding:2px 5px;width:11.4%">Sr.</th>
          <th style="border:1px solid #000;padding:2px 5px;width:17.3%">Indicators</th>
          <th style="border:1px solid #000;padding:2px 5px;width:35.7%">Targets</th>
          <th style="border:1px solid #000;padding:2px 5px;width:18.5%">Performance</th>
          <th style="border:1px solid #000;padding:2px 5px;width:17.1%">Remarks of Immediate Officer</th>
        </tr>
      </thead>
      <tbody style="font-weight:400">${rows}</tbody>
    </table>
    ${perfFooterHtml(data.amount, u, data.sigUrl)}`;
  return `<div style="width:794px;padding:44px 52px 36px;font-family:'Arial Narrow','Arial',sans-serif;color:#000;box-sizing:border-box">${body}</div>`;
}

// ─── Multi-page HTML → single PDF (A4 portrait, one page per month) ─
// Each entry in pagesHtml renders to its OWN page — pdf.addPage() is
// called between every page and never within one, so N selected months
// always produce exactly N pages, never combined.
async function perfBuildCertificatePdfBytes(pagesHtml) {
  const target = document.getElementById('iaPdfRenderTarget');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4'); // A4, portrait — required page size/orientation
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pagesHtml.length; i++) {
    target.innerHTML = pagesHtml[i];
    // Give the browser time to load the AEO's signature image (if any)
    // before capturing the canvas, so it isn't missed on a fast machine.
    await new Promise(r => setTimeout(r, 300));
    const canvas = await html2canvas(target, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    // Fit the whole page to A4 while preserving aspect ratio (never
    // stretch/crop). The template above is sized to comfortably fit
    // one month within one page, so this is effectively a 1:1 fit
    // centered on the sheet — but the math stays safe even if a
    // page's content ever runs slightly long.
    const scale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
    const drawWidth = canvas.width * scale;
    const drawHeight = canvas.height * scale;
    const offsetX = (pageWidth - drawWidth) / 2;
    const offsetY = (pageHeight - drawHeight) / 2;

    if (i > 0) pdf.addPage('a4', 'p');
    pdf.addImage(imgData, 'JPEG', offsetX, offsetY, drawWidth, drawHeight);
  }
  target.innerHTML = '';
  return pdf.output('arraybuffer');
}
