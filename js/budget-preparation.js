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

let bpState = {
  rate: 25000,
  tehsil: '',
  year: new Date().getFullYear(),
  roster: [],            // [{id, personal_no, name, wing, markaz_name, designation, ddeo_code}]
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
  bpState.roster = rosterRes.data || [];

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

// ─── Prepare & Send ──────────────────────────────────────────────────
async function bpPrepareBudget() {
  if (!bpState.roster.length) { showToast('No AEOs loaded.', false); return; }
  if (!bpState.selectedMonths.length) { showToast('Select at least one month.', false); return; }

  const btn = document.getElementById('bp_prepareBtn');
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

    bpState.editGrid = {};
    await bpLoadRoster();
  } catch (err) {
    showToast('Error preparing budget: ' + err.message, false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2-circle"></i> Prepare &amp; Send Budget';
  }
}

async function bpGenerateCumulative(monthBills) {
  const btn = document.getElementById('bp_prepareBtn');
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Building combined PDF…';

  // Sum each AEO's due across all selected months.
  const totals = {}; // { userId: {personal_no, name, due} }
  Object.values(monthBills).forEach(res => {
    (res.bill.entries || []).forEach(e => {
      if (!totals[e.user_id]) totals[e.user_id] = { personal_no: e.personal_no, name: e.name, due: 0 };
      totals[e.user_id].due += Number(e.due);
    });
  });

  const period = bpState.selectedMonths.map(m => BP_MONTH_NAMES[m - 1]).join(', ') + ' ' + bpState.year;
  const pdfBase64 = await bpBuildBudgetPdfBase64({
    period,
    entries: Object.entries(totals).map(([userId, t]) => ({ user_id: userId, personal_no: t.personal_no, name: t.name, due: t.due })),
  });
  bpDownloadPdf(pdfBase64, `Budget_${bpState.tehsil}_${bpState.year}_Cumulative.pdf`);

  const lastRes = Object.values(monthBills)[Object.values(monthBills).length - 1];
  await bpSendPdf(lastRes, pdfBase64, period);
}

async function bpGenerateSeparate(monthBills) {
  const btn = document.getElementById('bp_prepareBtn');
  for (const month of bpState.selectedMonths) {
    const res = monthBills[month];
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Building ${BP_MONTH_NAMES[month - 1]} PDF…`;
    const period = `${BP_MONTH_NAMES[month - 1]} ${bpState.year}`;
    const pdfBase64 = await bpBuildBudgetPdfBase64({
      period,
      entries: (res.bill.entries || []).map(e => ({ user_id: e.user_id, personal_no: e.personal_no, name: e.name, due: e.due })),
    });
    bpDownloadPdf(pdfBase64, `Budget_${bpState.tehsil}_${period.replace(' ', '_')}.pdf`);
    await bpSendPdf(res, pdfBase64, period);
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

// Budget summary PDF — mirrors the old Google Doc template:
// Sr.No | Personal No. | Name | Markaz | Tehsil | DDO | Amount, + total row.
// `opts.entries` items need: personal_no, name, due (already summed if cumulative).
async function bpBuildBudgetPdfBase64(opts) {
  const target = document.getElementById('bpPdfRenderTarget');
  const total = opts.entries.reduce((s, e) => s + Number(e.due), 0);
  const rosterById = Object.fromEntries(bpState.roster.map(u => [u.id, u]));

  const rows = opts.entries.map((e, i) => {
    const u = rosterById[e.user_id] || {};
    return `<tr>
      <td style="padding:5px 8px;border:1px solid #999;text-align:center">${i + 1}</td>
      <td style="padding:5px 8px;border:1px solid #999">${e.personal_no}</td>
      <td style="padding:5px 8px;border:1px solid #999">${e.name}</td>
      <td style="padding:5px 8px;border:1px solid #999">${u.markaz_name || ''}</td>
      <td style="padding:5px 8px;border:1px solid #999">${bpState.tehsil}</td>
      <td style="padding:5px 8px;border:1px solid #999">${u.ddeo_code || ''}</td>
      <td style="padding:5px 8px;border:1px solid #999;text-align:right">${Number(e.due).toLocaleString()}</td>
    </tr>`;
  }).join('');

  target.innerHTML = `
    <div style="width:794px;min-height:1123px;padding:40px 46px;font-family:'Times New Roman',serif;color:#111;box-sizing:border-box">
      <div style="text-align:center;font-size:12px;letter-spacing:.04em">GOVERNMENT OF THE PUNJAB</div>
      <div style="text-align:center;font-size:15px;font-weight:700;text-transform:uppercase;margin-bottom:4px">Inspection Allowance Budget</div>
      <div style="text-align:center;font-size:12px;margin-bottom:18px">${bpState.tehsil} — ${opts.period}</div>
      <table style="width:100%;border-collapse:collapse;font-size:11.5px">
        <thead><tr style="background:#f2f2f2">
          <th style="padding:6px 8px;border:1px solid #999">Sr.No</th>
          <th style="padding:6px 8px;border:1px solid #999">Personal No.</th>
          <th style="padding:6px 8px;border:1px solid #999">Name</th>
          <th style="padding:6px 8px;border:1px solid #999">Markaz</th>
          <th style="padding:6px 8px;border:1px solid #999">Tehsil</th>
          <th style="padding:6px 8px;border:1px solid #999">DDO</th>
          <th style="padding:6px 8px;border:1px solid #999">Amount</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="6" style="padding:6px 8px;border:1px solid #999;font-weight:700;text-align:right">Total</td>
          <td style="padding:6px 8px;border:1px solid #999;font-weight:700;text-align:right">${total.toLocaleString()}</td>
        </tr></tfoot>
      </table>
      <p style="font-size:11px;margin-top:24px">Prepared by: ${currentUser.name} — ${new Date().toLocaleString()}</p>
    </div>`;

  await new Promise(r => setTimeout(r, 120));
  const canvas = await html2canvas(target, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgData = canvas.toDataURL('image/jpeg', 0.92);
  const ratio = pageWidth / canvas.width;
  pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, Math.min(canvas.height * ratio, pageHeight));
  target.innerHTML = '';

  const dataUri = pdf.output('datauristring');
  return dataUri.split(',')[1];
}
