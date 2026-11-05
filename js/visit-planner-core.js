// ═══════════════════════════════════════════════════════════════════
//  VISIT PLANNER — core logic (pure functions, no DOM, no Supabase)
//  Calendar maths, weekly-leave handling, balanced generation,
//  visit sequencing and validation. Isolated from every other module;
//  exposed as window.VisitPlannerCore (and module.exports for tests).
// ═══════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  const DAY_NAMES   = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MIN_VISITS  = 2;

  const pad2 = n => String(n).padStart(2, '0');
  const iso  = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

  /** Days in a month — handles 28/29/30/31 (leap years) for any year. */
  function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

  /** Weekday (0=Sun..6=Sat) of an ISO date string, timezone-independent. */
  function dowOf(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  /** Every calendar date of a month with its weekday. */
  function monthDates(year, month) {
    const out = [];
    for (let d = 1, n = daysInMonth(year, month); d <= n; d++) {
      const s = iso(year, month, d);
      out.push({ iso: s, day: d, dow: dowOf(s) });
    }
    return out;
  }

  /** Working dates = month dates minus weekly-leave weekdays and holidays, from startDay onward.
   *  holidayDates: optional array/Set of ISO dates (gazetted + local) — holidays are never working days. */
  function workingDates(year, month, leaveDays, startDay, holidayDates) {
    const leave = new Set(leaveDays || []), hol = new Set(holidayDates || []);
    return monthDates(year, month).filter(x => !leave.has(x.dow) && !hol.has(x.iso) && x.day >= (startDay || 1));
  }

  /** Deterministic school order: by Markaz, then name — keeps neighbouring schools together. */
  function sortSchools(schools) {
    return schools.slice().sort((a, b) =>
      String(a.markaz_name || '').localeCompare(String(b.markaz_name || '')) ||
      String(a.school_name || '').localeCompare(String(b.school_name || '')) ||
      String(a.emis).localeCompare(String(b.emis)));
  }

  /**
   * Balanced generation.
   *  opts: { year, month, leaveDays:[0-6], officeDays:[0-6], startDay, blockedDates:[iso], schools:[{emis,...}] }
   *  Two slots per working day (1 = Morning, 2 = Mid-Day), as in the official template.
   *  On office-work weekdays slot 2 is "Office Work".
   *  Schools are dealt round-robin over the slots in date order, so every school's
   *  successive visits are ~n/2 days apart and no school is booked twice on one day.
   *  opts.holidayDates: ISO dates that are holidays — never scheduled.
   *  opts.targets (optional): [{category, min, max}] — visits per school category (school.source). When given, each
   *  category receives at least `min` and at most `max` visits (see allocateByCategory); otherwise every school is
   *  dealt round-robin exactly as before.
   *  Returns { rows:[{date,dow,slots:[school|{office:true}|null, ...]}], warnings:[], capacity, required, counts? }
   */
  function generate(opts) {
    if (opts.targets && opts.targets.length) return generateByCategory(opts);
    const schools = sortSchools(opts.schools || []);
    const n = schools.length;
    const office = new Set(opts.officeDays || []);
    const blocked = new Set(opts.blockedDates || []);   // dates already marked On Leave / Other Duty
    const dates = workingDates(opts.year, opts.month, opts.leaveDays, opts.startDay, opts.holidayDates).filter(d => !blocked.has(d.iso));
    const rows = dates.map(d => ({ date: d.iso, dow: d.dow, slots: [null, null] }));
    const warnings = [];

    const free = [];                                   // assignable (row, slotIndex) in date order
    rows.forEach(r => {
      free.push([r, 0]);
      if (office.has(r.dow)) r.slots[1] = { office: true };
      else if (n > 1) free.push([r, 1]);               // one school only → never twice on a day
    });

    const required = MIN_VISITS * n;
    if (n === 0) return { rows, warnings: ['No schools selected.'], capacity: free.length, required: 0 };

    free.forEach(([r, i], k) => {
      let s = schools[k % n];
      if (i === 1 && r.slots[0] && r.slots[0].emis === s.emis) s = schools[(k + 1) % n]; // safety net
      if (i === 1 && r.slots[0] && r.slots[0].emis === s.emis) return;
      r.slots[i] = s;
    });

    if (free.length < required) {
      warnings.push(`Only ${free.length} visit slot(s) are available in this month (after weekly leave${office.size ? ' and office-work days' : ''}), but ${n} school(s) need ${required} visits (2 each). ` +
        `Every school was given as many visits as the calendar allows; reduce the number of schools or leave days to reach 2 visits each.`);
    }
    return { rows, warnings, capacity: free.length, required };
  }


  /**
   * How many visits each category gets. targets: [{category,min,max}], capacity = free visit slots, have[cat] = #schools chosen.
   * Everyone first gets `min` (scaled down round-robin if the calendar cannot hold all minimums), then the remaining
   * slots are handed out one at a time (round-robin) to categories still below `max`. Slots nobody may take stay empty.
   */
  function allocateByCategory(targets, capacity, have) {
    const cats = targets.filter(t => (have[t.category] || 0) > 0);
    const count = {}, warnings = [];
    cats.forEach(t => { count[t.category] = 0; });
    let left = capacity;
    const wantMin = cats.reduce((a, t) => a + t.min, 0);
    if (wantMin > capacity) {
      warnings.push(`The minimum visits of all categories (${wantMin}) exceed the ${capacity} visit slot(s) available this month (after weekly leave, office days and holidays). Slots were shared between the categories; reduce the minimums or add working days.`);
      for (let guard = 0; left > 0 && guard < 100000; guard++) {
        let moved = false;
        cats.forEach(t => { if (left > 0 && count[t.category] < t.min) { count[t.category]++; left--; moved = true; } });
        if (!moved) break;
      }
    } else {
      cats.forEach(t => { count[t.category] = t.min; left -= t.min; });
      for (let guard = 0; left > 0 && guard < 100000; guard++) {
        let moved = false;
        cats.forEach(t => { if (left > 0 && count[t.category] < t.max) { count[t.category]++; left--; moved = true; } });
        if (!moved) break;
      }
    }
    targets.forEach(t => { if (!(have[t.category] > 0) && t.min > 0) warnings.push(`No ${t.category} school is selected, so its minimum of ${t.min} visit(s) cannot be met.`); });
    return { count, warnings, unused: left };
  }

  /** Category-aware generation: balanced inside each category, categories interleaved proportionally. */
  function generateByCategory(opts) {
    const office = new Set(opts.officeDays || []);
    const blocked = new Set(opts.blockedDates || []);
    const dates = workingDates(opts.year, opts.month, opts.leaveDays, opts.startDay, opts.holidayDates).filter(d => !blocked.has(d.iso));
    const rows = dates.map(d => ({ date: d.iso, dow: d.dow, slots: [null, null] }));
    const bySchool = {};
    sortSchools(opts.schools || []).forEach(s => { (bySchool[s.source] = bySchool[s.source] || []).push(s); });
    const have = {}; Object.keys(bySchool).forEach(k => { have[k] = bySchool[k].length; });
    const nSchools = (opts.schools || []).length;

    const free = [];
    rows.forEach(r => {
      free.push([r, 0]);
      if (office.has(r.dow)) r.slots[1] = { office: true };
      else if (nSchools > 1) free.push([r, 1]);
    });
    const alloc = allocateByCategory(opts.targets, free.length, have);
    const warnings = alloc.warnings.slice();
    if (!nSchools) return { rows, warnings: ['No schools selected.'].concat(warnings), capacity: free.length, required: 0, counts: alloc.count };

    // visit list per category, then merge by fractional position so categories are spread evenly over the month
    const items = [];
    Object.keys(alloc.count).forEach(cat => {
      const n = alloc.count[cat], list = bySchool[cat];
      for (let k = 0; k < n; k++) items.push({ key: (k + 0.5) / n, cat, school: list[k % list.length] });
    });
    items.sort((a, b) => a.key - b.key || String(a.cat).localeCompare(String(b.cat)));
    const seq = items.map(i => i.school);

    for (let k = 0, p = 0; k < free.length && p < seq.length; k++, p++) {
      const [r, i] = free[k];
      if (i === 1 && r.slots[0] && r.slots[0].emis === seq[p].emis) {           // never the same school twice in one day
        let j = p + 1; while (j < seq.length && seq[j].emis === r.slots[0].emis) j++;
        if (j >= seq.length) { p--; continue; }                                  // leave this slot empty
        [seq[p], seq[j]] = [seq[j], seq[p]];
      }
      r.slots[i] = seq[p];
    }
    const required = (opts.targets || []).reduce((a, t) => a + t.min, 0);
    return { rows, warnings, capacity: free.length, required, counts: alloc.count };
  }

  /** Flatten generated rows into entry objects (without ids). */
  function rowsToEntries(rows) {
    const out = [];
    rows.forEach(r => r.slots.forEach((s, i) => {
      if (!s) return;
      if (s.office) out.push({ visit_date: r.date, slot: i + 1, entry_type: 'office' });
      else out.push({ visit_date: r.date, slot: i + 1, entry_type: 'school', emis_code: String(s.emis),
        school_name: s.school_name, markaz: s.markaz_name, tehsil: s.tehsil, wing: s.wing });
    }));
    return out;
  }

  /** Nth visit of each school in the month (chronological), written to visit_sequence. */
  function assignSequences(entries) {
    const seen = {};
    entries.slice().sort((a, b) => a.visit_date.localeCompare(b.visit_date) || a.slot - b.slot).forEach(e => {
      if (e.entry_type !== 'school') { e.visit_sequence = null; return; }
      seen[e.emis_code] = (seen[e.emis_code] || 0) + 1;
      e.visit_sequence = seen[e.emis_code];
    });
    return entries;
  }

  /**
   * Validation. ctx: { year, month, leaveDays, entries, schools (selected set as [{emis,school_name,source}]), poolEmis:Set|null,
   *   holidays?: [{date,type,name}], targets?: [{category,min,max}] }
   * Returns [{ level:'error'|'warn'|'info', msg }]
   */
  function validate(ctx) {
    const msgs = [];
    const leave = new Set(ctx.leaveDays || []);
    const hol = new Map((ctx.holidays || []).map(h => [h.date, h]));
    const perSchool = {}, perDay = {};
    (ctx.entries || []).forEach(e => {
      const y = +e.visit_date.slice(0, 4), m = +e.visit_date.slice(5, 7);
      if (y !== ctx.year || m !== ctx.month) msgs.push({ level: 'error', msg: `${e.visit_date} is outside ${MONTH_NAMES[ctx.month - 1]} ${ctx.year}.` });
      if (leave.has(dowOf(e.visit_date))) msgs.push({ level: 'error', msg: `${e.visit_date} (${DAY_NAMES[dowOf(e.visit_date)]}) is a weekly leave day.` });
      if (hol.has(e.visit_date)) msgs.push({ level: 'error', msg: `${e.visit_date} is a ${hol.get(e.visit_date).type} holiday (${hol.get(e.visit_date).name}) — no visit may be planned on it.` });
      if (e.entry_type !== 'school') return;
      perSchool[e.emis_code] = (perSchool[e.emis_code] || 0) + 1;
      const k = e.visit_date + '|' + e.emis_code;
      perDay[k] = (perDay[k] || 0) + 1;
      if (perDay[k] === 2) msgs.push({ level: 'error', msg: `${e.school_name} — EMIS ${e.emis_code} is planned twice on ${e.visit_date}.` });
      if (ctx.poolEmis && !ctx.poolEmis.has(e.emis_code)) msgs.push({ level: 'error', msg: `${e.school_name} — EMIS ${e.emis_code} is outside your permitted jurisdiction.` });
    });
    if (ctx.targets && ctx.targets.length) {
      const perCat = {};
      (ctx.entries || []).forEach(e => { if (e.entry_type === 'school') { const sc = (ctx.schools || []).find(x => String(x.emis) === String(e.emis_code)); const c = sc && sc.source; if (c) perCat[c] = (perCat[c] || 0) + 1; } });
      ctx.targets.forEach(t => {
        const c = perCat[t.category] || 0;
        if (c < t.min) msgs.push({ level: 'warn', msg: `${t.category}: ${c} planned visit(s), below the minimum of ${t.min}.` });
        if (c > t.max) msgs.push({ level: 'error', msg: `${t.category}: ${c} planned visit(s), above the maximum of ${t.max}.` });
      });
    }
    const workDays = workingDates(ctx.year, ctx.month, ctx.leaveDays, 1, (ctx.holidays || []).map(h => h.date)).length;
    (ctx.schools || []).forEach(s => {
      const c = perSchool[String(s.emis)] || 0;
      if (c < MIN_VISITS) {
        msgs.push({ level: 'warn', msg: `${s.school_name} — EMIS ${s.emis} has only ${c} planned visit${c === 1 ? '' : 's'}. At least ${MIN_VISITS} visits are required.` +
          (workDays * 2 < MIN_VISITS * (ctx.schools || []).length ? ' This month has too few working days for every school to be visited twice.' : '') });
      }
    });
    return msgs;
  }

  /** Strip gender suffix to get the short Markaz label used in the official header ("93/ML MALE" → "93/ML"). */
  function markazShort(name) {
    return String(name || '').replace(/\s*-?\s*(MALE|FEMALE)\s*$/i, '').trim();
  }

  const api = { DAY_NAMES, MONTH_NAMES, MIN_VISITS, daysInMonth, dowOf, monthDates, workingDates, sortSchools,
                generate, allocateByCategory, rowsToEntries, assignSequences, validate, markazShort, iso };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VisitPlannerCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
