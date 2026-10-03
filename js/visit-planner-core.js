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

  /** Working dates = month dates minus weekly-leave weekdays, from startDay onward. */
  function workingDates(year, month, leaveDays, startDay) {
    const leave = new Set(leaveDays || []);
    return monthDates(year, month).filter(x => !leave.has(x.dow) && x.day >= (startDay || 1));
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
   *  opts: { year, month, leaveDays:[0-6], officeDays:[0-6], startDay, schools:[{emis,...}] }
   *  Two slots per working day (1 = Morning, 2 = Mid-Day), as in the official template.
   *  On office-work weekdays slot 2 is "Office Work".
   *  Schools are dealt round-robin over the slots in date order, so every school's
   *  successive visits are ~n/2 days apart and no school is booked twice on one day.
   *  Returns { rows:[{date,dow,slots:[school|{office:true}|null, ...]}], warnings:[], capacity, required }
   */
  function generate(opts) {
    const schools = sortSchools(opts.schools || []);
    const n = schools.length;
    const office = new Set(opts.officeDays || []);
    const dates = workingDates(opts.year, opts.month, opts.leaveDays, opts.startDay);
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
   * Validation. ctx: { year, month, leaveDays, entries, schools (selected set as [{emis,school_name}]), poolEmis:Set|null }
   * Returns [{ level:'error'|'warn'|'info', msg }]
   */
  function validate(ctx) {
    const msgs = [];
    const leave = new Set(ctx.leaveDays || []);
    const perSchool = {}, perDay = {};
    (ctx.entries || []).forEach(e => {
      const y = +e.visit_date.slice(0, 4), m = +e.visit_date.slice(5, 7);
      if (y !== ctx.year || m !== ctx.month) msgs.push({ level: 'error', msg: `${e.visit_date} is outside ${MONTH_NAMES[ctx.month - 1]} ${ctx.year}.` });
      if (leave.has(dowOf(e.visit_date))) msgs.push({ level: 'error', msg: `${e.visit_date} (${DAY_NAMES[dowOf(e.visit_date)]}) is a weekly leave day.` });
      if (e.entry_type !== 'school') return;
      perSchool[e.emis_code] = (perSchool[e.emis_code] || 0) + 1;
      const k = e.visit_date + '|' + e.emis_code;
      perDay[k] = (perDay[k] || 0) + 1;
      if (perDay[k] === 2) msgs.push({ level: 'error', msg: `${e.school_name} — EMIS ${e.emis_code} is planned twice on ${e.visit_date}.` });
      if (ctx.poolEmis && !ctx.poolEmis.has(e.emis_code)) msgs.push({ level: 'error', msg: `${e.school_name} — EMIS ${e.emis_code} is outside your permitted jurisdiction.` });
    });
    const workDays = workingDates(ctx.year, ctx.month, ctx.leaveDays, 1).length;
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
                generate, rowsToEntries, assignSequences, validate, markazShort, iso };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VisitPlannerCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
