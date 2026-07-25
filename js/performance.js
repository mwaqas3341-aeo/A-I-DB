// performance.js
// AEO Monthly Performance Certificate - Letter Portrait PDF
// Ready-to-replace version: single page per month, Letter 612x792pt.

const PERFMAXMONTHS = 4;
const PERFMINMONTHS = 1;

const PERFLETTER_WIDTH_PT = 612;
const PERFLETTER_HEIGHT_PT = 792;
const PERFLETTER_WIDTH_PX = Math.round((PERFLETTER_WIDTH_PT * 96) / 72); // 816
const PERFLETTER_HEIGHT_PX = Math.round((PERFLETTER_HEIGHT_PT * 96) / 72); // 1056
const PERFHEAD_PT = 9.5;
const PERFBODY_PT = 8.0;
const PERFLINEHEIGHT = 1.2;

const PERFTHSTYLE = `
  border:1px solid #000;
  padding:3px 4px;
  background:#f2f2f2;
  color:#000000;
  font-size:${PERFHEAD_PT}pt;
  font-weight:700;
  vertical-align:middle;
  white-space:normal;
  word-wrap:break-word;
  overflow-wrap:break-word;
  box-sizing:border-box;
`;

const PERFTDSTYLE = `
  border:1px solid #000;
  padding:2px 4px;
  color:#000000;
  font-size:${PERFBODY_PT}pt;
  font-weight:400;
  vertical-align:middle;
  white-space:normal;
  word-wrap:break-word;
  overflow-wrap:break-word;
  box-sizing:border-box;
`;

const PERFOPENROWS = [
  { ind: "AEO Visits", tgtLabel: "100", kind: "percent", targetPct: 100, weight: 0.40 },
  { ind: "LND E,M,U", tgtLabel: "80 per Quarter", kind: "fixed", fixedAch: "Not Conducted By PMIU", fixedRmk: "Not Applicable", weight: 0.04 },
  { ind: "Student Attendance ECE-8", tgtLabel: "90", kind: "percent", targetPct: 90, weight: 0.04 },
  { ind: "Teacher Presence", tgtLabel: "85", kind: "percent", targetPct: 85, weight: 0.04 },
  { ind: "Functioning of facilities BW, DW, Electricity, Furniture", tgtLabel: "80", kind: "percent", targetPct: 80, weight: 0.04 },
  { ind: "Student Retention", tgtLabel: "85", kind: "percent", targetPct: 85, weight: 0.04 },
  { ind: "Litnum Material", tgtLabel: "80", kind: "percent", targetPct: 80, weight: 0.04 },
  { ind: "On time resolution of Hotline Complaint", tgtLabel: "90", kind: "percent", targetPct: 90, weight: 0.04 },
  { ind: "Classroom Observation", tgtLabel: "90", kind: "percent", targetPct: 90, weight: 0.04 },
  { ind: "Co-curricular activities", tgtLabel: "As directed by department", kind: "yesno", weight: 0.04 },
  { ind: "School records", tgtLabel: "Properly maintained Students, Teachers, NSB and FTF", kind: "yesno", weight: 0.04 },
  { ind: "School based action plan", tgtLabel: "Ensure SBAP is prepared and present in school", kind: "yesno", weight: 0.04 },
  { ind: "School Council", tgtLabel: "Ensure 1 SC meeting per month", kind: "yesno", weight: 0.04 },
  { ind: "Attend monthly meeting", tgtLabel: "As directed by higher authorities", kind: "yesno", weight: 0.04 },
  { ind: "Visit ADP schemes under construction", tgtLabel: "Visit of ADP scheme and give status to department when required", kind: "yesno", weight: 0.04 },
  { ind: "Update SIS Data", tgtLabel: "Ensure all schools of markaz have updated data on SIS", kind: "yesno", weight: 0.04 },
];

const PERFCLOSEDROWS = [
  { ind: "Aeo Visits", tgtLabel: "Once in a Month" },
  { ind: "Teacher Training", tgtLabel: "Ensure That Teachers Attend Trainings" },
  { ind: "Cot Analysis Report", tgtLabel: "Submit Analysis Report to Immediate Officer" },
  { ind: "Ht Orientation", tgtLabel: "Ht Meeting of Markaz and Submit Attendance" },
  { ind: "Sbap Report", tgtLabel: "Develop and Submit Sbap Report" },
  { ind: "Awareness Campaign Smc", tgtLabel: "1 Session Regarding Importance of Schooling and Hygiene" },
  { ind: "Ece Support and Guidance", tgtLabel: "Up Gradation of Ece Room and Material" },
  { ind: "Oosc Survey", tgtLabel: "Once a Year" },
  { ind: "Ece Support for Enrollment Drive", tgtLabel: "Smc, Ht and Community Plan for Upcoming Enrollment Drive" },
  { ind: "Ece Awareness Campaign", tgtLabel: "Creating Awareness of the Importance of Ece in Community" },
  { ind: "Sis Orientation", tgtLabel: "Collect Feedback from Ht and Submit to Immediate Officer" },
  { ind: "Dengue Awareness Campaign", tgtLabel: "Creating Awareness Regarding Anti-dengue Activities in Schools Like Seminars" },
  { ind: "Visit Adp Schemes Under Construction", tgtLabel: "Visit of Adp Scheme and Give Status to Department When Required" },
  { ind: "Observance of Govt. Sops in Private Schools", tgtLabel: "Observe Govt. Sops Followed by Private Schools" },
  { ind: "Update Sis Data", tgtLabel: "Ensure All Schools of Markaz Have Updated Data on Sis" },
  { ind: "Online Complaint Resolution", tgtLabel: "In-time Resolution of Complaints on Dashboard" },
].map(r => ({ ...r, kind: "yesno", weight: 1 / 16 }));

const PERFKPINOTICE =
  "It is to certify that verifiable KPIs developed and issued by SED vide No. SO(SE-III)5-226/2020 dated 03-08-2020 has been achieved by the above named AEO. His performance is mentioned above against each indicator. He is entitled to get Inspection Allowance as admissible under rules.";

const perfState = {
  selected: new Set(),
  config: {},
  months: [],
};

function perfSafe(v) {
  return (v ?? "").toString().trim();
}

function perfIsCredited(row, storedVal) {
  if (row.kind === "fixed") return true;
  if (row.kind === "percent") {
    const val = (storedVal === undefined || storedVal === "") ? row.targetPct : storedVal;
    return Number(val) >= Number(row.targetPct);
  }
  return storedVal ?? true;
}

function perfRowAmount(row) {
  return Math.round((row.weight || 0) * (iaState.rate || 25000));
}

function perfRowDisplayCells(row, storedVal, credited) {
  if (row.kind === "fixed") {
    return { achCell: row.fixedAch || "Achieved", rmkCell: row.fixedRmk || "Not Applicable" };
  }
  if (row.kind === "percent") {
    const val = (storedVal === undefined || storedVal === "") ? row.targetPct : storedVal;
    return {
      achCell: credited ? val : "Not Achieved",
      rmkCell: credited ? "Achieved" : "Not Achieved",
    };
  }
  return {
    achCell: credited ? "Yes" : "No",
    rmkCell: credited ? "Achieved" : "Not Achieved",
  };
}

function perfOfficeLine(officeTitle, u) {
  const wing = perfSafe(u?.wing);
  const tehsil = perfSafe(u?.tehsil);
  const wingPart = wing ? ` (${wing})` : "";
  const tehsilPart = tehsil ? ` TEHSIL ${tehsil.toUpperCase()}` : "";
  return `${officeTitle}${wingPart}${tehsilPart}`;
}

function perfHeaderHtml(officeTitle, u, monthLabel) {
  const th = "border:1px solid #000;padding:5px 8px;font-weight:700;text-align:left;vertical-align:middle;";
  const td = "border:1px solid #000;padding:5px 8px;text-align:left;vertical-align:middle;";
  const officeLine = perfOfficeLine(officeTitle, u);
  return `
  <table dir="ltr" style="width:100%;border-collapse:collapse;margin-bottom:0;font-size:9.5pt;color:#000;">
    <tr><td colspan="2" style="border:1px solid #000;padding:6px 8px;text-align:center;font-weight:700;font-size:11.5pt;line-height:1.15;word-wrap:break-word;overflow-wrap:break-word;">${officeLine}</td></tr>
    <tr><td colspan="2" style="border:1px solid #000;padding:5px 8px;text-align:center;font-weight:700;font-size:10.5pt;text-decoration:underline;text-transform:uppercase;">AEO MONTHLY PERFORMANCE CERTIFICATE</td></tr>
    <tr><td style="${th}width:18%;">AEO Name:</td><td style="${td}">${perfSafe(u?.name)}</td></tr>
    <tr><td style="${th}">Markaz:</td><td style="${td}">${perfSafe(u?.markaz_name)}</td></tr>
    <tr><td style="${th}">Month:</td><td style="${td}">${perfSafe(monthLabel)}</td></tr>
    <tr><td style="${th}">Cell No:</td><td style="${td}">${perfSafe(u?.cell_no || u?.cnic || "")}</td></tr>
  </table>`;
}

function perfFooterHtml(amount, u) {
  const tehsil = perfSafe(u?.tehsil);
  return `
  <p style="font-size:8.5pt;font-weight:700;margin:6px 0 10px;line-height:1.25;color:#000;word-wrap:break-word;overflow-wrap:break-word;">${PERFKPINOTICE} worth PKR ${Number(amount || 0).toLocaleString()}.</p>
  <table style="width:100%;border-collapse:collapse;font-size:8.5pt;font-weight:700;color:#000;" dir="ltr">
    <tr>
      <td style="width:50%;text-align:center;vertical-align:bottom;padding:0 8px;">
        <div style="height:32px;"></div>
        <div style="border-top:1px solid #000;padding-top:2px;">Assistant Education Officer</div>
        <div style="font-weight:400;font-size:7.5pt;">${perfSafe(u?.markaz_name)}</div>
      </td>
      <td style="width:50%;text-align:center;vertical-align:bottom;padding:0 8px;">
        <div style="height:32px;"></div>
        <div style="border-top:1px solid #000;padding-top:2px;">Deputy District Education Officer</div>
        <div style="font-weight:400;font-size:7.5pt;">${tehsil ? `Tehsil ${tehsil}` : ""}</div>
      </td>
    </tr>
  </table>`;
}

// ─── OPEN format — Letter portrait, single page ─────────────────────
function perfOpenHtml(data) {
  const u = data.user || {};
  const cfg = data.cfg || {};
  const monthLabel = `${IA_MONTH_NAMES[data.month - 1] || data.month} ${data.year}`;
  const rows = PERFOPENROWS.map((r, i) => {
    const stored = cfg.achieved?.[i];
    const credited = perfIsCredited(r, stored);
    const amt = perfRowAmount(r);
    const { achCell, rmkCell } = perfRowDisplayCells(r, stored, credited);
    return `
      <tr>
        <td style="${PERFTDSTYLE}text-align:center;">${i + 1}</td>
        <td style="${PERFTDSTYLE}text-align:left;">${r.ind}</td>
        <td style="${PERFTDSTYLE}text-align:left;">${r.tgtLabel}</td>
        <td style="${PERFTDSTYLE}text-align:center;">${achCell}</td>
        <td style="${PERFTDSTYLE}text-align:center;">${credited ? `PKR ${amt.toLocaleString()}` : "-"}</td>
        <td style="${PERFTDSTYLE}text-align:center;">${rmkCell}</td>
        <td style="${PERFTDSTYLE}text-align:center;"></td>
      </tr>`;
  }).join("");

  const body = `
    ${perfHeaderHtml("OFFICE OF THE DEPUTY DISTRICT EDUCATION OFFICER", u, monthLabel)}
    <table style="width:100%;border-collapse:collapse;font-size:${PERFBODY_PT}pt;margin-top:8px;margin-bottom:0;line-height:${PERFLINEHEIGHT};color:#000;" dir="ltr">
      <thead>
        <tr>
          <th style="${PERFTHSTYLE}width:6%;">Sr.</th>
          <th style="${PERFTHSTYLE}width:24%;">Indicators</th>
          <th style="${PERFTHSTYLE}width:24%;">Targets %age</th>
          <th style="${PERFTHSTYLE}width:12%;">Target Achieved by AEO</th>
          <th style="${PERFTHSTYLE}width:12%;">Entitlement of Allowance rupees</th>
          <th style="${PERFTHSTYLE}width:12%;">Remarks of Immediate Officer</th>
          <th style="${PERFTHSTYLE}width:10%;">Initials of DDO</th>
        </tr>
      </thead>
      <tbody style="font-weight:400;">${rows}</tbody>
    </table>
    ${perfFooterHtml(data.amount, u)}
  `;

  return `
    <div style="width:${PERFLETTER_WIDTH_PX}px;padding:22pt 26pt;font-family:Arial,Arial Narrow,sans-serif;color:#000000;box-sizing:border-box;background:#fff;direction:ltr;text-align:left;">
      ${body}
    </div>`;
}

// ─── CLOSED format — Letter portrait, single page ───────────────────
function perfClosedHtml(data) {
  const u = data.user || {};
  const cfg = data.cfg || {};
  const monthLabel = `${IA_MONTH_NAMES[data.month - 1] || data.month} ${data.year}`;
  const rows = PERFCLOSEDROWS.map((r, i) => {
    const stored = cfg.achieved?.[i];
    const credited = perfIsCredited(r, stored);
    return `
      <tr>
        <td style="${PERFTDSTYLE}text-align:center;">${i + 1}</td>
        <td style="${PERFTDSTYLE}text-align:left;">${r.ind}</td>
        <td style="${PERFTDSTYLE}text-align:left;">${r.tgtLabel}</td>
        <td style="${PERFTDSTYLE}text-align:center;">${credited ? "Achieved" : "Not Achieved"}</td>
        <td style="${PERFTDSTYLE}text-align:center;"></td>
      </tr>`;
  }).join("");

  const body = `
    ${perfHeaderHtml("OFFICE OF THE DY. DISTRICT EDUCATION OFFICER", u, monthLabel)}
    <table style="width:100%;border-collapse:collapse;font-size:${PERFBODY_PT}pt;margin-top:8px;margin-bottom:0;line-height:${PERFLINEHEIGHT};color:#000;" dir="ltr">
      <thead>
        <tr>
          <th style="${PERFTHSTYLE}width:6%;">Sr.</th>
          <th style="${PERFTHSTYLE}width:24%;">Indicators</th>
          <th style="${PERFTHSTYLE}width:35%;">Targets</th>
          <th style="${PERFTHSTYLE}width:18%;">Performance</th>
          <th style="${PERFTHSTYLE}width:17%;">Remarks of Immediate Officer</th>
        </tr>
      </thead>
      <tbody style="font-weight:400;">${rows}</tbody>
    </table>
    ${perfFooterHtml(data.amount, u)}
  `;

  return `
    <div style="width:${PERFLETTER_WIDTH_PX}px;padding:22pt 26pt;font-family:Arial,Arial Narrow,sans-serif;color:#000000;box-sizing:border-box;background:#fff;direction:ltr;text-align:left;">
      ${body}
    </div>`;
}

async function perfBuildCertificatePdfBytes(pagesHtml) {
  const target = document.getElementById("iaPdfRenderTarget");
  target.style.width = `${PERFLETTER_WIDTH_PX}px`;
  target.setAttribute("dir", "ltr");
  target.style.direction = "ltr";

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("p", "pt", "letter");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pagesHtml.length; i++) {
    target.innerHTML = pagesHtml[i];
    await new Promise((r) => setTimeout(r, 300));
    void target.offsetHeight;

    const captureWidth = target.scrollWidth;
    const captureHeight = target.scrollHeight;
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      width: captureWidth,
      height: captureHeight,
      windowWidth: captureWidth,
      windowHeight: captureHeight,
    });

    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const scaleX = pageWidth / canvas.width;
    const scaleY = pageHeight / canvas.height;
    const scale = Math.min(scaleX, scaleY);
    const drawWidth = canvas.width * scale;
    const drawHeight = canvas.height * scale;
    const offsetX = (pageWidth - drawWidth) / 2;
    const offsetY = (pageHeight - drawHeight) / 2;

    if (i > 0) pdf.addPage("letter", "p");
    pdf.addImage(imgData, "JPEG", offsetX, offsetY, drawWidth, drawHeight);
  }

  target.style.width = "";
  target.innerHTML = "";
  return pdf.output("arraybuffer");
}

function perfInit() {
  const yearSel = document.getElementById("perf_year");
  const yNow = new Date().getFullYear();
  yearSel.innerHTML = [yNow - 2, yNow - 1, yNow, yNow + 1]
    .map((y) => `<option value="${y}" ${y === yNow ? "selected" : ""}>${y}</option>`)
    .join("");
  perfState.selected = new Set();
  perfState.config = {};
  perfLoadMonths();
}

async function perfLoadMonths() {
  const year = Number(document.getElementById("perf_year").value);
  const grid = document.getElementById("perfMonthsGrid");
  const warn = document.getElementById("perf_monthWarn");
  grid.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3)"><span class="spinner-border spinner-border-sm"></span> Loading months…</div>`;

  const res = await apiCall("getMyInspectionAllowanceMonths", { year });
  perfState.selected = new Set();
  perfState.config = {};
  if (!res || !res.success) { grid.innerHTML = ""; warn.style.display = "block"; perfRenderConfigPanels(); return; }

  perfState.months = (res.months || []).filter((m) => m.prepared);
  if (!perfState.months.length) { grid.innerHTML = ""; warn.style.display = "block"; perfRenderConfigPanels(); return; }

  warn.style.display = "none";
  perfRenderMonthsGrid();
  perfRenderConfigPanels();
}

function perfRenderMonthsGrid() {
  const grid = document.getElementById("perfMonthsGrid");
  grid.innerHTML = perfState.months.map((m) => {
    const checked = perfState.selected.has(m.month);
    return `<label style="display:flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--b0);border-radius:8px;cursor:pointer;font-size:.85rem;${checked ? "background:#f0fdfa;border-color:#0d9488" : ""}">
      <input type="checkbox" ${checked ? "checked" : ""} onchange="perfToggleMonth(${m.month}, this.checked)"> ${IA_MONTH_NAMES[m.month - 1]}
    </label>`;
  }).join("");
}

function perfToggleMonth(month, checked) {
  if (checked) {
    if (perfState.selected.size >= PERFMAXMONTHS) {
      showToast(`Maximum ${PERFMAXMONTHS} months per certificate.`, false);
      perfRenderMonthsGrid();
      return;
    }
    perfState.selected.add(month);
    if (!perfState.config[month]) perfState.config[month] = { status: "open", achieved: {} };
  } else {
    perfState.selected.delete(month);
    delete perfState.config[month];
  }
  perfRenderMonthsGrid();
  perfRenderConfigPanels();
}

function perfSetStatus(month, status) {
  const cfg = perfState.config[month];
  if (!cfg) return;
  cfg.status = status;
  cfg.achieved = {};
  perfRenderConfigPanels();
}

function perfUpdateAchieved(month, idx, value) {
  const cfg = perfState.config[month];
  if (!cfg) return;
  const rows = cfg.status === "open" ? PERFOPENROWS : PERFCLOSEDROWS;
  const row = rows[idx];
  cfg.achieved[idx] = row.kind === "percent" ? (value === "" ? "" : Number(value)) : Boolean(value);
  perfRenderConfigPanels();
}

function perfComputeMonthTotal(month) {
  const cfg = perfState.config[month];
  if (!cfg) return 0;
  const rows = cfg.status === "open" ? PERFOPENROWS : PERFCLOSEDROWS;
  const rawTotal = rows.reduce((sum, row, idx) => {
    const credited = perfIsCredited(row, cfg.achieved[idx]);
    return sum + (credited ? perfRowAmount(row) : 0);
  }, 0);
  return Math.round(rawTotal);
}

function perfUpdateGrandTotal() {
  const total = [...perfState.selected].reduce((s, m) => s + perfComputeMonthTotal(m), 0);
  document.getElementById("perfGrandTotalDisplay").textContent = "PKR " + total.toLocaleString();
}

function perfRenderConfigPanels() {
  const wrap = document.getElementById("perfConfigPanels");
  const months = [...perfState.selected].sort((a, b) => a - b);

  if (!months.length) {
    wrap.innerHTML = `<div style="padding:16px;text-align:center;color:var(--t3);font-size:.85rem">Select at least ${PERFMINMONTHS} prepared month above to begin.</div>`;
    document.getElementById("perf_downloadBtn").disabled = true;
    document.getElementById("perfGrandTotalDisplay").textContent = "PKR 0";
    return;
  }

  wrap.innerHTML = months.map((month) => {
    const cfg = perfState.config[month];
    const total = perfComputeMonthTotal(month);
    return `
      <div style="background:#fff;border:1px solid var(--b0);border-radius:10px;padding:16px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">
          <div style="font-weight:700;font-size:.95rem">${IA_MONTH_NAMES[month - 1]}</div>
          <div style="display:flex;gap:14px;align-items:center;font-size:.85rem">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="radio" name="perf_status_${month}" ${cfg.status === "open" ? "checked" : ""} onchange="perfSetStatus(${month},'open')"> Open
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="radio" name="perf_status_${month}" ${cfg.status === "closed" ? "checked" : ""} onchange="perfSetStatus(${month},'closed')"> Closed
            </label>
          </div>
        </div>
        ${perfConfigTableHtml(month, cfg)}
        <div style="text-align:right;margin-top:8px;padding-top:8px;border-top:1px dashed var(--b0);font-weight:700;font-size:.88rem">
          Month Total: <span style="color:#0d9488" id="perfMonthTotal_${month}">PKR ${total.toLocaleString()}</span>
        </div>
      </div>`;
  }).join("");

  document.getElementById("perf_downloadBtn").disabled = months.length < PERFMINMONTHS;
  perfUpdateGrandTotal();
}

function perfConfigTableHtml(month, cfg) {
  const isOpen = cfg.status === "open";
  const rows = isOpen ? PERFOPENROWS : PERFCLOSEDROWS;
  const rowsHtml = rows.map((r, i) => perfIndicatorRowHtml(month, r, i, cfg, isOpen)).join("");

  const th = "border:1px solid var(--b0);background:var(--s2);padding:6px 5px;font-size:.72rem;font-weight:700;text-align:left;vertical-align:middle;white-space:normal;word-wrap:break-word;overflow-wrap:break-word;";
  const heads = isOpen
    ? `<th style="${th}width:6%">Sr.</th>
       <th style="${th}width:24%">Indicators</th>
       <th style="${th}width:24%">Targets %age</th>
       <th style="${th}width:12%">Target Achieved by AEO</th>
       <th style="${th}width:12%;text-align:right">Entitlement</th>
       <th style="${th}width:12%">Remarks</th>
       <th style="${th}width:10%">Initials of DDO</th>`
    : `<th style="${th}width:6%">Sr.</th>
       <th style="${th}width:24%">Indicators</th>
       <th style="${th}width:35%">Targets</th>
       <th style="${th}width:18%">Performance</th>
       <th style="${th}width:17%">Remarks</th>`;

  return `<table style="width:100%;border-collapse:collapse;font-size:.72rem;table-layout:fixed">
    <thead><tr>${heads}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}

function perfIndicatorRowHtml(month, row, idx, cfg, isOpen) {
  const stored = cfg.achieved[idx];
  const credited = perfIsCredited(row, stored);
  const entitlement = perfRowAmount(row);
  const { rmkCell } = perfRowDisplayCells(row, stored, credited);
  const td = "border:1px solid var(--b0);padding:5px;vertical-align:middle;white-space:normal;word-wrap:break-word;overflow-wrap:break-word;";

  let achievedCell;
  if (row.kind === "fixed") {
    achievedCell = `<span style="color:var(--t3)">${row.fixedAch}</span>`;
  } else if (row.kind === "percent") {
    const val = (stored === undefined || stored === "") ? "" : stored;
    achievedCell = `<input type="number" min="0" max="100" value="${val}" placeholder="${row.targetPct}" style="width:56px;height:26px;border:1px solid var(--b0);border-radius:5px;padding:0 5px;font-size:.72rem"
      oninput="perfUpdateAchieved(${month}, ${idx}, this.value)"> %`;
  } else {
    const val = stored ?? true;
    achievedCell = `<label style="display:flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap">
      <input type="checkbox" ${val ? "checked" : ""} onchange="perfUpdateAchieved(${month}, ${idx}, this.checked)"> Achieved
    </label>`;
  }

  if (isOpen) {
    return `<tr>
      <td style="${td}text-align:center">${idx + 1}</td>
      <td style="${td}">${row.ind}</td>
      <td style="${td}color:var(--t3)">${row.tgtLabel}</td>
      <td style="${td}text-align:center">${achievedCell}</td>
      <td style="${td}text-align:right;font-weight:600;color:${credited ? "#0d9488" : "var(--t3)"}">PKR ${(credited ? entitlement : 0).toLocaleString()}</td>
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

async function perfDownloadCertificate() {
  if (!iaState.profile) { showToast("Profile not loaded yet.", false); return; }
  const months = [...perfState.selected].sort((a, b) => a - b);
  if (months.length < PERFMINMONTHS) { showToast(`Select at least ${PERFMINMONTHS} prepared month.`, false); return; }

  const btn = document.getElementById("perf_downloadBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating…';
  try {
    const year = Number(document.getElementById("perf_year").value);
    const pages = months.map((month) => {
      const cfg = perfState.config[month];
      const total = perfComputeMonthTotal(month);
      const data = { user: iaState.profile, year, month, amount: total, cfg };
      return cfg.status === "open" ? perfOpenHtml(data) : perfClosedHtml(data);
    });
    const pdfBytes = await perfBuildCertificatePdfBytes(pages);
    const label = months.map((m) => IA_MONTH_NAMES[m - 1]).join("-");
    iaDownloadPdf(pdfBytes, `Performance_Certificate_${iaState.profile.personal_no}_${label}_${year}.pdf`);
    showToast("Certificate downloaded.", true);
  } catch (err) {
    showToast("Error generating certificate: " + err.message, false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-file-earmark-pdf-fill"></i> Download Certificate (PDF)';
  }
}
