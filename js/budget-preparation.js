// ═══════════════════════════════════════════════════════════════════
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

  // A tehsil can have both M-EE and W-EE AEOs (e.g. Karor) — they're
  // administratively separate (different DDO/DEO), so budgets must be
  // prepared per wing, never mixed.
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

// Filters the fetched tehsil roster down to the selected wing only —
// Male and Female AEOs in the same tehsil must never appear on the same
// budget grid or letter.
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

  // Recompute just this row's total without a full re-render (keeps input focus)
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

  // Build entries per month locally from the grid (no server round-trip).
  bpState.previewMonthEntries = {}; // { month: [{user_id, personal_no, name, due}] }
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
  // Render at real size directly in the modal (no PDF conversion needed for preview).
  pane.innerHTML = `<div style="transform:scale(.92);transform-origin:top center">${html}</div>`;
}

// ─── Confirm: NOW we actually save to DB, generate real PDFs, download, and email ──
async function bpConfirmPrepare() {
  const btn = document.getElementById('bp_confirmBtn');
  btn.disabled = true;

  try {
    // Always save per-user-per-month records in the DB, one prepare call per month.
    const monthBills = {}; // { month: bill } from prepareTehsilBudget response
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

  // Sum each AEO's due across all selected months.
  const totals = {}; // { userId: {personal_no, name, due} }
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
    await new Promise(r => setTimeout(r, 400)); // stagger downloads so the browser doesn't block them
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

// ─── Wing-derived wording (drives recipient title, table's "Tehsil" cell,
// and the signature block) ────────────────────────────────────────────
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

  // Explicit cell style strings — !important overrides this app's own global
  // `thead th{background:var(--ink)...white-space:nowrap}` / `tbody td{white-space:nowrap}`
  // rules, which otherwise leak into this off-screen render (same document).
  const THC = 'padding:5px 4px !important;border:1px solid #999 !important;background:#f2f2f2 !important;color:#111 !important;font-weight:700 !important;text-transform:none !important;letter-spacing:normal !important;white-space:normal !important;word-wrap:break-word;overflow-wrap:break-word;vertical-align:middle;position:static !important;text-align:center';
  const TDC = 'padding:5px 4px !important;border:1px solid #999 !important;background:#fff !important;color:#111 !important;white-space:normal !important;word-wrap:break-word;overflow-wrap:break-word;vertical-align:middle';
  // Column widths sum to 100% — table-layout:fixed means the table can never
  // grow past its container no matter how long a tehsil/markaz name is; text
  // wraps within the cell instead.
  const COLW = [5, 11, 16, 15, 24, 11, 18]; // Sr/Personal/Name/Markaz/Tehsil/DDO/Amount

  const rows = opts.entries.map((e, i) => {
    const u = rosterById[e.user_id] || {};
    return `<tr data-bp-row="1">
      <td style="${TDC};text-align:center">${i + 1}</td>
      <td style="${TDC}">${e.personal_no}</td>
      <td style="${TDC}">${e.name}</td>
      <td style="${TDC}">${u.markaz_name || ''}</td>
      <td style="${TDC}">Dy. DEO (${w.letter}) ${bpState.tehsil}</td>
      <td style="${TDC}">${bpFormatDdo(u.ddeo_code)}</td>
      <td style="${TDC};text-align:right">${Number(e.due).toLocaleString()}</td>
    </tr>`;
  }).join('');

  // Signature/stamp block — Deputy DEO always. Single stamp sits on the
  // right; when CEO is the recipient, Deputy goes left and District DEO
  // goes right (two stamps).
  const signatureHtml = recipient === 'CEO'
    ? `<div dir="ltr" style="direction:ltr !important;display:flex;justify-content:space-between;font-family:'Times New Roman',serif;font-weight:700;font-size:12.5px;margin-top:60px">
         <div style="width:48%;text-align:left">DY. DISTRICT EDUCATION OFFICER<br>TEHSIL ${bpState.tehsil.toUpperCase()} (${w.wordUpper})</div>
         <div style="width:48%;text-align:right">DISTRICT EDUCATION OFFICER<br>DISTRICT LAYYAH (${w.code})</div>
       </div>`
    : `<div dir="ltr" style="direction:ltr !important;text-align:right;font-family:'Times New Roman',serif;font-weight:700;font-size:12.5px;margin-top:60px">
         DY. DISTRICT EDUCATION OFFICER<br>TEHSIL ${bpState.tehsil.toUpperCase()} (${w.wordUpper})
       </div>`;

  return `
    <div dir="ltr" style="direction:ltr !important;width:794px;padding:40px 46px;font-family:'Times New Roman',serif;color:#111;box-sizing:border-box;background:#fff;text-align:left">
      <div style="direction:ltr !important;display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">
        <img src="${BP_LOGO_DATA_URI}" style="width:78px;height:78px;order:1">
        <div style="text-align:right;font-size:12px;line-height:2;order:2">
          No.:____________________<br>Dated: _______________
        </div>
      </div>

      <div style="font-size:13px;line-height:1.6;text-align:left">
        <b>To</b><br>
        <b>${recipientLine}</b><br>
        <b>Layyah</b>
      </div>

      <p style="font-size:12.5px;font-weight:700;text-decoration:underline;margin:16px 0;line-height:1.6;text-align:left">
        SUBJECT: GRANT OF INSPECTION ALLOWANCE @ RS. ${bpState.rate.toLocaleString()} PER MONTH FOR THE
        ${monthPhraseUpper} OF THE ASSISTANT EDUCATION OFFICERS SUBJECT TO VERIFIABLE KEY PERFORMANCE INDICATORS.
      </p>

      <p style="font-size:12.5px;line-height:1.7;text-align:justify;margin:14px 0">
        Kindly refer to the subject cited above It is certified that performance of following Assistant Education
        Officers, Tehsil ${bpState.tehsil} (${w.word}) have achieved verifiable key performance indicators developed
        by DFID as issued vide Notification No. SO (SE-III) 5-226/2017 dated 03-08-2020.
      </p>

      <p style="font-size:12.5px;line-height:1.7;text-align:justify;margin:14px 0 18px">
        The performance of following AEOs has been verified for the ${monthPhraseTitle}. They are entitled to draw
        the following amount mentioned against their names.
      </p>

      <table dir="ltr" style="direction:ltr !important;width:100%;table-layout:fixed;border-collapse:collapse;font-size:10.5px">
        <colgroup>${COLW.map(w => `<col style="width:${w}%">`).join('')}</colgroup>
        <thead><tr>
          <th style="${THC}">Sr.<br>No.</th>
          <th style="${THC}">Personal<br>Number</th>
          <th style="${THC}">Name</th>
          <th style="${THC}">Markaz name</th>
          <th style="${THC}">Tehsil</th>
          <th style="${THC}">DDO<br>Code</th>
          <th style="${THC}">Amount</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>

      ${signatureHtml}
    </div>`;
}

// Rasterizes the given letter HTML (off-screen, real A4 width) into a
// multi-page-safe PDF — needed because rosters can run to 18+ rows.
async function bpRenderHtmlToPdfBase64(html) {
  const target = document.getElementById('bpPdfRenderTarget');
  target.innerHTML = html;
  await new Promise(r => setTimeout(r, 150));

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');
  await bpRenderTargetIntoPdf(pdf, target);
  target.innerHTML = '';

  const dataUri = pdf.output('datauristring');
  return dataUri.split(',')[1];
}

// Renders the (potentially tall) off-screen target into one or more A4
// pages, slicing the captured canvas by page height rather than
// clipping — needed because rosters can run to 18+ rows.
async function bpRenderTargetIntoPdf(pdf, target) {
  const scale = 2;

  // Capture row boundaries (in un-scaled CSS px, relative to target's top)
  // BEFORE rasterizing — these are our only safe places to cut a page,
  // so a row is never split in half across a page break.
  const targetTop = target.getBoundingClientRect().top;
  const rowBoundaries = [...target.querySelectorAll('[data-bp-row]')]
    .map(r => r.getBoundingClientRect().bottom - targetTop);
  const totalCssHeight = target.scrollHeight;

  const canvas = await html2canvas(target, { scale, useCORS: true, backgroundColor: '#ffffff' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const ratio = pageWidth / canvas.width;          // pt per canvas-px
  const pageHeightCanvasPx = pageHeight / ratio;    // how many canvas-px fit one page

  let renderedPx = 0; // in canvas px
  let firstPage = true;
  while (renderedPx < canvas.height - 1) {
    let cutPx = Math.min(renderedPx + pageHeightCanvasPx, canvas.height);

    if (rowBoundaries.length && cutPx < canvas.height) {
      // Prefer the largest row-boundary that still fits within this page.
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

