// ═══════════════════════════════════════════════════════════════════
//  FUND RECORD MANAGEMENT — NSB + FTF
//  Depends on: api.js/config.js (_sb, CONFIG), core.js (escHtml,
//  showToast, currentUser), index.js (switchGlobalTab), and
//  fund-google-drive.js (Admin Drive connect + NSB upload) which must
//  be loaded BEFORE this file.
// ═══════════════════════════════════════════════════════════════════

const FUND_MONTH_NAMES = { 7:'July',8:'August',9:'September',10:'October',11:'November',12:'December',1:'January',2:'February',3:'March',4:'April',5:'May',6:'June' };
const FUND_FISCAL_MONTHS = [7,8,9,10,11,12,1,2,3,4,5,6];

// "July 2026" style label — never show a bare month number/name without
// its actual calendar year, since July appears in both halves of an FY.
function fundMonthLabel(month, financialYear) {
  const fy = financialYear || fundState.financialYear;
  if (!fy) return FUND_MONTH_NAMES[month];
  const y1 = parseInt(fy.split('-')[0], 10);
  const year = month >= 7 ? y1 : y1 + 1;
  return `${FUND_MONTH_NAMES[month]} ${year}`;
}

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
  // Idempotent — tops up years 2014-15 through 5 years ahead of today.
  // No one ever needs to add a financial year by hand.
  await _sb.rpc('fund_ensure_financial_years');

  const fySel = document.getElementById(`fund_${prefix}_fy`);
  const { data: years } = await _sb.from('fund_financial_years').select('id, financial_year, start_date, end_date').order('financial_year', { ascending: false });
  const list = years || [];
  fySel.innerHTML = list.map(y => `<option value="${y.id}">${y.financial_year}</option>`).join('')
    || `<option value="">No financial years yet</option>`;

  const todayStr = new Date().toISOString().slice(0, 10);
  const current = list.find(y => y.start_date <= todayStr && todayStr <= y.end_date) || list[0];
  if (current) {
    fySel.value = current.id;
    fundState.financialYearId = current.id;
    fundState.financialYear = current.financial_year;
  }
  fySel.onchange = () => fundOnFyChange(prefix);

  const searchInput = document.getElementById(`fund_${prefix}_school_search`);
  searchInput.oninput = () => fundSearchSchool(prefix);
  searchInput.onfocus = () => fundSearchSchool(prefix);

  if (fundState.financialYearId && fundState.emisCode) fundLoadAccount(prefix);
}

function fundOnFyChange(prefix) {
  const fySel = document.getElementById(`fund_${prefix}_fy`);
  const opt = fySel.selectedOptions[0];
  fundState.financialYearId = fySel.value;
  fundState.financialYear = opt ? opt.textContent : '';
  if (fundState.emisCode) fundLoadAccount(prefix);
}

let fundSchoolSearchDebounce = null;
// Jurisdiction-scoped: fund_visible_schools() reuses the exact same
// is_admin()/fn_jurisdiction_visible() logic as the rest of the app, so
// non-admins only ever see schools they're already authorized to see —
// no manual EMIS entry, no separate jurisdiction system.
function fundSearchSchool(prefix) {
  const kw = document.getElementById(`fund_${prefix}_school_search`).value.trim();
  const resultsEl = document.getElementById(`fund_${prefix}_school_results`);
  clearTimeout(fundSchoolSearchDebounce);
  // Admins have a huge scope (everything) — require a couple of
  // characters before searching. Everyone else's jurisdiction is small
  // enough to just show the full list immediately (on focus/empty query).
  if (fundState.isAdmin && kw.length < 2) { resultsEl.innerHTML = ''; return; }
  resultsEl.innerHTML = `<div style="padding:8px;color:var(--t3);font-size:.82rem">Loading…</div>`;
  fundSchoolSearchDebounce = setTimeout(async () => {
    const { data, error } = await _sb.rpc('fund_visible_schools', { p_search: kw || null });
    if (error || !data?.length) { resultsEl.innerHTML = `<div style="padding:8px;color:var(--t3);font-size:.82rem">No matching school in your jurisdiction.</div>`; return; }
    resultsEl.innerHTML = data.map(s => `
      <div class="ap-school-result" onclick="fundSelectSchool('${prefix}', '${s.emis}', '${escHtml(s.school_name || '').replace(/'/g, "\\'")}')">
        <strong>${escHtml(s.school_name || '')}</strong>
        <span style="color:var(--t3);font-size:.78rem"> — EMIS ${escHtml(s.emis)} · ${escHtml(s.tehsil || '')}, ${escHtml(s.district || '')}</span>
      </div>`).join('');
  }, 250);
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
            <td><b>${fundMonthLabel(m)}</b></td>
            <td>${r ? fundMoney(r.opening_balance) : '—'}</td>
            <td style="color:var(--ok)">${r ? fundMoney(r.total_income) : '—'}</td>
            <td style="color:#dc2626">
              ${r ? fundMoney(r.total_expenses) : 'Rs 0'}
              <button class="btn-edit" style="padding:1px 8px;font-size:.72rem;margin-left:6px" onclick="fundEditMonthlyExpense('ftf', ${m}, ${r ? r.total_expenses : 0})"><i class="bi bi-pencil"></i></button>
            </td>
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
          <td>${escHtml(t.income_category || (t.transaction_type === 'expense' ? 'Total Monthly Expense' : ''))}</td>
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

// FTF income stays itemized (grants, various sources need a category/
// receipt#). Expenses (both FTF and NSB) are simplified to ONE total
// figure per month — no bill/voucher-wise entry — via fundEditMonthlyExpense().
function fundOpenFtfTxnModal() {
  document.getElementById('fundTxnModalTitle').textContent = 'Add FTF Income';
  document.getElementById('fundTxnType').value = 'income';
  document.getElementById('fundTxnFundType').value = 'FTF';
  document.getElementById('fundTxnCategoryLabel').textContent = 'Income Category';
  document.getElementById('fundTxnRefLabel').textContent = 'Reference / Receipt No.';
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
    income_category: category,
    created_by: currentUser.id,
  };

  const { error } = await _sb.from('fund_transactions').insert(row);
  if (error) { showToast(error.message, false); return; }

  showToast('Saved.', true);
  fundCloseTxnModal();
  fundLoadAccount(fundType === 'NSB' ? 'nsb' : 'ftf');
}

// Turns fiscal month (7=Jul...6=Jun) into a real date within the
// selected financial year, for storing the single monthly expense row.
function fundMonthToDate(month) {
  const [y1] = fundState.financialYear.split('-').map(Number);
  const year = month >= 7 ? y1 : y1 + 1;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

// Expenses are ONE total per month (no bill/voucher detail) — DB enforces
// this with a unique index (fund_account_id, month) where transaction_type
// = 'expense', so we select-then-insert/update rather than adding rows.
async function fundEditMonthlyExpense(prefix, month, current) {
  if (!fundState.accountId) { showToast('Select a financial year and school first.', false); return; }
  const label = fundMonthLabel(month);
  const amountStr = prompt(`Total expenses for ${label}:`, current || '');
  if (amountStr === null) return;
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount < 0) { showToast('Enter a valid, non-negative amount.', false); return; }

  const fundType = prefix === 'nsb' ? 'NSB' : 'FTF';
  const { data: existingRow } = await _sb.from('fund_transactions').select('id')
    .eq('fund_account_id', fundState.accountId).eq('month', month).eq('transaction_type', 'expense').maybeSingle();

  let error;
  if (amount === 0 && existingRow) {
    ({ error } = await _sb.from('fund_transactions').delete().eq('id', existingRow.id));
  } else if (existingRow) {
    ({ error } = await _sb.from('fund_transactions').update({ amount }).eq('id', existingRow.id));
  } else if (amount > 0) {
    ({ error } = await _sb.from('fund_transactions').insert({
      fund_account_id: fundState.accountId, emis_code: fundState.emisCode, fund_type: fundType,
      financial_year_id: fundState.financialYearId, transaction_type: 'expense',
      expense_category: 'Total Monthly Expense', month, transaction_date: fundMonthToDate(month),
      amount, created_by: currentUser.id,
    }));
  }
  if (error) { showToast(error.message, false); return; }
  showToast('Saved.', true);
  fundLoadAccount(prefix);
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
        ${FUND_FISCAL_MONTHS.map(m => {
          const r = byMonth[m];
          return `<tr>
            <td><b>${fundMonthLabel(m)}</b></td>
            <td style="color:#dc2626">
              ${r ? fundMoney(r.total_expenses) : 'Rs 0'}
              <button class="btn-edit" style="padding:1px 8px;font-size:.72rem;margin-left:6px" onclick="fundEditMonthlyExpense('nsb', ${m}, ${r ? r.total_expenses : 0})"><i class="bi bi-pencil"></i></button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <p style="font-size:.78rem;color:var(--t3);margin-top:6px">NSB income arrives quarterly (above), so it isn't spread month-by-month here — only expenses are tracked monthly, as a single total per month.</p>`;

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

// ═══════════════════════════ ANNUAL ARCHIVES ═════════════════════════
// Consolidated NSB/FTF workbooks are generated automatically once a
// financial year ends (daily server-side check, see fund-generate-
// annual-archive edge function + pg_cron). This view is on-demand
// access + an Admin "Generate Now" override — it doesn't trigger
// generation on its own.
let fundArchivesFundType = 'NSB';

function openFundArchivesView() {
  switchGlobalTab('fundArchivesView', null);
  fundState.isAdmin = fundIsAdmin();
  document.getElementById('fundArchivesGenerateBtn').style.display = fundState.isAdmin ? 'inline-flex' : 'none';
  fundSetArchivesFundType(fundArchivesFundType);
}

function fundSetArchivesFundType(type) {
  fundArchivesFundType = type;
  document.getElementById('fundArchivesNsbTab').classList.toggle('active', type === 'NSB');
  document.getElementById('fundArchivesFtfTab').classList.toggle('active', type === 'FTF');
  fundLoadArchives();
}

async function fundLoadArchives() {
  const listEl = document.getElementById('fundArchivesList');
  listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3)"><span class="spinner-border"></span> Loading…</div>`;

  const { data: years } = await _sb.from('fund_financial_years').select('id, financial_year, end_date').order('financial_year', { ascending: false });
  const { data: archives } = await _sb.from('fund_annual_archives').select('*').eq('fund_type', fundArchivesFundType);
  const byFy = {}; (archives || []).forEach(a => byFy[a.financial_year_id] = a);

  const todayStr = new Date().toISOString().slice(0, 10);
  const rows = (years || []).filter(y => y.end_date < todayStr); // only years that have actually ended

  if (!rows.length) { listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--t3)">No completed financial years yet.</div>`; return; }

  listEl.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Financial Year</th><th>Status</th><th>Schools</th><th>Generated</th><th></th></tr></thead>
      <tbody>
        ${rows.map(y => {
          const a = byFy[y.id];
          const status = a?.status || 'pending';
          const badgeColor = status === 'completed' ? 'var(--ok)' : (status === 'failed' ? '#dc2626' : 'var(--t3)');
          return `<tr>
            <td><b>${y.financial_year}</b></td>
            <td style="color:${badgeColor};text-transform:capitalize">${status}${a?.status === 'failed' && a?.error_message ? ` <span style="font-size:.72rem;color:var(--t3)">(${escHtml(a.error_message)})</span>` : ''}</td>
            <td>${a?.school_count ?? '—'}</td>
            <td>${a?.generated_at ? new Date(a.generated_at).toLocaleDateString() : '—'}</td>
            <td style="white-space:nowrap">
              ${a?.status === 'completed' ? `<a class="btn btn-add" style="padding:4px 10px;font-size:.78rem" href="${escHtml(a.google_drive_url)}" target="_blank"><i class="bi bi-download"></i> Open</a>` : ''}
              ${fundState.isAdmin ? `<button class="btn-edit" style="padding:4px 10px;font-size:.78rem;margin-left:6px" onclick="fundGenerateArchiveNow('${y.id}', '${y.financial_year}', ${a?.status === 'completed'})"><i class="bi bi-arrow-repeat"></i> ${a?.status === 'completed' ? 'Regenerate' : 'Generate Now'}</button>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

async function fundGenerateArchiveNow(financialYearId, financialYearLabel, isRegenerate) {
  if (isRegenerate && !confirm(`Regenerate the consolidated ${fundArchivesFundType} workbook for FY ${financialYearLabel}? This replaces the existing Drive file reference with a fresh export.`)) return;
  showToast(`Generating ${fundArchivesFundType} archive for FY ${financialYearLabel}…`, true);

  const { data: { session } } = await _sb.auth.getSession();
  const res = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/fund-generate-annual-archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify({ financial_year_id: financialYearId, fund_type: fundArchivesFundType, force: true }),
  });
  const result = await res.json();
  if (!result.success) { showToast(result.message || 'Failed to generate archive.', false); return; }

  const outcome = result.results?.[0];
  if (outcome?.status === 'completed') showToast('Archive generated and saved to Google Drive.', true);
  else showToast(outcome?.message || 'Archive generation did not complete — check Drive connection.', false);
  fundLoadArchives();
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
  ROUTES['fund-archives'] = () => openFundArchivesView();
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
