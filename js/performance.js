// performance.js
// AEO Monthly Performance Certificate - Letter Portrait PDF
// Ready-to-replace version focused on single-page-per-month output.

const PERFMAXMONTHS = 4;
const PERFMINMONTHS = 1;

const PERFLETTER_WIDTH_PT = 612;
const PERFLETTER_HEIGHT_PT = 792;
const PERFHEAD_PT = 9.0;
const PERFBODY_PT = 8.0;
const PERFLINEHEIGHT = 1.15;

const PERFTHSTYLE = `
  border:1px solid #000;
  padding:2px 3px;
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
  padding:1px 3px;
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
  { ind: "Aeo Visits", tgtLabel: "Once in a Month", weight: 0.10 },
  { ind: "Teacher Training", tgtLabel: "Ensure That Teachers Attend Trainings", weight: 0.10 },
  { ind: "Cot Analysis Report", tgtLabel: "Submit Analysis Report to Immediate Officer", weight: 0.10 },
  { ind: "Ht Orientation", tgtLabel: "Ht Meeting of Markaz and Submit Attendance", weight: 0.10 },
  { ind: "Sbap Report", tgtLabel: "Develop and Submit Sbap Report", weight: 0.10 },
  { ind: "Awareness Campaign Smc", tgtLabel: "1 Session Regarding Importance of Schooling and Hygiene", weight: 0.10 },
  { ind: "Ece Support and Guidance", tgtLabel: "Up Gradation of Ece Room and Material", weight: 0.10 },
  { ind: "Oosc Survey", tgtLabel: "Once a Year", weight: 0.10 },
  { ind: "Ece Support for Enrollment Drive", tgtLabel: "Smc, Ht and Community Plan for Upcoming Enrollment Drive", weight: 0.10 },
  { ind: "Ece Awareness Campaign", tgtLabel: "Creating Awareness of the Importance of Ece in Community", weight: 0.10 },
  { ind: "Sis Orientation", tgtLabel: "Collect Feedback from Ht and Submit to Immediate Officer", weight: 0.10 },
  { ind: "Dengue Awareness Campaign", tgtLabel: "Creating Awareness Regarding Anti-dengue Activities in Schools Like Seminars", weight: 0.10 },
  { ind: "Visit Adp Schemes Under Construction", tgtLabel: "Visit of Adp Scheme and Give Status to Department When Required", weight: 0.10 },
  { ind: "Observance of Govt. Sops in Private Schools", tgtLabel: "Observe Govt. Sops Followed by Private Schools", weight: 0.10 },
  { ind: "Update Sis Data", tgtLabel: "Ensure All Schools of Markaz Have Updated Data on Sis", weight: 0.10 },
  { ind: "Online Complaint Resolution", tgtLabel: "In-time Resolution of Complaints on Dashboard", weight: 0.10 },
];

const PERFKPINOTICE =
  "It is to certify that verifiable KPIs developed and issued by SED vide No. SO(SE-III)5-226/20020 dated 03-08-2020 has been achieved by the above named AEO. His performance is mentioned above against each indicator. He is entitled to get Inspection Allowance as admissible under rules.";

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
    const v = storedVal ?? row.targetPct;
    return Number(v) >= Number(row.targetPct);
  }
  return storedVal ?? true;
}

function perfRowAmount(row) {
  return Math.round((row.weight || 0) * (window.iaState?.rate || 25000));
}

function perfRowDisplayCells(row, storedVal, credited) {
  if (row.kind === "fixed") {
    return { achCell: row.fixedAch || "Achieved", rmkCell: row.fixedRmk || "Not Applicable" };
  }
  if (row.kind === "percent") {
    return {
      achCell: credited ? (storedVal ?? row.targetPct) : "Not Achieved",
      rmkCell: credited ? "Achieved" : "Not Achieved",
    };
  }
  return {
    achCell: credited ? "Yes" : "No",
    rmkCell: credited ? "Achieved" : "Not Achieved",
  };
}

function perfHeaderHtml(officeLine, u, monthLabel) {
  return `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;font-size:9.5pt;color:#000;">
    <div style="width:36%;text-align:left;">
      <table style="width:100%;border-collapse:collapse;font-weight:700;font-size:9pt;color:#000;">
        <tr><td style="padding:2px 0;width:62px;text-align:left;">AEO Name</td><td style="padding:2px 0;border-bottom:1px solid #000;text-align:left;">${perfSafe(u?.name)}</td></tr>
        <tr><td style="padding:2px 0;text-align:left;">Markaz</td><td style="padding:2px 0;border-bottom:1px solid #000;text-align:left;">${perfSafe(u?.markazname)}</td></tr>
        <tr><td style="padding:2px 0;text-align:left;">Month</td><td style="padding:2px 0;border-bottom:1px solid #000;text-align:left;">${perfSafe(monthLabel)}</td></tr>
        <tr><td style="padding:2px 0;text-align:left;">Cell No</td><td style="padding:2px 0;border-bottom:1px solid #000;text-align:left;">${perfSafe(u?.cellno || u?.cnic || "")}</td></tr>
      </table>
    </div>
    <div style="width:62%;text-align:center;color:#000;">
      <div style="font-size:11.5pt;font-weight:700;line-height:1.15;margin-bottom:4px;word-wrap:break-word;overflow-wrap:break-word;">${officeLine}</div>
      <div style="font-size:10.5pt;font-weight:700;text-decoration:underline;text-transform:uppercase;">AEO MONTHLY PERFORMANCE CERTIFICATE</div>
    </div>
  </div>`;
}

function perfFooterHtml(amount, u, sigUrl) {
  return `
  <p style="font-size:8.5pt;font-weight:700;margin:4px 0 12px;line-height:1.25;color:#000;word-wrap:break-word;overflow-wrap:break-word;">${PERFKPINOTICE} worth PKR ${Number(amount || 0).toLocaleString()}.</p>
  <table style="width:100%;border-collapse:collapse;font-size:8.5pt;font-weight:700;color:#000;">
    <tr>
      <td style="width:50%;text-align:center;vertical-align:bottom;padding:0 8px;">
        <div style="height:30px;display:flex;align-items:flex-end;justify-content:center;">${sigUrl ? `<img src="${sigUrl}" crossorigin="anonymous" style="max-height:28px;max-width:140px;filter:grayscale(1) contrast(1.4) brightness(.85);" />` : ""}</div>
        <div style="border-top:1px solid #000;padding-top:2px;">Assistant Education Officer</div>
        <div style="font-weight:400;font-size:7.5pt;">${perfSafe(u?.markazname)}</div>
      </td>
      <td style="width:50%;text-align:center;vertical-align:bottom;padding:0 8px;">
        <div style="height:30px;border:1px dashed #555;border-radius:4px;display:flex;align-items:center;justify-content:center;">
          <span style="font-weight:400;font-size:6.5pt;color:#555;">Signature &amp; Office Stamp</span>
        </div>
        <div style="border-top:1px solid #000;padding-top:2px;">Deputy District Education Officer</div>
        <div style="font-weight:400;font-size:7.5pt;">Tehsil Karor</div>
      </td>
    </tr>
  </table>`;
}

function perfOpenHtmldata(data) {
  const u = data.user || {};
  const cfg = data.cfg || {};
  const monthLabel = `${window.IA_MONTH_NAMES?.[data.month - 1] || data.month} ${data.year}`;
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
    ${perfHeaderHtml("OFFICE OF THE DEPUTY DISTRICT EDUCATION OFFICER (M-EE) TEHSIL KAROR", u, monthLabel)}
    <table style="width:100%;border-collapse:collapse;font-size:${PERFBODY_PT}pt;margin-bottom:0;line-height:${PERFLINEHEIGHT};table-layout:fixed;color:#000;">
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
    ${perfFooterHtml(data.amount, u, data.sigUrl)}
  `;

  return `
    <div style="width:${PERFLETTER_WIDTH_PT}pt;min-height:${PERFLETTER_HEIGHT_PT}pt;padding:28pt 30pt;font-family:Arial,Arial Narrow,sans-serif;color:#000000;box-sizing:border-box;background:#fff;">
      ${body}
    </div>`;
}

function perfClosedHtmldata(data) {
  const u = data.user || {};
  const cfg = data.cfg || {};
  const monthLabel = `${window.IA_MONTH_NAMES?.[data.month - 1] || data.month} ${data.year}`;
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
    ${perfHeaderHtml("OFFICE OF THE DY. DISTRICT EDUCATION OFFICER (M-EE) TEHSIL KAROR", u, monthLabel)}
    <table style="width:100%;border-collapse:collapse;font-size:${PERFBODY_PT}pt;margin-bottom:0;line-height:${PERFLINEHEIGHT};table-layout:fixed;color:#000;">
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
    ${perfFooterHtml(data.amount, u, data.sigUrl)}
  `;

  return `
    <div style="width:${PERFLETTER_WIDTH_PT}pt;min-height:${PERFLETTER_HEIGHT_PT}pt;padding:28pt 30pt;font-family:Arial,Arial Narrow,sans-serif;color:#000000;box-sizing:border-box;background:#fff;">
      ${body}
    </div>`;
}

async function perfGetSignatureUrl() {
  return new Promise((resolve) => {
    try {
      if (typeof getGoogleConnectionStatus !== "function") return resolve("");
      getGoogleConnectionStatus((status) => resolve(status?.signatureurl || ""));
    } catch {
      resolve("");
    }
  });
}

async function perfBuildCertificatePdfBytes(pagesHtml) {
  const target = document.getElementById("iaPdfRenderTarget");
  target.style.width = `${PERFLETTER_WIDTH_PT}pt`;

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("p", "pt", "letter");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pagesHtml.length; i++) {
    target.innerHTML = pagesHtml[i];
    await new Promise((r) => setTimeout(r, 300));

    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
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