// ── Script module JS ──
// =====================================================================
//  GLOBALS
// =====================================================================
let activeFixedMenu  = null;
let currentSheetView = 'Staff';
let schoolCache      = [];      // [{d,w,t,m,e}] — EMIS always in .e, from Schools col E
let sheetDataCache   = {};
// { sheetName: { headers, rows } }
let filteredResults  = [];
let currentHeaders   = [];
const PAGE_SIZE = 100;
let currentPage = 1;

// =====================================================================
//  GLOBAL SAFETY NET
//  Ensures the UI never gets stuck on a blank/frozen screen after an
//  uncaught error (e.g. inside a google.script.run handler).
// =====================================================================
window.addEventListener('error', function (e) {
  try { hideLoading(); } catch (_e) {}
  try { closeFixedMenu(); } catch (_e) {}
  showToast('Unexpected error: ' + (e && e.message ? e.message : 'unknown error'), 'error');
});
window.addEventListener('unhandledrejection', function (e) {
  try { hideLoading(); } catch (_e) {}
  var msg = (e && e.reason && e.reason.message) ? e.reason.message : 'unknown error';
  showToast('Unexpected error: ' + msg, 'error');
});
// =====================================================================
//  INIT
// =====================================================================
window.addEventListener('DOMContentLoaded', () => {
  initSchoolCache();

  document.querySelectorAll('.view-btn').forEach(b => {
    b.addEventListener('click', function () {
      document.querySelectorAll('.view-btn').forEach(x => x.classList.remove('active'));
      this.classList.add('active');
      currentSheetView = this.dataset.sheet;
      currentPage = 1;
      resetFilterUI();
      showEmptyState('Select filters and click Apply Filter to load records.');
    });
  });

  document.getElementById('filterBtn').addEventListener('click', applyFilter);
  document.getElementById('clearBtn').addEventListener('click', clearFilters);
  document.getElementById('addStaffBtn').addEventListener('click', () => openAddStaffModal());

  document.getElementById('filterDistrict').addEventListener('change', onDistrictChange);
  document.getElementById('filterWing').addEventListener('change', onWingChange);
  document.getElementById('filterTehsil').addEventListener('change', onTehsilChange);

  document.addEventListener('click', e => {
    if (activeFixedMenu && !e.target.closest('.fixed-menu') && !e.target.closest('.action-menu-btn'))
      closeFixedMenu();
  });
  window.addEventListener('scroll', closeFixedMenu, { passive: true });
  window.addEventListener('resize', closeFixedMenu, { passive: true });

  resetFilterUI();
  showEmptyState('Select filters above and click Apply Filter to load records.');
});
// =====================================================================
//  TOAST
// =====================================================================
function showToast(msg, type = 'info', duration = 3500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// =====================================================================
//  SCHOOL CACHE & DROPDOWNS
//  Schools sheet: A=District B=Wing C=Tehsil D=Markaz E=EMIS (col E, always)
// =====================================================================
function initSchoolCache() {
  const cached = sessionStorage.getItem('schoolHierarchy');
  if (cached) {
    try { schoolCache = JSON.parse(cached); } catch (e) { schoolCache = []; }
    buildDistrictDropdown();
  } else {
    google.script.run
      .withFailureHandler(err => showToast('Failed to load school list: ' + err.message, 'error'))
      .withSuccessHandler(data => {
        schoolCache = data || [];
        sessionStorage.setItem('schoolHierarchy', JSON.stringify(schoolCache));
        buildDistrictDropdown();
      }).getSchoolHierarchy();
  }
}

function buildDistrictDropdown() {
  const dists = [...new Set(schoolCache.map(x => x.d).filter(Boolean))].sort();
  populateSelect('filterDistrict', dists, 'All Districts');
  // Guard each element — they only exist when the HR/Staff view is open
  const _s = id => document.getElementById(id);
  if (_s('filterDistrict')) _s('filterDistrict').disabled = false;
  if (_s('filterEmis'))     _s('filterEmis').disabled     = false;
  if (_s('filterKeyword'))  _s('filterKeyword').disabled  = false;
  if (_s('filterBtn'))      _s('filterBtn').disabled      = false;
  if (_s('clearBtn'))       _s('clearBtn').disabled       = false;
  if (_s('addStaffBtn'))    _s('addStaffBtn').classList.toggle('hidden', currentSheetView !== 'Staff');
}

function onDistrictChange() {
  const d = document.getElementById('filterDistrict').value;
  resetSelect('filterWing',   'All Wings',   true);
  resetSelect('filterTehsil', 'All Tehsils', true);
  resetSelect('filterMarkaz', 'All Markazs', true);
  if (d) {
    const wings = [...new Set(schoolCache.filter(x => x.d === d).map(x => x.w).filter(Boolean))].sort();
    populateSelect('filterWing', wings, 'All Wings');
    document.getElementById('filterWing').disabled = false;
  }
}

function onWingChange() {
  const d = document.getElementById('filterDistrict').value;
  const w = document.getElementById('filterWing').value;
  resetSelect('filterTehsil', 'All Tehsils', true);
  resetSelect('filterMarkaz', 'All Markazs', true);
  if (w) {
    const tehsils = [...new Set(schoolCache.filter(x => x.d === d && x.w === w).map(x => x.t).filter(Boolean))].sort();
    populateSelect('filterTehsil', tehsils, 'All Tehsils');
    document.getElementById('filterTehsil').disabled = false;
  }
}

function onTehsilChange() {
  const d = document.getElementById('filterDistrict').value;
  const w = document.getElementById('filterWing').value;
  const t = document.getElementById('filterTehsil').value;
  resetSelect('filterMarkaz', 'All Markazs', true);
  if (t) {
    const markazs = [...new Set(schoolCache.filter(x => x.d === d && x.w === w && x.t === t).map(x => x.m).filter(Boolean))].sort();
    populateSelect('filterMarkaz', markazs, 'All Markazs');
    document.getElementById('filterMarkaz').disabled = false;
  }
}

function populateSelect(id, values, placeholder) {
  const sel = document.getElementById(id);
  if (!sel) return;  // element not in current view — skip silently
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    values.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
}

function resetSelect(id, placeholder, disable = false) {
  const sel = document.getElementById(id);
  if (!sel) return;  // element not in current view — skip silently
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  sel.disabled  = disable;
}

function resetFilterUI() {
  resetSelect('filterWing',   'All Wings',   true);
  resetSelect('filterTehsil', 'All Tehsils', true);
  resetSelect('filterMarkaz', 'All Markazs', true);
  document.getElementById('filterEmis').value    = '';
  document.getElementById('filterKeyword').value = '';
  buildDistrictDropdown();
  document.getElementById('addStaffBtn').classList.toggle('hidden', currentSheetView !== 'Staff');
}

function clearFilters() {
  resetFilterUI();
  filteredResults = [];
  currentPage     = 1;
  showEmptyState('Filters cleared. Apply Filter to load records.');
}

// =====================================================================
//  APPLY FILTER
// =====================================================================
function applyFilter() {
  const sheet = currentSheetView;
  currentPage = 1;
  if (sheetDataCache[sheet]) {
    runClientFilter(sheet);
  } else {
    showLoading();
    google.script.run
      .withFailureHandler(err => { hideLoading(); showToast('Server error: ' + err.message, 'error'); })
      .withSuccessHandler(res => {
        hideLoading();
        if (res.error) { showToast('Error: ' + res.error, 'error'); return; }
        sheetDataCache[sheet] = { headers: res.headers, rows: res.rows };
        currentHeaders        = res.headers;
        runClientFilter(sheet);
      }).loadSheetForClient(sheet);
  }
}

function runClientFilter(sheet) {
  const cache = sheetDataCache[sheet];
  if (!cache || !cache.rows.length) {
    showEmptyState('No records found in this sheet.');
    return;
  }
  currentHeaders = cache.headers;

  const fDistrict = document.getElementById('filterDistrict').value.trim().toLowerCase();
  const fWing     = document.getElementById('filterWing').value.trim().toLowerCase();
  const fTehsil   = document.getElementById('filterTehsil').value.trim().toLowerCase();
  const fMarkaz   = document.getElementById('filterMarkaz').value.trim().toLowerCase();
  const fEmis     = document.getElementById('filterEmis').value.trim().toLowerCase();
  const fKeyword  = document.getElementById('filterKeyword').value.trim().toLowerCase();

  filteredResults = cache.rows.filter(row => {
    if (fDistrict && (row._district || '').toLowerCase() !== fDistrict) return false;
    if (fWing     && (row._wing     || '').toLowerCase() !== fWing)     return false;
    if (fTehsil   && (row._tehsil   || '').toLowerCase() !== fTehsil)   return false;

    if (fMarkaz) {
      const rowMarkaz = ((row._markaz || '') + ' ' + (row['MARKAZ NAME'] || '')).toLowerCase();
      if (!rowMarkaz.includes(fMarkaz)) return false;
    }

    if (fEmis) {
      const emisVal = safeVal(row['SCHOOL EMIS CODE']);
      if (!emisVal.toLowerCase().includes(fEmis)) return false;
    }

    if (fKeyword) {
      const allText = cache.headers.map(h => safeVal(row[h])).join(' ').toLowerCase();
      if (!allText.includes(fKeyword)) return false;
    }

    return true;
  });
  renderTable();
}

function safeVal(v) {
  if (v === null || v === undefined) return '';
  return v.toString();
}

// =====================================================================
//  RENDER TABLE
// =====================================================================
function renderTable() {
  const container = document.getElementById('resultsContainer');
  if (!filteredResults.length) {
    showEmptyState('No records match the current filters.');
    return;
  }

  const totalPages = Math.ceil(filteredResults.length / PAGE_SIZE);
  const start      = (currentPage - 1) * PAGE_SIZE;
  const pageRows   = filteredResults.slice(start, start + PAGE_SIZE);

  const headerCells = currentHeaders.map(h => `<th title="${escHtml(h)}">${escHtml(h)}</th>`).join('');
  const bodyRows    = pageRows.map((row, idx) => {
    const globalIdx = start + idx;
    const cells = currentHeaders.map(h => {
      const v = safeVal(row[h]);
      return `<td title="${escHtml(v)}">${escHtml(formatValue(row[h]))}</td>`;
    }).join('');
    return `<tr><td class="actions-col"><button class="action-menu-btn" data-idx="${globalIdx}">☰</button></td>${cells}</tr>`;
  }).join('');
  container.innerHTML = `
    <div class="export-bar">
      <span class="result-count">${filteredResults.length} record${filteredResults.length !== 1 ? 's' : ''} found
        ${filteredResults.length > PAGE_SIZE ? ` &nbsp;·&nbsp; Page ${currentPage} / ${totalPages}` : ''}
      </span>
      <div class="export-actions">
        <button class="export-btn" onclick="doExport('csv')">↓ CSV</button>
        <button class="export-btn" onclick="doExport('xlsx')">↓ Excel</button>
        <button class="export-btn" onclick="doExport('pdf')">↓ PDF</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th class="actions-col">☰</th>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    ${totalPages > 1 ? buildPagination(totalPages) : ''}
  `;
  container.querySelectorAll('.action-menu-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openFixedMenu(btn, parseInt(btn.dataset.idx));
    });
  });
}

function buildPagination(totalPages) {
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 2)
      pages.push(i);
    else if (pages[pages.length - 1] !== '…')
      pages.push('…');
  }
  const btns = pages.map(p => {
    if (p === '…') return `<span style="padding:0 4px;color:var(--text-light)">…</span>`;
    return `<button class="page-btn${p === currentPage ? ' active' : ''}" onclick="goPage(${p})">${p}</button>`;
  }).join('');
  return `<div class="pagination">
    <button class="page-btn" onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>‹ Prev</button>
    ${btns}
    <button class="page-btn" onclick="goPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>Next ›</button>
  </div>`;
}

window.goPage = function(p) {
  const totalPages = Math.ceil(filteredResults.length / PAGE_SIZE);
  if (p < 1 || p > totalPages) return;
  currentPage = p;
  renderTable();
  document.getElementById('resultsContainer').scrollIntoView({ behavior: 'smooth' });
};
function showEmptyState(msg) {
  document.getElementById('resultsContainer').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <p>${escHtml(msg)}</p>
      <small>Use the filters above and click Apply Filter.</small>
    </div>`;
  filteredResults = [];
}

function formatValue(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toLocaleDateString();
  return val.toString();
}

function escHtml(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =====================================================================
//  CONTEXT MENU
// =====================================================================
function openFixedMenu(button, idx) {
  closeFixedMenu();
  const isStaff = (currentSheetView === 'Staff');
  const menu    = document.createElement('div');
  menu.className = 'fixed-menu';

  let items = `<button class="action-item" onclick="handleAction('view',${idx})">👁 View Details</button>`;

  if (isStaff) {
    items += `
      <button class="action-item" onclick="handleAction('edit',${idx})">✏️ Edit Record</button>
      <button class="action-item" onclick="handleAction('transfer',${idx})">🔄 Transfer</button>
      <button class="action-item" onclick="handleAction('promotion',${idx})">⬆️ Promotion</button>
      <button class="action-item" onclick="handleAction('retirement',${idx})">🎓 Retirement</button>
      <button class="action-item" onclick="handleAction('resignation',${idx})">📝 Resignation</button>
      <button class="action-item" onclick="handleAction('termination',${idx})">🚫 Termination</button>
      <button class="action-item" onclick="handleAction('death',${idx})">✝️ Death Case</button>
      <button class="action-item danger" onclick="handleAction('delete',${idx})">🗑 Delete</button>
    `;
  } else {
    items += `<button class="action-item revert" onclick="handleAction('revert',${idx})">↩ Revert to Active Staff</button>`;
  }

  menu.innerHTML = items;
  document.body.appendChild(menu);

  const rect = button.getBoundingClientRect();
  let top  = rect.bottom + 4;
  let left = rect.left;
  menu.style.top  = top  + 'px';
  menu.style.left = left + 'px';

  const mRect = menu.getBoundingClientRect();
  if (mRect.bottom > window.innerHeight) menu.style.top  = (rect.top - mRect.height - 4) + 'px';
  if (mRect.right  > window.innerWidth)  menu.style.left = (rect.right - mRect.width)    + 'px';

  activeFixedMenu = menu;
}

function closeFixedMenu() {
  if (activeFixedMenu) { activeFixedMenu.remove(); activeFixedMenu = null; }
}

function handleAction(action, idx) {
  closeFixedMenu();
  const row = filteredResults[idx];

  if (action === 'view')       showDetailModal(row);
  if (action === 'edit')       openEditModal(row);
  if (action === 'transfer')   openTransferModal(row);
  // Promotion now has its own dedicated modal (defined in StaffForm.html)
  if (action === 'promotion')  openPromotionModal(row);
  // Retirement / Resignation / Death / Termination share the generic action form
  if (['retirement','death','resignation','termination'].includes(action))
    openActionFormModal(action, row);
  if (action === 'delete')     confirmDeleteRow(row);
  if (action === 'revert')     confirmRevert(row);
}
window.handleAction = handleAction;

// =====================================================================
//  VIEW DETAILS  (base — overridden by StaffForm.html for Staff sheet)
// =====================================================================
function showDetailModal(row) {
  const html = Object.keys(row)
    .filter(k => !k.startsWith('_'))
    .map(k => `
      <div class="detail-row">
        <span class="dr-label">${escHtml(k)}</span>
        <span class="dr-value">${escHtml(formatValue(row[k]))}</span>
      </div>`).join('');
  document.getElementById('detailModalBody').innerHTML = html;
  document.getElementById('modalTitle').textContent    = 'Staff Details';
  document.getElementById('detailModal').classList.remove('hidden');
}

// =====================================================================
//  EDIT RECORD  (base — overridden by StaffForm.html for Staff sheet)
// =====================================================================
function openEditModal(row) {
  const form = document.createElement('div');
  const html = Object.keys(row)
    .filter(k => !k.startsWith('_'))
    .map(k => `
      <div class="form-row">
        <label>${escHtml(k)}</label>
        <input type="text" data-field="${escHtml(k)}" value="${escHtml(formatValue(row[k]))}">
      </div>`).join('');
  form.innerHTML = html;

  const saveBtn = document.createElement('button');
  saveBtn.className   = 'primary-btn';
  saveBtn.style.width = '100%';
  saveBtn.textContent = 'Save Changes';
  saveBtn.onclick = () => {
    const updated = { _row: row._row };
    form.querySelectorAll('input[data-field]').forEach(inp => updated[inp.dataset.field] = inp.value);
    showLoading();
    google.script.run
      .withFailureHandler(err => { hideLoading(); showToast('Update failed: ' + err.message, 'error'); })
      .withSuccessHandler(res => {
        hideLoading();
        if (res.success) {
          showToast('Record updated successfully.', 'success');
          closeModal();
          invalidateCache(currentSheetView);
          applyFilter();
        } else {
          showToast('Error: ' + (res.error || 'Unknown'), 'error');
        }
      }).updateStaffRow(updated);
  };

  const body = document.getElementById('detailModalBody');
  body.innerHTML = '';
  body.appendChild(form);
  body.appendChild(saveBtn);
  document.getElementById('modalTitle').textContent = 'Edit Record';
  document.getElementById('detailModal').classList.remove('hidden');
}

// =====================================================================
//  ADD NEW STAFF  (base — overridden by StaffForm.html)
// =====================================================================
function openAddStaffModal() {
  showToast('Staff form module loading…', 'info');
}

// Stubs overridden by StaffForm.html
function openTransferModal(row) { showToast('Transfer module not loaded.', 'error'); }
function openPromotionModal(row) { showToast('Promotion module not loaded.', 'error'); }

// =====================================================================
//  GENERIC ACTION FORM: Retirement / Resignation / Death / Termination
// =====================================================================
function openActionFormModal(actionType, row) {
  const titles = {
    retirement: '🎓 Retirement',
    death:      '✝️ Death Case',
    resignation:'📝 Resignation',
    termination:'🚫 Termination'
  };
  document.getElementById('modalTitle').textContent =
    titles[actionType] + ' — ' + escHtml(row['NAME OF TEACHER'] || '');

  const form = document.createElement('div');
  const notifRequired = ['retirement','death','termination'].includes(actionType);
  form.innerHTML = `
    <div class="transfer-info-box" style="margin-bottom:18px">
      <strong>📋 Staff</strong>
      <div><b>Name:</b> ${escHtml(row['NAME OF TEACHER'] || '')} &nbsp;|&nbsp; <b>P.No:</b> ${escHtml(row['PERSONAL NO.'] || '')}</div>
      <div><b>Designation:</b> ${escHtml(row['DESIGNATION'] || '')} &nbsp;|&nbsp; <b>BPS:</b> ${escHtml(String(row['BPS'] || ''))}</div>
    </div>
    <div class="form-row">
      <label>Notification No.${notifRequired ? ' <span style="color:var(--danger)">*</span>' : ''}</label>
      <input id="af_notificationNo" placeholder="${notifRequired ? 'Required' : 'Optional — e.g. resignation letter ref'}">
      <div class="transfer-err" id="afe_notif"></div>
    </div>
    <div class="form-row">
      <label>Effective Date${notifRequired ? ' <span style="color:var(--danger)">*</span>' : ''}</label>
      <input type="date" id="af_effectiveDate">
      <div class="transfer-err" id="afe_date"></div>
    </div>
    <button class="primary-btn" id="af_submitBtn" style="width:100%;margin-top:12px">
      Submit ${titles[actionType].replace(/^[^ ]+ /, '')}
    </button>
  `;
  form.querySelector('#af_submitBtn').onclick = () => {
    const notifEl   = form.querySelector('#af_notificationNo');
    const dateEl    = form.querySelector('#af_effectiveDate');
    const notifErr  = form.querySelector('#afe_notif');
    const dateErr   = form.querySelector('#afe_date');

    notifEl.classList.remove('invalid');
    dateEl.classList.remove('invalid');
    notifErr.textContent = '';
    dateErr.textContent  = '';

    const notifNo       = (notifEl.value || '').trim();
    const effectiveDate = (dateEl.value  || '').trim();

    let ok = true;
    if (notifRequired && !notifNo) {
      notifErr.textContent = 'Notification No. is required for ' + actionType + '.';
      notifEl.classList.add('invalid');
      ok = false;
    }
    if (notifRequired && !effectiveDate) {
      dateErr.textContent = 'Effective Date is required for ' + actionType + '.';
      dateEl.classList.add('invalid');
      ok = false;
    }
    if (!ok) {
      showToast('Please fix the highlighted errors before submitting.', 'warning');
      return;
    }

    if (!confirm(`Confirm ${actionType} for ${row['NAME OF TEACHER']}?\n` +
                 `Notification: ${notifNo || '—'}\nEffective Date: ${effectiveDate || '—'}\n\n` +
                 `The record will be moved out of Active Staff.`)) return;
    showLoading();
    google.script.run
      .withFailureHandler(err => { hideLoading(); showToast('Action failed: ' + err.message, 'error'); })
      .withSuccessHandler(res => {
        hideLoading();
        if (res && res.success) {
          showToast(res.message || 'Action completed.', 'success');
          closeModal();
          invalidateCache(currentSheetView);
          invalidateCache(res.targetSheet || '');
          applyFilter();
        } else {
          showToast('Error: ' + (res && (res.errors ? res.errors.join(', ') : res.error) || 'Unknown'), 'error');
        }
      }).executeStaffAction({
        personalNo:     row['PERSONAL NO.'],
        actionType,
        effectiveDate,
        notificationNo: notifNo
      });
  };

  const body = document.getElementById('detailModalBody');
  body.innerHTML = '';
  body.appendChild(form);
  document.getElementById('detailModal').classList.remove('hidden');
}

// =====================================================================
//  DELETE
// =====================================================================
function confirmDeleteRow(row) {
  if (!confirm(`Delete ${row['NAME OF TEACHER'] || row['PERSONAL NO.']}?\nThis will archive the record.`)) return;
  showLoading();
  google.script.run
    .withFailureHandler(err => { hideLoading(); showToast('Delete failed: ' + err.message, 'error'); })
    .withSuccessHandler(res => {
      hideLoading();
      if (res && res.success) {
        showToast('Record archived.', 'success');
        invalidateCache(currentSheetView);
        invalidateCache('Deleted_Archive');
        applyFilter();
      } else {
        showToast('Error: ' + (res && res.error || 'Unknown'), 'error');
      }
    }).deleteStaffRow(row['PERSONAL NO.']);
}

// =====================================================================
//  REVERT
// =====================================================================
function confirmRevert(row) {
  const name = row['NAME OF TEACHER'] || row['PERSONAL NO.'] || 'this record';
  
  let msg = `Revert "${name}" back to Active Staff?\nThis removes the record from ${currentSheetView}.`;
  if (currentSheetView === 'Transfers_History' || currentSheetView === 'Promotions_History') {
    msg = `Undo this action for "${name}"?\nThis will overwrite their current Active Staff record with these previous details.`;
  }
  
  if (!confirm(msg)) return;
  showLoading();
  google.script.run
    .withFailureHandler(err => { hideLoading(); showToast('Revert failed: ' + err.message, 'error'); })
    .withSuccessHandler(res => {
      hideLoading();
      if (res && res.success) {
        showToast(res.message || 'Action reverted successfully.', 'success');
        invalidateCache(currentSheetView);
        invalidateCache('Staff');
        applyFilter();
      } else {
        showToast('Error: ' + (res && res.error || 'Unknown'), 'error');
      }
    }).revertToActiveStaff({
      personalNo:      row['PERSONAL NO.'],
      sourceSheetName: currentSheetView,
      rowNum:          row._row
    });
}

// =====================================================================
//  EXPORT
// =====================================================================
function doExport(type) {
  if (!filteredResults.length) { showToast('No data to export.', 'warning'); return; }
  showLoading();
  const exportRows = filteredResults.map(row => {
    const clean = {};
    currentHeaders.forEach(h => { clean[h] = row[h] !== undefined ? row[h] : ''; });
    return clean;
  });
  google.script.run
    .withFailureHandler(err => { hideLoading(); showToast('Export failed: ' + err.message, 'error'); })
    .withSuccessHandler(res => {
      hideLoading();
      if (res.error) { showToast(res.error, 'error'); return; }
      const bytes = Uint8Array.from(atob(res.base64), c => c.charCodeAt(0));
      const a     = document.createElement('a');
      a.href       = URL.createObjectURL(new Blob([bytes], { type: res.mimeType }));
      a.download   = res.filename;
      a.click();
      showToast('Export ready.', 'success');
    }).generateExport(currentHeaders, exportRows, type, currentSheetView.toLowerCase() + '_export');
}

// =====================================================================
//  CACHE
// =====================================================================
function invalidateCache(sheetName) {
  if (sheetName) delete sheetDataCache[sheetName];
}

// =====================================================================
//  MODAL HELPERS
// =====================================================================
function closeModal()        { document.getElementById('detailModal').classList.add('hidden'); }
function showLoading()       { document.getElementById('loadingOverlay').classList.remove('hidden'); }
function hideLoading()       { document.getElementById('loadingOverlay').classList.add('hidden'); }
