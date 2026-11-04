// ═══════════════════════════════════════════════════════════════════
//  VISIT PLANNER — "Actual Visits" card
//  The user only enters EMIS code(s) + a date for each visit actually made.
//  School name / Markaz / Tehsil / Wing are filled in by the database
//  (trigger visit_actual_entry_validate, using the jurisdiction pool).
//  Any date can also be marked "On Leave" or "Other Duty" (with a comment).
//  Own tables: visit_actual_plans / visit_actual_entries (RLS: own rows).
//  Downloads (Excel / print) are headed "ACTUAL SCHOOL VISITS FOR <MONTH YEAR>".
//  Depends on window.VisitPlannerCore, VisitPlannerShared, VisitPlannerExcel.
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const C = window.VisitPlannerCore;
  const MAX_PER_DAY = 2;                       // two slots per day, as in the official template

  const A = { el: null, built: false, userId: null, year: new Date().getFullYear(), month: new Date().getMonth() + 1,
              plan: null, entries: [], queue: Promise.resolve() };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'info'); };
  const sb = () => window._supabase;
  const sh = () => window.VisitPlannerShared;
  const fmtDate = s => { const [y, m, d] = s.split('-').map(Number); return `${String(d).padStart(2, '0')} ${C.MONTH_NAMES[m - 1].slice(0, 3)} ${y}`; };
  const enqueue = fn => (A.queue = A.queue.then(fn, fn).catch(e => { console.error(e); toast(e.message || 'Operation failed', 'error'); }));
  const isSpecial = e => !!e && (e.entry_type === 'leave' || e.entry_type === 'other_duty');
  const specialText = e => e.entry_type === 'leave' ? 'ON LEAVE' : 'OTHER DUTY' + (e.comment ? ': ' + e.comment : '');

  // ─── Data ─────────────────────────────────────────────────────────
  async function load() {
    A.year = parseInt($('vaYear').value, 10); A.month = parseInt($('vaMonth').value, 10);
    if (!(A.year >= 1900 && A.year <= 2200)) { toast('Enter a valid year', 'error'); return; }
    $('vaStatus').innerHTML = '<span class="vp-muted">Loading…</span>';
    const { data: p, error } = await sb().from('visit_actual_plans').select('*').eq('user_id', A.userId).eq('year', A.year).eq('month', A.month).maybeSingle();
    if (error) { toast(error.message, 'error'); return; }
    A.plan = p || null; A.entries = [];
    if (p) {
      const { data, error: e2 } = await sb().from('visit_actual_entries').select('*').eq('plan_id', p.id).order('visit_date').order('slot');
      if (e2) { toast(e2.message, 'error'); return; }
      A.entries = data || [];
      if (p.markaz_label) $('vaMarkazLabel').value = p.markaz_label;
    }
    const mn = C.MONTH_NAMES[A.month - 1];
    $('vaDate').min = C.iso(A.year, A.month, 1); $('vaDate').max = C.iso(A.year, A.month, C.daysInMonth(A.year, A.month));
    if (!$('vaDate').value || $('vaDate').value.slice(0, 7) !== `${A.year}-${String(A.month).padStart(2, '0')}`) $('vaDate').value = C.iso(A.year, A.month, 1);
    $('vaStatus').innerHTML = `<strong>${mn} ${A.year}</strong> <span class="vp-muted">· ${A.plan ? 'saved' : 'no actual visits recorded yet'}</span>`;
    render();
  }

  async function ensurePlan() {
    if (A.plan) return A.plan;
    const { data, error } = await sb().from('visit_actual_plans').insert({ user_id: A.userId, year: A.year, month: A.month }).select().single();
    if (error) throw error; A.plan = data; return data;
  }

  const byDate = () => {
    const m = new Map();
    A.entries.forEach(e => { if (!m.has(e.visit_date)) m.set(e.visit_date, []); m.get(e.visit_date).push(e); });
    m.forEach(v => v.sort((a, b) => a.slot - b.slot));
    return new Map([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  };

  // ─── Add / remove ─────────────────────────────────────────────────
  function parseCodes(txt) { return [...new Set(String(txt || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean))]; }

  function onAdd() {
    return enqueue(async () => {
      const type = $('vaType').value, date = $('vaDate').value;
      if (!date) { toast('Select a date.', 'error'); return; }
      if (+date.slice(0, 4) !== A.year || +date.slice(5, 7) !== A.month) { toast(`The date must be inside ${C.MONTH_NAMES[A.month - 1]} ${A.year}.`, 'error'); return; }
      const onDay = A.entries.filter(e => e.visit_date === date);

      if (type !== 'school') {
        if (onDay.length) { toast(`${fmtDate(date)} already has ${isSpecial(onDay[0]) ? 'an entry' : 'school visits'}. Remove it first.`, 'error'); return; }
        const comment = $('vaComment').value.trim().slice(0, 500) || null;
        await ensurePlan();
        const { data, error } = await sb().from('visit_actual_entries').insert({ plan_id: A.plan.id, user_id: A.userId, visit_date: date, slot: 1, entry_type: type, comment: type === 'other_duty' ? comment : null }).select().single();
        if (error) throw error;
        A.entries.push(data); $('vaComment').value = '';
        render(); toast(type === 'leave' ? 'Marked as On Leave.' : 'Other Duty added.', 'success');
        return;
      }

      const codes = parseCodes($('vaEmis').value);
      if (!codes.length) { toast('Enter at least one EMIS code.', 'error'); return; }
      if (onDay.some(isSpecial)) { toast(`${fmtDate(date)} is marked as ${onDay[0].entry_type === 'leave' ? 'On Leave' : 'Other Duty'}. Remove it first.`, 'error'); return; }
      const pool = sh().getPool().emis;
      const bad = [], dup = [], over = [], added = [];
      await ensurePlan();
      for (const code of codes) {
        if (!pool.has(code)) { bad.push(code); continue; }
        const used = A.entries.filter(e => e.visit_date === date);
        if (used.some(e => e.emis_code === code)) { dup.push(code); continue; }
        const slot = [1, 2].find(n => !used.some(e => e.slot === n));
        if (!slot) { over.push(code); continue; }
        const { data, error } = await sb().from('visit_actual_entries').insert({ plan_id: A.plan.id, user_id: A.userId, visit_date: date, slot, entry_type: 'school', emis_code: code }).select().single();
        if (error) { toast(`${code}: ${error.message}`, 'error'); continue; }
        A.entries.push(data); added.push(code);
      }
      $('vaEmis').value = [...bad, ...dup, ...over].join(' ');          // keep only the codes that were not added
      render();
      if (added.length) toast(`${added.length} visit${added.length > 1 ? 's' : ''} added on ${fmtDate(date)}.`, 'success');
      const msgs = [];
      if (bad.length) msgs.push(`Not in your jurisdiction / not found: ${bad.join(', ')}`);
      if (dup.length) msgs.push(`Already on this date: ${dup.join(', ')}`);
      if (over.length) msgs.push(`Only ${MAX_PER_DAY} schools fit on one date — choose another date for: ${over.join(', ')}`);
      if (msgs.length) toast(msgs.join(' · '), 'warning');
    });
  }

  function onDelete(id) {
    return enqueue(async () => {
      const { error } = await sb().from('visit_actual_entries').delete().eq('id', id);
      if (error) throw error;
      A.entries = A.entries.filter(e => e.id !== id); render();
    });
  }

  function onDeleteDate(date) {
    return enqueue(async () => {
      if (!confirm(`Remove everything on ${fmtDate(date)}?`)) return;
      const { error } = await sb().from('visit_actual_entries').delete().eq('plan_id', A.plan.id).eq('visit_date', date);
      if (error) throw error;
      A.entries = A.entries.filter(e => e.visit_date !== date); render();
    });
  }

  function onCommentChange(inp) {
    const id = inp.dataset.id, text = inp.value.trim().slice(0, 500) || null;
    return enqueue(async () => {
      const ex = A.entries.find(e => e.id === id); if (!ex) return;
      const { data, error } = await sb().from('visit_actual_entries').update({ comment: text }).eq('id', id).select().single();
      if (error) throw error; Object.assign(ex, data);
    });
  }

  function onDeleteMonth() {
    return enqueue(async () => {
      if (!A.plan) return;
      if (!confirm(`Delete ALL actual visits recorded for ${C.MONTH_NAMES[A.month - 1]} ${A.year}? This cannot be undone.`)) return;
      const { error } = await sb().from('visit_actual_plans').delete().eq('id', A.plan.id);
      if (error) throw error;
      A.plan = null; A.entries = []; render(); $('vaStatus').innerHTML = `<strong>${C.MONTH_NAMES[A.month - 1]} ${A.year}</strong> <span class="vp-muted">· no actual visits recorded yet</span>`;
      toast('Deleted.', 'success');
    });
  }

  function onMarkazLabel(inp) {
    return enqueue(async () => {
      if (!A.plan) return;
      const { data, error } = await sb().from('visit_actual_plans').update({ markaz_label: inp.value.trim() || null }).eq('id', A.plan.id).select().single();
      if (!error && data) A.plan = data;
    });
  }

  // ─── Render ───────────────────────────────────────────────────────
  function render() {
    const dates = byDate();
    const schools = A.entries.filter(e => e.entry_type === 'school');
    const sum = `<strong>${schools.length}</strong> visit${schools.length === 1 ? '' : 's'} · <strong>${new Set(schools.map(e => e.emis_code)).size}</strong> school${new Set(schools.map(e => e.emis_code)).size === 1 ? '' : 's'} · ` +
      `<strong>${A.entries.filter(e => e.entry_type === 'leave').length}</strong> leave day(s) · <strong>${A.entries.filter(e => e.entry_type === 'other_duty').length}</strong> other-duty day(s)`;
    $('vaSummary').innerHTML = A.entries.length ? sum : '';
    const cell = e => e
      ? `<td class="vp-mono">${esc(e.emis_code)}</td><td>${esc(e.school_name)} <button class="vp-icon" data-vact="del" data-id="${e.id}" title="Remove this visit">✕</button></td>`
      : '<td></td><td></td>';
    const rows = [...dates.entries()].map(([date, list]) => {
      const sp = isSpecial(list[0]) ? list[0] : null;
      const mid = sp
        ? `<td colspan="4" class="vp-special vp-sp-${sp.entry_type}"><strong>${sp.entry_type === 'leave' ? 'ON LEAVE' : 'OTHER DUTY'}</strong>` +
          (sp.entry_type === 'other_duty' ? ` <input type="text" class="vp-comment va-comment" data-id="${sp.id}" maxlength="500" placeholder="Comment — what was the duty?" value="${esc(sp.comment || '')}">` : '') + '</td>'
        : cell(list.find(e => e.slot === 1)) + cell(list.find(e => e.slot === 2));
      return `<tr><td>${fmtDate(date)}</td><td>${C.DAY_NAMES[C.dowOf(date)]}</td>${mid}<td><button class="vp-icon" data-vact="delDate" data-date="${date}" title="Remove this date">🗑</button></td></tr>`;
    }).join('');
    $('vaSheet').innerHTML = `<div class="vp-scroll"><table class="vp-table"><thead><tr><th>Visit Date</th><th>Day</th><th>Emis Code</th><th>Morning Visit (School 1)</th><th>Emis Code</th><th>Mid-Day Visit (School 2)</th><th></th></tr></thead>` +
      `<tbody>${rows || '<tr><td colspan="7" class="vp-muted">Nothing recorded for this month yet — add EMIS codes with a date above.</td></tr>'}</tbody></table></div>`;
    ['vaBtnExcel', 'vaBtnPrint', 'vaBtnDeleteMonth'].forEach(id => { $(id).disabled = !A.entries.length && id !== 'vaBtnDeleteMonth' || (id === 'vaBtnDeleteMonth' && !A.plan); });
  }

  function syncType() {
    const t = $('vaType').value;
    $('vaEmisWrap').style.display = t === 'school' ? '' : 'none';
    $('vaCommentWrap').style.display = t === 'other_duty' ? '' : 'none';
  }

  // ─── Output ───────────────────────────────────────────────────────
  function sheetData() {
    const typed = $('vaMarkazLabel').value.trim();
    const schools = A.entries.filter(e => e.entry_type === 'school').map(e => ({ markaz_name: e.markaz }));
    const hdr = sh().makeHeader(schools, typed, null, 'actual', A.year, A.month);
    const f = e => e ? { emis: e.emis_code, name: e.school_name } : null;
    const rows = [...byDate().entries()].map(([date, list]) =>
      isSpecial(list[0]) ? { date, special: specialText(list[0]) } : { date, s1: f(list.find(e => e.slot === 1)), s2: f(list.find(e => e.slot === 2)) });
    return { year: A.year, month: A.month, startDate: null, genderTag: hdr.gender, markazLabel: hdr.markaz, district: hdr.district, rows, hdr,
             title: hdr.title, sheetName: `Actual Visits ${C.MONTH_NAMES[A.month - 1].slice(0, 3)} ${A.year}` };
  }

  async function onExcel() {
    try {
      if (!A.entries.length) { toast('Nothing to export.', 'warning'); return; }
      const d = sheetData();
      const name = `ACTUAL_VISITS_MARKAZ_${d.markazLabel.replace(/[^A-Za-z0-9]+/g, '')}_-_${C.MONTH_NAMES[A.month - 1].toUpperCase()}_${A.year}.xlsx`;
      await window.VisitPlannerExcel.download(d, name);
    } catch (e) { toast(e.message || 'Excel export failed', 'error'); }
  }

  const onPrint = () => { if (!A.entries.length) { toast('Nothing to print.', 'warning'); return; } sh().printSheet(sheetData()); };

  // ─── UI ───────────────────────────────────────────────────────────
  function build() {
    A.el.innerHTML = `
    <button class="vp-btn vp-ghost" id="vaBack" style="margin-bottom:10px">← Visit Planner</button>
    <div class="vp-card"><div class="vp-h2">Actual Visits — period</div>
      <div class="vp-row"><label>Year <input type="number" id="vaYear" min="1900" max="2200" value="${A.year}" class="vp-in" style="width:96px"></label>
      <label>Month <select id="vaMonth" class="vp-in">${C.MONTH_NAMES.map((n, i) => `<option value="${i + 1}" ${i + 1 === A.month ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <button class="vp-btn" id="vaBtnLoad">Open / Load</button></div>
      <div id="vaStatus" class="vp-status"></div></div>
    <div class="vp-card"><div class="vp-h2">Add visits</div>
      <div class="vp-row">
        <label>Type <select id="vaType" class="vp-in"><option value="school">School visit</option><option value="leave">On Leave</option><option value="other_duty">Other Duty</option></select></label>
        <label>Date <input type="date" id="vaDate" class="vp-in"></label>
        <label id="vaEmisWrap" style="flex:1;min-width:220px">EMIS code(s) <input type="text" id="vaEmis" class="vp-in" placeholder="e.g. 36110001 36110002  (max ${MAX_PER_DAY} per date)" style="width:100%"></label>
        <label id="vaCommentWrap" style="flex:1;min-width:220px;display:none">Comment <input type="text" id="vaComment" class="vp-in" maxlength="500" placeholder="What was the other duty?" style="width:100%"></label>
        <button class="vp-btn vp-primary" id="vaBtnAdd">＋ Add</button></div>
      <div class="vp-muted" style="margin-top:6px">Only the EMIS code is needed — the school name and Markaz are filled in automatically. Each entry is saved immediately.</div></div>
    <div class="vp-card"><div class="vp-h2">Actual visits sheet</div>
      <div class="vp-row"><label>Markaz label <input type="text" id="vaMarkazLabel" class="vp-in" placeholder="e.g. 93/ML (auto if blank)" style="width:170px"></label>
      <button class="vp-btn vp-excel" id="vaBtnExcel">⬇ Download Excel</button><button class="vp-btn" id="vaBtnPrint">🖨 Print</button><button class="vp-btn vp-danger" id="vaBtnDeleteMonth">Delete month</button></div>
      <div id="vaSummary" class="vp-status"></div><div id="vaSheet"></div></div>`;
    $('vaBack').addEventListener('click', () => sh().showHome());
    $('vaBtnLoad').addEventListener('click', () => enqueue(load));
    $('vaType').addEventListener('change', syncType);
    $('vaBtnAdd').addEventListener('click', onAdd);
    $('vaEmis').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } });
    $('vaBtnExcel').addEventListener('click', onExcel);
    $('vaBtnPrint').addEventListener('click', onPrint);
    $('vaBtnDeleteMonth').addEventListener('click', onDeleteMonth);
    $('vaMarkazLabel').addEventListener('change', e => onMarkazLabel(e.target));
    A.el.addEventListener('click', e => {
      const b = e.target.closest('[data-vact]'); if (!b) return;
      if (b.dataset.vact === 'del') onDelete(b.dataset.id); else if (b.dataset.vact === 'delDate') onDeleteDate(b.dataset.date);
    });
    A.el.addEventListener('change', e => { if (e.target.classList.contains('va-comment')) onCommentChange(e.target); });
    A.built = true; syncType();
  }

  async function mount(el) {
    try {
      A.el = el;
      const uid = sh().getUserId();
      if (!uid) { toast('Session expired — please sign in again.', 'error'); return; }
      if (A.userId !== uid) { A.userId = uid; A.plan = null; A.entries = []; A.built = false; }
      if (!A.built || !el.firstChild) build();
      await enqueue(load);
    } catch (e) { console.error(e); toast(e.message || 'Could not open Actual Visits', 'error'); }
  }

  window.VisitPlannerActual = { mount };
})();
