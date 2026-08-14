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

// Admin, or an Editor-access_type user acting within their own
// jurisdiction. Schools only ever reach this screen via
// fund_visible_schools() (jurisdiction-filtered), so any school already
// selected here is one this user is allowed to write to — matches the
// DB-side check (is_admin() or (is_editor() and fund_row_visible(...)))
// used by fund_accounts / fund_transactions / nsb_receipts RLS. Same
// pattern as _hrApplyPermissionGating() in hr_view.js.
function fundCanEdit() {
  if (fundState.isAdmin) return true;
  return String(currentUser?.access_type || '').toLowerCase() === 'editor';
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
  // Focusing the search box re-opens the picker (list below the search
  // bar) even if a school is already selected, so the user can change it
  // without hunting for a separate button first.
  searchInput.onfocus = () => { if (fundState.emisCode) fundChangeSchool(prefix, false); fundSearchSchool(prefix); };

  if (fundState.emisCode) {
    // A school is already selected (e.g. switching between NSB/FTF) —
    // keep the picker collapsed and show the identity bar straight away.
    fundShowSelectedBar(prefix);
  } else {
    document.getElementById(`fund_${prefix}_school_list_wrap`).style.display = 'block';
    // Non-admins have a small enough jurisdiction that we show it straight
    // away — no need to click/focus the search box first. Admins still
    // need to type (see fundSearchSchool) since "everything" is too big
    // a list to dump on open.
    if (!fundState.isAdmin) {
      fundSearchSchool(prefix);
    } else {
      document.getElementById(`fund_${prefix}_school_list_meta`).textContent = 'Type at least 2 characters to search schools.';
      document.getElementById(`fund_${prefix}_school_results`).innerHTML = '';
    }
  }

  if (fundState.financialYearId && fundState.emisCode) fundLoadAccount(prefix);
}

function fundOnFyChange(prefix) {
  const fySel = document.getElementById(`fund_${prefix}_fy`);
  const opt = fySel.selectedOptions[0];
  fundState.financialYearId = fySel.value;
  fundState.financialYear = opt ? opt.textContent : '';
  if (fundState.emisCode) {
    fundShowSelectedBar(prefix);
    fundLoadAccount(prefix);
  }
}

let fundSchoolSearchDebounce = null;
// Jurisdiction-scoped: fund_visible_schools() reuses the exact same
// is_admin()/fn_jurisdiction_visible() logic as the rest of the app, so
// non-admins only ever see schools they're already authorized to see —
// no manual EMIS entry, no separate jurisdiction system.
// Renders results in the free page space BELOW the search bar (never
// inside/under the search field itself) — see .fund-school-list-grid.
function fundSearchSchool(prefix) {
  const kw = document.getElementById(`fund_${prefix}_school_search`).value.trim();
  const wrapEl = document.getElementById(`fund_${prefix}_school_list_wrap`);
  const metaEl = document.getElementById(`fund_${prefix}_school_list_meta`);
  const resultsEl = document.getElementById(`fund_${prefix}_school_results`);
  clearTimeout(fundSchoolSearchDebounce);
  wrapEl.style.display = 'block';
  // Admins have a huge scope (everything) — require a couple of
  // characters before searching. Everyone else's jurisdiction is small
  // enough to just show the full list immediately (on focus/empty query).
  if (fundState.isAdmin && kw.length < 2) {
    metaEl.textContent = '';
    resultsEl.innerHTML = `<div class="fund-school-empty">Type at least 2 characters to search schools.</div>`;
    return;
  }
  metaEl.textContent = '';
  resultsEl.innerHTML = `<div class="fund-school-empty"><span class="spinner-border spinner-border-sm"></span> Loading…</div>`;
  fundSchoolSearchDebounce = setTimeout(async () => {
    const { data, error } = await _sb.rpc('fund_visible_schools', { p_search: kw || null });
    if (error || !data?.length) {
      metaEl.textContent = '';
      resultsEl.innerHTML = `<div class="fund-school-empty">No matching school in your jurisdiction.</div>`;
      return;
    }
    metaEl.textContent = `${data.length} school${data.length === 1 ? '' : 's'} — select one to open its ${prefix === 'nsb' ? 'NSB' : 'FTF'} record`;
    resultsEl.innerHTML = data.map(s => `
      <div class="fund-school-card" onclick="fundSelectSchool('${prefix}', '${s.emis}', '${escHtml(s.school_name || '').replace(/'/g, "\\'")}')">
        <span class="fsc-name">${escHtml(s.school_name || '')}</span>
        <span class="fsc-meta">EMIS ${escHtml(s.emis)} · ${escHtml(s.tehsil || '')}, ${escHtml(s.district || '')}</span>
      </div>`).join('');
  }, 250);
}

function fundSelectSchool(prefix, emis, name) {
  fundState.emisCode = emis;
  fundState.schoolName = name;
  document.getElementById(`fund_${prefix}_school_search`).value = `${name} (EMIS ${emis})`;
  fundShowSelectedBar(prefix);
  fundLoadAccount(prefix);
}

// Collapses the picker and shows the "School Name — EMIS Code" identity
// bar at the top of the detail area, per the intended workflow: Search →
// list below the search bar → select → detail opens with the school
// clearly identified.
function fundShowSelectedBar(prefix) {
  document.getElementById(`fund_${prefix}_school_list_wrap`).style.display = 'none';
  document.getElementById(`fund_${prefix}_school_results`).innerHTML = '';
  const bar = document.getElementById(`fund_${prefix}_selectedBar`);
  bar.style.display = 'flex';
  bar.innerHTML = `
    <div>
      <div class="fsb-name">${escHtml(fundState.schoolName || '')} — EMIS ${escHtml(fundState.emisCode || '')}</div>
      <div class="fsb-meta">${prefix === 'nsb' ? 'NSB' : 'FTF'} record${fundState.financialYear ? ` · FY ${escHtml(fundState.financialYear)}` : ''}</div>
    </div>
    <button class="btn-edit" style="padding:5px 12px;font-size:.8rem" onclick="fundChangeSchool('${prefix}')"><i class="bi bi-arrow-repeat"></i> Change School</button>`;
}

// Clears the current selection and returns to the school picker. By
// default also re-runs the search so the list reappears immediately.
function fundChangeSchool(prefix, reSearch = true) {
  fundState.emisCode = null;
  fundState.schoolName = '';
  fundState.accountId = null;
  document.getElementById(`fund_${prefix}_selectedBar`).style.display = 'none';
  document.getElementById(`fund_${prefix}_openingPrompt`).innerHTML = '';
  document.getElementById(`fund_${prefix}_openingPrompt`).style.display = 'none';
  document.getElementById(`fund_${prefix}_body`).style.display = 'none';
  const input = document.getElementById(`fund_${prefix}_school_search`);
  input.value = '';
  input.focus();
  if (reSearch) fundSearchSchool(prefix);
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
    // Pre-fill with the auto-carried-forward opening balance where one
    // exists. When there's no earlier year on record for this school,
    // this is exactly the case where the "true" opening balance (as on
    // 1 July, from paper/manual records) is NOT zero and NOT derivable —
    // so Admin gets an editable field right here instead of being forced
    // to accept 0 and hunt for a separate correction step afterward.
    const { data: carry } = await _sb.rpc('fund_previous_year_closing_balance', {
      p_emis: fundState.emisCode, p_fund_type: fundType, p_financial_year_id: fundState.financialYearId,
    });
    const carryAmt = Number(carry || 0);
    const carryNote = carryAmt
      ? `Carried forward from the previous year's closing balance: <b>${fundMoney(carryAmt)}</b>. Adjust below if it needs correcting.`
      : `No earlier year is on record for this school — enter the correct balance as on 1 July ${fundState.financialYear.split('-')[0]} below (leave at 0 only if it's genuinely zero).`;
    document.getElementById(`fund_${prefix}_openingPrompt`).innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--t3)">
        No ${fundType} account yet for ${escHtml(fundState.schoolName)} in FY ${fundState.financialYear}.<br>
        <div style="margin-top:8px;font-size:.85rem">${carryNote}</div>
        ${fundCanEdit() ? `
        <div style="margin-top:14px;display:flex;gap:8px;justify-content:center;align-items:center">
          <label style="font-size:.8rem;color:var(--t3);font-weight:600">Opening Balance (as on 1 July)</label>
          <input type="number" id="fund_${prefix}_openingInput" value="${carryAmt}" min="0" step="1"
            style="width:150px;padding:5px 8px;border:1px solid var(--b0);border-radius:6px;font-size:.85rem">
        </div>` : ''}
        <button class="btn btn-add" style="margin-top:12px" onclick="fundCreateAccount('${prefix}')">
          <i class="bi bi-plus-circle"></i> Start Ledger for FY ${fundState.financialYear}
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

// Opening balance defaults to the auto-carried-forward figure (0 if there
// is no earlier year on record), but Admin can type a different value into
// the input rendered above before starting the ledger — covers the "no
// previous year entries in the system" case where the real balance still
// needs to come from paper/manual records. Non-admins always get the
// auto-carried value (no input is rendered for them). See
// fund_previous_year_closing_balance() in the DB for the carry-forward
// logic. fundEditOpeningBalance() remains available for correcting it
// again later, after the ledger already exists.
async function fundCreateAccount(prefix) {
  const fundType = prefix === 'nsb' ? 'NSB' : 'FTF';
  let opening;
  const input = document.getElementById(`fund_${prefix}_openingInput`);
  if (input) {
    opening = parseFloat(input.value);
    if (isNaN(opening) || opening < 0) { showToast('Enter a valid, non-negative opening balance.', false); return; }
  } else {
    const { data: carry, error: carryErr } = await _sb.rpc('fund_previous_year_closing_balance', {
      p_emis: fundState.emisCode, p_fund_type: fundType, p_financial_year_id: fundState.financialYearId,
    });
    if (carryErr) { showToast(carryErr.message, false); return; }
    opening = Number(carry || 0);
  }

  const { error } = await _sb.from('fund_accounts').insert({
    emis_code: fundState.emisCode, fund_type: fundType, financial_year_id: fundState.financialYearId,
    opening_balance: opening, created_by: currentUser.id,
  });
  if (error) { showToast(error.message, false); return; }
  showToast(`Ledger started with opening balance ${fundMoney(opening)}.`, true);
  fundLoadAccount(prefix);
}

// Admin, or jurisdiction Editor, correction path — the figure is
// auto-computed on creation, but a genuine correction (e.g. a prior-year
// data fix) should still be possible without going around the app.
async function fundEditOpeningBalance(prefix, current) {
  if (!fundCanEdit()) return;
  const amountStr = prompt(`Correct the Opening Balance for ${escHtml(fundState.schoolName)} (FY ${fundState.financialYear}):`, current);
  if (amountStr === null) return;
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount < 0) { showToast('Enter a valid, non-negative amount.', false); return; }
  const { error } = await _sb.from('fund_accounts').update({ opening_balance: amount }).eq('id', fundState.accountId);
  if (error) { showToast(error.message, false); return; }
  showToast('Opening balance updated.', true);
  fundLoadAccount(prefix);
}

// ═══════════════════════════════════ FTF ═════════════════════════════
async function fundRenderFtf(account) {
  const { data: summary } = await _sb.from('fund_monthly_summary').select('*').eq('fund_account_id', account.id);
  const byMonth = {}; (summary || []).forEach(r => byMonth[r.month] = r);

  const totalIncome = (summary || []).reduce((s, r) => s + Number(r.total_income), 0);
  const totalExpenses = (summary || []).reduce((s, r) => s + Number(r.total_expenses), 0);
  const closing = byMonth[6] ? Number(byMonth[6].closing_balance) : Number(account.opening_balance);

  document.getElementById('fund_ftf_summaryCards').innerHTML = fundSummaryCardsHtml(account.opening_balance, totalIncome, totalExpenses, closing, 'ftf');

  document.getElementById('fund_ftf_monthlyTable').innerHTML = `
    <table class="data-table">
      <thead><tr><th>Month</th><th>Opening</th><th>Income</th><th>Expenses</th><th>Closing</th></tr></thead>
      <tbody>
        ${FUND_FISCAL_MONTHS.map(m => {
          const r = byMonth[m];
          return `<tr>
            <td><b>${fundMonthLabel(m)}</b></td>
            <td>${r ? fundMoney(r.opening_balance) : '—'}</td>
            <td style="color:var(--ok)">
              ${r ? fundMoney(r.total_income) : 'Rs 0'}
              <button class="btn-edit" style="padding:1px 8px;font-size:.72rem;margin-left:6px" onclick="fundEditMonthlyIncome('ftf', ${m}, ${r ? r.total_income : 0})"><i class="bi bi-pencil"></i></button>
            </td>
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

// FTF income, quick-edit path: same one-total-per-month method as
// fundEditMonthlyExpense() above, for schools that just need a running
// monthly income figure rather than itemized grants/receipts. The
// "Add Income" button/modal still exists for genuinely itemized entries
// (category + receipt#) — if a month already has more than one itemized
// income row, this quick editor won't guess which one to touch and asks
// you to manage those individually in Recent Transactions instead.
async function fundEditMonthlyIncome(prefix, month, current) {
  if (!fundState.accountId) { showToast('Select a financial year and school first.', false); return; }
  const label = fundMonthLabel(month);
  const amountStr = prompt(`Total income for ${label}:`, current || '');
  if (amountStr === null) return;
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount < 0) { showToast('Enter a valid, non-negative amount.', false); return; }

  const { data: existingRows } = await _sb.from('fund_transactions').select('id')
    .eq('fund_account_id', fundState.accountId).eq('month', month).eq('transaction_type', 'income');

  if ((existingRows || []).length > 1) {
    showToast('This month already has multiple itemized income entries — edit or delete them individually in Recent Transactions below.', false);
    return;
  }
  const existingRow = existingRows && existingRows[0];

  let error;
  if (amount === 0 && existingRow) {
    ({ error } = await _sb.from('fund_transactions').delete().eq('id', existingRow.id));
  } else if (existingRow) {
    ({ error } = await _sb.from('fund_transactions').update({ amount }).eq('id', existingRow.id));
  } else if (amount > 0) {
    ({ error } = await _sb.from('fund_transactions').insert({
      fund_account_id: fundState.accountId, emis_code: fundState.emisCode, fund_type: 'FTF',
      financial_year_id: fundState.financialYearId, transaction_type: 'income',
      income_category: 'Total Monthly Income', month, transaction_date: fundMonthToDate(month),
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

  document.getElementById('fund_nsb_summaryCards').innerHTML = fundSummaryCardsHtml(account.opening_balance, totalIncome, totalExpenses, closing, 'nsb');

  const canEditNsb = fundCanEdit();
  document.getElementById('fund_nsb_quarterlyTable').innerHTML = `
    <table class="data-table">
      <thead><tr><th>NSB Income Source</th><th>Amount</th>${canEditNsb ? '<th></th>' : ''}</tr></thead>
      <tbody>
        <tr><td>Balance as on 1 July</td><td><b>${fundMoney(account.opening_balance)}</b></td>
          ${canEditNsb ? `<td><button class="btn-edit" style="padding:1px 8px;font-size:.72rem" onclick="fundEditOpeningBalance('nsb', ${Number(account.opening_balance) || 0})" title="Correct opening balance"><i class="bi bi-pencil"></i></button></td>` : ''}
        </tr>
        ${[1,2,3,4].map(q => `<tr>
          <td>Quarter ${q}</td><td>${fundMoney(rByQ[q] || 0)}</td>
          ${canEditNsb ? `<td><button class="btn-edit" style="padding:1px 8px;font-size:.72rem" onclick="fundEditNsbReceipt('${q}', 'quarterly', ${rByQ[q] || 0})"><i class="bi bi-pencil"></i></button></td>` : ''}
        </tr>`).join('')}
        <tr><td>Any Other Income</td><td>${fundMoney(other)}</td>
          ${canEditNsb ? `<td><button class="btn-edit" style="padding:1px 8px;font-size:.72rem" onclick="fundEditNsbReceipt(null, 'other', ${other})"><i class="bi bi-pencil"></i></button></td>` : ''}</tr>
        <tr><td>Profit / Other Earnings</td><td>${fundMoney(profit)}</td>
          ${canEditNsb ? `<td><button class="btn-edit" style="padding:1px 8px;font-size:.72rem" onclick="fundEditNsbReceipt(null, 'profit', ${profit})"><i class="bi bi-pencil"></i></button></td>` : ''}</tr>
        <tr style="border-top:2px solid #0f172a"><td><b>Total Income</b></td><td><b>${fundMoney(totalIncome)}</b></td>${canEditNsb ? '<td></td>' : ''}</tr>
        <tr><td>Total Expenses</td><td style="color:#dc2626"><b>${fundMoney(totalExpenses)}</b></td>${canEditNsb ? '<td></td>' : ''}</tr>
        <tr><td><b>Closing Balance</b></td><td><b>${fundMoney(closing)}</b></td>${canEditNsb ? '<td></td>' : ''}</tr>
      </tbody>
    </table>
    ${!canEditNsb ? `<p style="font-size:.78rem;color:var(--t3);margin-top:6px">Quarterly figures are managed by Admin or an authorized Editor for your jurisdiction.</p>` : ''}`;

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
              ${a?.status === 'completed' ? `
                <button class="btn btn-add" style="padding:4px 10px;font-size:.78rem" onclick="fundDownloadArchive('${a.id}')"><i class="bi bi-download"></i> Download as Excel</button>
                <a class="btn-edit" style="padding:4px 10px;font-size:.78rem;margin-left:4px" href="${escHtml(a.google_drive_url)}" target="_blank" title="View in Google Drive"><i class="bi bi-box-arrow-up-right"></i></a>` : ''}
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

// Streams the archive workbook down through fund-download-archive (the
// server fetches it from Drive using the shared connection's own token),
// so the person downloading never needs their own Google account/access.
// Produces an actual .xlsx file save, not just a new tab.
async function fundDownloadArchive(archiveId) {
  showToast('Preparing download…', true);
  const { data: { session } } = await _sb.auth.getSession();
  if (!session) { showToast('Not logged in.', false); return; }

  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/fund-download-archive?archive_id=${encodeURIComponent(archiveId)}`, {
      headers: { Authorization: 'Bearer ' + session.access_token },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.message || 'Could not download the archive.', false);
      return;
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const fileName = match ? match[1] : `${fundArchivesFundType}_archive.xlsx`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    showToast(e.message || 'Download failed.', false);
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
  ROUTES['fund-archives'] = () => openFundArchivesView();
}

// Yearly financial summary for the selected EMIS code — school identity
// (EMIS/name/FY) plus opening/income/expenses/closing totals, computed
// from the actual records already loaded for this account (no change to
// the underlying calculations, just how they're presented).
function fundSummaryCardsHtml(opening, income, expenses, closing, prefix) {
  return `
    <div class="fund-ys-head">
      <div class="fys-item"><span class="fys-label">EMIS Code</span><span class="fys-value">${escHtml(fundState.emisCode || '')}</span></div>
      <div class="fys-item"><span class="fys-label">School Name</span><span class="fys-value">${escHtml(fundState.schoolName || '')}</span></div>
      <div class="fys-item"><span class="fys-label">Financial Year</span><span class="fys-value">${escHtml(fundState.financialYear || '')}</span></div>
    </div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi-card" style="border-left-color:#64748b">
        <div style="font-size:.75rem;color:var(--t3);font-weight:700;text-transform:uppercase">Opening Balance</div>
        <div style="font-size:1.3rem;font-weight:800;margin-top:4px">${fundMoney(opening)}
          ${fundCanEdit() && prefix ? `<button class="btn-edit" style="padding:1px 8px;font-size:.68rem;margin-left:6px;vertical-align:middle" onclick="fundEditOpeningBalance('${prefix}', ${Number(opening) || 0})" title="Correct opening balance"><i class="bi bi-pencil"></i></button>` : ''}
        </div>
      </div>
      <div class="kpi-card" style="border-left-color:var(--ok)"><div style="font-size:.75rem;color:var(--t3);font-weight:700;text-transform:uppercase">Total Income</div><div style="font-size:1.3rem;font-weight:800;margin-top:4px;color:var(--ok)">${fundMoney(income)}</div></div>
      <div class="kpi-card" style="border-left-color:#dc2626"><div style="font-size:.75rem;color:var(--t3);font-weight:700;text-transform:uppercase">Total Expenses</div><div style="font-size:1.3rem;font-weight:800;margin-top:4px;color:#dc2626">${fundMoney(expenses)}</div></div>
      <div class="kpi-card" style="border-left-color:var(--brand)"><div style="font-size:.75rem;color:var(--t3);font-weight:700;text-transform:uppercase">Closing Balance</div><div style="font-size:1.3rem;font-weight:800;margin-top:4px;color:var(--brand)">${fundMoney(closing)}</div></div>
    </div>`;
}
