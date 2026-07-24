import base64
from weasyprint import HTML

# 1. Write the updated JS file
js_code = """// ═══════════════════════════════════════════════════════════════════
//  BUDGET PREPARATION — Tehsil Representatives (and Admins) only.
//  Up to 4 months at once. One deduction column per selected month,
//  per AEO. Deduction records are always saved per-user-per-month in
//  the DB regardless of PDF mode. PDF output is either:
//    - Cumulative: one PDF, one row per AEO, totals summed across all
//      selected months.
//    - Separate: one PDF per selected month (each its own summary).
// ═══════════════════════════════════════════════════════════════════

const BP_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const BP_MAX_MONTHS = 4;

let bpPreviewModalInst = null;

let bpState = {
  rate: 25000,
  tehsil: '',
  year: new Date().getFullYear(),
  roster: [],            // [{id, personal_no, name, wing, markaz_name, designation, ddeo_code}] — filtered to selected wing
  tehsilRoster: [],      // full tehsil fetch (both wings), before wing filtering
  selectedMonths: [],    // month numbers, up to 4
  deductionsByUser: {},  // { userId: { [month]: {deduction, due} } } — existing, from DB
  preparedMonths: {},    // { month: {prepared_by_name, prepared_at, pdf_sent_at, send_error} }
  editGrid: {},          // { userId: { [month]: deductionValue } } — live edits
  pdfMode: 'cumulative',
};

async function bpInit() {
  const tehsils = (currentUser?.tr_tehsils || []);
  const tehselSel = document.getElementById('bp_tehsil');
  tehselSel.innerHTML = tehsils.length
    ? tehsils.map(t => `<option value="${t}">${t}</option>`).join('')
    : `<option value="">No tehsil assigned</option>`;

  const yearSel = document.getElementById('bp_year');
  const yNow = new Date().getFullYear();
  yearSel.innerHTML = [yNow - 1, yNow, yNow + 1].map(y => `<option value="${y}" ${y === yNow ? 'selected' : ''}>${y}</option>`).join('');

  bpState.selectedMonths = [new Date().getMonth() + 1];
  bpRenderMonthPicker();

  await iaLoadRate(); // reuse rate loader from inspection-allowance.js — same settings table
  bpState.rate = iaState.rate;

  bpRefreshGoogleStatus();
  if (tehsils.length) bpLoadRoster();
}

async function bpRefreshGoogleStatus() {
  const label = document.getElementById('bp_googleStatusLabel');
  if (typeof getGoogleConnectionStatus !== 'function') return;
  getGoogleConnectionStatus(status => {
    label.textContent = status?.connected ? `Connected (${status.email})` : 'Connect Google Account';
    if (!status?.connected) label.parentElement.onclick = () => connectGoogleAccount();
    else label.parentElement.onclick = () => bpRefreshGoogleStatus();
  });
}

// ─── Month picker (up to 4) ──────────────────────────────────────────
function bpRenderMonthPicker() {
  const picker = document.getElementById('bp_monthPicker');
  picker.innerHTML = BP_MONTH_NAMES.map((m, i) => {
    const mo = i + 1;
    const on = bpState.selectedMonths.includes(mo);
    return `<button type="button" onclick="bpToggleMonth(${mo})"
        style="padding:6px 12px;border-radius:6px;font-size:.78rem;cursor:pointer;
               border:1px solid ${on ? '#0d9488' : 'var(--b0)'};
               background:${on ? '#0d9488' : '#fff'};color:${on ? '#fff' : 'var(--t1)'}">
        ${m.slice(0, 3)}
      </button>`;
  }).join('');
}

function bpToggleMonth(month) {
  const idx = bpState.selectedMonths.indexOf(month);
  if (idx > -1) {
    bpState.selectedMonths.splice(idx, 1);
  } else {
    if (bpState.selectedMonths.length >= BP_MAX_MONTHS) { showToast(`Maximum ${BP_MAX_MONTHS} months at once.`, false); return; }
    bpState.selectedMonths.push(month);
    bpState.selectedMonths.sort((a, b) => a - b);
  }
  bpRenderMonthPicker();
  bpRenderRoster();
}

// ─── Roster + existing deductions ───────────────────────────────────
async function bpLoadRoster() {
  const tehsil = document.getElementById('bp_tehsil').value;
  const year = Number(document.getElementById('bp_year').value);
  bpState.tehsil = tehsil; bpState.year = year;
  bpState.editGrid = {};

  const wrap = document.getElementById('bp_rosterWrap');
  if (!tehsil) { wrap.innerHTML = `<div style="padding:30px;text-align:center;color:var(--t3)">Select a tehsil to begin.</div>`; return; }
  wrap.innerHTML = `<div style="padding:30px;text-align:center;color:var(--t3)"><span class="spinner-border spinner-border-sm"></span> Loading roster…</div>`;

  const [rosterRes, statusRes] = await Promise.all([
    apiCall('getTehsilRosterForBudget', { tehsil }),
    apiCall('getBudgetPrepStatus', { tehsil, year }),
  ]);

  if (!rosterRes || !rosterRes.success) { wrap.innerHTML = `<div style="padding:20px;color:var(--bad)">${rosterRes?.message || 'Failed to load roster.'}</div>`; return; }
  bpState.tehsilRoster = rosterRes.data || [];

  const wings = [...new Set(bpState.tehsilRoster.map(u => u.wing).filter(Boolean))].sort();
  const wingSel = document.getElementById('bp_wing');
  const prevWing = wingSel.value;
  wingSel.innerHTML = wings.map(w => `<option value="${w}">${w}</option>`).join('') || `<option value="">—</option>`;
  wingSel.value = wings.includes(prevWing) ? prevWing : (wings[0] || '');

  bpState.deductionsByUser = {};
  bpState.preparedMonths = {};
  if (statusRes && statusRes.success) {
    (statusRes.deductions || []).forEach(d => {
      bpState.deductionsByUser[d.user_id] = bpState.deductionsByUser[d.user_id] || {};
      bpState.deductionsByUser[d.user_id][d.month] = { deduction: Number(d.deduction), due: Number(d.due) };
    });
    (statusRes.preparedMonths || []).forEach(p => { bpState.preparedMonths[p.month] = p; });
  }

  bpRenderMonthStatusStrip();
  bpApplyWingFilter();
}

function bpApplyWingFilter() {
  const wing = document.getElementById('bp_wing').value;
  bpState.roster = (bpState.tehsilRoster || []).filter(u => u.wing === wing);
  bpRenderRoster();
}

function bpRenderMonthStatusStrip() {
  const strip = document.getElementById('bp_monthStatusStrip');
  strip.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap">` +
    BP_MONTH_NAMES.map((m, i) => {
      const mo = i + 1;
      const prepared = bpState.preparedMonths[mo];
      const isSelected = bpState.selectedMonths.includes(mo);
      const bg = prepared ? '#d1fae5' : '#f3f4f6';
      const border = isSelected ? '2px solid #0d9488' : '1px solid var(--b0)';
      const title = prepared
        ? `Prepared by ${prepared.prepared_by_name || '—'} on ${new Date(prepared.prepared_at).toLocaleDateString()}${prepared.send_error ? ' — email failed: ' + prepared.send_error : (prepared.pdf_sent_at ? ' — emailed' : '')}`
        : 'Not prepared yet';
      return `<span title="${title}" style="padding:4px 9px;border-radius:6px;font-size:.72rem;background:${bg};border:${border}">
                ${prepared ? '✅' : '⬜'} ${m.slice(0,3)}
              </span>`;
    }).join('') + `</div>`;
}

// ─── Roster grid: one deduction column per selected month ───────────
function bpRenderRoster() {
  const wrap = document.getElementById('bp_rosterWrap');
  if (!bpState.roster.length) { wrap.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3)">No AEOs found for this tehsil.</div>`; return; }
  if (!bpState.selectedMonths.length) { wrap.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3)">Select at least one month above.</div>`; return; }

  const monthCols = bpState.selectedMonths;

  wrap.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:.85rem">
      <thead><tr style="text-align:left;border-bottom:2px solid var(--b0);background:var(--s2)">
        <th style="padding:8px">#</th><th style="padding:8px">Personal No.</th><th style="padding:8px">Name</th>
        ${monthCols.map(mo => `<th style="padding:8px;text-align:center">${BP_MONTH_NAMES[mo - 1].slice(0,3)} Deduction</th>`).join('')}
        <th style="padding:8px;text-align:right">Total Due (selected months)</th>
      </tr></thead>
      <tbody>
        ${bpState.roster.map((u, i) => {
          let totalDue = 0;
          const cells = monthCols.map(mo => {
            const existing = (bpState.deductionsByUser[u.id] || {})[mo];
            const editVal = (bpState.editGrid[u.id] || {})[mo];
            const val = editVal !== undefined ? editVal : (existing ? existing.deduction : 0);
            const due = bpState.rate - (Number(val) || 0);
            totalDue += due;
            return `<td style="padding:6px 8px;text-align:center">
              <input type="number" min="0" max="${bpState.rate}" value="${val}" style="width:90px;height:32px;border:1px solid var(--b0);border-radius:6px;padding:0 6px;text-align:center"
                oninput="bpUpdateDeduction('${u.id}', ${mo}, this.value)">
            </td>`;
          }).join('');
          return `<tr style="border-bottom:1px solid var(--s2)" data-user-row="${u.id}">
            <td style="padding:8px">${i + 1}</td>
            <td style="padding:8px">${u.personal_no}</td>
            <td style="padding:8px;font-weight:600">${u.name}</td>
            ${cells}
            <td style="padding:8px;text-align:right;font-weight:700;color:#0d9488" data-total-cell>${totalDue.toLocaleString()}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function bpUpdateDeduction(userId, month, value) {
  bpState.editGrid[userId] = bpState.editGrid[userId] || {};
  bpState.editGrid[userId][month] = Number(value) || 0;

  const row = document.querySelector(`#bp_rosterWrap tr[data-user-row="${userId}"]`);
  if (!row) return;
  let totalDue = 0;
  bpState.selectedMonths.forEach(mo => {
    const existing = (bpState.deductionsByUser[userId] || {})[mo];
    const editVal = (bpState.editGrid[userId] || {})[mo];
    const val = editVal !== undefined ? editVal : (existing ? existing.deduction : 0);
    totalDue += bpState.rate - (Number(val) || 0);
  });
  row.querySelector('[data-total-cell]').textContent = totalDue.toLocaleString();
}

function bpDeductionFor(userId, month) {
  const existing = (bpState.deductionsByUser[userId] || {})[month];
  const editVal = (bpState.editGrid[userId] || {})[month];
  return editVal !== undefined ? editVal : (existing ? existing.deduction : 0);
}

// ─── Preview (no DB writes yet — purely local from the grid's current values) ──
function bpPreviewBudget() {
  if (!bpState.roster.length) { showToast('No AEOs loaded.', false); return; }
  if (!bpState.selectedMonths.length) { showToast('Select at least one month.', false); return; }

  bpState.previewMonthEntries = {}; 
  bpState.selectedMonths.forEach(month => {
    bpState.previewMonthEntries[month] = bpState.roster.map(u => ({
      user_id: u.id, personal_no: u.personal_no, name: u.name,
      due: bpState.rate - bpDeductionFor(u.id, month),
    }));
  });

  if (!bpPreviewModalInst) bpPreviewModalInst = new bootstrap.Modal(document.getElementById('bpPreviewModal'));

  const tabs = document.getElementById('bp_previewMonthTabs');
  if (bpState.pdfMode === 'cumulative') {
    tabs.innerHTML = '';
    bpRenderPreviewPane({ periodMonths: bpState.selectedMonths.map(m => BP_MONTH_NAMES[m - 1]), entries: bpCumulativeEntries() });
  } else {
    tabs.innerHTML = bpState.selectedMonths.map((m, i) => `
      <button type="button" onclick="bpShowPreviewTab(${m})" data-preview-tab="${m}"
        style="padding:6px 14px;border-radius:6px;font-size:.8rem;cursor:pointer;
               border:1px solid ${i === 0 ? '#0d9488' : 'var(--b0)'};
               background:${i === 0 ? '#0d9488' : '#fff'};color:${i === 0 ? '#fff' : 'var(--t1)'}">
        ${BP_MONTH_NAMES[m - 1]}
      </button>`).join('');
    bpShowPreviewTab(bpState.selectedMonths[0]);
  }

  bpPreviewModalInst.show();
}

function bpCumulativeEntries() {
  const totals = {};
  Object.values(bpState.previewMonthEntries).forEach(entries => {
    entries.forEach(e => {
      if (!totals[e.user_id]) totals[e.user_id] = { user_id: e.user_id, personal_no: e.personal_no, name: e.name, due: 0 };
      totals[e.user_id].due += e.due;
    });
  });
  return Object.values(totals);
}

function bpShowPreviewTab(month) {
  document.querySelectorAll('[data-preview-tab]').forEach(b => {
    const on = Number(b.dataset.previewTab) === month;
    b.style.background = on ? '#0d9488' : '#fff';
    b.style.color = on ? '#fff' : 'var(--t1)';
    b.style.borderColor = on ? '#0d9488' : 'var(--b0)';
  });
  bpRenderPreviewPane({ periodMonths: [BP_MONTH_NAMES[month - 1]], entries: bpState.previewMonthEntries[month] });
}

async function bpRenderPreviewPane(opts) {
  const pane = document.getElementById('bp_previewBody');
  pane.innerHTML = `<div style="padding:40px;color:var(--t3)"><span class="spinner-border spinner-border-sm"></span> Rendering…</div>`;
  const html = bpBuildLetterHtml(opts);
  pane.innerHTML = `<div style="width:100%; overflow-x:auto;"><div style="transform:scale(.92);transform-origin:top left; width:794px;">${html}</div></div>`;
}

// ─── Confirm: NOW we actually save to DB, generate real PDFs, download, and email ──
async function bpConfirmPrepare() {
  const btn = document.getElementById('bp_confirmBtn');
  btn.disabled = true;

  try {
    const monthBills = {}; 
    for (const month of bpState.selectedMonths) {
      btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Saving ${BP_MONTH_NAMES[month - 1]}…`;
      const entries = bpState.roster.map(u => ({ user_id: u.id, deduction: bpDeductionFor(u.id, month) }));
      const res = await apiCall('prepareTehsilBudget', { tehsil: bpState.tehsil, year: bpState.year, month, entries });
      if (!res || !res.success) { showToast(`Failed to save ${BP_MONTH_NAMES[month - 1]}: ${res?.message || 'Unknown error'}`, false); return; }
      monthBills[month] = res;
    }

    if (bpState.pdfMode === 'cumulative') {
      await bpGenerateCumulative(monthBills);
    } else {
      await bpGenerateSeparate(monthBills);
    }

    bpPreviewModalInst.hide();
    bpState.editGrid = {};
    await bpLoadRoster();
  } catch (err) {
    showToast('Error preparing budget: ' + err.message, false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2-circle"></i> Confirm &amp; Prepare Budget';
  }
}

async function bpGenerateCumulative(monthBills) {
  const btn = document.getElementById('bp_confirmBtn');
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Building combined PDF…';

  const totals = {}; 
  Object.values(monthBills).forEach(res => {
    (res.bill.entries || []).forEach(e => {
      if (!totals[e.user_id]) totals[e.user_id] = { personal_no: e.personal_no, name: e.name, due: 0 };
      totals[e.user_id].due += Number(e.due);
    });
  });

  const periodMonths = bpState.selectedMonths.map(m => BP_MONTH_NAMES[m - 1]);
  const pdfBase64 = await bpRenderHtmlToPdfBase64(bpBuildLetterHtml({
    periodMonths,
    entries: Object.entries(totals).map(([userId, t]) => ({ user_id: userId, personal_no: t.personal_no, name: t.name, due: t.due })),
  }));
  bpDownloadPdf(pdfBase64, `Budget_${bpState.tehsil}_${bpState.year}_Cumulative.pdf`);

  const lastRes = Object.values(monthBills)[Object.values(monthBills).length - 1];
  await bpSendPdf(lastRes, pdfBase64, periodMonths.join(', ') + ' ' + bpState.year);
}

async function bpGenerateSeparate(monthBills) {
  const btn = document.getElementById('bp_confirmBtn');
  for (const month of bpState.selectedMonths) {
    const res = monthBills[month];
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Building ${BP_MONTH_NAMES[month - 1]} PDF…`;
    const periodLabel = `${BP_MONTH_NAMES[month - 1]} ${bpState.year}`;
    const pdfBase64 = await bpRenderHtmlToPdfBase64(bpBuildLetterHtml({
      periodMonths: [BP_MONTH_NAMES[month - 1]],
      entries: (res.bill.entries || []).map(e => ({ user_id: e.user_id, personal_no: e.personal_no, name: e.name, due: e.due })),
    }));
    bpDownloadPdf(pdfBase64, `Budget_${bpState.tehsil}_${periodLabel.replace(' ', '_')}.pdf`);
    await bpSendPdf(res, pdfBase64, periodLabel);
    await new Promise(r => setTimeout(r, 400)); 
  }
}

async function bpSendPdf(res, pdfBase64, period) {
  const recipientEmails = (res.bill.recipients || []).map(r => r.email).filter(Boolean);
  if (!recipientEmails.length) { showToast(`Prepared and downloaded for ${period}, but no recipient emails found.`, true); return; }

  const { data: { session } } = await _sb.auth.getSession();
  const sendRes = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/send-budget-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
    body: JSON.stringify({
      prepId: res.prepId, tehsil: bpState.tehsil, period,
      preparedByName: currentUser.name, pdfBase64, recipientEmails,
    }),
  });
  const sendResult = await sendRes.json();
  showToast(
    sendResult.success
      ? `${period}: prepared, downloaded, and emailed to ${recipientEmails.length} recipient(s).`
      : `${period}: prepared and downloaded, but email failed: ${sendResult.message || 'Unknown error'}`,
    !!sendResult.success
  );
}

function bpDownloadPdf(base64, filename) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function bpWingInfo(wing) {
  const isFemale = wing === 'W-EE';
  return {
    code: wing || 'M-EE',                          // "M-EE" / "W-EE" — used verbatim in DEO recipient line
    letter: isFemale ? 'W' : 'M',                   // used in table's "Dy. DEO (M) Karor" style cell
    word: isFemale ? 'Female' : 'Male',             // Title Case — used in body paragraph
    wordUpper: isFemale ? 'FEMALE' : 'MALE',        // ALL CAPS — used in signature block
  };
}

function bpFormatDdo(code) {
  if (!code) return '';
  return code.replace(/^([A-Za-z]+)-?(\d+)$/, '$1-$2'); // "LL6013" -> "LL-6013"; leaves "LL-6013" unchanged
}

// ─── The actual government letter (matches the real sample PDFs) ────
function bpBuildLetterHtml(opts) {
  const rosterById = Object.fromEntries(bpState.roster.map(u => [u.id, u]));
  const wing = bpState.roster[0]?.wing || 'M-EE';
  const w = bpWingInfo(wing);
  const recipient = document.getElementById('bp_recipient').value; // 'DEO' | 'CEO'

  const monthPhraseUpper = opts.periodMonths.length === 1
    ? `MONTH OF ${opts.periodMonths[0].toUpperCase()} ${bpState.year}`
    : `MONTHS OF ${opts.periodMonths.map(m => m.toUpperCase()).join(', ')} ${bpState.year}`;
  const monthPhraseTitle = opts.periodMonths.length === 1
    ? `Month of ${opts.periodMonths[0]} ${bpState.year}`
    : `Months of ${opts.periodMonths.join(', ')} ${bpState.year}`;

  const recipientLine = recipient === 'CEO'
    ? 'The Chief Executive Officer (DEA)'
    : `The District Education Officer (${w.code})`;

  // Explicit Strict CSS - blocks forced RTL wrapping and allows wrapping for names/markaz/tehsil
  // Enforced Font Size Hierarchy here via !important rules
  const THC = 'font-size:10.5px !important; padding:5px 4px !important;border:1px solid #999 !important;background:#f2f2f2 !important;color:#111 !important;font-weight:700 !important;text-transform:none !important;letter-spacing:normal !important;word-break:break-word !important;vertical-align:middle !important;text-align:center !important;';
  const TDC = 'font-size:10.5px !important; padding:5px 4px !important;border:1px solid #999 !important;background:#fff !important;color:#111 !important;word-break:break-word !important;overflow-wrap:break-word !important;vertical-align:middle !important;white-space:normal !important;';
  const TDCNOWRAP = 'font-size:10.5px !important; padding:5px 4px !important;border:1px solid #999 !important;background:#fff !important;color:#111 !important;white-space:nowrap !important;vertical-align:middle !important;';
  
  // Adjusted exact pixel widths summing to 702px — giving more room to Name (140), Markaz (130), and Tehsil (200)
  const COLW = [30, 75, 140, 130, 200, 70, 57];

  const rows = opts.entries.map((e, i) => {
    const u = rosterById[e.user_id] || {};
    const srNo = i + 1;
    const amount = Number(e.due) || 0;
    return `<tr data-bp-row="1" dir="ltr" style="direction:ltr !important;">
      <td dir="ltr" style="${TDCNOWRAP};text-align:center !important;">${srNo}</td>
      <td dir="ltr" style="${TDCNOWRAP};text-align:center !important;">${e.personal_no || ''}</td>
      <td dir="ltr" style="${TDC};text-align:left !important;">${e.name || ''}</td>
      <td dir="ltr" style="${TDC};text-align:left !important;">${u.markaz_name || ''}</td>
      <td dir="ltr" style="${TDC};text-align:left !important;">Dy. DEO (${w.letter}) ${bpState.tehsil}</td>
      <td dir="ltr" style="${TDCNOWRAP};text-align:center !important;">${bpFormatDdo(u.ddeo_code)}</td>
      <td dir="ltr" style="${TDCNOWRAP};text-align:right !important;font-weight:bold;">${amount.toLocaleString()}</td>
    </tr>`;
  }).join('');

  // Signature Block - Size 14px as requested
  const signatureHtml = recipient === 'CEO'
    ? `<div dir="ltr" style="direction:ltr !important;display:flex;justify-content:space-between;font-family:'Times New Roman',serif;font-weight:700;font-size:14px !important;margin-top:80px">
         <div style="width:48%;text-align:left">DY. DISTRICT EDUCATION OFFICER<br>TEHSIL ${bpState.tehsil.toUpperCase()} (${w.wordUpper})</div>
         <div style="width:48%;text-align:right">DISTRICT EDUCATION OFFICER<br>DISTRICT LAYYAH (${w.code})</div>
       </div>`
    : `<div dir="ltr" style="direction:ltr !important;text-align:right;font-family:'Times New Roman',serif;font-weight:700;font-size:14px !important;margin-top:80px">
         DY. DISTRICT EDUCATION OFFICER<br>TEHSIL ${bpState.tehsil.toUpperCase()} (${w.wordUpper})
       </div>`;

  return `
    <div dir="ltr" style="direction:ltr !important;width:794px !important;min-width:794px !important;max-width:794px !important;padding:40px 46px;font-family:'Times New Roman',serif;color:#111;box-sizing:border-box;background:#fff;text-align:left">
      
      <table style="width:100%; border-collapse:collapse; margin-bottom:18px;">
        <tr>
          <td style="vertical-align:top; text-align:left; width:50%;">
            <img src="${BP_LOGO_DATA_URI}" style="width:78px;height:78px; display:block;">
          </td>
          <td style="vertical-align:top; text-align:right; width:50%; padding-top:10px;">
            <div style="display:inline-block; text-align:left;">
              <table style="font-size:10.5px !important; border-collapse:collapse;">
                <tbody>
                  <tr>
                    <td style="padding:2px 6px 2px 0; font-weight:bold; white-space:nowrap">No.:</td>
                    <td style="padding:2px 0; width:150px; border-bottom:1px solid #111">&nbsp;</td>
                  </tr>
                  <tr>
                    <td style="padding:2px 6px 2px 0; font-weight:bold; white-space:nowrap">Dated:</td>
                    <td style="padding:2px 0; width:150px; border-bottom:1px solid #111">&nbsp;</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      </table>

      <div style="font-size:12px !important;line-height:1.6;text-align:left">
        <b>To</b><br>
        <b>${recipientLine}</b><br>
        <b>Layyah</b>
      </div>

      <p style="font-size:12.5px !important;font-weight:700;text-decoration:underline;margin:16px 0;line-height:1.6;text-align:left">
        SUBJECT: GRANT OF INSPECTION ALLOWANCE @ RS. ${bpState.rate.toLocaleString()} PER MONTH FOR THE
        ${monthPhraseUpper} OF THE ASSISTANT EDUCATION OFFICERS SUBJECT TO VERIFIABLE KEY PERFORMANCE INDICATORS.
      </p>

      <p style="font-size:11px !important;line-height:1.7;text-align:justify;text-indent:36pt;margin:14px 0">
        Kindly refer to the subject cited above It is certified that performance of following Assistant Education
        Officers, Tehsil ${bpState.tehsil} (${w.word}) have achieved verifiable key performance indicators developed
        by DFID as issued vide Notification No. SO (SE-III) 5-226/2017 dated 03-08-2020.
      </p>

      <p style="font-size:11px !important;line-height:1.7;text-align:justify;text-indent:36pt;margin:14px 0 18px">
        The performance of following AEOs has been verified for the ${monthPhraseTitle}. They are entitled to draw
        the following amount mentioned against their names.
      </p>

      <table dir="ltr" style="direction:ltr !important;width:702px !important;min-width:702px !important;max-width:702px !important;table-layout:fixed !important;border-collapse:collapse;font-size:10.5px !important;">
        <colgroup>${COLW.map(cw => `<col style="width:${cw}px !important; min-width:${cw}px !important; max-width:${cw}px !important;">`).join('')}</colgroup>
        <thead><tr dir="ltr" style="direction:ltr !important;">
          <th dir="ltr" style="${THC}; width:${COLW[0]}px !important;">Sr.<br>No.</th>
          <th dir="ltr" style="${THC}; width:${COLW[1]}px !important;">Personal<br>Number</th>
          <th dir="ltr" style="${THC}; width:${COLW[2]}px !important;">Name</th>
          <th dir="ltr" style="${THC}; width:${COLW[3]}px !important;">Markaz name</th>
          <th dir="ltr" style="${THC}; width:${COLW[4]}px !important;">Tehsil</th>
          <th dir="ltr" style="${THC}; width:${COLW[5]}px !important;">DDO<br>Code</th>
          <th dir="ltr" style="${THC}; width:${COLW[6]}px !important;">Amount</th>
        </tr></thead>
        <tbody dir="ltr" style="direction:ltr !important;">${rows}</tbody>
      </table>

      ${signatureHtml}
    </div>`;
}

async function bpRenderHtmlToPdfBase64(html) {
  const target = document.getElementById('bpPdfRenderTarget');
  
  target.style.position = 'absolute';
  target.style.left = '0';
  target.style.top = '0';
  target.style.width = '794px';
  target.style.visibility = 'hidden'; 
  target.style.zIndex = '-1';
  
  target.innerHTML = html;
  
  await new Promise(r => setTimeout(r, 250));

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');
  await bpRenderTargetIntoPdf(pdf, target);
  
  target.innerHTML = '';
  target.style.position = '';
  target.style.left = '';
  target.style.top = '';
  target.style.width = '';
  target.style.visibility = '';
  target.style.zIndex = '';

  const dataUri = pdf.output('datauristring');
  return dataUri.split(',')[1];
}

async function bpRenderTargetIntoPdf(pdf, target) {
  const scale = 2;

  const targetTop = target.getBoundingClientRect().top;
  const rowBoundaries = [...target.querySelectorAll('[data-bp-row]')]
    .map(r => r.getBoundingClientRect().bottom - targetTop);
  const totalCssHeight = target.scrollHeight;

  const canvas = await html2canvas(target, { 
    scale, 
    useCORS: true, 
    backgroundColor: '#ffffff',
    onclone: function(clonedDoc) {
      const clonedTarget = clonedDoc.getElementById('bpPdfRenderTarget');
      if (clonedTarget) {
        clonedTarget.style.visibility = 'visible';
      }
    }
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const ratio = pageWidth / canvas.width;          
  const pageHeightCanvasPx = pageHeight / ratio;    

  let renderedPx = 0; 
  let firstPage = true;
  while (renderedPx < canvas.height - 1) {
    let cutPx = Math.min(renderedPx + pageHeightCanvasPx, canvas.height);

    if (rowBoundaries.length && cutPx < canvas.height) {
      const cutCssPx = cutPx / scale;
      const safeCuts = rowBoundaries.filter(b => b > (renderedPx / scale) + 2 && b <= cutCssPx);
      if (safeCuts.length) cutPx = safeCuts[safeCuts.length - 1] * scale;
    }

    const sliceHeightPx = Math.round(cutPx - renderedPx);
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceHeightPx;
    sliceCanvas.getContext('2d').drawImage(
      canvas, 0, Math.round(renderedPx), canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx
    );
    const imgData = sliceCanvas.toDataURL('image/jpeg', 0.92);
    if (!firstPage) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, sliceHeightPx * ratio);
    renderedPx += sliceHeightPx;
    firstPage = false;
  }
}
"""

with open('budget_pdf_generator.js', 'w', encoding='utf-8') as f:
    f.write(js_code)

# 2. Generate the PDF exactly as it would be printed so the user can verify
pdf_html = '''
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
@page {
    size: A4;
    margin: 15mm 15mm;
    background-color: #ffffff;
}
body {
    margin: 0;
    padding: 0;
    font-family: 'Times New Roman', serif;
    color: #111;
}
.thc {
    font-size: 10.5px !important;
    padding: 5px 4px !important;
    border: 1px solid #999 !important;
    background: #f2f2f2 !important;
    color: #111 !important;
    font-weight: 700 !important;
    text-transform: none !important;
    letter-spacing: normal !important;
    word-break: break-word !important;
    vertical-align: middle !important;
    text-align: center !important;
}
.tdc {
    font-size: 10.5px !important;
    padding: 5px 4px !important;
    border: 1px solid #999 !important;
    background: #fff !important;
    color: #111 !important;
    word-break: break-word !important;
    overflow-wrap: break-word !important;
    vertical-align: middle !important;
    white-space: normal !important;
}
.tdc-nowrap {
    font-size: 10.5px !important;
    padding: 5px 4px !important;
    border: 1px solid #999 !important;
    background: #fff !important;
    color: #111 !important;
    white-space: nowrap !important;
    vertical-align: middle !important;
}
</style>
</head>
<body>
    <div style="width:100%; text-align:left;">
      <table style="width:100%; border-collapse:collapse; margin-bottom:18px;">
        <tr>
          <td style="vertical-align:top; text-align:left; width:50%;">
            <!-- Logo placeholder -->
            <div style="width:78px;height:78px; display:block; background:#eee; border-radius:39px; border: 1px solid #ccc; text-align:center; line-height:78px; font-size:10px; color:#666;">LOGO</div>
          </td>
          <td style="vertical-align:top; text-align:right; width:50%; padding-top:10px;">
            <div style="display:inline-block; text-align:left;">
              <table style="font-size:10.5px !important; border-collapse:collapse;">
                <tbody>
                  <tr>
                    <td style="padding:2px 6px 2px 0; font-weight:bold; white-space:nowrap">No.:</td>
                    <td style="padding:2px 0; width:150px; border-bottom:1px solid #111">&nbsp;</td>
                  </tr>
                  <tr>
                    <td style="padding:2px 6px 2px 0; font-weight:bold; white-space:nowrap">Dated:</td>
                    <td style="padding:2px 0; width:150px; border-bottom:1px solid #111">&nbsp;</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      </table>

      <div style="font-size:12px !important;line-height:1.6;text-align:left">
        <b>To</b><br>
        <b>The District Education Officer (M-EE)</b><br>
        <b>Layyah</b>
      </div>

      <p style="font-size:12.5px !important;font-weight:700;text-decoration:underline;margin:16px 0;line-height:1.6;text-align:left">
        SUBJECT: GRANT OF INSPECTION ALLOWANCE @ RS. 25,000 PER MONTH FOR THE
        MONTH OF SEPTEMBER 2025 OF THE ASSISTANT EDUCATION OFFICERS SUBJECT TO VERIFIABLE KEY PERFORMANCE INDICATORS.
      </p>

      <p style="font-size:11px !important;line-height:1.7;text-align:justify;text-indent:36pt;margin:14px 0">
        Kindly refer to the subject cited above It is certified that performance of following Assistant Education
        Officers, Tehsil Karor (Male) have achieved verifiable key performance indicators developed
        by DFID as issued vide Notification No. SO (SE-III) 5-226/2017 dated 03-08-2020.
      </p>

      <p style="font-size:11px !important;line-height:1.7;text-align:justify;text-indent:36pt;margin:14px 0 18px">
        The performance of following AEOs has been verified for the Month of September 2025. They are entitled to draw
        the following amount mentioned against their names.
      </p>

      <table style="width:100%; table-layout:fixed; border-collapse:collapse; font-size:10.5px !important;">
        <colgroup>
          <col style="width:4.2%;">
          <col style="width:10.6%;">
          <col style="width:20%;">
          <col style="width:18.5%;">
          <col style="width:28.5%;">
          <col style="width:10%;">
          <col style="width:8%;">
        </colgroup>
        <thead>
          <tr>
            <th class="thc">Sr.<br>No.</th>
            <th class="thc">Personal<br>Number</th>
            <th class="thc">Name</th>
            <th class="thc">Markaz name</th>
            <th class="thc">Tehsil</th>
            <th class="thc">DDO<br>Code</th>
            <th class="thc">Amount</th>
          </tr>
        </thead>
        <tbody>
'''

rows_data = [
    (1, "31424237", "Tariq Bashir", "112/Ml-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (2, "31973236", "Zameer ul Hassan", "90-Ml-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (3, "32080362", "Muhammad Zubair Anjum", "93/Ml-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (4, "31977833", "Abdul Rehman", "98/Ml-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (5, "31698847", "Muhammad Kamran Ashraf", "Ali Rajan-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (6, "31998373", "Muhammad Sibtain", "Shah Pur Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (7, "31655017", "Muhammad Waqas", "Fateh Pur-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (8, "31655035", "Aamir Abbas", "Karor-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (9, "31713652", "Hafiz Abdul Qadoos", "Pir Chattar-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (10, "31973226", "Muhammad Ajmal", "Pir Sewag-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (11, "31714087", "Imran Jamil", "Qazi Abad-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (12, "31655086", "Ghulam Abbas", "Roshan Shah-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (13, "31864299", "Riaz Hussain", "Sahu Wala-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (14, "31499497", "Muhammad Fakhar-E-Alam", "Samtia-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (15, "31493244", "Habib Ur Rehman", "Shauket Abad-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (16, "32078918", "Farhan Abid", "Thal Jandi-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (17, "31973189", "Hafeez Ul Qamar", "Thal Kalan-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
    (18, "31481245", "Muhammad Ashraf", "Wara Sehran-Male", "Dy. DEO (M) Karor", "LL-6013", "49,000"),
]

for row in rows_data:
    pdf_html += f'''
          <tr>
            <td class="tdc-nowrap" style="text-align:center !important;">{row[0]}</td>
            <td class="tdc-nowrap" style="text-align:center !important;">{row[1]}</td>
            <td class="tdc" style="text-align:left !important;">{row[2]}</td>
            <td class="tdc" style="text-align:left !important;">{row[3]}</td>
            <td class="tdc" style="text-align:left !important;">{row[4]}</td>
            <td class="tdc-nowrap" style="text-align:center !important;">{row[5]}</td>
            <td class="tdc-nowrap" style="text-align:right !important;font-weight:bold;">{row[6]}</td>
          </tr>
'''

pdf_html += '''
        </tbody>
      </table>

      <div style="text-align:right; font-family:'Times New Roman',serif; font-weight:700; font-size:14px !important; margin-top:80px">
         DY. DISTRICT EDUCATION OFFICER<br>TEHSIL KAROR (MALE)
      </div>
    </div>
</body>
</html>
'''

HTML(string=pdf_html).write_pdf('Inspection_Allowance_Sep_2025.pdf')
print("File generation completed successfully.")
