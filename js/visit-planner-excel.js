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
  // Holidays: shaded rows in the table + a separate summary list (gazetted = red tint, local = amber tint)
  const HOL_FILL = { gazetted: 'FFFBE3E1', local: 'FFFFF1D6' }, HOL_INK = { gazetted: 'FF9B1C1C', local: 'FF7A5200' };
  const holType = t => t === 'gazetted' ? 'Gazetted' : 'Local';
  const holLabel = h => `${holType(h.type).toUpperCase()} HOLIDAY — ${h.name}`;
  const holFill = t => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: HOL_FILL[t] || HOL_FILL.local } });

  /**
   * data = { year, month, startDate:'YYYY-MM-DD'|null, genderTag:'M'|'F', markazLabel:'93/ML', district:'LAYYAH',
   *          title?:string, sheetName?:string, columns?:string[] (6 headers),
   *          rows:[{ date:'YYYY-MM-DD', s1:{emis,name,office}|null, s2:{...}|null } | { date, special:'ON LEAVE' } | { date, cells:[emis,school,type,details] }
   *                | { date, pair:[{emis,name,cat}, {…}|null], idx, span }  (grouped Actual Visits layout, 8 columns)
   *                | { date, holiday:{type:'gazetted'|'local', name} } ],
   *          holidays?: [{date,type,name}]  (summary list under the table), privateReason?: string }
   */
  function build(ExcelJS, data) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'A-I-DB Visit Planner';
    const mon = MONTHS[data.month - 1];
    const ws = wb.addWorksheet(data.sheetName || `Visit Plan ${mon.slice(0, 3)} ${data.year}`, {
      views: [{ showGridLines: true }],
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
                   margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } }
    });
    // 6-column layouts (tentative / legacy one-visit-per-row) end at column G; the grouped Actual Visits layout (data.pair) has 8 columns, B..I
    const LC = data.columns && data.columns.length === 8 ? 9 : 7, L = String.fromCharCode(64 + LC);
    (LC === 9 ? [2.57, 14, 10, 11, 30, 11, 30, 24, 24] : [2.57, 23.86, 11.5, 11.5, 29.57, 19.43, 26.86]).forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    if (LC === 9) ws.pageSetup.orientation = 'landscape';

    const wef = data.startDate ? new Date(Date.UTC(+data.startDate.slice(0, 4), +data.startDate.slice(5, 7) - 1, +data.startDate.slice(8, 10))) : null;
    const wefTxt = wef ? ` (W.E.F. ${String(wef.getUTCDate()).padStart(2, '0')} ${mon.toUpperCase()} ${data.year})` : '';
    const heads = [
      `OFFICE OF THE ASSISTANT EDUCATION OFFICER (${data.genderTag || 'M'})`,
      `MARKAZ ${String(data.markazLabel || '').toUpperCase()}, DISTRICT ${String(data.district || '').toUpperCase()}`,
      data.title || `TENTATIVE SCHOOL VISIT PLAN FOR ${mon.toUpperCase()} ${data.year}${wefTxt}`
    ];
    heads.forEach((t, i) => {
      const r = i + 1;
      ws.mergeCells(`B${r}:${L}${r}`);
      for (let c = 2; c <= LC; c++) {
        const cell = ws.getRow(r).getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
        cell.font = { name: 'Montserrat', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center', wrapText: true };
      }
      ws.getCell(`B${r}`).value = t;
      ws.getRow(r).height = 15.75;
    });

    (data.columns || ['Visit Date', 'Day', 'Emis Code', 'Morning Visit (School 1)', 'Emis Code', 'Mid-Day Visit (School 2)']).forEach((h, i) => {
      const cell = ws.getRow(5).getCell(i + 2);
      cell.value = h;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      cell.font = { name: 'Montserrat', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', wrapText: true };
      cell.border = BORDER;
    });
    ws.getRow(5).height = 31.5;

    const body = { name: 'Roboto', size: 10, color: { argb: INK } };
    let r = 6, pStart = 6;
    (data.rows || []).forEach(row => {
      const [y, m, d] = row.date.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (row.holiday) {                                  // gazetted / local holiday: shaded, never carries a visit
        const t = row.holiday.type, ink = Object.assign({}, body, { bold: true, color: { argb: HOL_INK[t] || HOL_INK.local } });
        [dt, DAYS[dt.getUTCDay()]].forEach((v, i) => {
          const cell = ws.getRow(r).getCell(i + 2);
          cell.value = v; cell.font = ink; cell.border = BORDER; cell.fill = holFill(t);
          cell.alignment = { wrapText: true, vertical: 'top' };
          if (i === 0) cell.numFmt = 'dd mmm yyyy';
        });
        ws.mergeCells(`D${r}:${L}${r}`);
        for (let c = 4; c <= LC; c++) { const cc = ws.getRow(r).getCell(c); cc.border = BORDER; cc.fill = holFill(t); }
        const hc = ws.getCell(`D${r}`);
        hc.value = holLabel(row.holiday); hc.font = ink;
        hc.alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
        ws.getRow(r).height = String(hc.value).length > 60 ? 25.5 : 12.75;
        r++;
        return;
      }
      if (row.special) {                                  // whole-day "On Leave" / "Other Duty (comment)"
        [dt, DAYS[dt.getUTCDay()]].forEach((v, i) => {
          const cell = ws.getRow(r).getCell(i + 2);
          cell.value = v; cell.font = body; cell.border = BORDER;
          cell.alignment = { wrapText: true, vertical: 'top' };
          if (i === 0) cell.numFmt = 'dd mmm yyyy';
        });
        ws.mergeCells(`D${r}:${L}${r}`);
        for (let c = 4; c <= LC; c++) ws.getRow(r).getCell(c).border = BORDER;
        const sc = ws.getCell(`D${r}`);
        sc.value = row.special;
        sc.font = Object.assign({}, body, { bold: true });
        sc.alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
        ws.getRow(r).height = String(row.special).length > 70 ? 38 : String(row.special).length > 35 ? 25.5 : 12.75;
        r++;
        return;
      }
      if (row.pair) {                                     // Actual Visits: up to two schools per row, one row per pair of schools of a date
        const [a, b2] = row.pair, first = row.idx === 0;
        const put = (c, v, opt) => { const cell = ws.getRow(r).getCell(c); cell.value = v === '' || v == null ? null : v; cell.font = body; cell.border = BORDER; cell.alignment = Object.assign({ wrapText: true, vertical: 'top' }, opt || {}); return cell; };
        const dc = put(2, first ? dt : null); dc.numFmt = 'dd mmm yyyy'; put(3, first ? DAYS[dt.getUTCDay()] : null);
        put(4, a.emis).numFmt = '@'; put(5, a.name); put(8, a.cat);
        if (b2) { put(6, b2.emis).numFmt = '@'; put(7, b2.name); put(9, b2.cat); }
        else {                                            // a single school: its name (and category) span the whole row width
          put(6, null); put(7, null); put(9, null);
          ws.mergeCells(`E${r}:G${r}`); ws.mergeCells(`H${r}:I${r}`);
        }
        const lines = Math.max(...[[a.name, b2 ? 30 : 72], [a.cat, b2 ? 24 : 48], [b2 && b2.name, 30], [b2 && b2.cat, 24]].map(([t, w]) => Math.ceil(String(t || '').length / w) || 1));
        ws.getRow(r).height = Math.max(12.75, 12.75 * lines);
        if (row.idx === 0) pStart = r;
        if (row.span > 1 && row.idx === row.span - 1) { ws.mergeCells(`B${pStart}:B${r}`); ws.mergeCells(`C${pStart}:C${r}`); }   // date + day span all rows of that date
        r++;
        return;
      }
      // row.cells = one-visit-per-row layout (Actual Visits): [emis, school, school type, visit type / duty details]
      const cells = row.cells ? [dt, DAYS[dt.getUTCDay()], ...row.cells] : [dt, DAYS[dt.getUTCDay()],
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
      if (row.cells) {                                    // wrap long school names / comments
        const lines = Math.max(...[[cells[3], 30], [cells[4], 22], [cells[5], 28]].map(([t, w]) => Math.ceil(String(t || '').length / w) || 1));
        ws.getRow(r).height = Math.max(12.75, 12.75 * lines);
      } else {
        const long = [cells[3], cells[5]].some(t => String(t || '').length > 30);
        ws.getRow(r).height = long ? 25.5 : 12.75;
      }
      r++;
    });

    const hols = data.holidays || [];
    if (hols.length) {                                    // separate holiday summary list
      r++;
      ws.mergeCells(`B${r}:${L}${r}`);
      for (let c = 2; c <= LC; c++) {
        const cell = ws.getRow(r).getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
        cell.font = { name: 'Montserrat', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center' }; cell.border = BORDER;
      }
      ws.getCell(`B${r}`).value = `HOLIDAYS — ${mon.toUpperCase()} ${data.year}`;
      r++;
      ['Date', 'Day', 'Type', 'Holiday name / description'].forEach((h, i) => {
        const col = [2, 3, 4, 5][i];
        const cell = ws.getRow(r).getCell(col);
        cell.value = h; cell.font = Object.assign({}, body, { bold: true }); cell.border = BORDER;
        cell.alignment = { horizontal: 'center' }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6EBF5' } };
      });
      ws.mergeCells(`E${r}:${L}${r}`); for (let c = 5; c <= LC; c++) ws.getRow(r).getCell(c).border = BORDER;
      r++;
      hols.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(h => {
        const [y, m, d] = h.date.split('-').map(Number), dt = new Date(Date.UTC(y, m - 1, d));
        const ink = Object.assign({}, body, { color: { argb: HOL_INK[h.type] || HOL_INK.local }, bold: true });
        [[2, dt], [3, DAYS[dt.getUTCDay()]], [4, holType(h.type)], [5, h.name]].forEach(([col, v]) => {
          const cell = ws.getRow(r).getCell(col);
          cell.value = v; cell.font = col === 5 ? body : ink; cell.border = BORDER; cell.fill = holFill(h.type);
          cell.alignment = { wrapText: true, vertical: 'top', horizontal: col === 5 ? 'left' : 'center' };
          if (col === 2) cell.numFmt = 'dd mmm yyyy';
        });
        ws.mergeCells(`E${r}:${L}${r}`); for (let c = 5; c <= LC; c++) { const cc = ws.getRow(r).getCell(c); cc.border = BORDER; cc.fill = holFill(h.type); }
        ws.getRow(r).height = String(h.name).length > 40 ? 25.5 : 12.75;
        r++;
      });
    }
    if (data.privateReason) {                             // reason recorded in Step 3 of the tentative plan
      r++;
      ws.mergeCells(`B${r}:${L}${r}`);
      const cell = ws.getCell(`B${r}`);
      cell.value = `Reason for visiting private schools: ${data.privateReason}`;
      cell.font = Object.assign({}, body, { italic: true }); cell.alignment = { wrapText: true, vertical: 'top' };
      ws.getRow(r).height = Math.max(12.75, 12.75 * Math.ceil(String(cell.value).length / 105));
      r++;
    }

    const sig = r + 7;
    [[`ASSISTANT EDUCATION OFFICER (${data.genderTag || 'M'})`], [`Markaz ${data.markazLabel}, District ${titleCase(data.district)}`]].forEach((t, i) => {
      ws.mergeCells(`E${sig + i}:${L}${sig + i}`);
      const cell = ws.getCell(`E${sig + i}`);
      cell.value = t[0];
      cell.font = { name: 'Roboto', size: 10, bold: true, color: { argb: INK } };
      cell.alignment = { horizontal: 'center', wrapText: true };
      ws.getRow(sig + i).height = 12.75;
    });
    ws.pageSetup.printArea = `B1:${L}${sig + 1}`;
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
