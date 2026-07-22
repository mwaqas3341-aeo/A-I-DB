// ═══════════════════════════════════════════════════════════════════
//  BUDGET PREPARATION — Tehsil Representatives (and Admins) only.
//  One TR action per tehsil+month sets every AEO's deduction, unlocks
//  that month's bill download + Performance Preparation for the AEOs
//  of that tehsil, and sends the summary PDF to TRs + flagged AEOs.
// ═══════════════════════════════════════════════════════════════════

const BP_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let bpState = {
  rate: 25000,
  tehsil: '',
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  roster: [],       // [{id, personal_no, name, wing, markaz_name, designation, ddeo_code}]
  deductionsByUser: {}, // { userId: { [month]: {deduction, due} } } for the selected year
  preparedMonths: {},   // { month: {prepared_by_name, prepared_at, pdf_sent_at, send_error} }
  editRow: {}, // { userId: deductionValue } — live edits for the currently selected month
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

  const monthSel = document.getElementById('bp_month');
  const mNow = new Date().getMonth() + 1;
  monthSel.innerHTML = BP_MONTH_NAMES.map((m, i) => `<option value="${i + 1}" ${i + 1 === mNow ? 'selected' : ''}>${m}</option>`).join('');

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

async function bpLoadRoster() {
  const tehsil = document.getElementById('bp_tehsil').value;
  const year = Number(document.getElementById('bp_year').value);
  const month = Number(document.getElementById('bp_month').value);
  bpState.tehsil = tehsil; bpState.year = year; bpState.month = month;
  bpState.editRow = {};

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
      const isSelected = mo === bpState.month;
      const bg = prepared ? '#d1fae5' : '#f3f4f6';
      const border = isSelected ? '2px solid #0d9488' : '1px solid var(--b0)';
      const title = prepared
        ? `Prepared by ${prepared.prepared_by_name || '—'} on ${new Date(prepared.prepared_at).toLocaleDateString()}${prepared.send_error ? ' — email failed: ' + prepared.send_error : (prepared.pdf_sent_at ? ' — emailed' : '')}`
        : 'Not prepared yet';
      return `<span title="${title}" style="padding:4px 9px;border-radius:6px;font-size:.72rem;background:${bg};border:${border};cursor:pointer"
                onclick="document.getElementById('bp_month').value=${mo};bpLoadRoster()">
                ${prepared ? '✅' : '⬜'} ${m.slice(0,3)}
              </span>`;
    }).join('') + `</div>`;
}

function bpRenderRoster() {
  const wrap = document.getElementById('bp_rosterWrap');
  if (!bpState.roster.length) { wrap.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3)">No AEOs found for this tehsil.</div>`; return; }

  const prepared = bpState.preparedMonths[bpState.month];

  wrap.innerHTML = `
    ${prepared ? `<div style="padding:10px 16px;background:#d1fae5;color:#065f46;font-size:.82rem">
        <i class="bi bi-check-circle-fill"></i> Already prepared by ${prepared.prepared_by_name || '—'} on ${new Date(prepared.prepared_at).toLocaleString()}.
        Re-preparing will overwrite these amounts.
      </div>` : ''}
    <table style="width:100%;border-collapse:collapse;font-size:.85rem">
      <thead><tr style="text-align:left;border-bottom:2px solid var(--b0);background:var(--s2)">
        <th style="padding:8px">#</th><th style="padding:8px">Personal No.</th><th style="padding:8px">Name</th>
        <th style="padding:8px">Designation</th><th style="padding:8px">DDEO Code</th>
        <th style="padding:8px">Deduction (PKR)</th><th style="padding:8px">Due (PKR)</th>
      </tr></thead>
      <tbody>
        ${bpState.roster.map((u, i) => {
          const existing = (bpState.deductionsByUser[u.id] || {})[bpState.month];
          const val = bpState.editRow[u.id] !== undefined ? bpState.editRow[u.id] : (existing ? existing.deduction : 0);
          const due = bpState.rate - (Number(val) || 0);
          return `<tr style="border-bottom:1px solid var(--s2)">
            <td style="padding:8px">${i + 1}</td>
            <td style="padding:8px">${u.personal_no}</td>
            <td style="padding:8px;font-weight:600">${u.name}</td>
            <td style="padding:8px">${u.designation || ''}</td>
            <td style="padding:8px">${u.ddeo_code || '—'}</td>
            <td style="padding:8px">
              <input type="number" min="0" max="${bpState.rate}" value="${val}" style="width:110px;height:32px;border:1px solid var(--b0);border-radius:6px;padding:0 8px"
                oninput="bpUpdateDeduction('${u.id}', this.value)">
            </td>
            <td style="padding:8px;font-weight:700;color:#0d9488">${due.toLocaleString()}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function bpUpdateDeduction(userId, value) {
  bpState.editRow[userId] = Number(value) || 0;
  // Live-update just that row's Due cell without a full re-render (avoids losing focus)
  const due = bpState.rate - (Number(value) || 0);
  const row = [...document.querySelectorAll('#bp_rosterWrap tbody tr')].find(tr =>
    tr.querySelector('input')?.getAttribute('oninput')?.includes(`'${userId}'`));
  if (row) row.lastElementChild.textContent = due.toLocaleString();
}

async function bpPrepareBudget() {
  if (!bpState.roster.length) { showToast('No AEOs loaded.', false); return; }
  const entries = bpState.roster.map(u => {
    const existing = (bpState.deductionsByUser[u.id] || {})[bpState.month];
    const val = bpState.editRow[u.id] !== undefined ? bpState.editRow[u.id] : (existing ? existing.deduction : 0);
    return { user_id: u.id, deduction: Number(val) || 0 };
  });

  const btn = document.getElementById('bp_prepareBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Preparing…';

  try {
    const res = await apiCall('prepareTehsilBudget', {
      tehsil: bpState.tehsil, year: bpState.year, month: bpState.month, entries,
    });
    if (!res || !res.success) { showToast(res?.message || 'Failed to prepare budget.', false); return; }

    const pdfBase64 = await bpBuildBudgetPdfBase64(res.bill);
    bpDownloadPdf(pdfBase64, `Budget_${bpState.tehsil}_${BP_MONTH_NAMES[bpState.month - 1]}_${bpState.year}.pdf`);

    const recipientEmails = (res.bill.recipients || []).map(r => r.email).filter(Boolean);
    if (!recipientEmails.length) {
      showToast('Budget prepared and downloaded, but no recipient emails found to send to.', true);
    } else {
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Sending email…';
      const { data: { session } } = await _sb.auth.getSession();
      const sendRes = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/send-budget-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
        body: JSON.stringify({
          prepId: res.prepId, tehsil: bpState.tehsil,
          period: `${BP_MONTH_NAMES[bpState.month - 1]} ${bpState.year}`,
          preparedByName: currentUser.name,
          pdfBase64, recipientEmails,
        }),
      });
      const sendResult = await sendRes.json();
      showToast(
        sendResult.success
          ? `Budget prepared, downloaded, and emailed to ${recipientEmails.length} recipient(s).`
          : `Budget prepared and downloaded, but email failed: ${sendResult.message || 'Unknown error'}`,
        !!sendResult.success
      );
    }

    bpState.editRow = {};
    await bpLoadRoster();
  } catch (err) {
    showToast('Error preparing budget: ' + err.message, false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2-circle"></i> Prepare &amp; Send Budget';
  }
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
async function bpBuildBudgetPdfBase64(bill) {
  const target = document.getElementById('bpPdfRenderTarget');
  const period = `${BP_MONTH_NAMES[bpState.month - 1]} ${bpState.year}`;
  const total = bill.entries.reduce((s, e) => s + Number(e.due), 0);

  const rosterById = Object.fromEntries(bpState.roster.map(u => [u.id, u]));
  const rows = bill.entries.map((e, i) => {
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
      <div style="text-align:center;font-size:12px;margin-bottom:18px">${bpState.tehsil} — ${period}</div>
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

  const dataUri = pdf.output('datauristring'); // "data:application/pdf;base64,...."
  return dataUri.split(',')[1];
}
