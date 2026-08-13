// ═══════════════════════════════════════════════════════════════════
//  FUND RECORD MANAGEMENT — NSB + FTF
//  Depends on: api.js/config.js (_sb, CONFIG), core.js (escHtml,
//  showToast, currentUser), index.js (switchGlobalTab), and
//  fund-google-drive.js (Admin Drive connect + NSB upload) which must
//  be loaded BEFORE this file.
// ═══════════════════════════════════════════════════════════════════

const FUND_MONTH_NAMES = { 7:'July',8:'August',9:'September',10:'October',11:'November',12:'December',1:'January',2:'February',3:'March',4:'April',5:'May',6:'June' };
const FUND_FISCAL_MONTHS = [7,8,9,10,11,12,1,2,3,4,5,6];

let fundState = {
  fundType: null,          // 'FTF' | 'NSB'
  financialYearId: null,
  financialYear: null,
  emisCode: null,
  schoolName: '',
  accountId: null,
  isAdmin: false,
};

function fundIsAdmin() {
  return String(currentUser?.role || '').toLowerCase() === 'admin';
}

// ═══════════════════════════════════ HUB ═══════════════════════════
function openFundModule() {
  switchGlobalTab('fundView', null);
  fundState.isAdmin = fundIsAdmin();
}

function openFundNsbModule() {
  switchGlobalTab('fundNsbView', null);
  fundState.fundType = 'NSB';
  fundState.isAdmin = fundIsAdmin();
  document.getElementById('fundNsbAdminPanel').style.display = fundState.isAdmin ? 'block' : 'none';
  fundInitSelectors('nsb');
  if (fundState.isAdmin) fundRefreshDriveStatus();
}

function openFundFtfModule() {
  switchGlobalTab('fundFtfView', null);
  fundState.fundType = 'FTF';
  fundState.isAdmin = fundIsAdmin();
  fundInitSelectors('ftf');
}

// ═══════════════════════════════ SELECTORS ══════════════════════════
async function fundInitSelectors(prefix) {
  const fySel = document.getElementById(`fund_${prefix}_fy`);
  const { data: years } = await _sb.from('fund_financial_years').select('id, financial_year').order('financial_year', { ascending: false });
  const list = years || [];
  fySel.innerHTML = list.map(y => `<option value="${y.id}">${y.financial_year}</option>`).join('')
    || `<option value="">No financial years yet</option>`;

  if (fundState.isAdmin) {
    fySel.innerHTML += `<option value="__new__">+ Add new financial year…</option>`;
  }

  if (list.length) {
    fySel.value = list[0].id;
    fundState.financialYearId = list[0].id;
    fundState.financialYear = list[0].financial_year;
  }
  fySel.onchange = () => fundOnFyChange(prefix);

  document.getElementById(`fund_${prefix}_school_search`).oninput = () => fundSearchSchool(prefix);

  if (fundState.financialYearId && fundState.emisCode) fundLoadAccount(prefix);
}

async function fundOnFyChange(prefix) {
  const fySel = document.getElementById(`fund_${prefix}_fy`);
  if (fySel.value === '__new__') {
    const label = prompt('New financial year (format: 2027-28):');
    if (!label || !/^\d{4}-\d{2}$/.test(label)) {
      if (label) showToast('Format must be like 2027-28.', false);
      fySel.value = fundState.financialYearId || '';
      return;
    }
    const { data, error } = await _sb.from('fund_financial_years').insert({ financial_year: label }).select('id, financial_year').single();
    if (error) { showToast(error.message, false); fySel.value = fundState.financialYearId || ''; return; }
    showToast(`Financial year ${label} created.`, true);
    await fundInitSelectors(prefix);
    return;
  }
  const opt = fySel.selectedOptions[0];
  fundState.financialYearId = fySel.value;
  fundState.financialYear = opt ? opt.textContent : '';
  if (fundState.emisCode) fundLoadAccount(prefix);
}

let fundSchoolSearchDebounce = null;
function fundSearchSchool(prefix) {
  const kw = document.getElementById(`fund_${prefix}_school_search`).value.trim();
  const resultsEl = document.getElementById(`fund_${prefix}_school_results`);
  clearTimeout(fundSchoolSearchDebounce);
  const isEmis = /^\d+$/.test(kw);
  if (kw.length < (isEmis ? 5 : 2)) { resultsEl.innerHTML = ''; return; }
  resultsEl.innerHTML = `<div style="padding:8px;color:var(--t3);font-size:.82rem">Searching…</div>`;
  fundSchoolSearchDebounce = setTimeout(async () => {
    const query = _sb.from('schools').select('emis, school_name, tehsil, district').limit(15);
    const { data, error } = isEmis ? await query.ilike('emis', `${kw}%`) : await query.ilike('school_name', `%${kw}%`);
    if (error || !data?.length) { resultsEl.innerHTML = `<div style="padding:8px;color:var(--t3);font-size:.82rem">No matching school.</div>`; return; }
    resultsEl.innerHTML = data.map(s => `
      <div class="ap-school-result" onclick="fundSelectSchool('${prefix}', '${s.emis}', '${escHtml(s.school_name || '').replace(/'/g, "\\'")}')">
        <strong>${escHtml(s.school_name || '')}</strong>
        <span style="color:var(--t3);font-size:.78rem"> — EMIS ${escHtml(s.emis)} · ${escHtml(s.tehsil || '')}, ${escHtml(s.district || '')}</span>
      </div>`).join('');
  }, 300);
}

function fundSelectSchool(prefix, emis, name) {
  fundState.emisCode = emis;
  fundState.schoolName = name;
  document.getElementById(`fund_${prefix}_school_search`).value = `${name} (EMIS ${emis})`;
  document.getElementById(`fund_${prefix}_school_results`).innerHTML = '';
  fundLoadAccount(prefix);
}

// ═══════════════════════════════ ACCOUNT LOAD ═══════════════════════
async function fundLoadAccount(prefix) {
  if (!fundState.financialYearId || !fundState.emisCode) return;
  const fundType = prefix === 'nsb' ? 'NSB' : 'FTF';

  let { data: account } = await _sb.from('fund_accounts').select('*')
    .eq('emis_code', fundState.emisCode).eq('fund_type', fundType).eq('financial_year_id', fundState.financialYearId)
    .maybeSingle();

  if (!account) {
    document.getElementById(`fund_${prefix}_body`).style.display = 'none';
    document.getElementById(`fund_${prefix}_openingPrompt`).style.display = 'block';
    document.getElementById(`fund_${prefix}_openingPrompt`).innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--t3)">
        No ${fundType} account yet for ${escHtml(fundState.schoolName)} in FY ${fundState.financialYear}.<br>
        <button class="btn btn-add" style="margin-top:12px" onclick="fundCreateAccount('${prefix}')">
          <i class="bi bi-plus-circle"></i> Set Opening Balance &amp; Start Ledger
        </button>
      </div>`;
    return;
  }

  fundState.accountId = account.id;
  document.getElementById(`fund_${prefix}_openingPrompt`).style.display = 'none';
  document.getElementById(`fund_${prefix}_body`).style.display = 'block';

  if (prefix === 'ftf') fundRenderFtf(account);
  else fundRenderNsb(account);
}

async function fundCreateAccount(prefix) {
  const fundType = prefix === 'nsb' ? 'NSB' : 'FTF';
  const openingStr = prompt(`Opening Balance as of 1 July (FY ${fundState.financialYear}):`, '0');
  if (openingStr === null) return;
  const opening = parseFloat(openingStr);
  if (isNaN(opening) || opening < 0) { showToast('Enter a valid, non-negative amount.', false); return; }

  const { error } = await _sb.from('fund_accounts').insert({
    emis_code: fundState.emisCode, fund_type: fundType, financial_year_id: fundState.financialYearId,
    opening_balance: opening, created_by: currentUser.id,
  });
  if (error) { showToast(error.message, false); return; }
  showToast('Account created.', true);
  fundLoadAccount(prefix);
}

// ═══════════════════════════════════ FTF ═════════════════════════════
async function fundRenderFtf(account) {
  const { data: summary } = await _sb.from('fund_monthly_summary').select('*').eq('fund_account_id', account.id);
  const byMonth = {}; (summary || []).forEach(r => byMonth[r.month] = r);

  const totalIncome = (summary || []).reduce((s, r) => s + Number(r.total_income), 0);
  const totalExpenses = (summary || []).reduce((s, r) => s + Number(r.total_expenses), 0);
  const closing = byMonth[6] ? Number(byMonth[6].closing_balance) : Number(account.opening_balance);

  document.getElementById('fund_ftf_summaryCards').innerHTML = fundSummaryCardsHtml(account.opening_balance, totalIncome, totalExpenses, closing);

  document.getElementById('fund_ftf_monthlyTable').innerHTML = `
    <table class="data-table">
      <thead><tr><th>Month</th><th>Opening</th><th>Income</th><th>Expenses</th><th>Closing</th></tr></thead>
      <tbody>
        ${FUND_FISCAL_MONTHS.map(m => {
          const r = byMonth[m];
          return `<tr>
            <td><b>${FUND_MONTH_NAMES[m]}</b></td>
            <td>${r ? fundMoney(r.opening_balance) : '—'}</td>
            <td style="color:var(--ok)">${r ? fundMoney(r.total_income) : '—'}</td>
            <td style="color:#dc2626">${r ? fundMoney(r.total_expenses) : '—'}</td>
            <td><b>${r ? fundMoney(r.closing_balance) : '—'}</b></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  fundLoadTransactions('ftf', account.id);
}

async function fundLoadTransactions(prefix, accountId) {
  const { data: txns } = await _sb.from('fund_transactions').select('*').eq('fund_account_id', accountId)
    .order('transaction_date', { ascending: false }).limit(100);
  const listEl = document.getElementById(`fund_${prefix}_txnList`);
  if (!txns?.length) { listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3)">No transactions yet.</div>`; return; }

  listEl.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Ref#</th><th>Amount</th>${fundState.isAdmin ? '<th></th>' : ''}</tr></thead>
      <tbody>
        ${txns.map(t => `<tr>
          <td>${t.transaction_date}</td>
          <td style="color:${t.transaction_type === 'income' ? 'var(--ok)' : '#dc2626'}">${t.transaction_type}</td>
          <td>${escHtml(t.income_category || t.expense_category || '')}</td>
          <td>${escHtml(t.description || '')}</td>
          <td>${escHtml(t.reference_no || '')}</td>
          <td><b>${fundMoney(t.amount)}</b></td>
          ${fundState.isAdmin ? `<td><button class="btn-edit" style="padding:2px 8px;font-size:.75rem" onclick="fundDeleteTransaction('${prefix}', '${t.id}', '${accountId}')"><i class="bi bi-trash"></i></button></td>` : ''}
        </tr>`).join('')}
      </tbody>
    </table>`;
}

async function fundDeleteTransaction(prefix, txnId, accountId) {
  if (!confirm('Delete this transaction? This cannot be undone (audit log will retain a record).')) return;
  const { error } = await _sb.from('fund_transactions').delete().eq('id', txnId);
  if (error) { showToast(error.message, false); return; }
  showToast('Transaction deleted.', true);
  fundLoadAccount(prefix);
}

function fundOpenFtfTxnModal(type) {
  document.getElementById('fundTxnModalTitle').textContent = type === 'income' ? 'Add FTF Income' : 'Add FTF Expense';
  document.getElementById('fundTxnType').value = type;
  document.getElementById('fundTxnFundType').value = 'FTF';
  document.getElementById('fundTxnCategoryLabel').textContent = type === 'income' ? 'Income Category' : 'Expense Category';
  document.getElementById('fundTxnRefLabel').textContent = type === 'income' ? 'Reference / Receipt No.' : 'Voucher / Reference No.';
  document.getElementById('fundTxnForm').reset();
  document.getElementById('fundTxnDate').valueAsDate = new Date();
  document.getElementById('fundTxnModal').classList.remove('hidden');
}

function fundOpenNsbExpenseModal() {
  document.getElementById('fundTxnModalTitle').textContent = 'Add NSB Monthly Expense';
  document.getElementById('fundTxnType').value = 'expense';
  document.getElementById('fundTxnFundType').value = 'NSB';
  document.getElementById('fundTxnCategoryLabel').textContent = 'Expense Category';
  document.getElementById('fundTxnRefLabel').textContent = 'Voucher / Reference Number';
  document.getElementById('fundTxnForm').reset();
  document.getElementById('fundTxnDate').valueAsDate = new Date();
  document.getElementById('fundTxnModal').classList.remove('hidden');
}

function fundCloseTxnModal() { document.getElementById('fundTxnModal').classList.add('hidden'); }

async function fundSubmitTxn(ev) {
  ev.preventDefault();
  if (!fundState.accountId) { showToast('Select a financial year and school first.', false); return; }

  const type = document.getElementById('fundTxnType').value;
  const fundType = document.getElementById('fundTxnFundType').value;
  const date = document.getElementById('fundTxnDate').value;
  const amount = parseFloat(document.getElementById('fundTxnAmount').value);
  const category = document.getElementById('fundTxnCategory').value.trim();
  const description = document.getElementById('fundTxnDescription').value.trim();
  const refNo = document.getElementById('fundTxnRef').value.trim();

  if (!date || !amount || amount <= 0 || !category) { showToast('Date, amount, and category are required.', false); return; }

  const month = parseInt(date.split('-')[1], 10);
  const row = {
    fund_account_id: fundState.accountId, emis_code: fundState.emisCode, fund_type: fundType,
    financial_year_id: fundState.financialYearId, transaction_type: type,
    month, transaction_date: date, amount, description: description || null, reference_no: refNo || null,
    created_by: currentUser.id,
  };
  if (type === 'income') row.income_category = category; else row.expense_category = category;

  const { error } = await _sb.from('fund_transactions').insert(row);
  if (error) { showToast(error.message, false); return; }

  showToast('Saved.', true);
  fundCloseTxnModal();
  fundLoadAccount(fundType === 'NSB' ? 'nsb' : 'ftf');
}

// ═══════════════════════════════════ NSB ═════════════════════════════
async function fundRenderNsb(account) {
  const { data: receipts } = await _sb.from('nsb_receipts').select('*')
    .eq('emis_code', fundState.emisCode).eq('financial_year_id', fundState.financialYearId);
  const rByQ = {}; let other = 0, profit = 0;
  (receipts || []).forEach(r => {
    if (r.income_type === 'quarterly') rByQ[r.quarter] = Number(r.amount);
    else if (r.income_type === 'other') other = Number(r.amount);
    else if (r.income_type === 'profit') profit = Number(r.amount);
  });
  const q1 = rByQ[1] || 0, q2 = rByQ[2] || 0, q3 = rByQ[3] || 0, q4 = rByQ[4] || 0;
  const totalIncome = q1 + q2 + q3 + q4 + other + profit;

  const { data: summary } = await _sb.from('fund_monthly_summary').select('*').eq('fund_account_id', account.id);
  const totalExpenses = (summary || []).reduce((s, r) => s + Number(r.total_expenses), 0);
  const closing = Number(account.opening_balance) + totalIncome - totalExpenses;

  document.getElementById('fund_nsb_summaryCards').innerHTML = fundSummaryCardsHtml(account.opening_balance, totalIncome, totalExpenses, closing);

  document.getElementById('fund_nsb_quarterlyTable').innerHTML = `
    <table class="data-table">
      <thead><tr><th>NSB Income Source</th><th>Amount</th>${fundState.isAdmin ? '<th></th>' : ''}</tr></thead>
      <tbody>
        <tr><td>Balance as on 1 July</td><td><b>${fundMoney(account.opening_balance)}</b></td><td></td></tr>
        ${[1,2,3,4].map(q => `<tr>
          <td>Quarter ${q}</td><td>${fundMoney(rByQ[q] || 0)}</td>
          ${fundState.isAdmin ? `<td><button class="btn-edit" style="padding:2px 10px;font-size:.75rem" onclick="fundEditNsbReceipt('${q}', 'quarterly', ${rByQ[q] || 0})">Edit</button></td>` : '<td></td>'}
        </tr>`).join('')}
        <tr><td>Any Other Income</td><td>${fundMoney(other)}</td>
          ${fundState.isAdmin ? `<td><button class="btn-edit" style="padding:2px 10px;font-size:.75rem" onclick="fundEditNsbReceipt(null, 'other', ${other})">Edit</button></td>` : '<td></td>'}</tr>
        <tr><td>Profit / Other Earnings</td><td>${fundMoney(profit)}</td>
          ${fundState.isAdmin ? `<td><button class="btn-edit" style="padding:2px 10px;font-size:.75rem" onclick="fundEditNsbReceipt(null, 'profit', ${profit})">Edit</button></td>` : '<td></td>'}</tr>
        <tr style="border-top:2px solid #0f172a"><td><b>Total Income</b></td><td><b>${fundMoney(totalIncome)}</b></td><td></td></tr>
        <tr><td>Total Expenses</td><td style="color:#dc2626"><b>${fundMoney(totalExpenses)}</b></td><td></td></tr>
        <tr><td><b>Closing Balance</b></td><td><b>${fundMoney(closing)}</b></td><td></td></tr>
      </tbody>
    </table>
    ${!fundState.isAdmin ? `<p style="font-size:.78rem;color:var(--t3);margin-top:6px">Quarterly figures are managed by Admin only.</p>` : ''}`;

  const byMonth = {}; (summary || []).forEach(r => byMonth[r.month] = r);
  document.getElementById('fund_nsb_monthlyTable').innerHTML = `
    <table class="data-table">
      <thead><tr><th>Month</th><th>Expenses</th></tr></thead>
      <tbody>
        ${FUND_FISCAL_MONTHS.map(m => `<tr><td><b>${FUND_MONTH_NAMES[m]}</b></td><td style="color:#dc2626">${byMonth[m] ? fundMoney(byMonth[m].total_expenses) : '—'}</td></tr>`).join('')}
      </tbody>
    </table>
    <p style="font-size:.78rem;color:var(--t3);margin-top:6px">NSB income arrives quarterly (above), so it isn't spread month-by-month here — only expenses are tracked monthly.</p>`;

  fundLoadTransactions('nsb', account.id);
  if (fundState.isAdmin) fundLoadSourceFiles();
}

async function fundEditNsbReceipt(quarter, incomeType, current) {
  const label = incomeType === 'quarterly' ? `Quarter ${quarter}` : (incomeType === 'other' ? 'Any Other Income' : 'Profit / Other Earnings');
  const amountStr = prompt(`${label} amount for FY ${fundState.financialYear}:`, current);
  if (amountStr === null) return;
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount < 0) { showToast('Enter a valid, non-negative amount.', false); return; }

  // Manual select-then-insert/update: the two NSB receipt "shapes"
  // (quarterly vs other/profit) are enforced by two separate partial
  // unique indexes, so a single upsert(onConflict:) can't target both.
  let existingQuery = _sb.from('nsb_receipts').select('id')
    .eq('emis_code', fundState.emisCode).eq('financial_year_id', fundState.financialYearId).eq('income_type', incomeType);
  existingQuery = incomeType === 'quarterly' ? existingQuery.eq('quarter', Number(quarter)) : existingQuery.is('quarter', null);
  const { data: existingRow } = await existingQuery.maybeSingle();

  let error;
  if (existingRow) {
    ({ error } = await _sb.from('nsb_receipts').update({ amount }).eq('id', existingRow.id));
  } else {
    ({ error } = await _sb.from('nsb_receipts').insert({
      fund_account_id: fundState.accountId, emis_code: fundState.emisCode,
      financial_year_id: fundState.financialYearId, income_type: incomeType,
      quarter: incomeType === 'quarterly' ? Number(quarter) : null, amount, created_by: currentUser.id,
    }));
  }
  if (error) { showToast(error.message, false); return; }
  showToast('Saved.', true);
  fundLoadAccount('nsb');
}

// ═══════════════════════════ NSB FILE MANAGEMENT (Admin) ═════════════
async function fundRefreshDriveStatus() {
  getFundGoogleConnectionStatus(status => {
    const label = document.getElementById('fundDriveStatusLabel');
    const btn = document.getElementById('fundDriveConnectBtn');
    if (status.connected) {
      label.innerHTML = `<i class="bi bi-check-circle-fill" style="color:var(--ok)"></i> Connected: ${escHtml(status.google_email)}`;
      btn.textContent = 'Reconnect';
    } else {
      label.innerHTML = `<i class="bi bi-exclamation-circle-fill" style="color:#dc2626"></i> Not connected`;
      btn.textContent = 'Connect Google Drive';
    }
    btn.onclick = fundConnectGoogleAccount;
  });
}

async function fundLoadSourceFiles() {
  const { data: files } = await _sb.from('fund_source_files').select('*')
    .eq('financial_year_id', fundState.financialYearId).eq('fund_type', 'NSB').eq('file_kind', 'quarterly')
    .eq('is_active', true);
  const byQ = {}; (files || []).forEach(f => byQ[f.quarter] = f);

  document.getElementById('fundNsbFilesTable').innerHTML = `
    <table class="data-table">
      <thead><tr><th>Quarter</th><th>File</th><th>Status</th><th>Uploaded</th><th></th></tr></thead>
      <tbody>
        ${[1,2,3,4].map(q => {
          const f = byQ[q];
          return `<tr>
            <td><b>Q${q}</b></td>
            <td>${f ? `<a href="${escHtml(f.file_url || '#')}" target="_blank">${escHtml(f.file_name)}</a> <span style="color:var(--t3);font-size:.75rem">(v${f.file_version})</span>` : '—'}</td>
            <td>${f ? escHtml(f.processing_status) : '<span style="color:var(--t3)">Not Uploaded</span>'}</td>
            <td>${f ? new Date(f.uploaded_at).toLocaleDateString() : '—'}</td>
            <td>
              <input type="file" id="fundNsbFileInput_${q}" style="display:none" accept=".xlsx,.xls,.csv" onchange="fundHandleNsbFileSelect(${q}, this)">
              <button class="btn btn-add" style="padding:4px 10px;font-size:.78rem" onclick="document.getElementById('fundNsbFileInput_${q}').click()">
                <i class="bi bi-upload"></i> ${f ? 'Replace' : 'Upload'}
              </button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

async function fundHandleNsbFileSelect(quarter, inputEl) {
  const file = inputEl.files[0];
  inputEl.value = '';
  if (!file || !fundState.financialYear) return;
  await fundDoNsbUpload(file, quarter, false);
}

async function fundDoNsbUpload(file, quarter, confirmReplace) {
  showToast('Uploading to Google Drive…', true);
  const result = await fundUploadNsbFile(
    file, { financialYear: fundState.financialYear, quarter, confirmReplace },
    {
      onDuplicate: (existing, message) => { showToast(message, false); },
      onNeedsConfirmation: (existing, message) => {
        const proceed = confirm(
          `${message}\n\nExisting file: ${existing.file_name} (v${existing.file_version})\n` +
          `Uploaded: ${new Date(existing.uploaded_at).toLocaleString()}\n\n` +
          `The new file appears different. Replace the existing Q${quarter} file? ` +
          `(The old file is archived, never deleted.)`
        );
        if (proceed) fundDoNsbUpload(file, quarter, true);
      },
    }
  );
  if (result.success) {
    showToast(`Q${quarter} file uploaded (v${result.file.file_version}).`, true);
    fundLoadSourceFiles();
  }
}

// ═══════════════════════════════════ helpers ═════════════════════════
function fundMoney(n) {
  return 'Rs ' + Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Wire into the existing router (see js/index.js ROUTES table). This
// file must load AFTER index.js so `ROUTES` already exists — classic
// (non-module) <script> tags share one global scope, so this just adds
// three keys to the same object index.js built.
if (typeof ROUTES === 'object') {
  ROUTES['fund'] = () => openFundModule();
  ROUTES['fund-nsb'] = () => openFundNsbModule();
  ROUTES['fund-ftf'] = () => openFundFtfModule();
}

function fundSummaryCardsHtml(opening, income, expenses, closing) {
  return `
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi-card" style="border-left-color:#64748b"><div style="font-size:.75rem;color:var(--t3);font-weight:700;text-transform:uppercase">Opening Balance</div><div style="font-size:1.3rem;font-weight:800;margin-top:4px">${fundMoney(opening)}</div></div>
      <div class="kpi-card" style="border-left-color:var(--ok)"><div style="font-size:.75rem;color:var(--t3);font-weight:700;text-transform:uppercase">Total Income</div><div style="font-size:1.3rem;font-weight:800;margin-top:4px;color:var(--ok)">${fundMoney(income)}</div></div>
      <div class="kpi-card" style="border-left-color:#dc2626"><div style="font-size:.75rem;color:var(--t3);font-weight:700;text-transform:uppercase">Total Expenses</div><div style="font-size:1.3rem;font-weight:800;margin-top:4px;color:#dc2626">${fundMoney(expenses)}</div></div>
      <div class="kpi-card" style="border-left-color:var(--brand)"><div style="font-size:.75rem;color:var(--t3);font-weight:700;text-transform:uppercase">Closing Balance</div><div style="font-size:1.3rem;font-weight:800;margin-top:4px;color:var(--brand)">${fundMoney(closing)}</div></div>
    </div>`;
}
