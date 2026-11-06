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
    q: '', markaz: '', source: '', shown: 150, queue: Promise.resolve(),
    targets: [], holidays: [], jsel: { d: '', w: '', t: '', m: '' }, catSel: new Map(), editHol: null, step: 1, noHol: false
  };
  const STEPS = ['Month & jurisdiction', 'School categories', 'Private-school reason', 'Holidays', 'Leave & schools', 'Plan & submit'];
  const HOLTYPE = { gazetted: 'Gazetted holiday', local: 'Local holiday' };

  const $  = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'info'); };
  const sb = () => window._supabase;
  const fmtDate = s => { const [y, m, d] = s.split('-').map(Number); return `${String(d).padStart(2, '0')} ${C.MONTH_NAMES[m - 1].slice(0, 3)} ${y}`; };
  const enqueue = fn => (S.queue = S.queue.then(fn, fn).catch(e => { console.error(e); toast(e.message || 'Operation failed', 'error'); }));

  // Whole-day entries: 'leave' (On Leave) and 'other_duty' (Other Duty + comment)
  const isSpecial = e => !!e && (e.entry_type === 'leave' || e.entry_type === 'other_duty');
  const specialText = e => e.entry_type === 'leave' ? 'ON LEAVE' : 'OTHER DUTY' + (e.comment ? ': ' + e.comment : '');


  // ─── Wizard helpers ───────────────────────────────────────────────
  const uniq = a => [...new Set(a.filter(x => x != null && x !== ''))].sort();
  const jurSaved = () => { const p = S.planner; return p && p.jur_district && p.jur_wing && p.jur_tehsil && p.jur_markaz ? { d: p.jur_district, w: p.jur_wing, t: p.jur_tehsil, m: p.jur_markaz } : null; };
  // Same predicate as the database (visit_planner_save_categories): HIGH schools are wing-agnostic, markaz 'ALL' = whole tehsil.
  const inJur = (r, j) => r.district === j.d && r.tehsil === j.t && (r.source === 'HIGH' || r.wing === j.w) && (j.m === 'ALL' || r.markaz_name === j.m);
  function jurPool() { const j = jurSaved(); return !S.pool ? [] : j ? S.pool.filter(r => inJur(r, j)) : S.pool; }
  function eligiblePool() {
    const rows = jurPool();
    if (!S.targets.length) return rows;
    const cats = new Set(S.targets.map(t => t.category));
    return rows.filter(r => cats.has(r.source));
  }
  const hasPrivate = () => S.targets.some(t => t.category === 'PRIVATE' || t.category === 'ACADEMY');
  const isLegacy = () => !!(S.planner && S.planner.config_legacy);
  const locked = () => !!(S.planner && S.planner.status === 'finalized');
  const cfg = () => (S.planner ? S.planner.config_step : 0);
  const stepNA = n => n === 3 && !hasPrivate() && cfg() >= 2;
  function maxStep() { let m = Math.min(6, cfg() + 1); if (m === 3 && stepNA(3)) m = 4; return m; }
  function configIssues() {
    const p = S.planner, out = [];
    if (!p) return ['Save Step 1 (month and jurisdiction).'];
    if (p.config_legacy) return out;
    if (!jurSaved()) out.push('Step 1: District, Wing, Tehsil and Markaz are not saved.');
    if (!S.targets.length) out.push('Step 2: select at least one school category with Min/Max visits.');
    if (hasPrivate() && !(p.private_visit_reason || '').trim()) out.push('Step 3: the reason for visiting private schools is mandatory.');
    if (!S.holidays.length && !p.no_holidays_confirmed) out.push('Step 4: add holidays or confirm that this month has none.');
    if (p.config_step < 5) out.push('Step 5: save the leave settings and choose the schools.');
    return out;
  }
  const dateInMonth = d => !!d && +d.slice(0, 4) === S.year && +d.slice(5, 7) === S.month;
  const holMap = () => new Map(S.holidays.map(h => [h.date, h]));
  const holDates = () => S.holidays.map(h => h.date);
  function stepMsg(text, kind) { const el = $('vpStepMsg'); if (!el) return; el.textContent = text || ''; el.className = 'vp-stepmsg' + (text ? (kind === 'ok' ? ' is-ok' : ' is-err') : ''); }

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
  }
  function fillMarkazFilter() {
    const mk = uniq(eligiblePool().map(r => r.markaz_name));
    if (S.markaz && !mk.includes(S.markaz)) S.markaz = '';
    $('vpMarkazFilter').innerHTML = '<option value="">All Markaz</option>' + mk.map(m => `<option value="${esc(m)}" ${m === S.markaz ? 'selected' : ''}>${esc(m)}</option>`).join('');
  }

  async function loadPeriod() {
    S.year = parseInt($('vpYear').value, 10); S.month = parseInt($('vpMonth').value, 10);
    if (!(S.year >= 1900 && S.year <= 2200)) { toast('Enter a valid year', 'error'); return; }
    $('vpStatusBar').innerHTML = '<span class="vp-muted">Loading planner…</span>';
    const { data: p, error } = await sb().from('visit_planners').select('*').eq('user_id', S.userId).eq('year', S.year).eq('month', S.month).maybeSingle();
    if (error) { toast(error.message, 'error'); return; }
    S.planner = p || null; S.entries = []; S.extraDates = new Set(); S.selected = new Map(); S.targets = []; S.holidays = []; S.editHol = null; S.noHol = false; S.autoSel = false;
    if (p) {
      const [tg, hl] = await Promise.all([
        sb().from('visit_planner_category_targets').select('category,min_visits,max_visits').eq('planner_id', p.id).order('category'),
        sb().from('visit_planner_holidays').select('id,holiday_date,holiday_type,name').eq('planner_id', p.id).order('holiday_date')]);
      if (tg.error || hl.error) { toast((tg.error || hl.error).message, 'error'); return; }
      S.targets = tg.data || [];
      S.holidays = (hl.data || []).map(h => ({ id: h.id, date: h.holiday_date, type: h.holiday_type, name: h.name }));
      const { data: ents, error: e2 } = await sb().from('visit_planner_entries').select('*').eq('planner_id', p.id).order('visit_date').order('slot');
      if (e2) { toast(e2.message, 'error'); return; }
      S.entries = ents || [];
      applyPlannerToSettings(p);
      S.entries.filter(e => e.entry_type === 'school').forEach(e => { if (!S.selected.has(e.emis_code)) S.selected.set(e.emis_code, schoolFromEntry(e)); });
    } else {
      applyDefaultSettings();
    }
    initWizardState();
    renderAll();
  }
  function initWizardState() {
    const j = jurSaved();
    S.jsel = j ? { ...j } : { d: '', w: '', t: '', m: '' };
    S.catSel = new Map(S.targets.map(t => [t.category, { min: String(t.min_visits), max: String(t.max_visits) }]));
    S.step = S.planner ? Math.min(maxStep(), 6) : 1;
    if (S.planner && (S.planner.config_legacy || S.planner.status === 'finalized')) S.step = 6;
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
  function renderAll() { fillMarkazFilter(); renderStatus(); renderWizard(); renderSchools(); renderSheet(); }

  function renderStatus() {
    const p = S.planner;
    const badge = p ? `<span class="vp-badge vp-st-${esc(p.status)}">${esc(p.status)}</span>` : '<span class="vp-badge vp-st-new">not saved yet</span>';
    $('vpStatusBar').innerHTML = `<strong>${C.MONTH_NAMES[S.month - 1]} ${S.year}</strong> ${badge}` +
      (p ? ` <span class="vp-muted">· last saved ${new Date(p.updated_at).toLocaleString()}</span>` : ' <span class="vp-muted">· no planner exists for this month — select schools and press Generate, or create an empty planner.</span>');
    const has = !!p, ready = has && cfg() >= 5, lk = locked();
    ['vpBtnSave', 'vpBtnExcel', 'vpBtnPrint', 'vpBtnAddDate', 'vpBtnDelete'].forEach(id => { $(id).disabled = !has; });
    ['vpBtnGen', 'vpBtnCreate', 'vpBtnAddDate'].forEach(id => { $(id).disabled = !ready || lk; });
    $('vpBtnCreate').style.display = has && S.entries.length ? 'none' : '';
    $('vpBtnFinal').textContent = lk ? 'Re-open for editing' : 'Mark as Finalized';
    $('vpBtnFinal').disabled = !has || (!lk && configIssues().length > 0);
    $('vpBtnFinal').title = !lk && configIssues().length ? 'Complete every configuration step first' : '';
    const note = $('vpLockNote');
    note.textContent = lk ? 'This plan is finalized. Re-open it to change visits, categories or holidays.' : configIssues().length ? 'Final submission is disabled until every mandatory step is valid: ' + configIssues().join(' ') : '';
    note.style.display = note.textContent ? '' : 'none';
  }

  function filteredPool() {
    if (!S.pool) return [];
    const q = S.q.trim().toLowerCase();
    return eligiblePool().filter(r =>
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
    $('vpSelCount').textContent = `${S.selected.size} selected · ${rows.length} shown by filter · ${eligiblePool().length} eligible for this plan`;
  }

  function byDate() {
    const m = new Map();
    S.entries.forEach(e => { if (!m.has(e.visit_date)) m.set(e.visit_date, {}); m.get(e.visit_date)[e.slot] = e; });
    S.extraDates.forEach(d => { if (!m.has(d)) m.set(d, {}); });
    return new Map([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }

  function slotSelect(date, slot, e, dis) {
    const val = !e ? '' : e.entry_type === 'office' ? 'O' : 'S:' + e.emis_code;
    const schools = [...S.selected.values()];
    const opts = ['<option value="">— empty —</option>', `<option value="O" ${val === 'O' ? 'selected' : ''}>Office Work</option>`]
      .concat(schools.map(s => `<option value="S:${esc(s.emis)}" ${val === 'S:' + s.emis ? 'selected' : ''}>${esc(s.school_name)} (${esc(s.emis)})</option>`));
    const seq = e && e.entry_type === 'school' && e.visit_sequence ? `<span class="vp-seq">visit ${e.visit_sequence}</span>` : '';
    return `<select class="vp-slot" ${dis ? 'disabled' : ''} data-date="${date}" data-slot="${slot}" aria-label="School for slot ${slot}">${opts.join('')}</select>${seq}`;
  }

  function renderSheet() {
    const box = $('vpSheet');
    if (!S.planner) { box.innerHTML = ''; $('vpAlerts').innerHTML = ''; return; }
    C.assignSequences(S.entries);
    const dates = byDate(), hm = holMap();
    const [y, m] = [S.year, S.month];
    const hdr = headerInfo();
    const all = new Map(dates); hm.forEach((h, d) => { if (!all.has(d)) all.set(d, {}); });
    const lk = locked();
    const rows = [...new Map([...all.entries()].sort((a, b) => a[0].localeCompare(b[0]))).entries()].map(([date, sl]) => {
      const dow = C.dowOf(date), e1 = sl[1], e2 = sl[2];
      const hol = hm.get(date);
      if (hol) return `<tr class="vp-hol vp-hol-${esc(hol.type)}"><td class="vp-mono">${fmtDate(date)}</td><td>${C.DAY_NAMES[dow]}</td>` +
        `<td colspan="4"><span class="vp-hbadge vp-hb-${esc(hol.type)}">${esc(HOLTYPE[hol.type] || hol.type)}</span> ${esc(hol.name)} <span class="vp-muted">— non-working day</span></td><td>Holiday</td><td></td></tr>`;
      const bad = new Set(S.planner.leave_days || []).has(dow);
      const dis = lk ? 'disabled' : '';
      const sp = isSpecial(e1) ? e1 : null;
      const mid = sp
        ? `<td colspan="4" class="vp-special vp-sp-${sp.entry_type}"><strong>${sp.entry_type === 'leave' ? 'ON LEAVE' : 'OTHER DUTY'}</strong>` +
          (sp.entry_type === 'other_duty' ? ` <input type="text" class="vp-comment" ${dis} data-id="${sp.id}" maxlength="500" placeholder="Comment — what was the duty?" value="${esc(sp.comment || '')}">` : '') + `</td>`
        : `<td class="vp-mono">${esc(e1 && e1.entry_type === 'school' ? e1.emis_code : '')}</td><td>${slotSelect(date, 1, e1, lk)}</td>` +
          `<td class="vp-mono">${esc(e2 && e2.entry_type === 'school' ? e2.emis_code : '')}</td><td>${slotSelect(date, 2, e2, lk)}</td>`;
      const dt = sp ? sp.entry_type : '';
      return `<tr class="${bad ? 'vp-bad' : ''}">` +
        `<td><input type="date" class="vp-date" ${dis} value="${date}" data-old="${date}" min="${C.iso(y, m, 1)}" max="${C.iso(y, m, C.daysInMonth(y, m))}"></td>` +
        `<td>${C.DAY_NAMES[dow]}</td>${mid}` +
        `<td><select class="vp-daytype" ${dis} data-date="${date}" aria-label="Day status"><option value="" ${dt === '' ? 'selected' : ''}>School visits</option><option value="leave" ${dt === 'leave' ? 'selected' : ''}>On Leave</option><option value="other_duty" ${dt === 'other_duty' ? 'selected' : ''}>Other Duty</option></select></td>` +
        `<td><button class="vp-icon" ${dis} data-act="delDate" data-date="${date}" title="Delete this date">✕</button></td></tr>`;
    }).join('');
    box.innerHTML = `<div class="vp-paper"><div class="vp-ph">OFFICE OF THE ASSISTANT EDUCATION OFFICER (${hdr.gender})</div>` +
      `<div class="vp-ph">MARKAZ ${esc(hdr.markaz.toUpperCase())}, DISTRICT ${esc(hdr.district.toUpperCase())}</div>` +
      `<div class="vp-ph">${esc(hdr.title)}</div></div>` +
      `<div class="vp-scroll"><table class="vp-table"><thead><tr><th>Visit Date</th><th>Day</th><th>Emis Code</th><th>Morning Visit (School 1)</th><th>Emis Code</th><th>Mid-Day Visit (School 2)</th><th>Day status</th><th></th></tr></thead>` +
      `<tbody>${rows || '<tr><td colspan="8" class="vp-muted">No visit dates yet — use “Generate Planner” or “+ Add visit date”.</td></tr>'}</tbody></table></div>` +
      holSummaryHtml() +
      `<div class="vp-sign">ASSISTANT EDUCATION OFFICER (${hdr.gender})<br>Markaz ${esc(hdr.markaz)}, District ${esc(hdr.districtTitle)}</div>`;
    renderAlerts();
  }

  function holSummaryHtml() {
    const p = S.planner, rsn = p && hasPrivate() && p.private_visit_reason ? `<div class="vp-note"><strong>Reason for visiting private schools:</strong> ${esc(p.private_visit_reason)}</div>` : '';
    if (!S.holidays.length) return rsn;
    return `<div class="vp-hsum"><div class="vp-h2">Holidays — ${C.MONTH_NAMES[S.month - 1]} ${S.year}</div><table class="vp-table vp-small" style="min-width:0"><thead><tr><th>Date</th><th>Holiday</th><th>Type</th></tr></thead><tbody>` +
      S.holidays.map(h => `<tr class="vp-hol vp-hol-${esc(h.type)}"><td>${fmtDate(h.date)}</td><td>${esc(h.name)}</td><td><span class="vp-hbadge vp-hb-${esc(h.type)}">${esc(HOLTYPE[h.type] || h.type)}</span></td></tr>`).join('') + `</tbody></table></div>` + rsn;
  }

  function renderAlerts() {
    const p = S.planner; if (!p) return;
    const msgs = C.validate({ year: S.year, month: S.month, leaveDays: p.leave_days, entries: S.entries, schools: [...S.selected.values()], poolEmis: S.poolEmis, holidays: S.holidays, targets: targetsForCore() });
    $('vpAlerts').innerHTML = msgs.length
      ? `<div class="vp-alerts"><strong>Checks (${msgs.length})</strong><ul>${msgs.slice(0, 60).map(x => `<li class="vp-${x.level}">${esc(x.msg)}</li>`).join('')}</ul></div>`
      : `<div class="vp-alerts vp-allok">✔ All checks passed — every selected school has at least ${C.MIN_VISITS} visits, no leave-day or duplicate-date problems.</div>`;
  }

  const targetsForCore = () => S.targets.map(t => ({ category: t.category, min: t.min_visits, max: t.max_visits }));

  // kind: 'tentative' | 'actual'. schools: [{ markaz_name }]
  function makeHeader(schools, typedLabel, startDate, kind, year, month) {
    const names = schools.map(s => s.markaz_name).filter(Boolean);
    const counts = {}; names.forEach(n => counts[n] = (counts[n] || 0) + 1);
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const markaz = typedLabel || (top.length ? [...new Set(top.map(C.markazShort))].slice(0, 3).join(' / ') : '—');
    const fem = names.filter(n => /FEMALE/i.test(n)).length, mal = names.filter(n => /\bMALE\b/i.test(n) && !/FEMALE/i.test(n)).length;
    const u = (typeof currentUser !== 'undefined' && currentUser) || {};
    const gender = fem > mal ? 'F' : mal > fem ? 'M' : (/^W/i.test(u.wing || '') ? 'F' : 'M');
    const district = (S.pool && S.pool[0] && S.pool[0].district) || u.district || 'LAYYAH';
    const mon = C.MONTH_NAMES[month - 1].toUpperCase();
    const wef = startDate ? ` (W.E.F. ${startDate.slice(8, 10)} ${mon} ${year})` : '';
    const title = kind === 'actual' ? `ACTUAL SCHOOL VISITS FOR ${mon} ${year}` : `TENTATIVE SCHOOL VISIT PLAN FOR ${mon} ${year}${wef}`;
    return { gender, markaz, district, districtTitle: district.charAt(0) + district.slice(1).toLowerCase(), title };
  }
  function headerInfo() {
    const typed = $('vpMarkazLabel').value.trim() || (S.planner && S.planner.markaz_label) || '';
    return makeHeader([...S.selected.values()], typed, S.planner && S.planner.start_date, 'tentative', S.year, S.month);
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
      const base = { user_id: S.userId, year: S.year, month: S.month, weekly_leave_count: s.count, leave_days: s.leave, office_work_days: s.office, start_date: s.start, markaz_label: s.markazLabel || null };
      const { data, error } = await sb().from('visit_planners').insert(base).select().single();
      if (error) throw error; S.planner = data;
      if (extra && Object.keys(extra).length) await patchPlanner(extra);
    }
    return S.planner;
  }
  async function patchPlanner(patch) {
    const { data, error } = await sb().from('visit_planners').update(patch).eq('id', S.planner.id).select().single();
    if (error) throw error; S.planner = data; return data;
  }
  async function refreshPlanner() {
    const { data, error } = await sb().from('visit_planners').select('*').eq('id', S.planner.id).single();
    if (error) throw error; S.planner = data; return data;
  }
  const settingsBody = () => { const s = settings(); return { weekly_leave_count: s.count, leave_days: s.leave, office_work_days: s.office, start_date: s.start, markaz_label: s.markazLabel || null }; };

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
      if (cfg() < 5 || locked()) { toast('Complete all configuration steps (and re-open a finalized plan) first.', 'error'); return; }
      const ok = new Set(eligiblePool().map(r => String(r.emis)));
      const schools = [...S.selected.values()].filter(r => ok.has(String(r.emis)));
      if (!schools.length) { toast('Select at least one eligible school first.', 'error'); return; }
      if (S.entries.length && !confirm('Generating again will replace all existing school visits in this month’s planner (days marked On Leave / Other Duty are kept). Continue?')) return;
      const s = settings();
      const keep = S.entries.filter(isSpecial).map(e => ({ visit_date: e.visit_date, slot: 1, entry_type: e.entry_type, comment: e.comment || null }));
      const tg = targetsForCore();
      const g = C.generate({ year: S.year, month: S.month, leaveDays: s.leave, officeDays: s.office, startDay: startDay(), schools, blockedDates: keep.map(k => k.visit_date), holidayDates: holDates(), targets: tg });
      await patchPlanner(Object.assign(settingsBody(), { status: 'generated' }));
      const del = await sb().from('visit_planner_entries').delete().eq('planner_id', S.planner.id);
      if (del.error) throw del.error;
      const ents = C.assignSequences(C.rowsToEntries(g.rows).concat(keep)).map(e => Object.assign({ planner_id: S.planner.id, user_id: S.userId }, e));
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
      await patchPlanner({ status: 'draft' }); renderAll(); toast('Empty planner created. Add visit dates and schools below.', 'success');
    });
  }

  function onSave() {
    return enqueue(async () => {
      const err = settingsError(); if (err) { toast(err, 'error'); return; }
      if (!locked()) await patchPlanner(settingsBody());
      renderAll(); toast('Planner saved.', 'success');
    });
  }

  function onFinalize() {
    return enqueue(async () => {
      const finalized = S.planner.status === 'finalized';
      if (!finalized) {
        const errs = C.validate({ year: S.year, month: S.month, leaveDays: S.planner.leave_days, entries: S.entries, schools: [...S.selected.values()], poolEmis: S.poolEmis, holidays: S.holidays, targets: targetsForCore() });
        if (errs.some(x => x.level === 'error')) { toast('Fix the errors listed under “Checks” before finalizing.', 'error'); return; }
        if (errs.length && !confirm(`${errs.length} warning(s) remain (e.g. schools with fewer than 2 visits). Finalize anyway?`)) return;
      }
      if (!finalized && configIssues().length) { toast(configIssues()[0], 'error'); return; }
      await patchPlanner({ status: finalized ? 'edited' : 'finalized' }); renderAll();
      toast(finalized ? 'Planner re-opened for editing.' : 'Planner marked as finalized.', 'success');
    });
  }

  function onDelete() {
    return enqueue(async () => {
      if (!confirm(`Delete the whole ${C.MONTH_NAMES[S.month - 1]} ${S.year} planner and all its visits? This cannot be undone.`)) return;
      const { error } = await sb().from('visit_planners').delete().eq('id', S.planner.id);
      if (error) throw error;
      S.planner = null; S.entries = []; S.targets = []; S.holidays = []; S.extraDates = new Set(); applyDefaultSettings(); initWizardState(); renderAll(); toast('Planner deleted.', 'success');
    });
  }

  function onSlotChange(sel) {
    const date = sel.dataset.date, slot = +sel.dataset.slot, v = sel.value;
    return enqueue(async () => {
      if (holMap().has(date)) { toast('This date is a holiday — no visits can be assigned.', 'error'); renderSheet(); return; }
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

  function onDayType(sel) {
    const date = sel.dataset.date, v = sel.value;
    return enqueue(async () => {
      const cur = S.entries.filter(e => e.visit_date === date);
      const curType = isSpecial(cur[0]) ? cur[0].entry_type : '';
      if (v === curType) return;
      if (v && holMap().has(date)) { toast('This date is a holiday — no visits can be assigned.', 'error'); sel.value = curType; return; }
      if ((S.planner.leave_days || []).includes(C.dowOf(date)) && v) { toast(`${C.DAY_NAMES[C.dowOf(date)]} is a weekly leave day.`, 'error'); sel.value = curType; return; }
      if (cur.length && v && !curType && !confirm(`Replace the school visits on ${fmtDate(date)} with “${v === 'leave' ? 'On Leave' : 'Other Duty'}”?`)) { sel.value = curType; return; }
      if (cur.length) {
        const { error } = await sb().from('visit_planner_entries').delete().eq('planner_id', S.planner.id).eq('visit_date', date);
        if (error) throw error;
        S.entries = S.entries.filter(e => e.visit_date !== date);
      }
      if (v) {
        const row = { planner_id: S.planner.id, user_id: S.userId, visit_date: date, slot: 1, entry_type: v, comment: null };
        const { data, error } = await sb().from('visit_planner_entries').insert(row).select().single();
        if (error) throw error; S.entries.push(data); S.extraDates.delete(date);
      } else S.extraDates.add(date);
      await persistSequences(); await markEdited(); renderStatus(); renderSheet();
    }).then(() => renderSheet());
  }

  function onCommentChange(inp) {
    const id = inp.dataset.id, text = inp.value.trim().slice(0, 500) || null;
    return enqueue(async () => {
      const ex = S.entries.find(e => e.id === id); if (!ex) return;
      const { data, error } = await sb().from('visit_planner_entries').update({ comment: text }).eq('id', id).select().single();
      if (error) throw error; Object.assign(ex, data);
      await markEdited(); renderStatus();
    });
  }

  function onDateChange(inp) {
    const old = inp.dataset.old, nu = inp.value;
    return enqueue(async () => {
      const revert = () => { inp.value = old; };
      if (!nu || nu === old) return revert();
      if (+nu.slice(0, 4) !== S.year || +nu.slice(5, 7) !== S.month) { toast('The date must stay inside the planner month.', 'error'); return revert(); }
      if ((S.planner.leave_days || []).includes(C.dowOf(nu))) { toast(`${C.DAY_NAMES[C.dowOf(nu)]} is a weekly leave day.`, 'error'); return revert(); }
      if (holMap().has(nu)) { toast(`${fmtDate(nu)} is a ${holMap().get(nu).type} holiday (${holMap().get(nu).name}).`, 'error'); return revert(); }
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
      const next = C.workingDates(S.year, S.month, S.planner.leave_days, 1, holDates()).find(d => !have.has(d.iso));
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
    const hm = holMap();
    const vis = [...byDate().entries()].filter(([d, sl]) => !hm.has(d) && (sl[1] || sl[2])).map(([date, sl]) =>
      isSpecial(sl[1]) ? { date, special: specialText(sl[1]) } : { date, s1: f(sl[1]), s2: f(sl[2]) });
    const rows = vis.concat(S.holidays.map(h => ({ date: h.date, holiday: { type: h.type, name: h.name } }))).sort((a, b) => a.date.localeCompare(b.date));
    return { year: S.year, month: S.month, startDate: S.planner.start_date, genderTag: hdr.gender, markazLabel: hdr.markaz, district: hdr.district, rows, hdr,
      holidays: S.holidays.map(h => ({ date: h.date, type: h.type, name: h.name })), privateReason: hasPrivate() ? (S.planner.private_visit_reason || '') : '' };
  }

  async function onExcel() {
    try {
      const d = sheetData();
      if (!d.rows.some(r => !r.holiday)) { toast('The planner has no visits to export.', 'warning'); return; }
      const name = `VISIT_PLAN_MARKAZ_${d.markazLabel.replace(/[^A-Za-z0-9]+/g, '')}_-_${C.MONTH_NAMES[S.month - 1].toUpperCase()}_${S.year}.xlsx`;
      await window.VisitPlannerExcel.download(d, name);
    } catch (e) { toast(e.message || 'Excel export failed', 'error'); }
  }

  function onPrint() { printSheet(sheetData()); }

  function printSheet(d) {
    let pa = $('vpPrintArea');
    if (!pa) { pa = document.createElement('div'); pa.id = 'vpPrintArea'; document.body.appendChild(pa); }
    const h = d.hdr, days = C.DAY_NAMES;
    const cols = d.columns || ['Visit Date', 'Day', 'Emis Code', 'Morning Visit (School 1)', 'Emis Code', 'Mid-Day Visit (School 2)'];
    const hol = r => `<tr class="vpp-hol vpp-hol-${esc(r.holiday.type)}"><td>${fmtDate(r.date)}</td><td>${days[C.dowOf(r.date)]}</td><td colspan="${cols.length - 2}" style="text-align:center;font-weight:bold">${esc((HOLTYPE[r.holiday.type] || 'Holiday').toUpperCase())} — ${esc(r.holiday.name)}</td></tr>`;
    const hs = (d.holidays || []).length
      ? `<div class="vpp-sub">Holidays — ${C.MONTH_NAMES[d.month - 1]} ${d.year}</div><table class="vpp-hsum"><thead><tr><th>Date</th><th>Holiday</th><th>Type</th></tr></thead><tbody>` +
        d.holidays.map(x => `<tr class="vpp-hol vpp-hol-${esc(x.type)}"><td>${fmtDate(x.date)}</td><td>${esc(x.name)}</td><td>${esc(HOLTYPE[x.type] || x.type)}</td></tr>`).join('') + `</tbody></table>` : '';
    pa.innerHTML = `<div class="vpp-h">OFFICE OF THE ASSISTANT EDUCATION OFFICER (${h.gender})</div><div class="vpp-h">MARKAZ ${esc(h.markaz.toUpperCase())}, DISTRICT ${esc(h.district.toUpperCase())}</div><div class="vpp-h">${esc(h.title)}</div>` +
      `<table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>` +
      d.rows.map(r => r.holiday ? hol(r) : r.cells
        ? `<tr><td>${fmtDate(r.date)}</td><td>${days[C.dowOf(r.date)]}</td>${r.cells.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`
        : r.special
        ? `<tr><td>${fmtDate(r.date)}</td><td>${days[C.dowOf(r.date)]}</td><td colspan="4" style="text-align:center;font-weight:bold">${esc(r.special)}</td></tr>`
        : `<tr><td>${fmtDate(r.date)}</td><td>${days[C.dowOf(r.date)]}</td><td>${esc(r.s1 && !r.s1.office ? r.s1.emis : '')}</td><td>${esc(r.s1 ? (r.s1.office ? 'Office Work' : r.s1.name) : '')}</td><td>${esc(r.s2 && !r.s2.office ? r.s2.emis : '')}</td><td>${esc(r.s2 ? (r.s2.office ? 'Office Work' : r.s2.name) : '')}</td></tr>`).join('') +
      `</tbody></table>${hs}` + (d.privateReason ? `<div class="vpp-note"><strong>Reason for visiting private schools:</strong> ${esc(d.privateReason)}</div>` : '') +
      `<div class="vpp-sign">ASSISTANT EDUCATION OFFICER (${h.gender})<br>Markaz ${esc(h.markaz)}, District ${esc(h.districtTitle)}</div>`;
    document.body.classList.add('vp-printing');
    const done = () => { document.body.classList.remove('vp-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }

  // ─── Step-by-step configuration wizard ────────────────────────────
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;

  function renderWizard() {
    const lk = locked(), mx = S.planner ? maxStep() : 1;
    if (S.step > mx && !(S.planner && (S.planner.config_legacy || lk) && S.step === 6)) S.step = mx;
    if (stepNA(S.step)) S.step = 4;
    if (S.step === 5 && !locked() && !S.autoSel) {   // first visit to the schools step: pre-tick every eligible school once
      S.autoSel = true; const ok = eligiblePool(); if (!ok.some(r => S.selected.has(String(r.emis)))) ok.forEach(r => S.selected.set(String(r.emis), r));
    }
    $('vpStepper').innerHTML = STEPS.map((t, i) => {
      const n = i + 1, na = stepNA(n), done = S.planner && (na || cfg() >= n) && !(n === 1 && !jurSaved() && !isLegacy());
      const accessible = !!S.planner ? (n <= mx || (isLegacy() && n <= 6)) && !na : n === 1;
      const cls = ['vp-step', n === S.step ? 'is-active' : '', done ? 'is-done' : '', !accessible ? 'is-locked' : '', na ? 'is-na' : ''].join(' ');
      return `<li><button type="button" class="${cls}" data-act="goStep" data-step="${n}" ${accessible ? '' : 'disabled'} aria-current="${n === S.step ? 'step' : 'false'}">` +
        `<span class="vp-st-n">${done && !na ? '✔' : na ? '–' : n}</span><span class="vp-st-t">${esc(t)}${na ? ' (n/a)' : ''}</span></button></li>`;
    }).join('');
    document.querySelectorAll('#vpWizard .vp-pane').forEach(el => { el.style.display = +el.dataset.pane === S.step ? '' : 'none'; });
    document.querySelectorAll('#vpWizard .vp-fs').forEach(el => { el.disabled = lk; });
    renderJur(); renderCats(); renderPriv(); renderHolidays(); renderSummary();
    $('vpPrev').style.display = S.step > 1 ? '' : 'none';
    $('vpNext').style.display = S.step < 6 ? '' : 'none';
    $('vpSaveProg').style.display = S.step < 6 ? '' : 'none';
    [$('vpNext'), $('vpSaveProg')].forEach(b => { b.disabled = lk; });
    if (lk && S.step < 6) stepMsg('Plan is finalized — re-open it (last step) to change this configuration.', 'err');
  }

  // Step 1 ------------------------------------------------------------
  function renderJur() {
    if (!S.pool) return;
    const j = S.jsel;
    const ds = uniq(S.pool.map(r => r.district));
    if (!j.d && ds.length === 1) j.d = ds[0];
    let ws = uniq(S.pool.filter(r => r.district === j.d && r.source !== 'HIGH').map(r => r.wing));
    if (!ws.length) ws = uniq(S.pool.filter(r => r.district === j.d).map(r => r.wing));
    if (j.d && !j.w && ws.length === 1) j.w = ws[0];
    const wingOk = r => r.district === j.d && (r.source === 'HIGH' || r.wing === j.w);
    const ts = j.w ? uniq(S.pool.filter(wingOk).map(r => r.tehsil)) : [];
    if (j.w && !j.t && ts.length === 1) j.t = ts[0];
    const ms = j.t ? uniq(S.pool.filter(r => wingOk(r) && r.tehsil === j.t).map(r => r.markaz_name)) : [];
    if (j.t && !j.m && ms.length === 1) j.m = ms[0];
    const fill = (id, label, list, val, extra) => { const el = $(id); el.innerHTML = opt('', label, !val) + (extra || '') + list.map(x => opt(x, x, x === val)).join(''); el.value = val || ''; };
    fill('vpJDistrict', '— Select district —', ds, j.d);
    fill('vpJWing', '— Select wing —', ws, j.w);
    fill('vpJTehsil', '— Select tehsil —', ts, j.t);
    fill('vpJMarkaz', '— Select markaz —', ms, j.m, ms.length > 1 ? opt('ALL', 'All Markaz in this Tehsil', j.m === 'ALL') : '');
    $('vpJWing').disabled = !j.d; $('vpJTehsil').disabled = !j.w; $('vpJMarkaz').disabled = !j.t;
    $('vpJMonthTxt').textContent = `${C.MONTH_NAMES[S.month - 1]} ${S.year}`;
  }
  function onJurChange(level, val) {
    const j = S.jsel; j[level] = val;
    if (level === 'd') { j.w = ''; j.t = ''; j.m = ''; } else if (level === 'w') { j.t = ''; j.m = ''; } else if (level === 't') j.m = '';
    renderJur(); stepMsg('');
  }
  async function saveJur() {
    const j = S.jsel;
    if (isLegacy() && !(j.d && j.w && j.t && j.m)) return true;     // existing plans: setup steps are optional
    if (!j.d) return stepFail('Select a District.');
    if (!j.w) return stepFail('Select a Wing.');
    if (!j.t) return stepFail('Select a Tehsil.');
    if (!j.m) return stepFail('Select a Markaz (or “All Markaz in this Tehsil”).');
    const was = jurSaved();
    const changed = !!was && (was.d !== j.d || was.w !== j.w || was.t !== j.t || was.m !== j.m);
    if (changed && !isLegacy() && cfg() >= 2 && !confirm('Changing the jurisdiction resets Steps 2–5 — you will need to confirm categories, holidays and schools again. Continue?')) return false;
    if (!S.planner) { const err = settingsError(); if (err) return stepFail(err); await ensurePlanner({}); }
    const keep = isLegacy() ? 5 : was && !changed ? Math.max(cfg(), 1) : 1;
    await patchPlanner({ jur_district: j.d, jur_wing: j.w, jur_tehsil: j.t, jur_markaz: j.m, config_step: keep });
    if (changed) { const ok = new Set(jurPool().map(r => String(r.emis))), used = new Set(S.entries.map(e => e.emis_code)); [...S.selected.keys()].forEach(k => { if (!ok.has(k) && !used.has(k)) S.selected.delete(k); }); }
    return true;
  }

  // Step 2 ------------------------------------------------------------
  function renderCats() {
    const box = $('vpCatBox'); if (!box) return;
    const j = jurSaved();
    if (!j) { box.innerHTML = '<div class="vp-muted">Complete Step 1 first.</div>'; return; }
    const count = {}; jurPool().forEach(r => { count[r.source] = (count[r.source] || 0) + 1; });
    const cats = Object.keys(count).sort();
    if (!cats.length) { box.innerHTML = '<div class="vp-error">No schools were found in this jurisdiction.</div>'; return; }
    box.innerHTML = `<div class="vp-scroll"><table class="vp-table vp-small vp-cats" style="min-width:520px"><thead><tr><th></th><th>Category</th><th>Eligible schools</th><th>Min visits per school</th><th>Max visits per school</th></tr></thead><tbody>` +
      cats.map(c => { const st = S.catSel.get(c), on = !!st; return `<tr class="${on ? 'vp-sel' : ''}"><td><input type="checkbox" class="vp-ccheck" data-cat="${esc(c)}" ${on ? 'checked' : ''} aria-label="Include ${esc(SRC_LABEL[c] || c)}"></td>` +
        `<td><span class="vp-src vp-src-${esc(c)}">${esc(SRC_LABEL[c] || c)}</span></td><td>${count[c]}</td>` +
        `<td><input type="number" min="0" step="1" class="vp-in vp-num vp-cmin" data-cat="${esc(c)}" value="${on ? esc(st.min) : ''}" ${on ? '' : 'disabled'}></td>` +
        `<td><input type="number" min="0" step="1" class="vp-in vp-num vp-cmax" data-cat="${esc(c)}" value="${on ? esc(st.max) : ''}" ${on ? '' : 'disabled'}></td></tr>`; }).join('') + `</tbody></table></div>`;
  }
  async function saveCats() {
    if (isLegacy() && !S.catSel.size) return true;                   // optional for existing plans
    const targets = [];
    for (const [c, st] of S.catSel) {
      const lbl = SRC_LABEL[c] || c;
      if (!/^\d+$/.test(String(st.min).trim()) || !/^\d+$/.test(String(st.max).trim())) return stepFail(`${lbl}: Min and Max visits must be whole numbers (0 or more).`);
      const mn = +st.min, mx = +st.max;
      if (mn > mx) return stepFail(`${lbl}: Min visits cannot be greater than Max visits.`);
      if (!jurPool().some(r => r.source === c)) return stepFail(`${lbl}: no eligible schools in this jurisdiction.`);
      targets.push({ category: c, min_visits: mn, max_visits: mx });
    }
    if (!targets.length) return stepFail('Select at least one school category.');
    const { data, error } = await sb().rpc('visit_planner_save_categories', { p_planner: S.planner.id, p_targets: targets, p_reason: null });
    if (error) throw error;
    S.planner = data; S.targets = targets;
    const ok = new Set(eligiblePool().map(r => String(r.emis)));
    const used = new Set(S.entries.map(e => e.emis_code));
    [...S.selected.keys()].forEach(k => { if (!ok.has(k) && !used.has(k)) S.selected.delete(k); });
    return true;
  }

  // Step 3 ------------------------------------------------------------
  function renderPriv() {
    const box = $('vpPrivBox'); if (!box) return;
    const ta = $('vpPrivReason');
    if (document.activeElement !== ta) ta.value = (S.planner && S.planner.private_visit_reason) || '';
    box.style.display = hasPrivate() ? '' : 'none';
    $('vpPrivNA').style.display = hasPrivate() ? 'none' : '';
  }
  async function saveReason() {
    if (!hasPrivate()) return true;
    const r = $('vpPrivReason').value.trim();
    if (r.length < 5) return stepFail('The reason for visiting private schools is mandatory (at least a few words).');
    await patchPlanner({ private_visit_reason: r.slice(0, 1000), config_step: Math.max(cfg(), 3) });
    return true;
  }

  // Step 4 ------------------------------------------------------------
  function renderHolidays() {
    const list = $('vpHList'); if (!list) return;
    const lk = locked(), eh = S.editHol && S.holidays.find(h => h.id === S.editHol);
    $('vpHDate').min = C.iso(S.year, S.month, 1); $('vpHDate').max = C.iso(S.year, S.month, C.daysInMonth(S.year, S.month));
    $('vpHAdd').textContent = eh ? 'Update holiday' : '+ Add holiday'; $('vpHCancel').style.display = eh ? '' : 'none';
    $('vpHMonthTxt').textContent = `${C.MONTH_NAMES[S.month - 1]} ${S.year}`;
    const nh = $('vpNoHol'); nh.checked = !!(S.planner && S.planner.no_holidays_confirmed); nh.disabled = lk || S.holidays.length > 0;
    list.innerHTML = S.holidays.length ? `<div class="vp-scroll"><table class="vp-table vp-small" style="min-width:420px"><thead><tr><th>Date</th><th>Holiday</th><th>Type</th><th></th></tr></thead><tbody>` +
      S.holidays.map(h => `<tr class="vp-hol vp-hol-${esc(h.type)}"><td class="vp-mono">${fmtDate(h.date)} <span class="vp-muted">${DAY_SHORT[C.dowOf(h.date)]}</span></td><td>${esc(h.name)}</td>` +
        `<td><span class="vp-hbadge vp-hb-${esc(h.type)}">${esc(HOLTYPE[h.type])}</span></td><td style="white-space:nowrap"><button type="button" class="vp-btn vp-ghost" data-act="editHol" data-id="${esc(h.id)}" ${lk ? 'disabled' : ''}>Edit</button> ` +
        `<button type="button" class="vp-icon" data-act="delHol" data-id="${esc(h.id)}" ${lk ? 'disabled' : ''} title="Remove">✕</button></td></tr>`).join('') + `</tbody></table></div>`
      : `<div class="vp-muted">No holidays added for ${C.MONTH_NAMES[S.month - 1]} ${S.year}.</div>`;
  }
  function resetHolForm() { S.editHol = null; $('vpHDate').value = ''; $('vpHName').value = ''; $('vpHType').value = 'gazetted'; renderHolidays(); }
  function onHolidaySave() {
    return enqueue(async () => {
      if (!S.planner || locked()) return;
      const date = $('vpHDate').value, type = $('vpHType').value, name = $('vpHName').value.trim();
      if (!date) return stepFail('Choose the holiday date.');
      if (!dateInMonth(date)) return stepFail(`The date must fall inside ${C.MONTH_NAMES[S.month - 1]} ${S.year}.`);
      if (!name) return stepFail('Enter the holiday name.');
      if (!HOLTYPE[type]) return stepFail('Choose the holiday type.');
      if (S.holidays.some(h => h.date === date && h.id !== S.editHol)) return stepFail('A holiday is already recorded on that date.');
      if (S.entries.some(e => e.visit_date === date)) return stepFail('Visits are already planned on that date — remove them first.');
      const row = { holiday_date: date, holiday_type: type, name: name.slice(0, 120) };
      if (S.editHol) { const { error } = await sb().from('visit_planner_holidays').update(row).eq('id', S.editHol); if (error) throw error; }
      else { const { error } = await sb().from('visit_planner_holidays').insert(Object.assign({ planner_id: S.planner.id, user_id: S.userId }, row)); if (error) throw error; }
      await reloadHolidays(); await refreshPlanner(); S.editHol = null; $('vpHDate').value = ''; $('vpHName').value = '';
      stepMsg('Holiday saved.', 'ok'); renderAll();
    }).catch(() => {});
  }
  async function reloadHolidays() {
    const { data, error } = await sb().from('visit_planner_holidays').select('id,holiday_date,holiday_type,name').eq('planner_id', S.planner.id).order('holiday_date');
    if (error) throw error; S.holidays = data.map(h => ({ id: h.id, date: h.holiday_date, type: h.holiday_type, name: h.name }));
  }
  function onHolidayDelete(id) {
    return enqueue(async () => {
      const { error } = await sb().from('visit_planner_holidays').delete().eq('id', id); if (error) throw error;
      await reloadHolidays(); await refreshPlanner(); if (S.editHol === id) S.editHol = null; renderAll();
    });
  }
  function onNoHolidays(on) {
    return enqueue(async () => {
      if (!S.planner || locked()) return;
      if (on && S.holidays.length) { stepMsg('Remove the holidays first, or leave this unticked.', 'err'); renderAll(); return; }
      await patchPlanner(on ? { no_holidays_confirmed: true } : { no_holidays_confirmed: false, config_step: Math.min(cfg(), 3) });
      renderAll();
    });
  }
  async function saveHolStep() {
    if (isLegacy()) return true;
    if (!S.holidays.length && !S.planner.no_holidays_confirmed) return stepFail('Add at least one holiday, or tick “This month has no holidays”.');
    await patchPlanner({ config_step: Math.max(cfg(), 4) });
    return true;
  }

  // Step 5 ------------------------------------------------------------
  async function saveSettings() {
    const err = settingsError(); if (err) return stepFail(err);
    const ok = new Set(eligiblePool().map(r => String(r.emis)));
    if (![...S.selected.keys()].some(k => ok.has(k))) return stepFail('Select at least one school.');
    await patchPlanner(Object.assign(settingsBody(), { config_step: Math.max(cfg(), 5) }));
    return true;
  }

  // Step 6 summary ----------------------------------------------------
  function renderSummary() {
    const box = $('vpSummary'); if (!box) return;
    const p = S.planner, j = jurSaved();
    if (!p) { box.innerHTML = ''; return; }
    const iss = configIssues();
    box.innerHTML = `<div class="vp-summary"><div class="vp-h2">Plan configuration</div><ul>` +
      `<li><strong>Month:</strong> ${C.MONTH_NAMES[S.month - 1]} ${S.year}</li>` +
      `<li><strong>Jurisdiction:</strong> ${j ? esc(`${j.d} › ${j.w} › ${j.t} › ${j.m === 'ALL' ? 'All Markaz' : j.m}`) : '<span class="vp-muted">legacy plan — not set</span>'}</li>` +
      `<li><strong>Categories:</strong> ${S.targets.length ? S.targets.map(t => `<span class="vp-src vp-src-${esc(t.category)}">${esc(SRC_LABEL[t.category] || t.category)}</span> ${t.min_visits}–${t.max_visits} per school`).join(' · ') : '<span class="vp-muted">none</span>'}</li>` +
      (hasPrivate() ? `<li><strong>Private-school reason:</strong> ${esc(p.private_visit_reason || '—')}</li>` : '') +
      `<li><strong>Holidays:</strong> ${S.holidays.length ? S.holidays.map(h => `<span class="vp-hbadge vp-hb-${esc(h.type)}">${esc(fmtDate(h.date))} ${esc(h.name)}</span>`).join(' ') : (p.no_holidays_confirmed ? 'None this month' : '<span class="vp-muted">not set</span>')}</li></ul>` +
      (iss.length ? `<div class="vp-error">${iss.map(esc).join('<br>')}</div>` : '<div class="vp-check">✔ All mandatory configuration is valid.</div>') + `</div>`;
  }

  // Navigation ----------------------------------------------------------
  function stepFail(m) { stepMsg(m, 'err'); toast(m, 'error'); return false; }
  async function saveStep(n) {
    switch (n) { case 1: return saveJur(); case 2: return saveCats(); case 3: return saveReason(); case 4: return saveHolStep(); case 5: return saveSettings(); default: return true; }
  }
  function goTo(n) {
    if (!S.planner && n > 1) return;
    if (n > maxStep() && !isLegacy()) { stepMsg('Complete and save the previous step first.', 'err'); return; }
    if (stepNA(n)) n = n > S.step ? 4 : 2;
    S.step = n; stepMsg(''); renderAll();
    $('vpWizard').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function onStepSave(advance) {
    return enqueue(async () => {
      const n = S.step;
      let ok;
      try { ok = await saveStep(n); } catch (e) { stepMsg(e.message || 'Could not save this step.', 'err'); throw e; }
      if (!ok) return;
      stepMsg(advance ? '' : 'Progress saved.', 'ok'); renderAll();
      if (advance) { let nx = n + 1; if (stepNA(nx)) nx = nx + 1; goTo(Math.min(nx, 6)); }
      else toast('Progress saved.', 'success');
    });
  }
  function onPrev() { let pv = S.step - 1; if (stepNA(pv)) pv--; goTo(Math.max(pv, 1)); }

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
        $('vpSelCount').textContent = `${S.selected.size} selected · ${filteredPool().length} shown by filter · ${eligiblePool().length} eligible for this plan`;
        if (S.planner) renderSheet();
      } else if (a === 'delDate') onDelDate(b.dataset.date);
      else if (a === 'goStep') goTo(+b.dataset.step);
      else if (a === 'editHol') { const h = S.holidays.find(x => x.id === b.dataset.id); if (h) { S.editHol = h.id; $('vpHDate').value = h.date; $('vpHType').value = h.type; $('vpHName').value = h.name; renderHolidays(); } }
      else if (a === 'delHol') { if (confirm('Remove this holiday?')) onHolidayDelete(b.dataset.id); }
      else if (a === 'showHome') showPanel('vpHome');
      else if (a === 'openTentative') { e.preventDefault(); showPanel('vpTentative'); }
      else if (a === 'openActual') {
        e.preventDefault();
        if (!window.VisitPlannerActual) { toast('Actual Visits module failed to load. Refresh the page.', 'error'); return; }
        showPanel('vpActual'); window.VisitPlannerActual.mount($('vpActual'));
      }
    });
    root.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset && t.dataset.lvl) onJurChange(t.dataset.lvl, t.value);
      else if (t.classList.contains('vp-ccheck')) { if (t.checked) S.catSel.set(t.dataset.cat, S.catSel.get(t.dataset.cat) || { min: '', max: '' }); else S.catSel.delete(t.dataset.cat); renderCats(); stepMsg(''); }
      else if (t.classList.contains('vp-cmin') || t.classList.contains('vp-cmax')) { const st = S.catSel.get(t.dataset.cat); if (st) st[t.classList.contains('vp-cmin') ? 'min' : 'max'] = t.value; }
      else if (t.id === 'vpNoHol') onNoHolidays(t.checked);
      else if (t.id === 'vpMonth' || t.id === 'vpYear') enqueue(loadPeriod);
      else if (t.classList.contains('vp-slot')) onSlotChange(t);
      else if (t.classList.contains('vp-daytype')) onDayType(t);
      else if (t.classList.contains('vp-comment')) onCommentChange(t);
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
    $('vpNext').addEventListener('click', () => onStepSave(true));
    $('vpSaveProg').addEventListener('click', () => onStepSave(false));
    $('vpPrev').addEventListener('click', onPrev);
    $('vpHAdd').addEventListener('click', onHolidaySave);
    $('vpHCancel').addEventListener('click', resetHolForm);
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
  function showPanel(id) {
    ['vpHome', 'vpTentative', 'vpActual'].forEach(x => { const el = $(x); if (el) el.style.display = x === id ? '' : 'none'; });
    window.scrollTo(0, 0);
  }
  function syncLeaveHint() { const n = +$('vpLeaveCount').value; $('vpLeaveHint').textContent = `Select ${n} weekday${n > 1 ? 's' : ''} (${getChecked('vpLeave').length}/${n} chosen). These are excluded from every month automatically.`; }

  function build() {
    const cur = new Date().getFullYear();
    $('vpRoot').innerHTML = `
    <div id="vpHome" class="vp-home">
      <a class="vp-bigcard" href="#visit-planner" data-act="openTentative"><div class="vp-bc-ico">📅</div><div class="vp-bc-t">Tentative Plans</div><div class="vp-bc-d">Generate and edit the monthly tentative school visit plan · Leave &amp; Other Duty · Excel &amp; print</div></a>
      <a class="vp-bigcard" href="#visit-planner" data-act="openActual"><div class="vp-bc-ico">✅</div><div class="vp-bc-t">Actual Visits</div><div class="vp-bc-d">Enter only EMIS codes and dates of the visits you actually made · Leave &amp; Other Duty · Excel &amp; print</div></a>
    </div>
    <div id="vpTentative" style="display:none"><button class="vp-btn vp-ghost" data-act="showHome" style="margin-bottom:10px">← Visit Planner</button>
    <div id="vpWizard">
    <ol id="vpStepper" class="vp-stepper" aria-label="Plan configuration steps"></ol>
    <div class="vp-pane" data-pane="1"><div class="vp-card"><div class="vp-h2">Step 1 — Month &amp; jurisdiction</div>
      <div class="vp-row"><label>Year <input type="number" id="vpYear" min="1900" max="2200" value="${S.year}" class="vp-in" style="width:96px"></label>
      <label>Month <select id="vpMonth" class="vp-in">${C.MONTH_NAMES.map((n, i) => `<option value="${i + 1}" ${i + 1 === S.month ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <button class="vp-btn" id="vpBtnLoad">Open / Load</button></div>
      <div id="vpStatusBar" class="vp-status"></div>
      <fieldset class="vp-fs"><div class="vp-row" style="margin-top:10px">
        <label>District <span class="vp-req">*</span><select id="vpJDistrict" class="vp-in" data-lvl="d"></select></label>
        <label>Wing <span class="vp-req">*</span><select id="vpJWing" class="vp-in" data-lvl="w"></select></label>
        <label>Tehsil <span class="vp-req">*</span><select id="vpJTehsil" class="vp-in" data-lvl="t"></select></label>
        <label>Markaz <span class="vp-req">*</span><select id="vpJMarkaz" class="vp-in" data-lvl="m"></select></label></div>
      <div class="vp-muted" style="margin-top:6px">Planning <strong id="vpJMonthTxt"></strong>. Choose in order: District → Wing → Tehsil → Markaz. Only your assigned jurisdiction is offered.</div></fieldset></div></div>
    <div class="vp-pane" data-pane="2"><div class="vp-card"><div class="vp-h2">Step 2 — School categories &amp; visit limits</div>
      <div class="vp-muted" style="margin-bottom:8px">Tick each category you will visit and set, for every school of that category, the minimum and maximum visits in the month (whole numbers, Min ≤ Max). Each school gets its minimum automatically when the plan is generated.</div>
      <fieldset class="vp-fs"><div id="vpCatBox"></div></fieldset></div></div>
    <div class="vp-pane" data-pane="3"><div class="vp-card"><div class="vp-h2">Step 3 — Reason for visiting private schools</div>
      <div id="vpPrivNA" class="vp-muted">Not required — no private category was selected.</div>
      <fieldset class="vp-fs" id="vpPrivBox"><label class="vp-lbl" style="width:100%">Reason <span class="vp-req">*</span><textarea id="vpPrivReason" class="vp-in" rows="4" maxlength="1000" placeholder="Why will private schools be visited this month?"></textarea></label></fieldset></div></div>
    <div class="vp-pane" data-pane="4"><div class="vp-card"><div class="vp-h2">Step 4 — Holidays for <span id="vpHMonthTxt"></span></div>
      <fieldset class="vp-fs"><div class="vp-row"><label>Date <input type="date" id="vpHDate" class="vp-in"></label>
        <label>Type <select id="vpHType" class="vp-in"><option value="gazetted">Gazetted holiday</option><option value="local">Local holiday</option></select></label>
        <label style="flex:1;min-width:180px">Holiday name <input type="text" id="vpHName" class="vp-in" maxlength="120" placeholder="e.g. Iqbal Day"></label>
        <button type="button" class="vp-btn vp-primary" id="vpHAdd">+ Add holiday</button><button type="button" class="vp-btn vp-ghost" id="vpHCancel" style="display:none">Cancel edit</button></div>
        <div id="vpHList" style="margin-top:10px"></div>
        <label class="vp-check-row"><input type="checkbox" id="vpNoHol"> This month has no gazetted or local holidays</label></fieldset>
      <div class="vp-muted">Holidays are non-working days: no visit can be planned on them, and they appear (locked) in the Actual Visit Planner once this plan is finalized.</div></div></div>
    <div class="vp-pane" data-pane="5">
    <div class="vp-card"><div class="vp-h2">Step 5 — Weekly leave &amp; settings</div><fieldset class="vp-fs">
      <div class="vp-row"><label>Weekly leave days <select id="vpLeaveCount" class="vp-in"><option>1</option><option selected>2</option><option>3</option></select></label></div>
      <div class="vp-days" id="vpLeaveDays">${DAY_SHORT.map((d, i) => `<label><input type="checkbox" name="vpLeave" value="${i}" ${i === 0 || i === 6 ? 'checked' : ''}> ${d}</label>`).join('')}</div>
      <div class="vp-muted" id="vpLeaveHint"></div>
      <div class="vp-row" style="margin-top:10px"><div><div class="vp-lbl">Office-work (mid-day) weekdays</div><div class="vp-days">${DAY_SHORT.map((d, i) => `<label><input type="checkbox" name="vpOffice" value="${i}" ${i === 5 ? 'checked' : ''}> ${d}</label>`).join('')}</div></div>
      <label>Start date (W.E.F.) <input type="date" id="vpStart" class="vp-in"></label>
      <label>Markaz label <input type="text" id="vpMarkazLabel" class="vp-in" placeholder="e.g. 93/ML (auto if blank)" style="width:170px"></label></div></fieldset></div>
    <div class="vp-card"><div class="vp-h2">Schools <span class="vp-muted" id="vpSelCount"></span></div><fieldset class="vp-fs">
      <div class="vp-row"><input id="vpSearch" class="vp-in" placeholder="Search EMIS code or school name" style="flex:1;min-width:200px">
      <select id="vpMarkazFilter" class="vp-in"><option value="">All Markaz</option></select>
      <select id="vpSourceFilter" class="vp-in"><option value="">All types</option><option value="PUBLIC">Govt / Outsourced</option><option value="HIGH">High / H.Sec.</option><option value="PIEMA">PIEMA</option><option value="PEF">PEF</option><option value="PRIVATE">Private Schools</option><option value="ACADEMY">Private Academies</option></select>
      <button class="vp-btn vp-ghost" id="vpSelectAll">Select all shown</button><button class="vp-btn vp-ghost" id="vpClearSel">Clear</button><button class="vp-btn vp-ghost" id="vpBtnRefresh" title="Reload the school list">↻</button></div>
      <div class="vp-scroll" style="max-height:340px"><table class="vp-table vp-small"><thead><tr><th></th><th>EMIS</th><th>School</th><th>Markaz</th><th>Tehsil</th><th>Wing</th><th>Level / Type</th></tr></thead><tbody id="vpSchoolBody"></tbody></table></div>
      <button class="vp-btn vp-ghost" id="vpMore" style="display:none;margin-top:6px"></button></fieldset></div></div>
    <div class="vp-pane" data-pane="6"><div class="vp-card"><div class="vp-h2">Step 6 — Generate, review &amp; submit</div>
      <div id="vpSummary"></div>
      <div class="vp-row"><button class="vp-btn vp-primary" id="vpBtnGen">⚙ Generate Planner</button><button class="vp-btn" id="vpBtnCreate">Create empty planner</button>
      <button class="vp-btn" id="vpBtnAddDate">+ Add visit date</button><button class="vp-btn" id="vpBtnSave">💾 Save Planner</button><button class="vp-btn" id="vpBtnFinal">Mark as Finalized</button>
      <button class="vp-btn vp-excel" id="vpBtnExcel">⬇ Download Excel</button><button class="vp-btn" id="vpBtnPrint">🖨 Print</button><button class="vp-btn vp-danger" id="vpBtnDelete">Delete planner</button></div>
      <div id="vpLockNote" class="vp-banner vp-banner-warn" style="display:none;margin-top:8px"></div>
      <div class="vp-muted" style="margin-top:6px">Every change below is saved to the database immediately — no need to regenerate after a small correction.</div>
      <div id="vpAlerts"></div><div id="vpSheet"></div></div></div>
    <div class="vp-nav" id="vpNav"><button class="vp-btn vp-ghost" id="vpPrev">← Previous</button><span id="vpStepMsg" class="vp-stepmsg" role="status"></span>
      <span class="vp-nav-r"><button class="vp-btn" id="vpSaveProg">💾 Save progress</button><button class="vp-btn vp-primary" id="vpNext">Save &amp; Next →</button></span></div>
    </div></div>
    <div id="vpActual" style="display:none"></div>`;
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
      showPanel('vpHome');
    } catch (e) { console.error(e); toast(e.message || 'Could not open Visit Planner', 'error'); }
  }

  // Shared helpers for the Actual Visits module (js/visit-planner-actual.js)
  window.VisitPlannerShared = {
    getUserId: () => S.userId,
    getPool: () => ({ rows: S.pool || [], emis: S.poolEmis || new Set() }),
    makeHeader, printSheet, showHome: () => showPanel('vpHome')
  };
  window.openVisitPlannerView = open;
  // Register the hash route without editing index.js (ROUTES is a global lexical binding there).
  try { if (typeof ROUTES === 'object') ROUTES['visit-planner'] = () => open(); } catch (e) { /* router not ready */ }
  window.addEventListener('load', () => { try { if (typeof ROUTES === 'object' && !ROUTES['visit-planner']) ROUTES['visit-planner'] = () => open(); } catch (e) {} });
})();
