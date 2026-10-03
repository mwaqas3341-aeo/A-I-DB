// ═══════════════════════════════════════════════════════════════════
//  VISIT PLANNER — Excel export (official template reproduction)
//  Reproduces VISIT_PLAN_MARKAZ_*.xlsx: three merged blue header lines,
//  Visit Date | Day | Emis Code | Morning Visit (School 1) | Emis Code |
//  Mid-Day Visit (School 2), thin borders, Montserrat/Roboto fonts, and the
//  AEO signature block. ExcelJS (styled output) is loaded on demand only
//  when the user clicks Download, so no other page pays for it.
// ═══════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  const BLUE = 'FF435E91', INK = 'FF1A1B1F';
  const thin = { style: 'thin' };
  const BORDER = { left: thin, right: thin, top: thin, bottom: thin };
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const titleCase = s => String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  /**
   * data = { year, month, startDate:'YYYY-MM-DD'|null, genderTag:'M'|'F', markazLabel:'93/ML', district:'LAYYAH',
   *          rows:[{ date:'YYYY-MM-DD', s1:{emis,name,office}|null, s2:{...}|null }] }
   */
  function build(ExcelJS, data) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'A-I-DB Visit Planner';
    const mon = MONTHS[data.month - 1];
    const ws = wb.addWorksheet(`Visit Plan ${mon.slice(0, 3)} ${data.year}`, {
      views: [{ showGridLines: true }],
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
                   margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } }
    });
    [2.57, 23.86, 11.5, 11.5, 29.57, 19.43, 26.86].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    const wef = data.startDate ? new Date(Date.UTC(+data.startDate.slice(0, 4), +data.startDate.slice(5, 7) - 1, +data.startDate.slice(8, 10))) : null;
    const wefTxt = wef ? ` (W.E.F. ${String(wef.getUTCDate()).padStart(2, '0')} ${mon.toUpperCase()} ${data.year})` : '';
    const heads = [
      `OFFICE OF THE ASSISTANT EDUCATION OFFICER (${data.genderTag || 'M'})`,
      `MARKAZ ${String(data.markazLabel || '').toUpperCase()}, DISTRICT ${String(data.district || '').toUpperCase()}`,
      `TENTATIVE SCHOOL VISIT PLAN FOR ${mon.toUpperCase()} ${data.year}${wefTxt}`
    ];
    heads.forEach((t, i) => {
      const r = i + 1;
      ws.mergeCells(`B${r}:G${r}`);
      for (let c = 2; c <= 7; c++) {
        const cell = ws.getRow(r).getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
        cell.font = { name: 'Montserrat', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center', wrapText: true };
      }
      ws.getCell(`B${r}`).value = t;
      ws.getRow(r).height = 15.75;
    });

    ['Visit Date', 'Day', 'Emis Code', 'Morning Visit (School 1)', 'Emis Code', 'Mid-Day Visit (School 2)'].forEach((h, i) => {
      const cell = ws.getRow(5).getCell(i + 2);
      cell.value = h;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      cell.font = { name: 'Montserrat', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', wrapText: true };
      cell.border = BORDER;
    });
    ws.getRow(5).height = 31.5;

    const body = { name: 'Roboto', size: 10, color: { argb: INK } };
    let r = 6;
    (data.rows || []).forEach(row => {
      const [y, m, d] = row.date.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      const cells = [dt, DAYS[dt.getUTCDay()],
        row.s1 && !row.s1.office ? row.s1.emis : '', row.s1 ? (row.s1.office ? 'Office Work' : row.s1.name) : '',
        row.s2 && !row.s2.office ? row.s2.emis : '', row.s2 ? (row.s2.office ? 'Office Work' : row.s2.name) : ''];
      cells.forEach((v, i) => {
        const cell = ws.getRow(r).getCell(i + 2);
        cell.value = v === '' ? null : v;
        cell.font = body;
        cell.border = BORDER;
        cell.alignment = { wrapText: true, vertical: 'top' };
        if (i === 0) cell.numFmt = 'dd mmm yyyy';
        if (i === 2 || i === 4) cell.numFmt = '@';
      });
      const long = [cells[3], cells[5]].some(t => String(t || '').length > 30);
      ws.getRow(r).height = long ? 25.5 : 12.75;
      r++;
    });

    const sig = r + 7;
    [[`ASSISTANT EDUCATION OFFICER (${data.genderTag || 'M'})`], [`Markaz ${data.markazLabel}, District ${titleCase(data.district)}`]].forEach((t, i) => {
      ws.mergeCells(`E${sig + i}:G${sig + i}`);
      const cell = ws.getCell(`E${sig + i}`);
      cell.value = t[0];
      cell.font = { name: 'Roboto', size: 10, bold: true, color: { argb: INK } };
      cell.alignment = { horizontal: 'center', wrapText: true };
      ws.getRow(sig + i).height = 12.75;
    });
    ws.pageSetup.printArea = `B1:G${sig + 1}`;
    return wb;
  }

  function loadExcelJS() {
    if (root.ExcelJS) return Promise.resolve(root.ExcelJS);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = EXCELJS_URL; s.async = true;
      s.onload = () => root.ExcelJS ? resolve(root.ExcelJS) : reject(new Error('ExcelJS failed to initialise'));
      s.onerror = () => reject(new Error('Could not load the Excel library. Check your internet connection.'));
      document.head.appendChild(s);
    });
  }

  async function download(data, fileName) {
    const ExcelJS = await loadExcelJS();
    const buf = await build(ExcelJS, data).xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  const api = { build, download };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VisitPlannerExcel = api;
})(typeof window !== 'undefined' ? window : globalThis);
