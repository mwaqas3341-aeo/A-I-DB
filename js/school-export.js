// ═══════════════════════════════════════════════════════════════════
//  SCHOOL LIST EXPORT — "which list do you want?" dialog
//  Categories: SED · PEF · PIEMA · Private Schools · Private Academies · Outsourced
//  Every exported school list carries a "Category" column right after "School Name".
//  One Excel workbook is produced, one sheet per ticked list.
//  Data comes from the getSchoolExportData API action (already filtered to the
//  logged-in user's jurisdiction), so users only ever download their own schools.
// ═══════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  const CATS = [
    { key: 'SED',             label: 'SED (Govt / Public)',  sum: 'sed' },
    { key: 'PEF',             label: 'PEF Schools',          sum: 'pef' },
    { key: 'PIEMA',           label: 'PIEMA Schools',        sum: 'piema' },
    { key: 'PRIVATE_SCHOOL',  label: 'Private Schools',      sum: 'privateSchools' },
    { key: 'PRIVATE_ACADEMY', label: 'Private Academies',    sum: 'academies' },
    { key: 'OUTSOURCED',      label: 'Outsourced Schools',   sum: 'outsourced' },
  ];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, ok) => { if (typeof showToast === 'function') showToast(m, ok === undefined ? true : ok); else alert(m); };

  // Insert "Category" after "School Name" in a client-side grid (array of objects keyed by header)
  function addCategory(headers, objRows, catFn) {
    let idx = headers.findIndex(h => /^school\s*name$/i.test(String(h).trim()));
    idx = idx >= 0 ? idx + 1 : 1;
    const h2 = [...headers.slice(0, idx), 'Category', ...headers.slice(idx)];
    const rows = objRows.map(r => Object.assign({}, r, { Category: catFn(r) }));
    return { headers: h2, rows };
  }

  function sheetName(label, used) {
    let n = label.replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Sheet';
    let k = 1; while (used.has(n.toLowerCase())) n = n.slice(0, 28) + '_' + (++k);
    used.add(n.toLowerCase()); return n;
  }

  function writeWorkbook(sheets, fileBase) {
    if (typeof XLSX === 'undefined') { toast('Excel library not loaded.', false); return; }
    const wb = XLSX.utils.book_new(), used = new Set();
    sheets.forEach(sh => {
      const aoa = [sh.headers, ...sh.rows];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = sh.headers.map((h, i) => ({ wch: Math.min(Math.max(String(h).length, ...sh.rows.slice(0, 300).map(r => String(r[i] == null ? '' : r[i]).length)) + 2, 50) }));
      XLSX.utils.book_append_sheet(wb, ws, sheetName(sh.label, used));
    });
    XLSX.writeFile(wb, fileBase.replace(/[^A-Za-z0-9_\-]/g, '_') + '.xlsx');
  }

  function ensureModal() {
    let el = document.getElementById('schoolExportModal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'schoolExportModal';
    el.className = 'modal fade';
    el.tabIndex = -1;
    el.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-hdr">
            <div class="modal-hdr-icon"><i class="bi bi-file-earmark-excel"></i></div>
            <div style="flex:1"><div class="modal-hdr-title">Download School Lists</div></div>
            <button class="btn-mclose" data-bs-dismiss="modal"><i class="bi bi-x-lg"></i></button>
          </div>
          <div class="modal-bdy">
            <div style="font-size:.82rem;color:var(--t2);margin-bottom:10px">
              Tick the list(s) you want. Each list becomes a sheet in one Excel file, with a <b>Category</b> column after School Name.
              Users only receive schools inside their own jurisdiction; admins can choose.
            </div>
            <div id="seScopeBox" style="display:none;margin-bottom:12px;padding:10px 12px;border:1px solid var(--brand);background:var(--brand-light);border-radius:8px">
              <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin:0">
                <input type="checkbox" id="seMine" style="width:18px;height:18px;margin-top:2px">
                <span><b>Only my jurisdiction</b><br><span id="seMineHint" style="font-size:.75rem;color:var(--t2)"></span></span>
              </label>
            </div>
            <div id="seList" style="display:flex;flex-direction:column;gap:8px"></div>
            <div style="margin-top:10px"><a href="#" id="seAll" style="font-size:.78rem">Select all</a> · <a href="#" id="seNone" style="font-size:.78rem">Clear</a></div>
          </div>
          <div class="modal-ftr" style="gap:8px;flex-wrap:wrap">
            <button class="btn-cancel" data-bs-dismiss="modal">Cancel</button>
            <button class="btn-cancel" id="seFiltered" style="display:none">Current filtered view</button>
            <button class="btn-save" id="seGo"><i class="bi bi-download"></i> Download</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#seAll').onclick  = e => { e.preventDefault(); el.querySelectorAll('#seList input').forEach(i => { i.checked = true; }); };
    el.querySelector('#seNone').onclick = e => { e.preventDefault(); el.querySelectorAll('#seList input').forEach(i => { i.checked = false; }); };
    return el;
  }

  /**
   * open({ preselect:['SED'], filtered:{ headers, rows:[objects], name, category } })
   */
  function open(opts) {
    opts = opts || {};
    const el = ensureModal();
    const pre = new Set(opts.preselect || []);
    const u = (typeof currentUser !== 'undefined' && currentUser) || {};
    const isAdmin = String(u.role || '').toLowerCase() === 'admin';
    // Admins would otherwise download every school in the system → offer "only my jurisdiction" (ticked by default).
    const place = [u.district, u.wing, u.tehsil, u.markaz_name || u.markaz].filter(Boolean).join(' › ');
    const hasPlace = !!place || (!!u.scope_type && !!u.scope_value);
    const box = el.querySelector('#seScopeBox'), mine = el.querySelector('#seMine');
    box.style.display = isAdmin ? '' : 'none';
    mine.disabled = !hasPlace;
    mine.checked = isAdmin && hasPlace;
    el.querySelector('#seMineHint').textContent = hasPlace
      ? ('Your posting: ' + (place || 'extra scope only') + (u.scope_type && u.scope_value ? ' + ' + u.scope_type + ' scope' : '') + '. Untick to download the whole system.')
      : 'No district / wing / tehsil / markaz is assigned to your profile, so the whole system will be exported.';
    const drawList = () => {
      const sum = (isAdmin && mine.checked ? root._schoolSummaryMine : root._schoolSummary) || {};
      const checked = new Set([...el.querySelectorAll('#seList input:checked')].map(i => i.value));
      const first = !el.querySelector('#seList input');
      el.querySelector('#seList').innerHTML = CATS.map(c => {
        const n = sum[c.sum];
        return `<label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--b0);border-radius:8px;cursor:pointer">
          <input type="checkbox" value="${c.key}" ${(first ? pre.has(c.key) : checked.has(c.key)) ? 'checked' : ''} style="width:18px;height:18px">
          <span style="flex:1;font-weight:600">${esc(c.label)}</span>
          ${n == null ? '' : `<span class="count-chip" style="font-family:var(--mono)">${n}</span>`}</label>`;
      }).join('');
    };
    mine.onchange = drawList;
    drawList();
    if (isAdmin && hasPlace && !root._schoolSummaryMine) {
      google.script.run.withSuccessHandler(r => { if (r && r.success) { root._schoolSummaryMine = r; drawList(); } })
        .getSchoolSummary([u, { myJurisdictionOnly: true }]);
    }
    const fBtn = el.querySelector('#seFiltered');
    if (opts.filtered && opts.filtered.rows && opts.filtered.rows.length) {
      fBtn.style.display = '';
      fBtn.onclick = () => {
        const f = opts.filtered, catFn = f.perRow ? (r => /academy/i.test(String(r['School Category'] || '')) ? 'Private Academy' : 'Private School') : (() => f.category);
        const out = addCategory(f.headers, f.rows, catFn);
        const rows2d = out.rows.map(r => out.headers.map(h => r[h] !== undefined ? r[h] : ''));
        writeWorkbook([{ label: f.name || f.category, headers: out.headers, rows: rows2d }], (f.name || f.category) + '_filtered');
        bootstrap.Modal.getInstance(el).hide();
      };
    } else fBtn.style.display = 'none';

    const go = el.querySelector('#seGo');
    go.disabled = false;
    go.onclick = () => {
      const mine = el.querySelector('#seMine');
      const keys = [...el.querySelectorAll('#seList input:checked')].map(i => i.value);
      if (!keys.length) { toast('Select at least one school list.', false); return; }
      go.disabled = true; go.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Preparing…';
      google.script.run
        .withSuccessHandler(res => {
          go.disabled = false; go.innerHTML = '<i class="bi bi-download"></i> Download';
          if (!res || !res.success) { toast('Export failed: ' + (res && res.message || 'unknown error'), false); return; }
          const sheets = (res.sheets || []).filter(s => s.rows.length);
          const empty = (res.sheets || []).filter(s => !s.rows.length).map(s => s.label);
          if (!sheets.length) { toast('No schools found in the selected list(s).', false); return; }
          const day = new Date().toISOString().slice(0, 10);
          writeWorkbook(sheets, sheets.length === 1 ? sheets[0].label + '_' + day : 'School_Lists_' + day);
          if (empty.length) toast('No schools in: ' + empty.join(', '), false);
          bootstrap.Modal.getInstance(el).hide();
        })
        .withFailureHandler(err => { go.disabled = false; go.innerHTML = '<i class="bi bi-download"></i> Download'; toast('Export error: ' + err.message, false); })
        .getSchoolExportData([typeof currentUser !== 'undefined' ? currentUser : null, keys, { myJurisdictionOnly: !!(mine && mine.checked && !mine.disabled) }]);
    };
    bootstrap.Modal.getOrCreateInstance(el).show();
  }

  root.SchoolExport = { open, addCategory, writeWorkbook, CATS };
})(window);
