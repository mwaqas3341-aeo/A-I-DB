// ═══════════════════════════════════════════════════════════════════
//  PERFORMANCE REPORT — "AEO Monthly Performance Certificate"
//  Updated for A4-size, single-page layout with fixed column widths.
//  All text wraps to multiple lines with no truncation.
// ═══════════════════════════════════════════════════════════════════

const PERF_MAX_MONTHS = 4;
const PERF_MIN_MONTHS = 1;

// Optimised font sizes for A4 (595pt wide, 841.89pt tall)
const PERF_HEAD_PT     = 8.8;
const PERF_BODY_PT     = 7.8;
const PERF_LINE_HEIGHT = 1.12;

// Explicitly set text color to black for headers, and tight padding
const PERF_TH_STYLE = `border:1px solid #000;padding:2px 3px;background:#f2f2f2;color:#000000;font-size:${PERF_HEAD_PT}pt;font-weight:700;vertical-align:middle;white-space:normal;word-wrap:break-word;overflow-wrap:break-word;box-sizing:border-box;`;
const PERF_TD_STYLE = `border:1px solid #000;padding:1px 3px;color:#000000;font-size:${PERF_BODY_PT}pt;font-weight:400;vertical-align:middle;white-space:normal;word-wrap:break-word;overflow-wrap:break-word;box-sizing:border-box;`;

const PERF_OPEN_ROWS = [
  { ind: 'AEO Visits',                                                    tgtLabel: '100',                                                        kind: 'percent', targetPct: 100, weight: 0.40 },
  { ind: 'LND (E,M,U)',                                                   tgtLabel: '80% per Quarter',                                            kind: 'fixed',   fixedAch: 'Not Conducted By PMIU', fixedRmk: 'Not Applicable', weight: 0.04 },
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

const PERF_KPI_NOTICE = 'It is to certify that verifiable KPIs developed and issued by SED vide No. SO (SE-III) 5-226/200 dated 03-08-2020 has been achieved by the above named AEO. His performance is mentioned above against each indicator. He is entitled to get Inspection';

let perfState = { months: [], selected: new Set(), config: {} };

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
        ${perfConfigTableHtml(month, cfg)}
        <div style="text-align:right;margin-top:8px;padding-top:8px;border-top:1px dashed var(--b0);font-weight:700;font-size:.88rem">
          Month Total: <span style="color:#0d9488" id="perfMonthTotal_${month}">PKR ${total.toLocaleString()}</span>
        </div>
      </div>`;
  }).join('');

  document.getElementById('perf_downloadBtn').disabled = months.length < PERF_MIN_MONTHS;
  perfUpdateGrandTotal();
}

// ─── Prep-view table — mirrors the certificate's own column layout ──
function perfConfigTableHtml(month, cfg) {
  const isOpen = cfg.status === 'open';
  const rows = isOpen ? PERF_OPEN_ROWS : PERF_CLOSED_ROWS;
  const rowsHtml = rows.map((r, i) => perfIndicatorRowHtml(month, r, i, cfg, isOpen)).join('');

  const th = 'border:1px solid var(--b0);background:var(--s2);padding:5px 4px;font-size:.7rem;font-weight:700;text-align:left;vertical-align:middle;color:#000000;white-space:normal;word-wrap:break-word;overflow-wrap:break-word;';
  const heads = isOpen
    ? `<th style="${th}width:4%">Sr.</th>
       <th style="${th}width:15%">Indicators</th>
       <th style="${th}width:20%">Targets %age</th>
       <th style="${th}width:20%">Target Achieved by AEO</th>
       <th style="${th}width:14%;text-align:right">Entitlement</th>
       <th style="${th}width:15%">Remarks of Immediate Officer</th>
       <th style="${th}width:12%">Initials of DDO</th>`
    : `<th style="${th}width:5%">Sr.</th>
       <th style="${th}width:18%">Indicators</th>
       <th style="${th}width:32%">Targets</th>
       <th style="${th}width:22%">Performance</th>
       <th style="${th}width:23%">Remarks of Immediate Officer</th>`;

  return `<table style="width:100%;border-collapse:collapse;font-size:.7rem;table-layout:fixed">
    <thead><tr>${heads}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}

function perfIndicatorRowHtml(month, row, idx, cfg, isOpen) {
  const stored = cfg.achieved[idx];
  const credited = perfIsCredited(row, stored);
  const entitlement = perfRowAmount(row);
  const { rmkCell } = perfRowDisplayCells(row, stored, credited);
  const td = 'border:1px solid var(--b0);padding:4px;vertical-align:middle;color:#000000;white-space:normal;word-wrap:break-word;overflow-wrap:break-word;';

  let achievedCell;
  if (row.kind === 'fixed') {
    achievedCell = `<span style="color:var(--t3)">${row.fixedAch}</span>`;
  } else if (row.kind === 'percent') {
    const val = stored ?? row.targetPct;
    achievedCell = `<input type="number" min="0" max="100" value="${val}" style="width:52px;height:26px;border:1px solid var(--b0);border-radius:5px;padding:0 4px;font-size:.7rem"
      oninput="perfUpdateAchieved(${month}, ${idx}, this.value)"> %`;
  } else {
    const val = stored ?? true;
    achievedCell = `<label style="display:flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap">
      <input type="checkbox" ${val ? 'checked' : ''} onchange="perfUpdateAchieved(${month}, ${idx}, this.checked)"> Achieved
    </label>`;
  }

  if (isOpen) {
    return `<tr>
      <td style="${td}text-align:center">${idx + 1}</td>
      <td style="${td}">${row.ind}</td>
      <td style="${td}color:var(--t3)">${row.tgtLabel}</td>
      <td style="${td}text-align:center">${achievedCell}</td>
      <td style="${td}text-align:right;font-weight:600;color:${credited ? '#0d9488' : 'var(--t3)'}">PKR ${(credited ? entitlement : 0).toLocaleString()}</td>
      <td style="${td}color:var(--t3)">${rmkCell}</td>
      <td style="${td}"></td>
    </tr>`;
  }
  return `<tr>
    <td style="${td}text-align:center">${idx + 1}</td>
    <td style="${td}">${row.ind}</td>
    <td style="${td}color:var(--t3)">${row.tgtLabel}</td>
    <td style="${td}text-align:center">${achievedCell}</td>
    <td style="${td}"></td>
  </tr>`;
}

function perfRowAmount(row) {
  return Math.round(row.weight * (iaState.rate || 25000));
}

function perfRowDisplayCells(row, storedVal, credited) {
  if (row.kind === 'fixed') return { achCell: row.fixedAch, rmkCell: row.fixedRmk };
  if (row.kind === 'percent') return { achCell: credited ? (storedVal ?? row.targetPct) : '', rmkCell: '' };
  return { achCell: credited ? 'Yes' : '', rmkCell: credited ? 'Achieved' : '' };
}

function perfIsCredited(row, storedVal) {
  if (row.kind === 'fixed') return true;
  if (row.kind === 'percent') {
    const v = storedVal ?? row.targetPct;
    return Number(v) >= row.targetPct;
  }
  return (storedVal ?? true) === true; 
}

function perfUpdateAchieved(month, idx, value) {
  const cfg = perfState.config[month];
  if (!cfg) return;
  const rows = cfg.status === 'open' ? PERF_OPEN_ROWS : PERF_CLOSED_ROWS;
  const row = rows[idx];
  cfg.achieved[idx] = row.kind === 'percent' ? Number(value) : Boolean(value);
  perfRenderConfigPanels(); 
}

function perfSetStatus(month, status) {
  const cfg = perfState.config[month];
  if (!cfg) return;
  cfg.status = status;
  cfg.achieved = {}; 
  perfRenderConfigPanels();
}

function perfComputeMonthTotal(month) {
  const cfg = perfState.config[month];
  if (!cfg) return 0;
  
  const rows = cfg.status === 'open' ? PERF_OPEN_ROWS : PERF_CLOSED_ROWS;
  
  const rawTotal = rows.reduce((sum, row, idx) => {
    const isCredited = perfIsCredited(row, cfg.achieved[idx]);
    const exactAmount = isCredited ? (row.weight * (iaState.rate || 25000)) : 0;
    return sum + exactAmount;
  }, 0);
  
  return Math.round(rawTotal);
}

function perfUpdateGrandTotal() {
  const total = [...perfState.selected].reduce((s, m) => s + perfComputeMonthTotal(m), 0);
  document.getElementById('perfGrandTotalDisplay').textContent = 'PKR ' + total.toLocaleString();
}

function perfGetSignatureUrl() {
  return new Promise(resolve => {
    if (typeof getGoogleConnectionStatus !== 'function') { resolve(''); return; }
    getGoogleConnectionStatus(status => resolve((status && status.signature_url) || ''));
  });
}

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

// ─── Shared Split-Layout Header ─────────────────────────────────────
function perfHeaderHtml(officeLine, u, monthLabel) {
  // Reduced margins and tighter spacing to squeeze more width
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; font-size:9.5pt;">
      <table style="width:35%; border-collapse:collapse; font-weight:700; font-size:9pt;">
        <tr><td style="padding:2px 0; width:60px">AEO Name:</td><td style="padding:2px 0; border-bottom:1px solid #333">${u.name || ''}</td></tr>
        <tr><td style="padding:2px 0">Markaz:</td><td style="padding:2px 0; border-bottom:1px solid #333">${u.markaz_name || ''}</td></tr>
        <tr><td style="padding:2px 0">Month:</td><td style="padding:2px 0; border-bottom:1px solid #333">${monthLabel}</td></tr>
        <tr><td style="padding:2px 0">Cell No:</td><td style="padding:2px 0; border-bottom:1px solid #333">${u.cell_no || u.cnic || ''}</td></tr>
      </table>
      <div style="width:63%; text-align:center;">
        <div style="font-size:11.5pt; font-weight:700; line-height:1.15; margin-bottom:4px; word-wrap:break-word; overflow-wrap:break-word;">${officeLine}</div>
        <div style="font-size:10.5pt; font-weight:700; text-decoration:underline; text-transform:uppercase;">AEO MONTHLY PERFORMANCE CERTIFICATE</div>
      </div>
    </div>`;
}

function perfFooterHtml(amount, u, sigUrl) {
  return `
    <p style="font-size:8.5pt;font-weight:700;margin:4px 0 12px;line-height:1.25;word-wrap:break-word;overflow-wrap:break-word;">${PERF_KPI_NOTICE} worth PKR ${Number(amount).toLocaleString()}</p>
    <table style="width:100%;border-collapse:collapse;font-size:8.5pt;font-weight:700">
      <tr>
        <td style="width:50%;text-align:center;vertical-align:bottom;padding:0 10px">
          <div style="height:30px;display:flex;align-items:flex-end;justify-content:center">
            ${sigUrl ? `<img src="${sigUrl}" crossorigin="anonymous" style="max-height:28px;max-width:150px;filter:grayscale(1) contrast(1.4) brightness(.85)">` : ''}
          </div>
          <div style="border-top:1px solid #000;padding-top:2px">Assistant Education Officer</div>
          <div style="font-weight:400;font-size:7.5pt">${u.markaz_name || ''}</div>
        </td>
        <td style="width:50%;text-align:center;vertical-align:bottom;padding:0 10px">
          <div style="height:30px;border:1px dashed #555;border-radius:4px;display:flex;align-items:center;justify-content:center">
            <span style="font-weight:400;font-size:6.5pt;color:#555">Signature &amp; Office Stamp</span>
          </div>
          <div style="border-top:1px solid #000;padding-top:2px">Deputy District Education Officer</div>
          <div style="font-weight:400;font-size:7.5pt">Tehsil Karor</div>
        </td>
      </tr>
    </table>`;
}

// ─── OPEN format — A4 Fixed Column Widths ───────────────────────────
function perfOpenHtml(data) {
  const u = data.user;
  const cfg = data.cfg;
  const monthLabel = `${IA_MONTH_NAMES[data.month - 1]} ${data.year}`;
  const rows = PERF_OPEN_ROWS.map((r, i) => {
    const stored = cfg.achieved[i];
    const credited = perfIsCredited(r, stored);
    const amt = perfRowAmount(r);
    const { achCell, rmkCell } = perfRowDisplayCells(r, stored, credited);

    return `<tr>
      <td style="${PERF_TD_STYLE}text-align:center">${i + 1}</td>
      <td style="${PERF_TD_STYLE}text-align:left">${r.ind}</td>
      <td style="${PERF_TD_STYLE}text-align:left">${r.tgtLabel}</td>
      <td style="${PERF_TD_STYLE}text-align:center">${achCell}</td>
      <td style="${PERF_TD_STYLE}text-align:center">${amt.toLocaleString()}/-</td>
      <td style="${PERF_TD_STYLE}text-align:center">${rmkCell}</td>
      <td style="${PERF_TD_STYLE}"></td>
    </tr>`;
  }).join('');

  // A4 container: 595pt wide, 841.89pt high, with 20pt left/right margins
  const body = `
    ${perfHeaderHtml('OFFICE OF THE DEPUTY DISTRICT EDUCATION OFFICER (M-EE) TEHSIL KAROR', u, monthLabel)}
    <table style="width:100%;border-collapse:collapse;font-size:${PERF_BODY_PT}pt;margin-bottom:0;line-height:${PERF_LINE_HEIGHT};table-layout:fixed;">
      <thead>
        <tr>
          <th style="${PERF_TH_STYLE}width:5%">Sr.</th>
          <th style="${PERF_TH_STYLE}width:16%">Indicators</th>
          <th style="${PERF_TH_STYLE}width:20%">Targets %age</th>
          <th style="${PERF_TH_STYLE}width:14%">Target Achieved by AEO</th>
          <th style="${PERF_TH_STYLE}width:15%">Entitlement of Allowance rupees</th>
          <th style="${PERF_TH_STYLE}width:20%">Remarks of Immediate Officer</th>
          <th style="${PERF_TH_STYLE}width:10%">Initials of DDO</th>
        </tr>
      </thead>
      <tbody style="font-weight:400">${rows}</tbody>
    </table>
    ${perfFooterHtml(data.amount, u, data.sigUrl)}`;
  
  return `<div style="width:595pt;min-height:841.89pt;padding:20pt 24pt;font-family:'Arial Narrow','Arial',sans-serif;color:#000;box-sizing:border-box;background:#fff">${body}</div>`;
}

// ─── CLOSED format — A4 Fixed Column Widths ─────────────────────────
function perfClosedHtml(data) {
  const u = data.user;
  const cfg = data.cfg;
  const monthLabel = `${IA_MONTH_NAMES[data.month - 1]} ${data.year}`;
  const rows = PERF_CLOSED_ROWS.map((r, i) => {
    const stored = cfg.achieved[i];
    const credited = perfIsCredited(r, stored);
    return `<tr>
      <td style="${PERF_TD_STYLE}text-align:center">${i + 1}</td>
      <td style="${PERF_TD_STYLE}text-align:left">${r.ind}</td>
      <td style="${PERF_TD_STYLE}text-align:left">${r.tgtLabel}</td>
      <td style="${PERF_TD_STYLE}text-align:center">${credited ? 'Achieved' : 'Not Achieved'}</td>
      <td style="${PERF_TD_STYLE}"></td>
    </tr>`;
  }).join('');

  const body = `
    ${perfHeaderHtml('OFFICE OF THE DY. DISTRICT EDUCATION OFFICER (M-EE) TEHSIL KAROR', u, monthLabel)}
    <table style="width:100%;border-collapse:collapse;font-size:${PERF_BODY_PT}pt;margin-bottom:0;line-height:${PERF_LINE_HEIGHT};table-layout:fixed;">
      <thead>
        <tr>
          <th style="${PERF_TH_STYLE}width:5%">Sr.</th>
          <th style="${PERF_TH_STYLE}width:18%">Indicators</th>
          <th style="${PERF_TH_STYLE}width:32%">Targets</th>
          <th style="${PERF_TH_STYLE}width:18%">Performance</th>
          <th style="${PERF_TH_STYLE}width:27%">Remarks of Immediate Officer</th>
        </tr>
      </thead>
      <tbody style="font-weight:400">${rows}</tbody>
    </table>
    ${perfFooterHtml(data.amount, u, data.sigUrl)}`;
    
  return `<div style="width:595pt;min-height:841.89pt;padding:20pt 24pt;font-family:'Arial Narrow','Arial',sans-serif;color:#000;box-sizing:border-box;background:#fff">${body}</div>`;
}

// ─── PDF Engine for A4 output ────────────────────────────────────────
async function perfBuildCertificatePdfBytes(pagesHtml) {
  const target = document.getElementById('iaPdfRenderTarget');
  // Force render target to match A4 width (595pt)
  target.style.width = '595pt';
  const { jsPDF } = window.jspdf;
  
  const pdf = new jsPDF('p', 'pt', 'a4'); 
  const pageWidth = pdf.internal.pageSize.getWidth(); // 595.28pt
  const pageHeight = pdf.internal.pageSize.getHeight(); // 841.89pt

  for (let i = 0; i < pagesHtml.length; i++) {
    target.innerHTML = pagesHtml[i];
    await new Promise(r => setTimeout(r, 250)); // wait for layout
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: 595 // enforce A4 width in pixels for the canvas
    });
    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    // Scale the canvas exactly to fit the A4 page
    const scaleX = pageWidth / canvas.width;
    const scaleY = pageHeight / canvas.height;
    const scale = Math.min(scaleX, scaleY);
    
    const drawWidth = canvas.width * scale;
    const drawHeight = canvas.height * scale;
    const offsetX = (pageWidth - drawWidth) / 2;
    const offsetY = (pageHeight - drawHeight) / 2;

    if (i > 0) pdf.addPage('a4', 'p');
    pdf.addImage(imgData, 'JPEG', offsetX, offsetY, drawWidth, drawHeight);
  }
  target.style.width = ''; // reset
  target.innerHTML = '';
  return pdf.output('arraybuffer');
}