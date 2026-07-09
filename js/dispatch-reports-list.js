/**
 * Report Dispatch System — Reports list.
 * Non-admins see their own dispatch history; admins see every report
 * from every user, per the stored (view-only) Drive links.
 */

async function loadMyDispatchReports() {
  const isAdmin = String(currentUser.role || '').toLowerCase() === 'admin';
  let query = _sb.from('dispatch_reports').select('*').order('created_at', { ascending: false }).limit(200);
  // Admins get everything automatically via RLS (is_admin() OR sender_id
  // = auth.uid() in the policy) — no extra filter needed either way.
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
    body.innerHTML = '<div style="padding:30px;text-align:center;color:var(--t3)">No reports yet.</div>';
    return;
  }

  const statusBadge = (s) => {
    const map = {
      sent: ['var(--ok)', 'Sent'], sending: ['var(--warn)', 'Sending…'],
      partial: ['var(--warn)', 'Partially Sent'], failed: ['var(--bad)', 'Failed'], draft: ['var(--t3)', 'Draft'],
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
        </tr>
      </thead>
      <tbody>
        ${reports.map(r => `
          <tr style="border-bottom:1px solid var(--b0)">
            <td style="padding:8px;font-family:var(--mono)">${escHtml(r.dispatch_number)}</td>
            <td style="padding:8px">${escHtml(r.report_date)}</td>
            ${isAdmin ? `<td style="padding:8px">${escHtml(r.sender_name)}<div style="font-size:.72rem;color:var(--t3)">${escHtml(r.sender_markaz)}</div></td>` : ''}
            <td style="padding:8px">${(r.recipients || []).map(x => escHtml(x.name)).join(', ')}</td>
            <td style="padding:8px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.description)}">${escHtml(r.description)}</td>
            <td style="padding:8px">${statusBadge(r.status)}</td>
            <td style="padding:8px">
              ${r.drive_file_link ? `<a href="${r.drive_file_link}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i> View</a>` : '—'}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function openDispatchReportsView() {
  if (typeof switchGlobalTab === 'function') switchGlobalTab('dispatchReportsView', null);
  loadMyDispatchReports();
}

async function loadDispatchKpiCount() {
  const el = document.getElementById('kpiDispatchSent');
  if (!el) return;
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
  const { count, error } = await _sb
    .from('dispatch_reports')
    .select('id', { count: 'exact', head: true })
    .eq('sender_id', currentUser.id)
    .in('status', ['sent', 'partial'])
    .gte('created_at', yearStart);
  el.textContent = error ? '—' : (count ?? 0);
}
