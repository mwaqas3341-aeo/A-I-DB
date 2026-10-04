// ═══════════════════════════════════════════════════════════════════
//  VISIT PLANNER — UI + Supabase persistence
//  Isolated module: own view (#visitPlannerView), own tables
//  (visit_planners / visit_planner_entries / visit_school_allocation),
//  own RPC (visit_planner_pool). Reads the shared Supabase client (_sb)
//  and the existing session only; changes nothing in other modules.
//  Jurisdiction + ownership are enforced server-side (RLS + triggers).
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const C = window.VisitPlannerCore;
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const PAGE = 1000;
  const SRC_LABEL = { PUBLIC: 'SED/Outsourced', HIGH: 'High', PIEMA: 'PIEMA', PEF: 'PEF', PRIVATE: 'Private', ACADEMY: 'Academy' };

  const S = {
    inited: false, userId: null,
    pool: null, poolEmis: null, poolFor: null,
    year: new Date().getFullYear(), month: new Date().getMonth() + 1,
    planner: null, entries: [], selected: new Map(), extraDates: new Set(),
    q: '', markaz: '', source: '', shown: 150, queue: Promise.resolve()
  };

  const $  = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'info'); };
  const sb = () => window._supabase;
  const fmtDate = s => { const [y, m, d] = s.split('-').map(Number); return `${String(d).padStart(2, '0')} ${C.MONTH_NAMES[m - 1].slice(0, 3)} ${y}`; };
  const enqueue = fn => (S.queue = S.queue.then(fn, fn).catch(e => { console.error(e); toast(e.message || 'Operation failed', 'error'); }));

  // ─── Session / data ───────────────────────────────────────────────
  async function getUserId() {
    const { data } = await sb().auth.getSession();
    return data && data.session ? data.session.user.id : null;
  }

  async function loadPool(force) {
    if (!force && S.pool && S.poolFor === S.userId) return;
    $('vpSchoolBody').innerHTML = '<tr><td colspan="7" class="vp-muted">Loading schools in your jurisdiction…</td></tr>';
    const all = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb().rpc('visit_planner_pool').range(from, from + PAGE - 1);
      if (error) throw error;
      all.push(...data);
      if (data.length < PAGE) break;
    }
    S.pool = all; S.poolFor = S.userId;
    S.poolEmis = new Set(all.map(r => String(r.emis)));
    const mk = [...new Set(all.map(r => r.markaz_name))].sort();
    $('vpMarkazFilter').innerHTML = '<option value="">All Markaz</option>' + mk.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  }

  async function loadPeriod() {
    S.year = parseInt($('vpYear').value, 10); S.month = parseInt($('vpMonth').value, 10);
    if (!(S.year >= 1900 && S.year <= 2200)) { toast('Enter a valid year', 'error'); return; }
    $('vpStatusBar').innerHTML = '<span class="vp-muted">Loading planner…</span>';
    const { data: p, error } = await sb().from('visit_planners').select('*').eq('user_id', S.userId).eq('year', S.year).eq('month', S.month).maybeSingle();
    if (error) { toast(error.message, 'error'); return; }
    S.planner = p || null; S.entries = []; S.extraDates = new Set(); S.selected = new Map();
    if (p) {
      const { data: ents, error: e2 } = await sb().from('visit_planner_entries').select('*').eq('planner_id', p.id).order('visit_date').order('slot');
      if (e2) { toast(e2.message, 'error'); return; }
      S.entries = ents || [];
      applyPlannerToSettings(p);
      S.entries.filter(e => e.entry_type === 'school').forEach(e => { if (!S.selected.has(e.emis_code)) S.selected.set(e.emis_code, schoolFromEntry(e)); });
    } else {
      applyDefaultSettings();
    }
    renderAll();
  }

  function schoolFromEntry(e) {
    const hit = S.pool && S.pool.find(r => String(r.emis) === String(e.emis_code));
    return hit || { emis: e.emis_code, school_name: e.school_name, markaz_name: e.markaz, tehsil: e.tehsil, wing: e.wing, level: '', source: '' };
  }

  // ─── Settings ─────────────────────────────────────────────────────
  function applyDefaultSettings() {
    $('vpLeaveCount').value = '2'; setChecked('vpLeave', [0, 6]); setChecked('vpOffice', [5]);
    $('vpStart').value = ''; $('vpMarkazLabel').value = '';
  }
  function applyPlannerToSettings(p) {
    $('vpLeaveCount').value = String(p.weekly_leave_count); setChecked('vpLeave', p.leave_days || []); setChecked('vpOffice', p.office_work_days || []);
    $('vpStart').value = p.start_date || ''; $('vpMarkazLabel').value = p.markaz_label || '';
  }
  const setChecked = (name, arr) => document.querySelectorAll(`input[name="${name}"]`).forEach(i => { i.checked = arr.includes(+i.value); });
  const getChecked = name => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(i => +i.value);
  const settings = () => ({
    count: +$('vpLeaveCount').value, leave: getChecked('vpLeave'), office: getChecked('vpOffice'),
    start: $('vpStart').value || null, markazLabel: $('vpMarkazLabel').value.trim()
  });
  function settingsError() {
    const s = settings();
    if (s.leave.length !== s.count) return `Select exactly ${s.count} weekly leave day${s.count > 1 ? 's' : ''} (you selected ${s.leave.length}).`;
    if (s.start && (+s.start.slice(0, 4) !== S.year || +s.start.slice(5, 7) !== S.month)) return 'Start date must fall inside the selected month.';
    return null;
  }
  function startDay() { const s = $('vpStart').value; return s ? +s.slice(8, 10) : 1; }

  // ─── Rendering ────────────────────────────────────────────────────
  function renderAll() { renderStatus(); renderSchools(); renderSheet(); }

  function renderStatus() {
    const p = S.planner;
    const badge = p ? `<span class="vp-badge vp-st-${esc(p.status)}">${esc(p.status)}</span>` : '<span class="vp-badge vp-st-new">not saved yet</span>';
    $('vpStatusBar').innerHTML = `<strong>${C.MONTH_NAMES[S.month - 1]} ${S.year}</strong> ${badge}` +
      (p ? ` <span class="vp-muted">· last saved ${new Date(p.updated_at).toLocaleString()}</span>` : ' <span class="vp-muted">· no planner exists for this month — select schools and press Generate, or create an empty planner.</span>');
    const has = !!p;
    ['vpBtnSave', 'vpBtnFinal', 'vpBtnExcel', 'vpBtnPrint', 'vpBtnAddDate', 'vpBtnDelete'].forEach(id => { $(id).disabled = !has; });
    $('vpBtnCreate').style.display = has ? 'none' : '';
    $('vpBtnFinal').textContent = p && p.status === 'finalized' ? 'Re-open for editing' : 'Mark as Finalized';
  }

  function filteredPool() {
    if (!S.pool) return [];
    const q = S.q.trim().toLowerCase();
    return S.pool.filter(r =>
      (!S.markaz || r.markaz_name === S.markaz) && (!S.source || r.source === S.source) &&
      (!q || String(r.emis).includes(q) || String(r.school_name || '').toLowerCase().includes(q)));
  }

  function renderSchools() {
    const rows = filteredPool();
    const slice = rows.slice(0, S.shown);
    $('vpSchoolBody').innerHTML = slice.length ? slice.map(r => {
      const on = S.selected.has(String(r.emis));
      return `<tr class="${on ? 'vp-sel' : ''}"><td><input type="checkbox" data-act="pick" data-emis="${esc(r.emis)}" ${on ? 'checked' : ''}></td>` +
        `<td class="vp-mono">${esc(r.emis)}</td><td>${esc(r.school_name)}</td><td>${esc(r.markaz_name)}</td><td>${esc(r.tehsil)}</td>` +
        `<td>${esc(r.wing || '')}</td><td>${esc(r.level || '')} <span class="vp-src vp-src-${esc(r.source)}">${esc(SRC_LABEL[r.source] || r.source)}</span></td></tr>`;
    }).join('') : '<tr><td colspan="7" class="vp-muted">No schools match.</td></tr>';
    $('vpMore').style.display = rows.length > S.shown ? '' : 'none';
    $('vpMore').textContent = `Show more (${rows.length - S.shown} hidden — refine the search or filters)`;
    $('vpSelCount').textContent = `${S.selected.size} selected · ${rows.length} shown by filter · ${S.pool ? S.pool.length : 0} in your jurisdiction`;
  }

  function byDate() {
    const m = new Map();
    S.entries.forEach(e => { if (!m.has(e.visit_date)) m.set(e.visit_date, {}); m.get(e.visit_date)[e.slot] = e; });
    S.extraDates.forEach(d => { if (!m.has(d)) m.set(d, {}); });
    return new Map([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }

  function slotSelect(date, slot, e) {
    const val = !e ? '' : e.entry_type === 'office' ? 'O' : 'S:' + e.emis_code;
    const schools = [...S.selected.values()];
    const opts = ['<option value="">— empty —</option>', `<option value="O" ${val === 'O' ? 'selected' : ''}>Office Work</option>`]
      .concat(schools.map(s => `<option value="S:${esc(s.emis)}" ${val === 'S:' + s.emis ? 'selected' : ''}>${esc(s.school_name)} (${esc(s.emis)})</option>`));
    const seq = e && e.entry_type === 'school' && e.visit_sequence ? `<span class="vp-seq">visit ${e.visit_sequence}</span>` : '';
    return `<select class="vp-slot" data-date="${date}" data-slot="${slot}" aria-label="School for slot ${slot}">${opts.join('')}</select>${seq}`;
  }

  function renderSheet() {
    const box = $('vpSheet');
    if (!S.planner) { box.innerHTML = ''; $('vpAlerts').innerHTML = ''; return; }
    C.assignSequences(S.entries);
    const dates = byDate();
    const [y, m] = [S.year, S.month];
    const hdr = headerInfo();
    const rows = [...dates.entries()].map(([date, sl]) => {
      const dow = C.dowOf(date), e1 = sl[1], e2 = sl[2];
      const bad = new Set(S.planner.leave_days || []).has(dow);
      return `<tr class="${bad ? 'vp-bad' : ''}">` +
        `<td><input type="date" class="vp-date" value="${date}" data-old="${date}" min="${C.iso(y, m, 1)}" max="${C.iso(y, m, C.daysInMonth(y, m))}"></td>` +
        `<td>${C.DAY_NAMES[dow]}</td><td class="vp-mono">${esc(e1 && e1.entry_type === 'school' ? e1.emis_code : '')}</td><td>${slotSelect(date, 1, e1)}</td>` +
        `<td class="vp-mono">${esc(e2 && e2.entry_type === 'school' ? e2.emis_code : '')}</td><td>${slotSelect(date, 2, e2)}</td>` +
        `<td><button class="vp-icon" data-act="delDate" data-date="${date}" title="Delete this date">✕</button></td></tr>`;
    }).join('');
    box.innerHTML = `<div class="vp-paper"><div class="vp-ph">OFFICE OF THE ASSISTANT EDUCATION OFFICER (${hdr.gender})</div>` +
      `<div class="vp-ph">MARKAZ ${esc(hdr.markaz.toUpperCase())}, DISTRICT ${esc(hdr.district.toUpperCase())}</div>` +
      `<div class="vp-ph">${esc(hdr.title)}</div></div>` +
      `<div class="vp-scroll"><table class="vp-table"><thead><tr><th>Visit Date</th><th>Day</th><th>Emis Code</th><th>Morning Visit (School 1)</th><th>Emis Code</th><th>Mid-Day Visit (School 2)</th><th></th></tr></thead>` +
      `<tbody>${rows || '<tr><td colspan="7" class="vp-muted">No visit dates yet — use “Generate Planner” or “+ Add visit date”.</td></tr>'}</tbody></table></div>` +
      `<div class="vp-sign">ASSISTANT EDUCATION OFFICER (${hdr.gender})<br>Markaz ${esc(hdr.markaz)}, District ${esc(hdr.districtTitle)}</div>`;
    renderAlerts();
  }

  function renderAlerts() {
    const p = S.planner; if (!p) return;
    const msgs = C.validate({ year: S.year, month: S.month, leaveDays: p.leave_days, entries: S.entries, schools: [...S.selected.values()], poolEmis: S.poolEmis });
    $('vpAlerts').innerHTML = msgs.length
      ? `<div class="vp-alerts"><strong>Checks (${msgs.length})</strong><ul>${msgs.slice(0, 60).map(x => `<li class="vp-${x.level}">${esc(x.msg)}</li>`).join('')}</ul></div>`
      : `<div class="vp-alerts vp-allok">✔ All checks passed — every selected school has at least ${C.MIN_VISITS} visits, no leave-day or duplicate-date problems.</div>`;
  }

  function headerInfo() {
    const sch = [...S.selected.values()];
    const names = sch.map(s => s.markaz_name).filter(Boolean);
    const counts = {}; names.forEach(n => counts[n] = (counts[n] || 0) + 1);
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const typed = $('vpMarkazLabel').value.trim() || (S.planner && S.planner.markaz_label) || '';
    const markaz = typed || (top.length ? [...new Set(top.map(C.markazShort))].slice(0, 3).join(' / ') : '—');
    const fem = names.filter(n => /FEMALE/i.test(n)).length, mal = names.filter(n => /\bMALE\b/i.test(n) && !/FEMALE/i.test(n)).length;
    const u = (typeof currentUser !== 'undefined' && currentUser) || {};
    const gender = fem > mal ? 'F' : mal > fem ? 'M' : (/^W/i.test(u.wing || '') ? 'F' : 'M');
    const district = (S.pool && S.pool[0] && S.pool[0].district) || u.district || 'LAYYAH';
    const mon = C.MONTH_NAMES[S.month - 1].toUpperCase();
    const sd = S.planner && S.planner.start_date;
    const wef = sd ? ` (W.E.F. ${sd.slice(8, 10)} ${mon} ${S.year})` : '';
    return { gender, markaz, district, districtTitle: district.charAt(0) + district.slice(1).toLowerCase(), title: `TENTATIVE SCHOOL VISIT PLAN FOR ${mon} ${S.year}${wef}` };
  }

  // ─── Persistence ──────────────────────────────────────────────────
  const clean = e => { const o = { ...e }; Object.keys(o).forEach(k => { if (k[0] === '_') delete o[k]; }); return o; };

  async function ensurePlanner(extra) {
    const s = settings();
    const body = Object.assign({ user_id: S.userId, year: S.year, month: S.month, weekly_leave_count: s.count, leave_days: s.leave,
      office_work_days: s.office, start_date: s.start, markaz_label: s.markazLabel || null }, extra || {});
    if (S.planner) {
      const { data, error } = await sb().from('visit_planners').update(body).eq('id', S.planner.id).select().single();
      if (error) throw error; S.planner = data;
    } else {
      const { data, error } = await sb().from('visit_planners').insert(body).select().single();
      if (error) throw error; S.planner = data;
    }
    return S.planner;
  }

  async function persistSequences() {
    const before = new Map(S.entries.map(e => [e.id, e.visit_sequence]));
    C.assignSequences(S.entries);
    const changed = S.entries.filter(e => before.get(e.id) !== e.visit_sequence).map(clean);
    if (changed.length) {
      const { error } = await sb().from('visit_planner_entries').upsert(changed, { onConflict: 'id' });
      if (error) throw error;
    }
  }

  async function markEdited() {
    if (S.planner && S.planner.status !== 'edited' && S.planner.status !== 'draft') {
      const { data, error } = await sb().from('visit_planners').update({ status: 'edited' }).eq('id', S.planner.id).select().single();
      if (!error) S.planner = data;
    }
  }

  function onGenerate() {
    return enqueue(async () => {
      const err = settingsError(); if (err) { toast(err, 'error'); return; }
      const schools = [...S.selected.values()];
      if (!schools.length) { toast('Select at least one school first.', 'error'); return; }
      if (S.entries.length && !confirm('Generating again will replace ALL existing visits in this month’s planner. Continue?')) return;
      const s = settings();
      const g = C.generate({ year: S.year, month: S.month, leaveDays: s.leave, officeDays: s.office, startDay: startDay(), schools });
      await ensurePlanner({ status: 'generated' });
      const del = await sb().from('visit_planner_entries').delete().eq('planner_id', S.planner.id);
      if (del.error) throw del.error;
      const ents = C.assignSequences(C.rowsToEntries(g.rows)).map(e => Object.assign({ planner_id: S.planner.id, user_id: S.userId }, e));
      S.entries = []; S.extraDates = new Set();
      if (ents.length) {
        const { data, error } = await sb().from('visit_planner_entries').insert(ents).select();
        if (error) throw error;
        S.entries = data.sort((a, b) => a.visit_date.localeCompare(b.visit_date) || a.slot - b.slot);
      }
      renderAll();
      toast(g.warnings.length ? g.warnings[0] : `Planner generated: ${ents.filter(e => e.entry_type === 'school').length} visits for ${schools.length} school(s).`, g.warnings.length ? 'warning' : 'success');
    });
  }

  function onCreateEmpty() {
    return enqueue(async () => {
      const err = settingsError(); if (err) { toast(err, 'error'); return; }
      await ensurePlanner({ status: 'draft' }); renderAll(); toast('Empty planner created. Add visit dates and schools below.', 'success');
    });
  }

  function onSave() {
    return enqueue(async () => {
      const err = settingsError(); if (err) { toast(err, 'error'); return; }
      await ensurePlanner(); renderAll(); toast('Planner saved.', 'success');
    });
  }

  function onFinalize() {
    return enqueue(async () => {
      const finalized = S.planner.status === 'finalized';
      if (!finalized) {
        const errs = C.validate({ year: S.year, month: S.month, leaveDays: S.planner.leave_days, entries: S.entries, schools: [...S.selected.values()], poolEmis: S.poolEmis });
        if (errs.some(x => x.level === 'error')) { toast('Fix the errors listed under “Checks” before finalizing.', 'error'); return; }
        if (errs.length && !confirm(`${errs.length} warning(s) remain (e.g. schools with fewer than 2 visits). Finalize anyway?`)) return;
      }
      await ensurePlanner({ status: finalized ? 'edited' : 'finalized' }); renderAll();
      toast(finalized ? 'Planner re-opened for editing.' : 'Planner marked as finalized.', 'success');
    });
  }

  function onDelete() {
    return enqueue(async () => {
      if (!confirm(`Delete the whole ${C.MONTH_NAMES[S.month - 1]} ${S.year} planner and all its visits? This cannot be undone.`)) return;
      const { error } = await sb().from('visit_planners').delete().eq('id', S.planner.id);
      if (error) throw error;
      S.planner = null; S.entries = []; S.extraDates = new Set(); applyDefaultSettings(); renderAll(); toast('Planner deleted.', 'success');
    });
  }

  function onSlotChange(sel) {
    const date = sel.dataset.date, slot = +sel.dataset.slot, v = sel.value;
    return enqueue(async () => {
      const ex = S.entries.find(e => e.visit_date === date && e.slot === slot);
      const other = S.entries.find(e => e.visit_date === date && e.slot !== slot);
      if (v === '') {
        if (ex) { const { error } = await sb().from('visit_planner_entries').delete().eq('id', ex.id); if (error) throw error; S.entries = S.entries.filter(e => e.id !== ex.id); }
      } else {
        let fields;
        if (v === 'O') fields = { entry_type: 'office', emis_code: null, school_name: null, markaz: null, tehsil: null, wing: null, visit_sequence: null };
        else {
          const emis = v.slice(2), sc = S.selected.get(emis);
          if (other && other.emis_code === emis) { toast('The same school cannot be visited twice on one day.', 'error'); renderSheet(); return; }
          fields = { entry_type: 'school', emis_code: emis, school_name: sc.school_name, markaz: sc.markaz_name, tehsil: sc.tehsil, wing: sc.wing };
        }
        if (ex) {
          const { data, error } = await sb().from('visit_planner_entries').update(fields).eq('id', ex.id).select().single();
          if (error) throw error; Object.assign(ex, data);
        } else {
          const row = Object.assign({ planner_id: S.planner.id, user_id: S.userId, visit_date: date, slot }, fields);
          const { data, error } = await sb().from('visit_planner_entries').insert(row).select().single();
          if (error) throw error; S.entries.push(data);
        }
      }
      S.extraDates.delete(date); if (S.entries.some(e => e.visit_date === date) === false) S.extraDates.add(date);
      await persistSequences(); await markEdited(); renderStatus(); renderSheet();
    }).then(() => renderSheet());
  }

  function onDateChange(inp) {
    const old = inp.dataset.old, nu = inp.value;
    return enqueue(async () => {
      const revert = () => { inp.value = old; };
      if (!nu || nu === old) return revert();
      if (+nu.slice(0, 4) !== S.year || +nu.slice(5, 7) !== S.month) { toast('The date must stay inside the planner month.', 'error'); return revert(); }
      if ((S.planner.leave_days || []).includes(C.dowOf(nu))) { toast(`${C.DAY_NAMES[C.dowOf(nu)]} is a weekly leave day.`, 'error'); return revert(); }
      if (byDate().has(nu)) { toast('That date is already in the planner.', 'error'); return revert(); }
      if (S.entries.some(e => e.visit_date === old)) {
        const { error } = await sb().from('visit_planner_entries').update({ visit_date: nu }).eq('planner_id', S.planner.id).eq('visit_date', old);
        if (error) throw error;
        S.entries.forEach(e => { if (e.visit_date === old) e.visit_date = nu; });
      } else { S.extraDates.delete(old); S.extraDates.add(nu); }
      await persistSequences(); await markEdited(); renderStatus(); renderSheet();
    });
  }

  function onAddDate() {
    return enqueue(async () => {
      const have = byDate();
      const next = C.workingDates(S.year, S.month, S.planner.leave_days, 1).find(d => !have.has(d.iso));
      if (!next) { toast('Every working day of this month is already in the planner.', 'warning'); return; }
      S.extraDates.add(next.iso); renderSheet();
      toast(`Added ${fmtDate(next.iso)} — choose schools for its two slots (change the date if needed).`, 'info');
    });
  }

  function onDelDate(date) {
    return enqueue(async () => {
      const has = S.entries.some(e => e.visit_date === date);
      if (has && !confirm(`Remove all visits on ${fmtDate(date)}?`)) return;
      if (has) {
        const { error } = await sb().from('visit_planner_entries').delete().eq('planner_id', S.planner.id).eq('visit_date', date);
        if (error) throw error;
        S.entries = S.entries.filter(e => e.visit_date !== date);
      }
      S.extraDates.delete(date); await persistSequences(); await markEdited(); renderStatus(); renderSheet();
    });
  }

  // ─── Output ───────────────────────────────────────────────────────
  function sheetData() {
    const hdr = headerInfo();
    const f = e => !e ? null : e.entry_type === 'office' ? { office: true } : { emis: e.emis_code, name: e.school_name };
    const rows = [...byDate().entries()].filter(([, sl]) => sl[1] || sl[2]).map(([date, sl]) => ({ date, s1: f(sl[1]), s2: f(sl[2]) }));
    return { year: S.year, month: S.month, startDate: S.planner.start_date, genderTag: hdr.gender, markazLabel: hdr.markaz, district: hdr.district, rows, hdr };
  }

  async function onExcel() {
    try {
      const d = sheetData();
      if (!d.rows.length) { toast('The planner has no visits to export.', 'warning'); return; }
      const name = `VISIT_PLAN_MARKAZ_${d.markazLabel.replace(/[^A-Za-z0-9]+/g, '')}_-_${C.MONTH_NAMES[S.month - 1].toUpperCase()}_${S.year}.xlsx`;
      await window.VisitPlannerExcel.download(d, name);
    } catch (e) { toast(e.message || 'Excel export failed', 'error'); }
  }

  function onPrint() {
    const d = sheetData();
    let pa = $('vpPrintArea');
    if (!pa) { pa = document.createElement('div'); pa.id = 'vpPrintArea'; document.body.appendChild(pa); }
    const h = d.hdr, days = C.DAY_NAMES;
    pa.innerHTML = `<div class="vpp-h">OFFICE OF THE ASSISTANT EDUCATION OFFICER (${h.gender})</div><div class="vpp-h">MARKAZ ${esc(h.markaz.toUpperCase())}, DISTRICT ${esc(h.district.toUpperCase())}</div><div class="vpp-h">${esc(h.title)}</div>` +
      `<table><thead><tr><th>Visit Date</th><th>Day</th><th>Emis Code</th><th>Morning Visit (School 1)</th><th>Emis Code</th><th>Mid-Day Visit (School 2)</th></tr></thead><tbody>` +
      d.rows.map(r => `<tr><td>${fmtDate(r.date)}</td><td>${days[C.dowOf(r.date)]}</td><td>${esc(r.s1 && !r.s1.office ? r.s1.emis : '')}</td><td>${esc(r.s1 ? (r.s1.office ? 'Office Work' : r.s1.name) : '')}</td><td>${esc(r.s2 && !r.s2.office ? r.s2.emis : '')}</td><td>${esc(r.s2 ? (r.s2.office ? 'Office Work' : r.s2.name) : '')}</td></tr>`).join('') +
      `</tbody></table><div class="vpp-sign">ASSISTANT EDUCATION OFFICER (${h.gender})<br>Markaz ${esc(h.markaz)}, District ${esc(h.districtTitle)}</div>`;
    document.body.classList.add('vp-printing');
    const done = () => { document.body.classList.remove('vp-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }

  // ─── Events ───────────────────────────────────────────────────────
  function wire() {
    const root = $('vpRoot');
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'pick') {
        const emis = b.dataset.emis, row = S.pool.find(r => String(r.emis) === emis);
        if (b.checked) S.selected.set(emis, row); else S.selected.delete(emis);
        b.closest('tr').classList.toggle('vp-sel', b.checked);
        $('vpSelCount').textContent = `${S.selected.size} selected · ${filteredPool().length} shown by filter · ${S.pool.length} in your jurisdiction`;
        if (S.planner) renderSheet();
      } else if (a === 'delDate') onDelDate(b.dataset.date);
    });
    root.addEventListener('change', e => {
      const t = e.target;
      if (t.classList.contains('vp-slot')) onSlotChange(t);
      else if (t.classList.contains('vp-date')) onDateChange(t);
      else if (t.id === 'vpLeaveCount') { const n = +t.value, boxes = getChecked('vpLeave'); setChecked('vpLeave', boxes.slice(0, n)); syncLeaveHint(); }
      else if (t.name === 'vpLeave') {
        if (getChecked('vpLeave').length > +$('vpLeaveCount').value) { t.checked = false; toast(`You can select only ${$('vpLeaveCount').value} leave day(s). Increase “Weekly Leave Days” first.`, 'warning'); }
        syncLeaveHint();
      }
    });
    $('vpSearch').addEventListener('input', e => { S.q = e.target.value; S.shown = 150; renderSchools(); });
    $('vpMarkazFilter').addEventListener('change', e => { S.markaz = e.target.value; S.shown = 150; renderSchools(); });
    $('vpSourceFilter').addEventListener('change', e => { S.source = e.target.value; S.shown = 150; renderSchools(); });
    $('vpMore').addEventListener('click', () => { S.shown += 250; renderSchools(); });
    $('vpSelectAll').addEventListener('click', () => { filteredPool().forEach(r => S.selected.set(String(r.emis), r)); renderSchools(); if (S.planner) renderSheet(); });
    $('vpClearSel').addEventListener('click', () => {
      const used = new Set(S.entries.map(e => e.emis_code));
      [...S.selected.keys()].forEach(k => { if (!used.has(k)) S.selected.delete(k); });
      renderSchools(); if (S.planner) renderSheet();
      if (used.size) toast('Schools that already have planned visits were kept.', 'info');
    });
    $('vpBtnLoad').addEventListener('click', () => enqueue(loadPeriod));
    $('vpBtnGen').addEventListener('click', onGenerate);
    $('vpBtnCreate').addEventListener('click', onCreateEmpty);
    $('vpBtnSave').addEventListener('click', onSave);
    $('vpBtnFinal').addEventListener('click', onFinalize);
    $('vpBtnDelete').addEventListener('click', onDelete);
    $('vpBtnAddDate').addEventListener('click', onAddDate);
    $('vpBtnExcel').addEventListener('click', onExcel);
    $('vpBtnPrint').addEventListener('click', onPrint);
    $('vpBtnRefresh').addEventListener('click', () => enqueue(async () => { await loadPool(true); renderSchools(); toast('School list refreshed.', 'success'); }));
    $('vpMarkazLabel').addEventListener('input', () => { if (S.planner) renderSheet(); });
  }
  function syncLeaveHint() { const n = +$('vpLeaveCount').value; $('vpLeaveHint').textContent = `Select ${n} weekday${n > 1 ? 's' : ''} (${getChecked('vpLeave').length}/${n} chosen). These are excluded from every month automatically.`; }

  function build() {
    const cur = new Date().getFullYear();
    $('vpRoot').innerHTML = `
    <div class="vp-card"><div class="vp-h2">Step 1 — Planner period</div>
      <div class="vp-row"><label>Year <input type="number" id="vpYear" min="1900" max="2200" value="${S.year}" class="vp-in" style="width:96px"></label>
      <label>Month <select id="vpMonth" class="vp-in">${C.MONTH_NAMES.map((n, i) => `<option value="${i + 1}" ${i + 1 === S.month ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <button class="vp-btn" id="vpBtnLoad">Open / Load</button></div>
      <div id="vpStatusBar" class="vp-status"></div></div>
    <div class="vp-card"><div class="vp-h2">Step 2 — Weekly leave &amp; settings</div>
      <div class="vp-row"><label>Weekly leave days <select id="vpLeaveCount" class="vp-in"><option>1</option><option selected>2</option><option>3</option></select></label></div>
      <div class="vp-days" id="vpLeaveDays">${DAY_SHORT.map((d, i) => `<label><input type="checkbox" name="vpLeave" value="${i}" ${i === 0 || i === 6 ? 'checked' : ''}> ${d}</label>`).join('')}</div>
      <div class="vp-muted" id="vpLeaveHint"></div>
      <div class="vp-row" style="margin-top:10px"><div><div class="vp-lbl">Office-work (mid-day) weekdays</div><div class="vp-days">${DAY_SHORT.map((d, i) => `<label><input type="checkbox" name="vpOffice" value="${i}" ${i === 5 ? 'checked' : ''}> ${d}</label>`).join('')}</div></div>
      <label>Start date (W.E.F.) <input type="date" id="vpStart" class="vp-in"></label>
      <label>Markaz label <input type="text" id="vpMarkazLabel" class="vp-in" placeholder="e.g. 93/ML (auto if blank)" style="width:170px"></label></div></div>
    <div class="vp-card"><div class="vp-h2">Step 3 — Schools <span class="vp-muted" id="vpSelCount"></span></div>
      <div class="vp-row"><input id="vpSearch" class="vp-in" placeholder="Search EMIS code or school name" style="flex:1;min-width:200px">
      <select id="vpMarkazFilter" class="vp-in"><option value="">All Markaz</option></select>
      <select id="vpSourceFilter" class="vp-in"><option value="">All types</option><option value="PUBLIC">Govt / Outsourced</option><option value="HIGH">High / H.Sec.</option><option value="PIEMA">PIEMA</option><option value="PEF">PEF</option><option value="PRIVATE">Private Schools</option><option value="ACADEMY">Private Academies</option></select>
      <button class="vp-btn vp-ghost" id="vpSelectAll">Select all shown</button><button class="vp-btn vp-ghost" id="vpClearSel">Clear</button><button class="vp-btn vp-ghost" id="vpBtnRefresh" title="Reload the school list">↻</button></div>
      <div class="vp-scroll" style="max-height:340px"><table class="vp-table vp-small"><thead><tr><th></th><th>EMIS</th><th>School</th><th>Markaz</th><th>Tehsil</th><th>Wing</th><th>Level / Type</th></tr></thead><tbody id="vpSchoolBody"></tbody></table></div>
      <button class="vp-btn vp-ghost" id="vpMore" style="display:none;margin-top:6px"></button></div>
    <div class="vp-card"><div class="vp-h2">Step 4 — Generate, review &amp; save</div>
      <div class="vp-row"><button class="vp-btn vp-primary" id="vpBtnGen">⚙ Generate Planner</button><button class="vp-btn" id="vpBtnCreate">Create empty planner</button>
      <button class="vp-btn" id="vpBtnAddDate">+ Add visit date</button><button class="vp-btn" id="vpBtnSave">💾 Save Planner</button><button class="vp-btn" id="vpBtnFinal">Mark as Finalized</button>
      <button class="vp-btn vp-excel" id="vpBtnExcel">⬇ Download Excel</button><button class="vp-btn" id="vpBtnPrint">🖨 Print</button><button class="vp-btn vp-danger" id="vpBtnDelete">Delete planner</button></div>
      <div class="vp-muted" style="margin-top:6px">Every change below is saved to the database immediately — no need to regenerate after a small correction.</div>
      <div id="vpAlerts"></div><div id="vpSheet"></div></div>`;
    wire(); syncLeaveHint();
  }

  async function open() {
    if (typeof switchGlobalTab === 'function') switchGlobalTab('visitPlannerView', null);
    try {
      if (!S.inited) { build(); S.inited = true; }
      const uid = await getUserId();
      if (!uid) { toast('Session expired — please sign in again.', 'error'); return; }
      if (S.userId !== uid) { S.userId = uid; S.pool = null; S.planner = null; S.entries = []; S.selected = new Map(); }
      await loadPool(false);
      await enqueue(loadPeriod);
    } catch (e) { console.error(e); toast(e.message || 'Could not open Visit Planner', 'error'); }
  }

  window.openVisitPlannerView = open;
  // Register the hash route without editing index.js (ROUTES is a global lexical binding there).
  try { if (typeof ROUTES === 'object') ROUTES['visit-planner'] = () => open(); } catch (e) { /* router not ready */ }
  window.addEventListener('load', () => { try { if (typeof ROUTES === 'object' && !ROUTES['visit-planner']) ROUTES['visit-planner'] = () => open(); } catch (e) {} });
})();
