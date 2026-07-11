/**
 * Report Dispatch System — Reports list.
 * Every user searches/downloads/deletes reports within their own
 * jurisdiction (the reports they sent); admins see and manage every
 * report from every user via RLS (is_admin() OR sender_id = auth.uid()
 * in the select policy — no extra filter needed client-side for that
 * part). Deletion always goes through the delete_dispatch_report RPC
 * so the dispatch-number reclaim rule can never be bypassed.
 */

let _drFilterTimer = null;
function _debouncedLoadDispatchReports() {
  clearTimeout(_drFilterTimer);
  _drFilterTimer = setTimeout(loadMyDispatchReports, 350);
}

function _clearDispatchReportFilters() {
  document.getElementById('dr_filterDateFrom').value = '';
  document.getElementById('dr_filterDateTo').value = '';
  document.getElementById('dr_filterDispatchNo').value = '';
  document.getElementById('dr_filterOffice').value = '';
  loadMyDispatchReports();
}

async function loadMyDispatchReports() {
  const isAdmin = String(currentUser.role || '').toLowerCase() === 'admin';

  const dateFrom = document.getElementById('dr_filterDateFrom')?.value;
  const dateTo = document.getElementById('dr_filterDateTo')?.value;
  const dispatchNo = document.getElementById('dr_filterDispatchNo')?.value.trim();
  const office = document.getElementById('dr_filterOffice')?.value.trim();

  let query = _sb.from('dispatch_reports').select('*').order('created_at', { ascending: false }).limit(200);
  // Admins get everything automatically via RLS; everyone else's SELECT
  // policy already scopes rows to sender_id = auth.uid() — that IS their
  // jurisdiction filter, since dispatch numbering is per-Markaz/per-sender.
  if (dateFrom) query = query.gte('report_date', dateFrom);
  if (dateTo) query = query.lte('report_date', dateTo);
  if (dispatchNo) query = query.ilike('dispatch_number', `%${dispatchNo}%`);
  if (office) query = query.ilike('recipient_offices', `%${office}%`);

  const { data, error } = await query;
  if (error) {
    showToast('Failed to load reports: ' + error.message, false);
    return;
  }
  renderDispatchReportsList(data || [], isAdmin);
}

function renderDispatchReportsList(reports, isAdmin) {
  const body = document.getElementById('dispatchReportsListBody');
  if (!body) return;

  if (!reports.length) {
    body.innerHTML = '<div style="padding:30px;text-align:center;color:var(--t3)">No reports match your filters.</div>';
    return;
  }

  const statusBadge = (s) => {
    const map = {
      sent: ['var(--ok)', 'Sent'], sending: ['var(--warn)', 'Sending…'],
      partial: ['var(--warn)', 'Partially Sent'], failed: ['var(--bad)', 'Failed'],
      draft: ['var(--t3)', 'Draft'], imported: ['var(--t3)', 'Imported'],
    };
    const [color, label] = map[s] || ['var(--t3)', s];
    return `<span style="color:${color};font-weight:700;font-size:.75rem">● ${label}</span>`;
  };

  body.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:.85rem">
      <thead>
        <tr style="border-bottom:2px solid var(--b0);text-align:left">
          <th style="padding:8px">Dispatch No.</th>
          <th style="padding:8px">Date</th>
          ${isAdmin ? '<th style="padding:8px">Sender</th>' : ''}
          <th style="padding:8px">Sent To</th>
          <th style="padding:8px">Description</th>
          <th style="padding:8px">Status</th>
          <th style="padding:8px">Report</th>
          <th style="padding:8px"></th>
        </tr>
      </thead>
      <tbody>
        ${reports.map(r => `
          <tr style="border-bottom:1px solid var(--b0)" id="drRow_${r.id}">
            <td style="padding:8px;font-family:var(--mono)">${escHtml(r.dispatch_number)}</td>
            <td style="padding:8px">${escHtml(r.report_date)}</td>
            ${isAdmin ? `<td style="padding:8px">${escHtml(r.sender_name)}<div style="font-size:.72rem;color:var(--t3)">${escHtml(r.sender_markaz)}</div></td>` : ''}
            <td style="padding:8px">${(r.recipients || []).map(x => escHtml(x.name)).join(', ')}</td>
            <td style="padding:8px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.description)}">${escHtml(r.description)}</td>
            <td style="padding:8px">${statusBadge(r.status)}</td>
            <td style="padding:8px">
              ${r.drive_file_link ? `<a href="${r.drive_file_link}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i> View / Download</a>` : '—'}
            </td>
            <td style="padding:8px">
              ${(isAdmin || r.sender_id === currentUser.id)
                ? `<button class="tbl-btn" style="border-color:var(--bad);color:var(--bad);background:var(--bad-bg)" onclick="deleteDispatchReport('${r.id}','${escHtml(r.dispatch_number)}')" title="Delete"><i class="bi bi-trash"></i></button>`
                : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function deleteDispatchReport(id, dispatchNumber) {
  if (!confirm(`Delete report ${dispatchNumber}? This removes it from the register permanently. The dispatch number is only reused if this was the most recent one for its Markaz/year.`)) return;

  const { data, error } = await _sb.rpc('delete_dispatch_report', { p_report_id: id });
  if (error) { showToast('Failed to delete: ' + error.message, false); return; }
  if (!data || !data.success) { showToast(data?.message || 'Failed to delete report.', false); return; }

  showToast(
    data.reclaimed
      ? `Report ${dispatchNumber} deleted — that dispatch number is now free for the next report.`
      : `Report ${dispatchNumber} deleted.`,
    true
  );
  loadMyDispatchReports();
}

function openDispatchReportsView() {
  if (typeof switchGlobalTab === 'function') switchGlobalTab('dispatchReportsView', null);
  loadMyDispatchReports();
}
