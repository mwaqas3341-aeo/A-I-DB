// ═══════════════════════════════════════════════════════════════════
//  VISIT PLANNER — "Actual Visits" card
//  One entry per visit actually made (any number of schools per day).
//  Each entry asks: Entry (School visit / Other duty / On leave) → School type
//  (Public / Outsourced / PIEMA / PEF / Private) → the school (EMIS code for Public,
//  a drop-down of the user's jurisdiction for the rest; Admin also gets District →
//  Wing → Tehsil → Markaz filters) → Visit type (Online Monitoring / Assessment or
//  Follow Up). "Other duty" may use ANY school of the district and needs a comment.
//  Every entry can be edited. Names / Markaz / type are re-checked by the database
//  (trigger visit_actual_entry_validate, migration 06). Downloads are headed
//  "ACTUAL SCHOOL VISITS FOR <MONTH YEAR>".
//  Depends on window.VisitPlannerCore, VisitPlannerShared, VisitPlannerExcel.
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const C = window.VisitPlannerCore;
  const PAGE = 1000, MAX_OPTIONS = 500;
  const KINDS = [['public', 'Public'], ['outsourced', 'Outsourced'], ['piema', 'PIEMA'], ['pef', 'PEF'], ['private', 'Private']];
  const KIND_LABEL = Object.fromEntries(KINDS);
  const SRC_KIND = { PUBLIC: 'public', HIGH: 'public', PIEMA: 'piema', PEF: 'pef', PRIVATE: 'private', ACADEMY: 'private' };
  const VISIT_LABEL = { monitoring_assessment: 'Online Monitoring / Assessment Visit', follow_up: 'Follow Up Visit' };
  const COLUMNS = ['Visit Date', 'Day', 'Emis Code', 'Name of School', 'School Type', 'Visit Type / Duty Details'];

  const A = { el: null, built: false, userId: null, year: new Date().getFullYear(), month: new Date().getMonth() + 1,
              plan: null, entries: [], holidays: new Map(), reason: '', wide: null, wideFor: null, wideWarned: false, editId: null, queue: Promise.resolve() };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'info'); };
  const sb = () => window._supabase;
  const sh = () => window.VisitPlannerShared;
  const fmtDate = s => { const [y, m, d] = s.split('-').map(Number); return `${String(d).padStart(2, '0')} ${C.MONTH_NAMES[m - 1].slice(0, 3)} ${y}`; };
  const enqueue = fn => (A.queue = A.queue.then(fn, fn).catch(e => { console.error(e); toast(e.message || 'Operation failed', 'error'); }));
  const isAdmin = () => String(((typeof currentUser !== 'undefined' && currentUser) || {}).role || '').toLowerCase() === 'admin';
  const uniq = arr => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

  // ─── School lists ─────────────────────────────────────────────────
  async function loadWide() {
    if (A.wide && A.wideFor === A.userId) return;
    try {
      const all = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb().rpc('visit_actual_wide_pool').range(from, from + PAGE - 1);
        if (error) throw error;
        all.push(...data);
        if (data.length < PAGE) break;
      }
      A.wide = all.map(r => Object.assign({}, r, { emis: String(r.emis) })); A.wideFor = A.userId;
    } catch (e) {
      A.wide = null;
      if (!A.wideWarned) { A.wideWarned = true; toast('School list function missing — run supabase/visit-planner/06_actual_visits_school_types.sql. Showing your jurisdiction schools only (Outsourced and district-wide Other Duty need it).', 'warning'); }
    }
  }

  // Schools the user may pick for this kind of entry. School visits: own jurisdiction (primary + assigned);
  // admins and Other Duty: everything the database lets them see (whole district / all districts for admin).
  function baseList(entryType) {
    const mine = sh().getPool().rows.map(r => ({ emis: String(r.emis), school_name: r.school_name, level: r.level, district: r.district,
      tehsil: r.tehsil, wing: r.wing, markaz_name: r.markaz_name, kind: SRC_KIND[r.source] || 'public' }));
    if (!A.wide) return mine;
    if (entryType === 'other_duty' || isAdmin()) return A.wide;
    const wmap = new Map(A.wide.map(r => [r.emis, r]));
    return mine.map(m => wmap.get(m.emis) || m);
  }

  // ─── Data ─────────────────────────────────────────────────────────
  async function load() {
    A.year = parseInt($('vaYear').value, 10); A.month = parseInt($('vaMonth').value, 10);
    if (!(A.year >= 1900 && A.year <= 2200)) { toast('Enter a valid year', 'error'); return; }
    $('vaStatus').innerHTML = '<span class="vp-muted">Loading…</span>';
    const { data: p, error } = await sb().from('visit_actual_plans').select('*').eq('user_id', A.userId).eq('year', A.year).eq('month', A.month).maybeSingle();
    if (error) { toast(error.message, 'error'); return; }
    A.plan = p || null; A.entries = []; cancelEdit(true);
    if (p) {
      const { data, error: e2 } = await sb().from('visit_actual_entries').select('*').eq('plan_id', p.id).order('visit_date').order('created_at');
      if (e2) { toast(e2.message, 'error'); return; }
      A.entries = data || [];
      $('vaMarkazLabel').value = p.markaz_label || '';
    } else $('vaMarkazLabel').value = '';
    await loadHolidays();
    fillDates();
    $('vaStatus').innerHTML = `<strong>${C.MONTH_NAMES[A.month - 1]} ${A.year}</strong> <span class="vp-muted">· ${A.plan ? 'saved' : 'no actual visits recorded yet'}</span>`;
    render();
  }

  // Holidays come from the FINALIZED tentative plan of the same month (server-side RPC; also enforced by DB triggers).
  async function loadHolidays() {
    A.holidays = new Map(); A.reason = '';
    const { data, error } = await sb().rpc('visit_effective_holidays', { p_year: A.year, p_month: A.month });
    if (error) { toast('Could not load holidays: ' + error.message, 'error'); return; }
    (data || []).forEach(h => A.holidays.set(h.holiday_date, { type: h.holiday_type, name: h.name }));
    const { data: tp } = await sb().from('visit_planners').select('private_visit_reason,finalized_at').eq('user_id', A.userId).eq('year', A.year).eq('month', A.month).maybeSingle();
    if (tp && tp.finalized_at) A.reason = tp.private_visit_reason || '';
  }
  const HOLNAME = { gazetted: 'Gazetted holiday', local: 'Local holiday' };
  function fillDates() {
    const el = $('vaDate'), keep = el.value, n = C.daysInMonth(A.year, A.month);
    let first = '';
    el.innerHTML = Array.from({ length: n }, (_, i) => {
      const d = C.iso(A.year, A.month, i + 1), h = A.holidays.get(d), lbl = `${fmtDate(d)} · ${C.DAY_NAMES[C.dowOf(d)].slice(0, 3)}`;
      if (!h && !first) first = d;
      return h ? `<option value="${d}" disabled>${esc(lbl)} — ${esc(HOLNAME[h.type] || 'Holiday')}: ${esc(h.name)} (not available)</option>` : `<option value="${d}">${esc(lbl)}</option>`;
    }).join('');
    el.value = keep && keep.slice(0, 7) === `${A.year}-${String(A.month).padStart(2, '0')}` && !A.holidays.has(keep) ? keep : first;
    const b = $('vaBanner');
    b.style.display = A.holidays.size ? '' : 'none';
    b.innerHTML = A.holidays.size ? `<strong>Holidays this month (from your finalized tentative plan):</strong> ` +
      [...A.holidays.entries()].map(([d, h]) => `<span class="vp-hbadge vp-hb-${esc(h.type)}">${esc(fmtDate(d))} · ${esc(h.name)} (${esc(h.type)})</span>`).join(' ') +
      ` <span class="vp-muted">— non-working days; no entry can be made on them.</span>` : '';
  }

  async function ensurePlan() {
    if (A.plan) return A.plan;
    const { data, error } = await sb().from('visit_actual_plans').insert({ user_id: A.userId, year: A.year, month: A.month }).select().single();
    if (error) throw error; A.plan = data; return data;
  }

  const sorted = () => A.entries.slice().sort((a, b) => a.visit_date.localeCompare(b.visit_date) || String(a.created_at).localeCompare(String(b.created_at)));

  // ─── Form logic ───────────────────────────────────────────────────
  const curType = () => $('vaType').value;
  const curKind = () => $('vaKind').value;

  function kindOptions(type, keep) {
    const first = type === 'other_duty' ? '<option value="">— no specific school —</option>' : '<option value="">— select school type —</option>';
    return first + KINDS.map(([v, l]) => `<option value="${v}" ${v === keep ? 'selected' : ''}>${l}</option>`).join('');
  }

  function listForKind() {
    const kind = curKind(); if (!kind) return [];
    let l = baseList(curType()).filter(r => r.kind === kind);
    if (isAdmin()) {
      const d = $('vaFD').value, w = $('vaFW').value, t = $('vaFT').value, m = $('vaFM').value;
      l = l.filter(r => (!d || r.district === d) && (!w || r.wing === w) && (!t || r.tehsil === t) && (!m || r.markaz_name === m));
    }
    const q = $('vaFilter').value.trim().toLowerCase();
    if (q) l = l.filter(r => String(r.emis).toLowerCase().includes(q) || String(r.school_name || '').toLowerCase().includes(q));
    return l;
  }

  function fillSel(id, label, values, cur) {
    const el = $(id); if (!el) return;
    const keep = values.includes(cur) ? cur : '';
    el.innerHTML = `<option value="">All ${label}</option>` + values.map(v => `<option value="${esc(v)}" ${v === keep ? 'selected' : ''}>${esc(v)}</option>`).join('');
  }
  function renderAdminFilters() {
    const kind = curKind(); if (!isAdmin() || !kind) return;
    const all = baseList(curType()).filter(r => r.kind === kind);
    const d0 = $('vaFD').value;
    fillSel('vaFD', 'districts', uniq(all.map(r => r.district)), d0); const d = $('vaFD').value;
    const a = all.filter(r => !d || r.district === d);
    const w0 = $('vaFW').value; fillSel('vaFW', 'wings', uniq(a.map(r => r.wing)), w0); const w = $('vaFW').value;
    const b = a.filter(r => !w || r.wing === w);
    const t0 = $('vaFT').value; fillSel('vaFT', 'tehsils', uniq(b.map(r => r.tehsil)), t0); const t = $('vaFT').value;
    const c = b.filter(r => !t || r.tehsil === t);
    const m0 = $('vaFM').value; fillSel('vaFM', 'markaz', uniq(c.map(r => r.markaz_name)), m0);
  }

  function renderPick(want) {
    const sel = $('vaPick'); const keep = want || sel.value;
    const l = listForKind(), shown = l.slice(0, MAX_OPTIONS);
    if (keep && !shown.some(r => r.emis === keep)) { const hit = baseList(curType()).find(r => r.emis === keep); if (hit) shown.push(hit); }
    sel.innerHTML = '<option value="">— select school —</option>' + shown.map(r =>
      `<option value="${esc(r.emis)}" ${r.emis === keep ? 'selected' : ''}>${esc(r.school_name)} (${esc(r.emis)})${r.markaz_name ? ' — ' + esc(r.markaz_name) : ''}</option>`).join('');
    $('vaPickInfo').textContent = `${l.length} ${KIND_LABEL[curKind()] || ''} school${l.length === 1 ? '' : 's'}` + (l.length > MAX_OPTIONS ? ` — showing ${MAX_OPTIONS}, type in the filter box to narrow` : '');
  }

  function resolveEmis() {
    const code = $('vaEmis').value.trim(), out = $('vaResolved');
    if (!code) { out.textContent = ''; return null; }
    const hit = baseList(curType()).find(r => r.emis.toLowerCase() === code.toLowerCase());
    if (!hit) { out.innerHTML = `<span class="vp-error">EMIS ${esc(code)} not found ${curType() === 'other_duty' ? 'in your district' : 'in your jurisdiction'}.</span>`; return null; }
    if (hit.kind !== curKind()) { out.innerHTML = `<span class="vp-error">${esc(hit.school_name)} is a ${esc(KIND_LABEL[hit.kind])} school — choose “${esc(KIND_LABEL[hit.kind])}” as the school type.</span>`; return null; }
    out.innerHTML = `✔ ${esc(hit.school_name)}${hit.markaz_name ? ' — ' + esc(hit.markaz_name) : ''}`; return hit;
  }

  function syncForm(want) {
    const t = curType(), adm = isAdmin();
    const kindSel = $('vaKind'), prev = kindSel.value;
    kindSel.innerHTML = kindOptions(t, prev);
    const kind = kindSel.value;
    $('vaSchoolBox').style.display = t === 'leave' ? 'none' : '';
    $('vaVisitWrap').style.display = t === 'school' ? '' : 'none';
    $('vaCommentWrap').style.display = t === 'other_duty' ? '' : 'none';
    const needEmis = !!kind && kind === 'public' && !adm, needPick = !!kind && !needEmis;
    $('vaEmisWrap').style.display = needEmis ? '' : 'none';
    $('vaPickBox').style.display = needPick ? '' : 'none';
    $('vaAdminBox').style.display = adm && kind ? '' : 'none';
    if (adm && kind) renderAdminFilters();
    if (needPick) renderPick(want);
    if (needEmis) resolveEmis();
  }

  function clearSchoolFields() {
    $('vaEmis').value = ''; $('vaResolved').textContent = ''; $('vaFilter').value = ''; $('vaPick').value = ''; $('vaVisit').value = ''; $('vaComment').value = '';
  }

  function selectedSchool() {
    const kind = curKind(); if (!kind) return null;
    if (kind === 'public' && !isAdmin()) return resolveEmis();
    const v = $('vaPick').value; if (!v) return null;
    return baseList(curType()).find(r => r.emis === v) || { emis: v, kind };
  }

  function payloadFromForm() {
    const type = curType(), date = $('vaDate').value;
    if (!date) throw new Error('Select a date.');
    if (+date.slice(0, 4) !== A.year || +date.slice(5, 7) !== A.month) throw new Error(`The date must be inside ${C.MONTH_NAMES[A.month - 1]} ${A.year}.`);
    const hol = A.holidays.get(date);
    if (hol) throw new Error(`${fmtDate(date)} is a ${hol.type} holiday (${hol.name}). No visit, leave or duty can be recorded on a holiday.`);
    const day = A.entries.filter(e => e.visit_date === date && e.id !== A.editId);
    if (day.some(e => e.entry_type === 'leave')) throw new Error(`${fmtDate(date)} is marked On Leave. Remove that entry first.`);
    if (type === 'leave') {
      if (day.length) throw new Error(`${fmtDate(date)} already has entries. Remove them first to mark the day as leave.`);
      return { visit_date: date, entry_type: 'leave', emis_code: null, school_type: null, visit_type: null, comment: null };
    }
    const kind = curKind(), sel = selectedSchool();
    if (type === 'school') {
      if (!kind) throw new Error('Select the school type.');
      if (!sel) throw new Error(kind === 'public' && !isAdmin() ? 'Enter a valid EMIS code of a Public school in your jurisdiction.' : 'Select the school.');
      const vt = $('vaVisit').value; if (!vt) throw new Error('Select the visit type: Online Monitoring / Assessment or Follow Up.');
      if (day.some(e => e.emis_code === sel.emis)) throw new Error(`${sel.school_name || sel.emis} is already recorded on ${fmtDate(date)}.`);
      return { visit_date: date, entry_type: 'school', emis_code: sel.emis, school_type: sel.kind || kind, visit_type: vt, comment: null };
    }
    const comment = $('vaComment').value.trim().slice(0, 500);
    if (!comment) throw new Error('Write a comment describing the other duty (inquiry, exam duty, any other duty).');
    if (kind && !sel) throw new Error('Select the school for this duty, or choose “— no specific school —”.');
    return { visit_date: date, entry_type: 'other_duty', emis_code: sel ? sel.emis : null, school_type: sel ? (sel.kind || kind) : null, visit_type: null, comment };
  }

  function onSave() {
    return enqueue(async () => {
      let payload;
      try { payload = payloadFromForm(); } catch (e) { toast(e.message, 'error'); return; }
      if (A.editId) {
        const { data, error } = await sb().from('visit_actual_entries').update(payload).eq('id', A.editId).select().single();
        if (error) throw error;
        A.entries = A.entries.map(e => e.id === A.editId ? data : e);
        cancelEdit(); render(); toast('Entry updated.', 'success'); return;
      }
      await ensurePlan();
      const { data, error } = await sb().from('visit_actual_entries').insert(Object.assign({ plan_id: A.plan.id, user_id: A.userId }, payload)).select().single();
      if (error) throw error;
      A.entries.push(data);
      clearSchoolFields(); syncForm(); render();
      toast(payload.entry_type === 'leave' ? 'Marked as On Leave.' : payload.entry_type === 'other_duty' ? 'Other duty added.' : `${data.school_name || data.emis_code} added on ${fmtDate(payload.visit_date)}.`, 'success');
    });
  }

  // ─── Edit ─────────────────────────────────────────────────────────
  function startEdit(id) {
    const e = A.entries.find(x => x.id === id); if (!e) return;
    A.editId = id;
    $('vaDate').value = e.visit_date; $('vaType').value = e.entry_type;
    clearSchoolFields();
    $('vaKind').innerHTML = kindOptions(e.entry_type, e.school_type || '');
    if (isAdmin()) ['vaFD', 'vaFW', 'vaFT', 'vaFM'].forEach(x => { $(x).value = ''; });
    syncForm(e.emis_code || '');
    if (e.emis_code && curKind() === 'public' && !isAdmin()) { $('vaEmis').value = e.emis_code; resolveEmis(); }
    $('vaVisit').value = e.visit_type || ''; $('vaComment').value = e.comment || '';
    $('vaFormTitle').textContent = 'Edit entry'; $('vaBtnAdd').textContent = '💾 Update entry'; $('vaBtnCancel').style.display = '';
    $('vaFormCard').classList.add('va-editing'); $('vaFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelEdit(silent) {
    A.editId = null;
    if (!$('vaFormTitle')) return;
    $('vaFormTitle').textContent = 'Add an entry'; $('vaBtnAdd').textContent = '＋ Add'; $('vaBtnCancel').style.display = 'none';
    $('vaFormCard').classList.remove('va-editing');
    if (!silent) { clearSchoolFields(); syncForm(); }
  }

  // ─── Delete ───────────────────────────────────────────────────────
  function onDelete(id) {
    return enqueue(async () => {
      const e = A.entries.find(x => x.id === id); if (!e) return;
      if (!confirm(`Remove this entry (${fmtDate(e.visit_date)}${e.school_name ? ' — ' + e.school_name : ''})?`)) return;
      const { error } = await sb().from('visit_actual_entries').delete().eq('id', id);
      if (error) throw error;
      A.entries = A.entries.filter(x => x.id !== id); if (A.editId === id) cancelEdit(); render();
    });
  }

  function onDeleteMonth() {
    return enqueue(async () => {
      if (!A.plan) return;
      if (!confirm(`Delete ALL actual visits recorded for ${C.MONTH_NAMES[A.month - 1]} ${A.year}? This cannot be undone.`)) return;
      const { error } = await sb().from('visit_actual_plans').delete().eq('id', A.plan.id);
      if (error) throw error;
      A.plan = null; A.entries = []; cancelEdit(); render(); $('vaStatus').innerHTML = `<strong>${C.MONTH_NAMES[A.month - 1]} ${A.year}</strong> <span class="vp-muted">· no actual visits recorded yet</span>`;
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
  function rowCells(e) {
    if (e.entry_type === 'leave') return null;
    if (e.entry_type === 'other_duty') return [e.emis_code || '', e.school_name || '—', 'Other Duty', e.comment || ''];
    return [e.emis_code || '', e.school_name || '', KIND_LABEL[e.school_type] || '', VISIT_LABEL[e.visit_type] || ''];
  }

  function render() {
    const list = sorted(), visits = list.filter(e => e.entry_type === 'school');
    const n = (arr) => arr.length;
    $('vaSummary').innerHTML = A.entries.length
      ? `<strong>${n(visits)}</strong> school visit${n(visits) === 1 ? '' : 's'} (<strong>${n(visits.filter(e => e.visit_type === 'monitoring_assessment'))}</strong> monitoring/assessment · <strong>${n(visits.filter(e => e.visit_type === 'follow_up'))}</strong> follow-up) · ` +
        `<strong>${new Set(visits.map(e => e.emis_code)).size}</strong> different school(s) · <strong>${n(list.filter(e => e.entry_type === 'other_duty'))}</strong> other duty · <strong>${n(list.filter(e => e.entry_type === 'leave'))}</strong> leave day(s)` : '';
    const holRows = [...A.holidays.entries()].map(([d, h]) => ({ _hol: h, visit_date: d }));
    const merged = list.concat(holRows).sort((a, b) => a.visit_date.localeCompare(b.visit_date) || (a._hol ? -1 : 1));
    const rows = merged.map(e => {
      if (e._hol) return `<tr class="vp-hol vp-hol-${esc(e._hol.type)}"><td>${fmtDate(e.visit_date)}</td><td>${C.DAY_NAMES[C.dowOf(e.visit_date)]}</td><td colspan="4"><span class="vp-hbadge vp-hb-${esc(e._hol.type)}">${esc(HOLNAME[e._hol.type] || 'Holiday')}</span> ${esc(e._hol.name)} <span class="vp-muted">— non-working day</span></td><td></td></tr>`;
      const c = rowCells(e), days = C.DAY_NAMES[C.dowOf(e.visit_date)];
      const act = `<td style="white-space:nowrap"><button class="vp-icon" style="color:var(--brand,#0B6E4F)" data-vact="edit" data-id="${e.id}" title="Edit this entry">✎</button><button class="vp-icon" data-vact="del" data-id="${e.id}" title="Remove this entry">✕</button></td>`;
      const body = c
        ? `<td class="vp-mono">${esc(c[0])}</td><td>${esc(c[1])}</td><td>${esc(c[2])}</td><td>${esc(c[3])}</td>`
        : `<td colspan="4" class="vp-special vp-sp-leave"><strong>ON LEAVE</strong></td>`;
      return `<tr class="${A.editId === e.id ? 'vp-sel' : ''}"><td>${fmtDate(e.visit_date)}</td><td>${days}</td>${body}${act}</tr>`;
    }).join('');
    $('vaSheet').innerHTML = `<div class="vp-scroll"><table class="vp-table"><thead><tr>${COLUMNS.map(h => `<th>${h}</th>`).join('')}<th></th></tr></thead>` +
      `<tbody>${rows || '<tr><td colspan="7" class="vp-muted">Nothing recorded for this month yet — use “Add an entry” above.</td></tr>'}</tbody></table></div>` + holSummary();
    ['vaBtnExcel', 'vaBtnPrint'].forEach(id => { $(id).disabled = !A.entries.length; });
    $('vaBtnDeleteMonth').disabled = !A.plan;
  }

  function holSummary() {
    if (!A.holidays.size) return '';
    return `<div class="vp-hsum"><div class="vp-h2">Holidays — ${C.MONTH_NAMES[A.month - 1]} ${A.year}</div><table class="vp-table vp-small" style="min-width:0"><thead><tr><th>Date</th><th>Holiday</th><th>Type</th></tr></thead><tbody>` +
      [...A.holidays.entries()].map(([d, h]) => `<tr class="vp-hol vp-hol-${esc(h.type)}"><td>${fmtDate(d)}</td><td>${esc(h.name)}</td><td><span class="vp-hbadge vp-hb-${esc(h.type)}">${esc(HOLNAME[h.type] || h.type)}</span></td></tr>`).join('') + `</tbody></table></div>` +
      (A.reason ? `<div class="vp-note"><strong>Reason for visiting private schools:</strong> ${esc(A.reason)}</div>` : '');
  }

  // ─── Output ───────────────────────────────────────────────────────
  function sheetData() {
    const typed = $('vaMarkazLabel').value.trim();
    const schools = A.entries.filter(e => e.entry_type === 'school').map(e => ({ markaz_name: e.markaz }));
    const hdr = sh().makeHeader(schools, typed, null, 'actual', A.year, A.month);
    const vis = sorted().map(e => { const c = rowCells(e); return c ? { date: e.visit_date, cells: c } : { date: e.visit_date, special: 'ON LEAVE' }; });
    const hols = [...A.holidays.entries()].map(([date, h]) => ({ date, type: h.type, name: h.name }));
    const rows = vis.concat(hols.map(h => ({ date: h.date, holiday: { type: h.type, name: h.name } }))).sort((a, b) => a.date.localeCompare(b.date));
    return { holidays: hols, privateReason: A.reason, year: A.year, month: A.month, startDate: null, genderTag: hdr.gender, markazLabel: hdr.markaz, district: hdr.district, rows, hdr,
             title: hdr.title, columns: COLUMNS, sheetName: `Actual Visits ${C.MONTH_NAMES[A.month - 1].slice(0, 3)} ${A.year}` };
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
    const adm = isAdmin();
    A.el.innerHTML = `
    <button class="vp-btn vp-ghost" id="vaBack" style="margin-bottom:10px">← Visit Planner</button>
    <div class="vp-card"><div class="vp-h2">Actual Visits — period</div>
      <div class="vp-row"><label>Year <input type="number" id="vaYear" min="1900" max="2200" value="${A.year}" class="vp-in" style="width:96px"></label>
      <label>Month <select id="vaMonth" class="vp-in">${C.MONTH_NAMES.map((n, i) => `<option value="${i + 1}" ${i + 1 === A.month ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <button class="vp-btn" id="vaBtnLoad">Open / Load</button></div>
      <div id="vaStatus" class="vp-status"></div><div id="vaBanner" class="vp-banner" style="display:none;margin-top:8px"></div></div>
    <div class="vp-card" id="vaFormCard"><div class="vp-h2" id="vaFormTitle">Add an entry</div>
      <div class="vp-row">
        <label>Date <select id="vaDate" class="vp-in"></select></label>
        <label>Entry <select id="vaType" class="vp-in"><option value="school">School visit</option><option value="other_duty">Other duty</option><option value="leave">On leave</option></select></label>
      </div>
      <div id="vaSchoolBox" style="margin-top:10px">
        <div class="vp-row"><label>School type <select id="vaKind" class="vp-in"></select></label></div>
        <div class="vp-row" id="vaAdminBox" style="display:none;margin-top:8px">
          <label>District <select id="vaFD" class="vp-in"></select></label><label>Wing <select id="vaFW" class="vp-in"></select></label>
          <label>Tehsil <select id="vaFT" class="vp-in"></select></label><label>Markaz <select id="vaFM" class="vp-in"></select></label></div>
        <div class="vp-row" style="margin-top:8px">
          <label id="vaEmisWrap" style="flex:1;min-width:220px;display:none">EMIS code of the Public school <input type="text" id="vaEmis" class="vp-in" placeholder="e.g. 36110001" style="width:100%" autocomplete="off"></label>
          <div id="vaPickBox" style="flex:1;min-width:260px;display:none"><div class="vp-lbl">School</div>
            <input type="text" id="vaFilter" class="vp-in" placeholder="Type EMIS or name to filter the list" style="width:100%;margin:3px 0" autocomplete="off">
            <select id="vaPick" class="vp-in" style="width:100%"></select><div class="vp-muted" id="vaPickInfo"></div></div>
        </div>
        <div class="vp-muted" id="vaResolved" style="margin-top:4px"></div>
        <div class="vp-row" id="vaVisitWrap" style="margin-top:8px"><label>Visit type <select id="vaVisit" class="vp-in"><option value="">— select —</option><option value="monitoring_assessment">${VISIT_LABEL.monitoring_assessment}</option><option value="follow_up">${VISIT_LABEL.follow_up}</option></select></label></div>
      </div>
      <div id="vaCommentWrap" style="display:none;margin-top:10px"><label class="vp-lbl">Comment — what was the duty? (inquiry, exam duty, any other duty)
        <textarea id="vaComment" class="vp-in" maxlength="500" rows="2" style="width:100%" placeholder="Type the details of your other duty"></textarea></label></div>
      <div class="vp-row" style="margin-top:12px"><button class="vp-btn vp-primary" id="vaBtnAdd">＋ Add</button><button class="vp-btn vp-ghost" id="vaBtnCancel" style="display:none">Cancel edit</button></div>
      <div class="vp-muted" style="margin-top:6px">Add as many schools as you visited on a date — each entry is saved immediately and can be edited (✎) or removed (✕) below.${adm ? ' As Admin you can pick any school using District → Wing → Tehsil → Markaz.' : ' School lists show your primary and all assigned jurisdictions.'} For “Other duty” every school of the district is available.</div></div>
    <div class="vp-card"><div class="vp-h2">Actual visits sheet</div>
      <div class="vp-row"><label>Markaz label <input type="text" id="vaMarkazLabel" class="vp-in" placeholder="e.g. 93/ML (auto if blank)" style="width:170px"></label>
      <button class="vp-btn vp-excel" id="vaBtnExcel">⬇ Download Excel</button><button class="vp-btn" id="vaBtnPrint">🖨 Print</button><button class="vp-btn vp-danger" id="vaBtnDeleteMonth">Delete month</button></div>
      <div id="vaSummary" class="vp-status"></div><div id="vaSheet"></div></div>`;
    $('vaBack').addEventListener('click', () => sh().showHome());
    $('vaBtnLoad').addEventListener('click', () => enqueue(load));
    $('vaType').addEventListener('change', () => syncForm());
    $('vaKind').addEventListener('change', () => { $('vaPick').value = ''; $('vaEmis').value = ''; $('vaResolved').textContent = ''; ['vaFD', 'vaFW', 'vaFT', 'vaFM'].forEach(x => { $(x).value = ''; }); syncForm(); });
    ['vaFD', 'vaFW', 'vaFT', 'vaFM'].forEach(id => $(id).addEventListener('change', () => { renderAdminFilters(); renderPick(); }));
    $('vaFilter').addEventListener('input', () => renderPick());
    $('vaEmis').addEventListener('input', resolveEmis);
    $('vaBtnAdd').addEventListener('click', onSave);
    $('vaBtnCancel').addEventListener('click', () => cancelEdit());
    $('vaEmis').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onSave(); } });
    $('vaBtnExcel').addEventListener('click', onExcel);
    $('vaBtnPrint').addEventListener('click', onPrint);
    $('vaBtnDeleteMonth').addEventListener('click', onDeleteMonth);
    $('vaMarkazLabel').addEventListener('change', e => onMarkazLabel(e.target));
    if (!A.el._vaWired) {                                  // delegated listeners: attach once per container
      A.el._vaWired = true;
      A.el.addEventListener('click', e => {
        const b = e.target.closest('[data-vact]'); if (!b) return;
        if (b.dataset.vact === 'del') onDelete(b.dataset.id); else if (b.dataset.vact === 'edit') startEdit(b.dataset.id);
      });
    }
    A.built = true; syncForm();
  }

  async function mount(el) {
    try {
      A.el = el;
      const uid = sh().getUserId();
      if (!uid) { toast('Session expired — please sign in again.', 'error'); return; }
      if (A.userId !== uid) { A.userId = uid; A.plan = null; A.entries = []; A.built = false; A.wide = null; }
      await loadWide();
      if (!A.built || !el.firstChild) build(); else syncForm();
      await enqueue(load);
    } catch (e) { console.error(e); toast(e.message || 'Could not open Actual Visits', 'error'); }
  }

  window.VisitPlannerActual = { mount };
})();
