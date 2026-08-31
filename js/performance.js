// performance.js
// AEO Monthly Performance Certificate - Letter Portrait PDF
// Ready-to-replace version: single page per month, Letter 612x792pt.

const PERFMAXMONTHS = 4;
const PERFMINMONTHS = 1;

const PERFLETTER_WIDTH_PT = 650;
const PERFLETTER_HEIGHT_PT = 820;
const PERFLETTER_WIDTH_PX = Math.round((PERFLETTER_WIDTH_PT * 96) / 72); // 867
const PERFLETTER_HEIGHT_PX = Math.round((PERFLETTER_HEIGHT_PT * 96) / 72); // 1093
const PERFHEAD_PT = 7.0;
const PERFBODY_PT = 9.0;
const PERFLINEHEIGHT = 1.25;

// NOTE: the indicator grids are built with flexbox rows/cells (not a
// native <table>) because html2canvas has long-standing bugs rendering
// <table>/<colgroup> column widths — it was silently dropping the
// right-most column(s) even when the declared widths summed correctly.
// Flexbox with explicit fixed-width cells renders reliably.
const PERFCOLGAP = 0; // borders sit flush against each other (grid look)

function perfFlexCell(widthPx, content, opts = {}) {
  const align = opts.align || "left";
  const justify = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
  const textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
  const header = !!opts.header;
  return `<div style="
    flex:0 0 ${widthPx}px;
    width:${widthPx}px;
    max-width:${widthPx}px;
    box-sizing:border-box;
    border:1px solid #000;
    padding:3px 3px;
    display:flex;
    align-items:center;
    justify-content:${justify};
    text-align:${textAlign};
    white-space:normal;
    word-wrap:break-word;
    overflow-wrap:break-word;
    word-break:break-word;
    color:#000000;
    font-weight:700;
    font-size:${header ? PERFHEAD_PT : PERFBODY_PT}pt;
    ${header ? "background:#f2f2f2;" : ""}
  ">${content}</div>`;
}

function perfFlexRow(totalWidthPx, cellsHtml) {
  return `<div style="display:flex;width:${totalWidthPx}px;">${cellsHtml.join("")}</div>`;
}

function perfFlexTable(totalWidthPx, headerCellsHtml, bodyRowsHtml) {
  return `<div style="width:${totalWidthPx}px;line-height:${PERFLINEHEIGHT};color:#000;">
    ${perfFlexRow(totalWidthPx, headerCellsHtml)}
    ${bodyRowsHtml.join("")}
  </div>`;
}

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
  lockedMonths: new Set(), // months required by an already-generated bill — can't be removed/skipped
};

function perfSafe(v) {
  return (v ?? "").toString().trim();
}

function perfTitleCase(v) {
  return perfSafe(v).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function perfIsCredited(row, storedVal) {
  if (row.kind === "fixed") return true;
  if (row.kind === "percent") {
    const val = (storedVal === undefined || storedVal === "") ? row.targetPct : storedVal;
    return Number(val) >= Number(row.targetPct);
  }
  return storedVal ?? true;
}

// FIX (Issue 2 — inflated totals like 25,008 / 250008 instead of 25,000):
// The old perfRowAmount() rounded EVERY row's share individually
// (Math.round(weight * rate)), then the totals summed those already-rounded
// numbers. For 16 equal-weight rows at rate 25000, each row's exact share is
// 1562.5, which Math.round() bumps up to 1563 — and 16 x 1563 = 25008, not
// 25000. Multiply that same drift across multiple selected months and it
// compounds further (which is how a display can end up showing something
// like 250008). The fix: never round per-row and then add the rounded
// numbers. Instead, apportion the whole (integer) rate across rows using
// the "largest remainder" method, which guarantees the parts always sum to
// EXACTLY the capped total — no drift is mathematically possible — and
// every value is forced through Number()/Math.round so a stray string can
// never sneak in and get concatenated instead of added.
function perfDistributeAmounts(rows, rate) {
  const capRate = Math.max(0, Math.round(Number(rate) || 25000));
  const raw = rows.map((row) => (Number(row.weight) || 0) * capRate);
  const floors = raw.map((v) => Math.floor(v));
  const allocated = floors.reduce((a, b) => a + b, 0);
  let remaining = capRate - allocated;
  const order = raw
    .map((v, i) => ({ i, rem: v - floors[i] }))
    .sort((a, b) => b.rem - a.rem);
  const amounts = floors.slice();
  for (let k = 0; k < order.length && remaining > 0; k++, remaining--) {
    amounts[order[k].i] += 1;
  }
  // Safety net: amounts must always be non-negative integers and must
  // always sum to exactly capRate (never more) — this is the strict cap.
  return amounts.map((v) => Math.max(0, Math.round(Number(v) || 0)));
}

function perfRowAmount(row, rows) {
  // Back-compat single-row lookup: derive this row's apportioned share from
  // the full distribution so it never drifts from the true total. Falls
  // back to a plain rounded share only if a rows list isn't supplied.
  if (Array.isArray(rows)) {
    const rate = Number(iaState?.rate) || 25000;
    const idx = rows.indexOf(row);
    if (idx !== -1) return perfDistributeAmounts(rows, rate)[idx];
  }
  return Math.round((Number(row.weight) || 0) * (Number(iaState?.rate) || 25000));
}

function perfRowDisplayCells(row, storedVal, credited) {
  if (row.kind === "fixed") {
    return { achCell: row.fixedAch || "Achieved", rmkCell: row.fixedRmk || "Not Applicable" };
  }
  if (row.kind === "percent") {
    const val = (storedVal === undefined || storedVal === "") ? row.targetPct : storedVal;
    return {
      // The "Target Achieved by AEO" column must always show the actual
      // percentage the AEO entered (even when it's below target) — it is
      // NOT a status field. "Achieved"/"Not Achieved" status belongs only
      // in the separate Remarks column below, which is unaffected.
      achCell: val,
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
  const tehsil = perfTitleCase(u?.tehsil);
  const wingPart = wing ? ` (${wing})` : "";
  const tehsilPart = tehsil ? ` TEHSIL ${tehsil.toUpperCase()}` : "";
  return `${officeTitle}${wingPart}${tehsilPart}`;
}

function perfHeaderHtml(officeTitle, u, monthLabel) {
  const th = "border:1px solid #000;padding:5px 8px;font-weight:700;text-align:left;vertical-align:middle;";
  const td = "border:1px solid #000;padding:5px 8px;text-align:left;vertical-align:middle;font-weight:700;";
  const officeLine = perfOfficeLine(officeTitle, u);
  return `
  <table dir="ltr" style="width:100%;border-collapse:collapse;margin-bottom:0;font-size:9.5pt;color:#000;">
    <tr><td colspan="2" style="border:1px solid #000;padding:6px 8px;text-align:center;font-weight:700;font-size:11.5pt;line-height:1.15;word-wrap:break-word;overflow-wrap:break-word;">${officeLine}</td></tr>
    <tr><td colspan="2" style="border:1px solid #000;padding:5px 8px;text-align:center;font-weight:700;font-size:10.5pt;text-decoration:underline;text-transform:uppercase;">AEO MONTHLY PERFORMANCE CERTIFICATE</td></tr>
    <tr><td style="${th}width:18%;">AEO Name:</td><td style="${td}">${perfSafe(u?.name)}</td></tr>
    <tr><td style="${th}">Markaz:</td><td style="${td}">${perfTitleCase(u?.markaz_name)}</td></tr>
    <tr><td style="${th}">Month:</td><td style="${td}">${perfSafe(monthLabel)}</td></tr>
    <tr><td style="${th}">Cell No:</td><td style="${td}">${perfSafe(u?.cell_no || u?.cnic || "")}</td></tr>
  </table>`;
}

function perfFooterHtml(amount, u) {
  const tehsil = perfTitleCase(u?.tehsil);
  return `
  <p style="font-size:11pt;font-weight:700;margin:12px 0 16px;line-height:1.4;color:#000;text-align:justify;text-indent:2em;word-wrap:break-word;overflow-wrap:break-word;">${PERFKPINOTICE} worth PKR ${Number(amount || 0).toLocaleString()}.</p>
  <table style="width:100%;border-collapse:collapse;font-size:12.5pt;font-weight:700;color:#000;" dir="ltr">
    <tr>
      <td style="width:50%;text-align:center;vertical-align:bottom;padding:0 8px;">
        <div style="height:26px;"></div>
        <div style="font-weight:700;font-size:12.5pt;">Assistant Education Officer</div>
        <div style="font-weight:700;font-size:12.5pt;">${perfTitleCase(u?.markaz_name)}</div>
      </td>
      <td style="width:50%;text-align:center;vertical-align:bottom;padding:0 8px;">
        <div style="height:26px;"></div>
        <div style="font-weight:700;font-size:12.5pt;">Deputy District Education Officer</div>
        <div style="font-weight:700;font-size:12.5pt;">${tehsil ? `Tehsil ${tehsil}` : ""}</div>
      </td>
    </tr>
  </table>`;
}

// ─── OPEN format — Letter portrait, single page ─────────────────────
function perfOpenHtml(data) {
  const u = data.user || {};
  const cfg = data.cfg || {};
  const monthLabel = `${IA_MONTH_NAMES[data.month - 1] || data.month} ${data.year}`;
  const PERFOPEN_COLS = [42, 165, 150, 100, 115, 140, 118]; // px — sums to ~830, fits the wider page
  const openTotalW = PERFOPEN_COLS.reduce((a, b) => a + b, 0);

  const headerCells = [
    perfFlexCell(PERFOPEN_COLS[0], "Sr.", { header: true, align: "center" }),
    perfFlexCell(PERFOPEN_COLS[1], "Indicators", { header: true, align: "center" }),
    perfFlexCell(PERFOPEN_COLS[2], "Targets %age", { header: true, align: "center" }),
    perfFlexCell(PERFOPEN_COLS[3], "Target Achieved by AEO", { header: true, align: "center" }),
    perfFlexCell(PERFOPEN_COLS[4], "Entitlement of Allowance rupees", { header: true, align: "center" }),
    perfFlexCell(PERFOPEN_COLS[5], "Remarks of Immediate Officer", { header: true, align: "center" }),
    perfFlexCell(PERFOPEN_COLS[6], "Initials of DDO", { header: true, align: "center" }),
  ];

  const rate = Number(iaState?.rate) || 25000;
  const openAmounts = perfDistributeAmounts(PERFOPENROWS, rate);
  const rows = PERFOPENROWS.map((r, i) => {
    const stored = cfg.achieved?.[i];
    const credited = perfIsCredited(r, stored);
    const amt = openAmounts[i];
    const { achCell, rmkCell } = perfRowDisplayCells(r, stored, credited);
    return perfFlexRow(openTotalW, [
      perfFlexCell(PERFOPEN_COLS[0], i + 1, { align: "center" }),
      perfFlexCell(PERFOPEN_COLS[1], r.ind, { align: "left" }),
      perfFlexCell(PERFOPEN_COLS[2], r.tgtLabel, { align: "left" }),
      perfFlexCell(PERFOPEN_COLS[3], achCell, { align: "center" }),
      perfFlexCell(PERFOPEN_COLS[4], credited ? amt.toLocaleString() : "-", { align: "center" }),
      perfFlexCell(PERFOPEN_COLS[5], rmkCell, { align: "center" }),
      perfFlexCell(PERFOPEN_COLS[6], "", { align: "center" }),
    ]);
  });

  const body = `
    ${perfHeaderHtml("OFFICE OF THE DEPUTY DISTRICT EDUCATION OFFICER", u, monthLabel)}
    <div style="margin-top:8px;">
      ${perfFlexTable(openTotalW, headerCells, rows)}
    </div>
    ${perfFooterHtml(data.amount, u)}
  `;

  return `
    <div style="width:${PERFLETTER_WIDTH_PX}px;padding:10pt 14pt 16pt;font-family:Arial,Arial Narrow,sans-serif;color:#000000;box-sizing:border-box;background:#fff;direction:ltr;text-align:left;">
      ${body}
    </div>`;
}

// ─── CLOSED format — Letter portrait, single page ───────────────────
function perfClosedHtml(data) {
  const u = data.user || {};
  const cfg = data.cfg || {};
  const monthLabel = `${IA_MONTH_NAMES[data.month - 1] || data.month} ${data.year}`;

  const PERFCLOSED_COLS = [42, 195, 230, 165, 198]; // px — sums to ~830, fits the wider page
  const closedTotalW = PERFCLOSED_COLS.reduce((a, b) => a + b, 0);

  const headerCells = [
    perfFlexCell(PERFCLOSED_COLS[0], "Sr.", { header: true, align: "center" }),
    perfFlexCell(PERFCLOSED_COLS[1], "Indicators", { header: true, align: "center" }),
    perfFlexCell(PERFCLOSED_COLS[2], "Targets", { header: true, align: "center" }),
    perfFlexCell(PERFCLOSED_COLS[3], "Performance", { header: true, align: "center" }),
    perfFlexCell(PERFCLOSED_COLS[4], "Remarks of Immediate Officer", { header: true, align: "center" }),
  ];

  const rows = PERFCLOSEDROWS.map((r, i) => {
    const stored = cfg.achieved?.[i];
    const credited = perfIsCredited(r, stored);
    return perfFlexRow(closedTotalW, [
      perfFlexCell(PERFCLOSED_COLS[0], i + 1, { align: "center" }),
      perfFlexCell(PERFCLOSED_COLS[1], r.ind, { align: "left" }),
      perfFlexCell(PERFCLOSED_COLS[2], r.tgtLabel, { align: "left" }),
      perfFlexCell(PERFCLOSED_COLS[3], credited ? "Achieved" : "Not Achieved", { align: "center" }),
      perfFlexCell(PERFCLOSED_COLS[4], "", { align: "center" }),
    ]);
  });

  const body = `
    ${perfHeaderHtml("OFFICE OF THE DY. DISTRICT EDUCATION OFFICER", u, monthLabel)}
    <div style="margin-top:8px;">
      ${perfFlexTable(closedTotalW, headerCells, rows)}
    </div>
    ${perfFooterHtml(data.amount, u)}
  `;

  return `
    <div style="width:${PERFLETTER_WIDTH_PX}px;padding:10pt 14pt 16pt;font-family:Arial,Arial Narrow,sans-serif;color:#000000;box-sizing:border-box;background:#fff;direction:ltr;text-align:left;">
      ${body}
    </div>`;
}

async function perfBuildCertificatePdfBytes(pagesHtml) {
  const target = document.getElementById("iaPdfRenderTarget");

  // Same reliable off-screen-capture pattern as bpRenderTargetIntoPdf
  // (budget-preparation.js): position:fixed;left:-9999px can get
  // partially culled/painted by the browser before html2canvas grabs
  // it, causing intermittent missing content (e.g. one footer column
  // vanishing). Explicitly hiding via visibility, then forcing the
  // clone visible only inside html2canvas's private DOM, avoids that.
  target.style.position = "absolute";
  target.style.left = "0";
  target.style.top = "0";
  target.style.width = `${PERFLETTER_WIDTH_PX}px`;
  target.style.visibility = "hidden";
  target.style.zIndex = "-1";
  target.setAttribute("dir", "ltr");
  target.style.direction = "ltr";

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("p", "pt", [PERFLETTER_WIDTH_PT, PERFLETTER_HEIGHT_PT]);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pagesHtml.length; i++) {
    target.innerHTML = pagesHtml[i];
    await new Promise((r) => setTimeout(r, 250));

    // NOTE: deliberately NOT passing width/height/windowWidth/windowHeight
    // here. Those were being computed from target.scrollWidth/scrollHeight
    // while the target was still visibility:hidden, and combined with an
    // async onclone that flips visibility back on, that produced a
    // mismatched capture window — the root cause of the blank/broken
    // certificates. Letting html2canvas size itself off the (now-visible,
    // inside the clone) element, exactly like iaBuildBillPdfBytes and
    // bpRenderTargetIntoPdf already do successfully elsewhere in this repo.
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      onclone: function (clonedDoc) {
        const clonedTarget = clonedDoc.getElementById("iaPdfRenderTarget");
        if (clonedTarget) clonedTarget.style.visibility = "visible";
      },
    });

    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const scaleX = pageWidth / canvas.width;
    const scaleY = pageHeight / canvas.height;
    const scale = Math.min(scaleX, scaleY);
    const drawWidth = canvas.width * scale;
    const drawHeight = canvas.height * scale;
    const offsetX = (pageWidth - drawWidth) / 2;
    const offsetY = (pageHeight - drawHeight) / 2;

    if (i > 0) pdf.addPage([PERFLETTER_WIDTH_PT, PERFLETTER_HEIGHT_PT], "p");
    pdf.addImage(imgData, "JPEG", offsetX, offsetY, drawWidth, drawHeight);
  }

  target.innerHTML = "";
  target.style.position = "";
  target.style.left = "";
  target.style.top = "";
  target.style.width = "";
  target.style.visibility = "";
  target.style.zIndex = "";
  return pdf.output("arraybuffer");
}

function perfInjectGateStyles() {
  if (document.getElementById("perfGateStyleTag")) return;
  const style = document.createElement("style");
  style.id = "perfGateStyleTag";
  style.textContent = `
    @keyframes perfGatePulse {
      0%, 100% { box-shadow: 0 0 0 3px rgba(13,148,136,.15), 0 8px 20px rgba(13,148,136,.25); }
      50%      { box-shadow: 0 0 0 7px rgba(13,148,136,.28), 0 12px 28px rgba(13,148,136,.42); }
    }
    @keyframes perfArrowNudge {
      0%, 100% { transform: translateX(0); }
      50%      { transform: translateX(-6px); }
    }
    .perf-status-gate {
      animation: perfGatePulse 1.6s ease-in-out infinite;
      border: 2px solid #0d9488;
      background: linear-gradient(135deg,#ffffff,#ecfeff);
      border-radius: 12px;
      padding: 16px;
      text-align: center;
      width: 100%;
    }
    .perf-status-btn {
      padding: 10px 24px;
      border-radius: 10px;
      border: none;
      font-weight: 700;
      font-size: .85rem;
      cursor: pointer;
      color: #fff;
      background: linear-gradient(135deg,#cbd5e1,#94a3b8);
      transition: transform .12s ease, box-shadow .12s ease;
    }
    .perf-status-btn:hover { transform: translateY(-1px); }
    .perf-status-btn.active {
      background: linear-gradient(135deg,#14b8a6,#0d9488 60%,#0f766e);
      box-shadow: 0 4px 12px rgba(13,148,136,.4);
    }
    .perf-status-btn.pending {
      background: linear-gradient(135deg,#14b8a6,#0d9488 60%,#0f766e);
      box-shadow: 0 4px 14px rgba(13,148,136,.45);
    }
    .perf-workspace-locked {
      pointer-events: none;
      user-select: none;
      filter: grayscale(.85) blur(1px);
      opacity: .45;
    }
  `;
  document.head.appendChild(style);
}

function perfInit() {
  perfInjectGateStyles();
  perfState.aeoTargetId = null; // self-service — clears any AEO previously being prepared for
  if (typeof iaState !== 'undefined' && iaState.selfProfile) iaState.profile = iaState.selfProfile;
  const banner = document.getElementById('perf_aeoTargetBanner');
  if (banner) banner.classList.add('hidden');
  const yearSel = document.getElementById("perf_year");
  const yNow = new Date().getFullYear();
  yearSel.innerHTML = [yNow - 2, yNow - 1, yNow, yNow + 1]
    .map((y) => `<option value="${y}" ${y === yNow ? "selected" : ""}>${y}</option>`)
    .join("");
  perfState.selected = new Set();
  perfState.config = {};
  perfState.lockedMonths = new Set();
  perfLoadMonths();
}

// TR/Admin preparing a Performance Certificate on behalf of another
// AEO (see aeoBillPreparePerformance in inspection-allowance.js).
// iaState.profile is already pointed at the target by the caller;
// this just points perfLoadMonths at that AEO's own inspection
// allowance months instead of the caller's, then everything else
// (grid rendering, KPI entry, PDF generation) works completely
// unchanged since none of it reads currentUser directly.
function perfInitForAeo(targetUserId) {
  perfInjectGateStyles();
  perfState.aeoTargetId = targetUserId;
  const banner = document.getElementById('perf_aeoTargetBanner');
  if (banner) {
    banner.textContent = `⚠ Preparing performance for: ${iaState.profile?.name || 'AEO'} (P.No ${iaState.profile?.personal_no || '—'}) — NOT your own certificate.`;
    banner.classList.remove('hidden');
  }
  const yearSel = document.getElementById("perf_year");
  const yNow = new Date().getFullYear();
  yearSel.innerHTML = [yNow - 2, yNow - 1, yNow, yNow + 1]
    .map((y) => `<option value="${y}" ${y === yNow ? "selected" : ""}>${y}</option>`)
    .join("");
  perfState.selected = new Set();
  perfState.config = {};
  perfState.lockedMonths = new Set();
  perfLoadMonths();
  showToast(`Preparing a Performance Certificate for ${iaState.profile?.name || 'this AEO'}.`, true);
}

// Called after a successful Inspection Allowance bill download/generation
// (see iaRedirectToPerformance in inspection-allowance.js) so bill and
// performance prep always cover the exact same months.
//
// NOTE: perfState is single-year under the hood (one perf_year dropdown
// drives everything below, including the save/submit logic further down
// this file), so it can't natively hold two different years selected at
// once. A bill spanning two years (allowed since it can mix e.g. Dec 2025
// + Jan 2026) is handled by jumping to whichever year has more of the
// bill's months and pre-checking those; the other year's month(s), if
// any, are explicitly flagged via toast so the AEO does a quick second
// pass for those rather than having them silently dropped.
async function perfInitWithPreselected(monthYearPairs) {
  perfInjectGateStyles();
  if (!monthYearPairs || !monthYearPairs.length) { perfInit(); return; }

  const counts = {};
  monthYearPairs.forEach(p => { counts[p.year] = (counts[p.year] || 0) + 1; });
  const years = Object.keys(counts).map(Number);
  const primaryYear = years.reduce((a, b) => (counts[b] > counts[a] ? b : a), years[0]);
  const primaryMonths = monthYearPairs.filter(p => p.year === primaryYear).map(p => p.month);
  const otherPairs = monthYearPairs.filter(p => p.year !== primaryYear);

  const yearSel = document.getElementById("perf_year");
  const yNow = new Date().getFullYear();
  const yearOptions = [...new Set([yNow - 2, yNow - 1, yNow, yNow + 1, primaryYear])].sort();
  yearSel.innerHTML = yearOptions.map((y) => `<option value="${y}" ${y === primaryYear ? "selected" : ""}>${y}</option>`).join("");

  perfState.config = {};
  await perfLoadMonths(); // resets perfState.selected, loads perfState.months for primaryYear

  const validMonths = primaryMonths.filter(m => perfState.months.some(x => x.month === m));
  perfState.selected = new Set(validMonths);
  // BUG FIX: perfToggleMonth always initializes perfState.config[month]
  // before re-rendering; this preselection path skipped that step, so
  // perfRenderConfigPanels() crashed on cfg.status (cfg was undefined)
  // and the KPI panel silently failed to open — exactly the "must
  // remove and re-add the month" symptom, since re-adding goes through
  // perfToggleMonth which does set it.
  validMonths.forEach(m => { perfState.config[m] = { status: null, achieved: {} }; });
  // These months came from an already-generated bill — required, not a
  // free choice, so lock them from being removed/skipped.
  perfState.lockedMonths = new Set(validMonths);

  perfRenderMonthsGrid();
  perfRenderConfigPanels();

  if (otherPairs.length) {
    const label = otherPairs.map(p => `${IA_MONTH_NAMES[p.month - 1]} ${p.year}`).join(', ');
    showToast(`Months pre-selected for ${primaryYear}. Your bill also included ${label} — switch the Year above to prepare that certificate separately.`, false);
  } else {
    showToast('Months from your bill are pre-selected below — fill in the KPIs and save.', true);
  }
}

async function perfLoadMonths() {
  const year = Number(document.getElementById("perf_year").value);
  const grid = document.getElementById("perfMonthsGrid");
  const warn = document.getElementById("perf_monthWarn");
  grid.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3)"><span class="spinner-border spinner-border-sm"></span> Loading months…</div>`;

  const res = perfState.aeoTargetId
    ? await apiCall("getAeoInspectionAllowanceMonths", { userId: perfState.aeoTargetId, year })
    : await apiCall("getMyInspectionAllowanceMonths", { year });
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
  const available = perfState.months.filter((m) => !perfState.selected.has(m.month));
  const selected = [...perfState.selected].sort((a, b) => a - b);
  const atMax = perfState.selected.size >= PERFMAXMONTHS;
  const hasLocked = perfState.lockedMonths.size > 0;

  let pickerHtml;
  if (hasLocked) {
    // These months are required by an already-generated bill — selection
    // isn't a free choice here, so no "add another month" picker at all.
    pickerHtml = `<div style="font-size:.8rem;color:#0f766e;background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:8px 12px">
      <i class="bi bi-lock-fill"></i> These months are required because your Inspection Allowance bill was generated for them.
    </div>`;
  } else if (atMax) {
    pickerHtml = `<div style="font-size:.8rem;color:var(--t3)">Maximum ${PERFMAXMONTHS} months selected. Remove one below to add another.</div>`;
  } else if (!available.length) {
    pickerHtml = `<div style="font-size:.8rem;color:var(--t3)">All prepared months for this year are selected.</div>`;
  } else {
    pickerHtml = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select id="perfMonthPicker" style="height:36px;border:1px solid var(--b0);border-radius:6px;padding:0 10px;font-size:.85rem;color:#111">
        ${available.map((m) => `<option value="${m.month}">${IA_MONTH_NAMES[m.month - 1]}</option>`).join("")}
      </select>
      <button type="button" style="background:#0d9488;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:.85rem;cursor:pointer" onclick="perfAddMonthFromPicker()">
        <i class="bi bi-plus-lg"></i> Add
      </button>
    </div>`;
  }

  const chipsHtml = selected.length
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${selected.map((month) => {
          const locked = perfState.lockedMonths.has(month);
          return `<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;background:#f0fdfa;border:1px solid #0d9488;font-size:.85rem;color:#0f766e">
            ${locked ? '<i class="bi bi-lock-fill" style="font-size:.75rem"></i>' : ''}
            ${IA_MONTH_NAMES[month - 1]}
            ${locked ? '' : `<i class="bi bi-x-lg" style="cursor:pointer" onclick="perfRemoveMonth(${month})"></i>`}
          </span>`;
        }).join("")}
      </div>`
    : "";

  grid.innerHTML = pickerHtml + chipsHtml;
}

function perfAddMonthFromPicker() {
  const picker = document.getElementById("perfMonthPicker");
  if (!picker || picker.value === "") return;
  perfToggleMonth(Number(picker.value), true);
}

function perfRemoveMonth(month) {
  if (perfState.lockedMonths.has(month)) {
    showToast('This month is required by your Inspection Allowance bill and can\'t be removed here.', false);
    return;
  }
  perfToggleMonth(month, false);
}

function perfToggleMonth(month, checked) {
  if (checked) {
    if (perfState.selected.size >= PERFMAXMONTHS) {
      showToast(`Maximum ${PERFMAXMONTHS} months per certificate.`, false);
      perfRenderMonthsGrid();
      return;
    }
    perfState.selected.add(month);
    if (!perfState.config[month]) perfState.config[month] = { status: null, achieved: {} };
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
  perfEnforceDeductionMinimum(month, cfg);
  perfRenderConfigPanels();
}

function perfUpdateAchieved(month, idx, value) {
  const cfg = perfState.config[month];
  if (!cfg) return;
  const rows = cfg.status === "open" ? PERFOPENROWS : PERFCLOSEDROWS;
  const row = rows[idx];
  cfg.achieved[idx] = row.kind === "percent" ? (value === "" ? "" : Number(value)) : Boolean(value);
  // The AEO is free to choose which indicator(s) reflect a bill deduction —
  // nothing is permanently locked. But if their choice leaves fewer
  // Not-Achieved indicators than the bill's recorded deduction requires
  // (e.g. they just tried to mark everything Achieved), the system
  // auto-defaults a *different* eligible indicator back to Not Achieved
  // so the deduction can never silently disappear. idx is excluded from
  // that auto-pick so the row they just touched keeps their choice.
  perfEnforceDeductionMinimum(month, cfg, idx);
  perfRenderConfigPanels();
}

// Flat per-indicator deduction (rupees) applied for each "Not Achieved"
// indicator when School Status = Closed. The rate itself (25,000 by
// default) stays the ceiling; achieved indicators simply keep whatever
// isn't deducted — they are not apportioned a fixed per-row share.
const PERFCLOSED_DEDUCTION = 1000;

// ─── Bill-deduction minimum enforcement ────────────────────────────────
// A month's real Inspection Allowance bill deduction (from
// inspection_allowance_deductions — the single source of truth, joined
// in live via getMy/getAeoInspectionAllowanceMonths into perfState.months)
// must always be reflected in this month's certificate as Not-Achieved
// indicator(s). The AEO/TR/Admin preparing it is free to choose WHICH
// indicator(s) — nothing is permanently locked — but the count of
// Not-Achieved indicators (excluding index 0, "AEO/Aeo Visits", and any
// "fixed" row that can never be marked Not Achieved) can never drop below
// what the bill deduction requires. Recomputed fresh from perfState.months
// every time — never persisted — so a later bill edit/removal is always
// picked up next time Prepare Performance is opened.

function perfHashSeed(str) {
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function perfMulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rows eligible to represent a bill deduction: everything except index 0
// (Schools Visits / "AEO Visits" — never touched, per spec) and any
// "fixed" row (perfIsCredited() always returns true for these regardless
// of stored value, so forcing one Not Achieved would silently do nothing).
function perfEligibleDeductionIndices(rows) {
  return rows.map((_, i) => i).filter((i) => i !== 0 && rows[i].kind !== "fixed");
}

// Stable per (user, year, month) priority order used only to pick WHICH
// eligible row gets auto-defaulted to Not Achieved when the AEO's own
// choices fall short — not a permanent lock, just a deterministic
// "next one to flip" order so repeated opens don't jump around randomly.
function perfDeductionPriorityOrder(month, eligible) {
  const seedKey = `${iaState?.profile?.personal_no || iaState?.profile?.id || perfState.aeoTargetId || ""}|${document.getElementById("perf_year")?.value || ""}|${month}`;
  const rand = perfMulberry32(perfHashSeed(seedKey));
  const shuffled = eligible.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Returns the bill-deduction requirement info for a month without
// mutating anything: { billDeduction, required, current, eligible,
// mismatch, insufficient }.
//   mismatch    = billDeduction isn't a clean multiple of Rs.1,000, so it
//                 can't be fully represented by whole indicator rows.
//   insufficient = required count exceeds how many eligible rows exist.
function perfDeductionStatus(month, cfg) {
  const rows = cfg.status === "open" ? PERFOPENROWS : PERFCLOSEDROWS;
  const eligible = perfEligibleDeductionIndices(rows);
  const monthMeta = (perfState.months || []).find((m) => m.month === month);
  const billDeduction = Math.max(0, Number(monthMeta?.deduction) || 0);
  const required = Math.min(eligible.length, Math.floor(billDeduction / PERFCLOSED_DEDUCTION));
  const current = eligible.reduce((cnt, i) => cnt + (perfIsCredited(rows[i], cfg.achieved[i]) ? 0 : 1), 0);
  return {
    billDeduction,
    required,
    current,
    eligible,
    mismatch: billDeduction % PERFCLOSED_DEDUCTION !== 0,
    insufficient: Math.floor(billDeduction / PERFCLOSED_DEDUCTION) > eligible.length,
  };
}

// Mutates cfg.achieved so at least `required` eligible rows are
// Not Achieved. `keepIdx`, if given, is the row the AEO just interacted
// with — it's never chosen as the auto-fill target, so their explicit
// choice is always respected.
function perfEnforceDeductionMinimum(month, cfg, keepIdx) {
  if (!cfg || !cfg.status) return;
  const rows = cfg.status === "open" ? PERFOPENROWS : PERFCLOSEDROWS;
  const status = perfDeductionStatus(month, cfg);
  if (status.current >= status.required) return;

  let need = status.required - status.current;
  const order = perfDeductionPriorityOrder(month, status.eligible);
  for (const idx of order) {
    if (need <= 0) break;
    if (idx === keepIdx) continue;
    if (!perfIsCredited(rows[idx], cfg.achieved[idx])) continue; // already Not Achieved
    cfg.achieved[idx] = rows[idx].kind === "percent" ? 0 : false;
    need--;
  }
}

function perfComputeMonthTotal(month) {
  const cfg = perfState.config[month];
  if (!cfg || !cfg.status) return 0;
  const rate = Number(iaState?.rate) || 25000;

  if (cfg.status === "closed") {
    const notAchievedCount = PERFCLOSEDROWS.reduce((cnt, row, idx) => {
      const credited = perfIsCredited(row, cfg.achieved[idx]);
      return cnt + (credited ? 0 : 1);
    }, 0);
    const total = rate - notAchievedCount * PERFCLOSED_DEDUCTION;
    // Never below 0, never above the configured rate.
    return Math.max(0, Math.min(Math.round(total), Math.round(rate)));
  }

  const rows = PERFOPENROWS;
  const amounts = perfDistributeAmounts(rows, rate);
  const total = rows.reduce((sum, row, idx) => {
    const credited = perfIsCredited(row, cfg.achieved[idx]);
    return sum + (credited ? amounts[idx] : 0);
  }, 0);
  // Strict cap: whatever happens above, the month total can never exceed
  // the configured rate (default 25000).
  return Math.min(Math.round(Number(total) || 0), Math.round(rate));
}

function perfUpdateGrandTotal() {
  const total = [...perfState.selected].reduce((s, m) => Number(s) + Number(perfComputeMonthTotal(m) || 0), 0);
  document.getElementById("perfGrandTotalDisplay").textContent = "PKR " + Number(total).toLocaleString();
}

function perfRenderConfigPanels() {
  const wrap = document.getElementById("perfConfigPanels");
  const months = [...perfState.selected].sort((a, b) => a - b);

  // Preserve focus/caret/scroll across the innerHTML rebuild below. This
  // function runs on every keystroke in a percent indicator input (via
  // perfUpdateAchieved -> oninput). Rebuilding the DOM tears down the
  // input the AEO is actively typing in, which drops focus, dismisses
  // the mobile keyboard, and lets the viewport snap to wherever the page
  // re-settles (often the bill-deduction warning banner above) — this is
  // the "screen jumps to indicator column check" bug. Restoring focus,
  // caret position, and scroll position after the rebuild fixes it
  // without needing to change how/when the panel re-renders.
  const active = document.activeElement;
  const activeCell = (active && wrap.contains(active)) ? active.getAttribute("data-perf-cell") : null;
  const activeSelStart = activeCell ? active.selectionStart : null;
  const activeSelEnd = activeCell ? active.selectionEnd : null;
  const scrollY = window.scrollY;

  if (!months.length) {
    wrap.innerHTML = `<div style="padding:16px;text-align:center;color:var(--t3);font-size:.85rem">Select at least ${PERFMINMONTHS} prepared month above to begin.</div>`;
    document.getElementById("perf_downloadBtn").disabled = true;
    document.getElementById("perfGrandTotalDisplay").textContent = "PKR 0";
    return;
  }

  wrap.innerHTML = months.map((month) => {
    const cfg = perfState.config[month];
    const answered = !!cfg.status;
    const total = perfComputeMonthTotal(month);

    const statusButtons = (pending) => `
      <button type="button" class="perf-status-btn ${cfg.status === "open" ? "active" : pending ? "pending" : ""}" onclick="perfSetStatus(${month},'open')">Open</button>
      <button type="button" class="perf-status-btn ${cfg.status === "closed" ? "active" : pending ? "pending" : ""}" onclick="perfSetStatus(${month},'closed')">Closed</button>
    `;

    const statusBlock = answered
      ? `<div style="display:flex;gap:10px;align-items:center;font-size:.85rem">${statusButtons(false)}</div>`
      : "";

    const gateBlock = answered
      ? ""
      : `<div class="perf-status-gate">
           <div style="font-weight:800;font-size:.78rem;color:#0f766e;text-transform:uppercase;letter-spacing:.04em;margin-bottom:10px">
             ⚠ Required — select School Status to unlock this month
           </div>
           <div style="display:flex;gap:12px;justify-content:center;align-items:center;flex-wrap:wrap">
             ${statusButtons(true)}
             <span style="font-size:1.4rem;color:#f59e0b;font-weight:800;animation:perfArrowNudge 1s ease-in-out infinite">⬅ Tap one</span>
           </div>
         </div>`;

    const dstatus = answered ? perfDeductionStatus(month, cfg) : null;
    const deductionBlock = (dstatus && dstatus.billDeduction > 0)
      ? (dstatus.mismatch || dstatus.insufficient
          ? `<div style="background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;padding:8px 12px;font-size:.76rem;font-weight:600;margin-bottom:10px">
               ⚠ This month has a Rs.${dstatus.billDeduction.toLocaleString()} bill deduction on file that can't be fully represented by whole indicators (each indicator = Rs.${PERFCLOSED_DEDUCTION.toLocaleString()}). Resolve manually before downloading — currently only Rs.${(dstatus.required * PERFCLOSED_DEDUCTION).toLocaleString()} is reflected.
             </div>`
          : `<div style="background:#f0fdfa;border:1px solid #99f6e4;color:#0f766e;border-radius:8px;padding:8px 12px;font-size:.76rem;font-weight:600;margin-bottom:10px">
               ℹ Bill deduction on file: Rs.${dstatus.billDeduction.toLocaleString()} — ${dstatus.current} of ${dstatus.required} required Not-Achieved indicator(s) currently marked (any indicator except "AEO Visits" — your choice).
             </div>`)
      : "";

    const bodyBlock = answered
      ? `${deductionBlock}${perfConfigTableHtml(month, cfg)}
         <div style="text-align:right;margin-top:8px;padding-top:8px;border-top:1px dashed var(--b0);font-weight:700;font-size:.88rem">
           Month Total: <span style="color:#0d9488" id="perfMonthTotal_${month}">PKR ${total.toLocaleString()}</span>
         </div>`
      : `<div class="perf-workspace-locked" style="padding:14px;text-align:center;color:var(--t3);font-size:.8rem;margin-top:12px;border:1px dashed var(--b0);border-radius:8px">
           Indicator checklist is locked until you choose a School Status above.
         </div>`;

    return `
      <div style="background:#fff;border:1px solid var(--b0);border-radius:10px;padding:16px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">
          <div style="font-weight:700;font-size:.95rem">${IA_MONTH_NAMES[month - 1]}</div>
          ${statusBlock}
        </div>
        ${gateBlock}
        ${bodyBlock}
      </div>`;
  }).join("");

  const allAnswered = months.every((m) => !!perfState.config[m]?.status);
  const hasUnresolvedDeduction = months.some((m) => {
    const c = perfState.config[m];
    if (!c || !c.status) return false;
    const d = perfDeductionStatus(m, c);
    return d.mismatch || d.insufficient;
  });
  document.getElementById("perf_downloadBtn").disabled = months.length < PERFMINMONTHS || !allAnswered || hasUnresolvedDeduction;
  perfUpdateGrandTotal();

  if (activeCell) {
    const el = wrap.querySelector(`[data-perf-cell="${activeCell}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (typeof el.setSelectionRange === "function" && activeSelStart != null) {
        try { el.setSelectionRange(activeSelStart, activeSelEnd); } catch (e) { /* ignore */ }
      }
    }
  }
  window.scrollTo(0, scrollY);
}

function perfConfigTableHtml(month, cfg) {
  const isOpen = cfg.status === "open";
  const rows = isOpen ? PERFOPENROWS : PERFCLOSEDROWS;
  const rowsHtml = rows.map((r, i) => perfIndicatorRowHtml(month, r, i, cfg, isOpen, rows)).join("");

  const th = "border:1px solid var(--b0);background:#e2e8f0;color:#1e293b;padding:6px 5px;font-size:.72rem;font-weight:700;text-align:left;vertical-align:middle;white-space:normal;word-wrap:break-word;overflow-wrap:break-word;";
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

function perfIndicatorRowHtml(month, row, idx, cfg, isOpen, rowsList) {
  const stored = cfg.achieved[idx];
  const credited = perfIsCredited(row, stored);
  const entitlement = perfRowAmount(row, rowsList || (isOpen ? PERFOPENROWS : PERFCLOSEDROWS));
  const { rmkCell } = perfRowDisplayCells(row, stored, credited);
  const td = "border:1px solid var(--b0);padding:5px;vertical-align:middle;white-space:normal;word-wrap:break-word;overflow-wrap:break-word;";

  let achievedCell;
  if (row.kind === "fixed") {
    achievedCell = `<span style="color:var(--t3)">${row.fixedAch}</span>`;
  } else if (row.kind === "percent") {
    const val = (stored === undefined || stored === "") ? "" : stored;
    achievedCell = `<input type="number" min="0" max="100" value="${val}" placeholder="${row.targetPct}" data-perf-cell="${month}-${idx}" style="width:56px;height:26px;border:1px solid var(--b0);border-radius:5px;padding:0 5px;font-size:.72rem"
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

  // If a bulk performance run (aeoBillDownloadAllPerformances, in
  // inspection-allowance.js) is in progress, this same button doubles as
  // "Download & Next AEO": the certificate goes into the shared ZIP
  // instead of downloading on its own, and the queue auto-advances.
  // Every check above (months selected, deduction minimum via the
  // disabled state already set by perfRenderConfigPanels) still applies
  // exactly as it does for a normal single-AEO download.
  const queueActive = typeof aeoBillPerfQueue !== "undefined" && aeoBillPerfQueue.active;

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
    const filename = `Performance_Certificate_${iaState.profile.personal_no}_${label}_${year}.pdf`;

    if (queueActive) {
      aeoBillPerfQueue.zip.file(filename, pdfBytes);
      showToast(`Added ${iaState.profile.name || iaState.profile.personal_no}'s certificate to the ZIP.`, true);
      aeoBillPerfQueue.index++;
      await aeoBillPerfQueueLoadCurrent();
    } else {
      iaDownloadPdf(pdfBytes, filename);
      showToast("Certificate downloaded.", true);
    }
  } catch (err) {
    showToast("Error generating certificate: " + err.message, false);
  } finally {
    btn.disabled = false;
    const stillQueued = typeof aeoBillPerfQueue !== "undefined" && aeoBillPerfQueue.active;
    btn.innerHTML = stillQueued
      ? '<i class="bi bi-file-earmark-pdf-fill"></i> Download &amp; Next AEO'
      : '<i class="bi bi-file-earmark-pdf-fill"></i> Download Certificate (PDF)';
  }
}
