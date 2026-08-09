// =====================================================================
//  API.JS  —  Supabase backend  (replaces Apps Script + Google Sheets)
//  ─────────────────────────────────────────────────────────────────────
//  Drop-in replacement: keeps the exact same google.script.run interface
//  AND the same response shapes every module file already expects.
//  No changes needed to any other JS file.
//
//  LOAD ORDER in index.html (before all other scripts):
//    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//    <script src="config.js"></script>
//    <script src="js/api.js"></script>   ← this file
// =====================================================================

'use strict';

// ── Supabase client ──────────────────────────────────────────────────
const _sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
window._supabase = _sb;   // expose for any direct use elsewhere

// ── Column-name maps (Supabase snake_case ↔ frontend display headers) ─
// Staff table: Supabase column → display header used in SF_MAP
const STAFF_COL_MAP = {
  school_emis_code:              'SCHOOL EMIS CODE',
  school_name:                   'SCHOOL NAME',
  markaz_name:                   'MARKAZ NAME',
  district:                      'District',
  wing:                          'Wing',
  tehsil:                        'Tehsil',
  personal_no:                   'PERSONAL NO.',
  name_of_teacher:               'NAME OF TEACHER',
  parent_name:                   'PARENT NAME',
  date_of_birth:                 'DATE OF BIRTH',
  gender:                        'GENDER',
  cnic:                          'CNIC',
  address_as_per_cnic:           'ADDRESS AS PER CNIC',
  designation:                   'DESIGNATION',
  working_as_head:               'WORKING AS HEAD',
  bps:                           'BPS',
  pps:                           'PPS',
  nature_of_job:                 'NATURE OF JOB',
  date_of_permanentization:      'date of regularization',
  date_of_entry_govt_service:    'DATE OF ENTRY IN GOVT- SERVICE',
  first_place_of_posting:        'FIRST PLACE OF POSTING',
  date_of_posting_present_school:'DATE OF POSTING IN PRESENT SCHOOL',
  date_of_joining_present_scale: 'DATE OF JOINING IN PRESENT SCALE',
  subject:                       'SUBJECT',
  academic_qualification:        'ACADEMIC QUALIFICATION',
  professional_qualification:    'PROFESSIONAL QUALIFICATION',
  cell_no:                       'CELL NO',
  whatsapp_no:                   'WHATSAPP NO.',
  email_id:                      'EMAIL ID',
  bank_name_branch_code:         'BANK NAME & BRANCH CODE WHERE SALARY IS CREDIT',
  salary_account_iban_no:        'SALARY ACCOUNT IBAN NO.',
  date_of_retirement:            'DATE OF RETIREMENT',
  contract_end_date:             'CONTRACT END DATE',
  contract_end_order_no:         'CONTRACT END ORDER NO',
  contract_end_remarks:          'CONTRACT END REMARKS',
  contract_renewal_order_no:     'CONTRACT RENEWAL ORDER NO',
  contract_start_date:           'CONTRACT START DATE',
  contract_tenure_months:        'CONTRACT TENURE MONTHS',
  contract_expected_end_date:    'CONTRACT EXPECTED END DATE',
  status:                        'Status',
  changes_made_by:               'Changes Made by',
  changes_made_at:               'Time',
};

// User profile: Supabase column → UH header used in admin.js
const USER_COL_MAP = {
  personal_no:  'Personal No.',
  name:         'Name',
  markaz_name:  'Markaz Name',
  markaz_name_ur: 'Markaz Name (Urdu)',
  designation_ur: 'Designation (Urdu)',
  cell_no:      'Cell No',
  cnic:         'CNIC',
  role:         'Role',
  district:     'District',
  wing:         'Wing',
  tehsil:       'Tehsil',
  scope_type:   'Scope Type',
  scope_value:  'Scope Value',
  access_type:  'Access Type',
  email:        'Email',
  page_no:        'Page No',
  ddeo_code:      'DDEO Code',
  bps_scale:      'BPS Scale',
  dy_office_detail: 'Dy Office Detail', // DB-generated (wing+tehsil) — display only, never written from saveUser
  receives_budget_copy: 'Receives Budget Copy',
};

// Public school: Supabase column → display header.
//
// This is DERIVED from PUB_EDITABLE_FIELDS (js/public_schools.js) rather
// than hand-duplicated, so adding/removing/renaming a question on the
// actual Add/Edit Public School form automatically updates everything
// that reads this map: save/load, the Download Template button, and the
// bulk-import column matcher — with nothing to remember to edit here.
// It's a function (not a top-level const) because api.js loads before
// public_schools.js; calling it lazily at use-time avoids a load-order
// problem while a top-level const would silently see an empty array.
//
// A few identity/system columns aren't user-editable "questions" on the
// form (they're auto-filled from EMIS or shown read-only elsewhere), so
// they're listed here directly rather than expected to appear in
// PUB_EDITABLE_FIELDS.
function getPubColMap() {
  const map = {
    emis: 'Emis', school_name: 'School Name', district: 'District',
    wing: 'Wing', tehsil: 'Tehsil', markaz_name: 'Markaz Name',
    level: 'Level', type: 'Type', area: 'Area',
  };
  if (typeof PUB_EDITABLE_FIELDS !== 'undefined') {
    for (const f of PUB_EDITABLE_FIELDS) {
      if (f.col) map[f.col] = f.header;
    }
  }
  return map;
}


// Private school: Supabase column → display header.
// Derived from PRIVATE_FIELD_CONFIG (js/private_schools.js) — see the
// comment on getPubColMap() above for why this is a function.
function getPrivColMap() {
  const map = {};
  if (typeof PRIVATE_FIELD_CONFIG !== 'undefined') {
    for (const f of PRIVATE_FIELD_CONFIG) {
      if (f.col) map[f.col] = f.header;
    }
  }
  return map;
}


// ── Helpers ──────────────────────────────────────────────────────────
/** Map a Supabase row object to display-header keys using a col map. */
function _remap(row, colMap) {
  const out = {};
  for (const [col, header] of Object.entries(colMap)) {
    out[header] = row[col] !== undefined ? row[col] : '';
  }
  return out;
}

/** Get ordered display headers from a col map. */
function _headers(colMap) {
  return Object.values(colMap);
}

/** Convert array of Supabase rows to { headers, rows } shape. */
function _toHeadersRows(data, colMap) {
  const headers = _headers(colMap);
  const rows = (data || []).map(r => _remap(r, colMap));
  return { headers, rows };
}

/** Convert array of Supabase rows to { headers, data } shape. */
function _toHeadersData(data, colMap) {
  const headers = _headers(colMap);
  const mapped = (data || []).map(r => _remap(r, colMap));
  return { headers, data: mapped };
}

/**
 * Builds a row-filtering predicate reflecting a user's visibility scope:
 *   - PRIMARY jurisdiction: their own posting (district/wing/tehsil/markaz_name).
 *   - Plus whatever ADDITIONAL scope is assigned via scope_type/scope_value
 *     (Markaz: extra markaz names within their wing/tehsil; Tehsil: "Tehsil:Wing"
 *     pairs; Wing: "District:Wing" pairs; District: whole districts;
 *     Schools: exact EMIS/unique_id list, independent of location).
 * Admins (or a falsy user) get `null` back, meaning "no filter — show all".
 *
 * This mirrors the scope semantics defined in admin.js (renderScopeValueUI) —
 * keep both in sync if the scope model changes.
 */
function _buildUserSchoolFilter(user, opts) {
  const idKey = (opts && opts.idKey) || 'emis'; // 'emis' for public_schools, 'unique_id' for private_schools
  if (!user || String(user.role || '').toLowerCase() === 'admin') return null;

  const primary = {
    district: (user.district || '').trim(),
    wing:     (user.wing     || '').trim(),
    tehsil:   (user.tehsil   || '').trim(),
    markaz:   (user.markaz_name || user.markaz || '').trim(),
  };

  const scopeType  = (user.scope_type || '').trim();
  const scopeValue = (user.scope_value || '').trim();
  const extraTags  = scopeValue ? scopeValue.split(',').map(s => s.trim()).filter(Boolean) : [];

  const groups = [];
  if (primary.district || primary.wing || primary.tehsil || primary.markaz) groups.push(primary);

  if (extraTags.length) {
    if (scopeType === 'Markaz') {
      // Extra markazes are always within the user's own wing/tehsil.
      extraTags.forEach(m => groups.push({ district: primary.district, wing: primary.wing, tehsil: primary.tehsil, markaz: m }));
    } else if (scopeType === 'Tehsil') {
      extraTags.forEach(pair => {
        const [tehsil, wing] = pair.split(':').map(s => (s || '').trim());
        if (tehsil) groups.push({ district: '', wing: wing || '', tehsil, markaz: '' });
      });
    } else if (scopeType === 'Wing') {
      extraTags.forEach(pair => {
        const [district, wing] = pair.split(':').map(s => (s || '').trim());
        if (district || wing) groups.push({ district: district || '', wing: wing || '', tehsil: '', markaz: '' });
      });
    } else if (scopeType === 'District') {
      extraTags.forEach(d => groups.push({ district: d, wing: '', tehsil: '', markaz: '' }));
    }
  }

  const schoolIds = scopeType === 'Schools' ? new Set(extraTags.map(s => s.toLowerCase())) : null;

  return function (row) {
    if (schoolIds && row[idKey] && schoolIds.has(String(row[idKey]).trim().toLowerCase())) return true;
    return groups.some(g =>
      (!g.district || row.district === g.district) &&
      // row.wing is undefined on tables with no wing column at all
      // (private_schools) — treat that as "not applicable" rather than
      // a forced mismatch, same as the SQL RLS functions do (staff_wing
      // is null OR staff_wing = p_wing). Without this, every Tehsil-
      // or Wing-scoped user sees zero private schools, since their
      // scope tag always carries a wing even though private_schools
      // rows never do.
      (!g.wing || row.wing == null || row.wing === g.wing) &&
      (!g.tehsil   || row.tehsil === g.tehsil) &&
      (!g.markaz   || row.markaz_name === g.markaz)
    );
  };
}

/**
 * Shared "24 hours for non-admins, no limit for admins" revert policy.
 * Returns an error string if the window has closed, or null if the
 * revert is allowed. Takes the timestamp of the SPECIFIC action being
 * undone (a staff_events row's created_at when we have one, or the
 * staff row's own changes_made_at for the older status-revert path
 * that isn't tied to an individual event id) — not "now", so a
 * non-admin can't extend their own window by touching the record
 * again after the fact.
 */
async function _isAdminOrTr(user) {
  if ((user.role || '').toLowerCase() === 'admin') return true;
  const { count } = await _sb.from('tehsil_representatives')
    .select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  return (count || 0) > 0;
}

function _checkRevertWindow(user, actionTimestamp) {
  const isAdminUser = user && String(user.role || '').toLowerCase() === 'admin';
  if (isAdminUser) return null;
  const changedAt = actionTimestamp ? new Date(actionTimestamp) : null;
  const hoursSince = changedAt ? (Date.now() - changedAt.getTime()) / (1000 * 60 * 60) : Infinity;
  if (hoursSince > 24) {
    return 'This action can no longer be reverted — it was made more than 24 hours ago. ' +
           'Please contact an admin, who can revert it at any time.';
  }
  return null;
}

/**
 * Reads staff_events (written by executeTransfer / executeMutualTransfer /
 * executePromotion) and shapes it into the { headers, rows } format the
 * Transfer_History / Promotions_History HR tabs expect. There was
 * previously no read path for staff_events at all — every case in this
 * file only ever inserted into it.
 *
 * Scoping: staff_events rows themselves don't carry a jurisdiction (the
 * event's `details` only has from/to EMIS + markaz, no district/wing/
 * tehsil), so this scopes by each employee's CURRENT staff record —
 * same idea as the Staff sheet itself: an HR rep sees the transfer/
 * promotion history of people currently in their jurisdiction.
 */
// Resolves the months a given AEO (targetUserId, in tehsil/wing) can
// bill: every month budget_preparations has on file for their
// tehsil+wing (the source of truth for "prepared"), left-joined
// against any actual inspection_allowance_deductions row for that
// specific AEO. Since 0-deduction rows are no longer stored, a
// missing row means "no deduction that month" = full rate due. Used
// by both the self-service Collective flow and the TR/Admin
// download-for-any-AEO flow, so both stay in sync.
async function _resolveCollectiveMonthsForUser(targetUserId, tehsil, wing) {
  if (!tehsil || !wing) return [];
  const { data: preps } = await _sb.from('budget_preparations')
    .select('year, month')
    .eq('tehsil', tehsil).eq('wing', wing)
    .order('year', { ascending: true }).order('month', { ascending: true })
    .limit(18);
  if (!preps || !preps.length) return [];

  const { data: dedRows } = await _sb.from('inspection_allowance_deductions')
    .select('id, year, month, allowance_rate, deduction, due, downloaded_at')
    .eq('user_id', targetUserId)
    .in('year', [...new Set(preps.map(p => p.year))]);
  const dedByKey = {};
  (dedRows || []).forEach(d => { dedByKey[`${d.year}-${d.month}`] = d; });

  const { data: rateRow } = await _sb.from('inspection_allowance_settings').select('allowance_rate').eq('id', 1).single();
  const rate = Number(rateRow?.allowance_rate) || 25000;

  return preps.map(p => {
    const existing = dedByKey[`${p.year}-${p.month}`];
    return existing || {
      id: null, year: p.year, month: p.month,
      allowance_rate: rate, deduction: 0, due: rate, downloaded_at: null,
    };
  });
}

async function _staffEventHistoryRows(eventTypes, reqUser) {
  const events = await _fetchAllRows('staff_events', '*', q => q.in('event_type', eventTypes));
  events.sort((a, b) => new Date(b.created_at || b.effective_date || 0) - new Date(a.created_at || a.effective_date || 0));

  const pnos = [...new Set(events.map(e => e.personal_no).filter(Boolean).map(String))];
  let staffByPno = {};
  if (pnos.length) {
    const staffRows = await _fetchAllRows(
      'staff',
      'personal_no, cnic, designation, bps, school_emis_code, school_name, markaz_name, district, wing, tehsil',
      q => q.in('personal_no', pnos)
    );
    staffByPno = Object.fromEntries((staffRows || []).map(r => [String(r.personal_no), r]));
  }

  const filterFn = _buildUserSchoolFilter(reqUser, { idKey: 'school_emis_code' });

  const rows = [];
  for (const e of events) {
    const s = staffByPno[String(e.personal_no)] || {};
    // If we can't find the employee's current staff record at all, show
    // the event anyway rather than silently dropping it (e.g. the
    // employee was later deleted/archived) — only scope-filter rows
    // where we actually know the employee's current jurisdiction.
    if (filterFn && staffByPno[String(e.personal_no)] && !filterFn(s)) continue;

    const d = e.details || {};
    rows.push({
      'Employee Personal No': e.personal_no || '',
      'Employee Name':        e.employee_name || '',
      'Employee CNIC':        s.cnic || '',
      'Event Type':           e.event_type === 'mutual_transfer' ? 'Mutual Transfer'
                             : e.event_type === 'transfer'        ? 'Transfer'
                             : e.event_type === 'promotion'       ? 'Promotion'
                             : (e.event_type || ''),
      'Notification No':      e.notification_no || '',
      'Effective Date':       e.effective_date || '',
      'From EMIS':            d.from_emis || '',
      'To EMIS':              d.to_emis || '',
      'From Markaz':          d.from_markaz || '',
      'To Markaz':            d.to_markaz || '',
      'To School':            d.to_school || '',
      'Swapped With':         d.swapped_with_name || '',
      'Old Designation':      d.old_designation || '',
      'New Designation':      d.new_designation || '',
      'Old BPS':               d.old_bps || '',
      'New BPS':               d.new_bps || '',
      'Changes Made by':      e.created_by || '',
      'Time':                 e.created_at || '',
      _row:                   e.id,
      'PERSONAL NO.':          e.personal_no || '',   // aliases some HR-side code looks for
      'NAME OF TEACHER':       e.employee_name || '',
      // BUGFIX (2026-07-24): rows here never carried District/Wing/
      // Tehsil/MARKAZ NAME at all. The HR tab's jurisdiction dropdowns
      // auto-preselect a non-admin user's own District/Wing/Tehsil/
      // Markaz on every tab switch (see buildHrDistrictDropdown in
      // hr_view.js) — including Transfer_History/Promotions_History —
      // and the client-side filter in runHrClientFilter compares that
      // against these row fields. With the fields missing, every row
      // read as blank district/wing/etc., never matched the
      // auto-selected value, and got filtered out — so these two tabs
      // showed "No records found" for every non-admin user even though
      // the data loaded fine. Using the employee's CURRENT jurisdiction
      // (same source _buildUserSchoolFilter above already scopes by)
      // fixes the filter and makes it actually useful on these tabs.
      'District':              s.district || '',
      'Wing':                  s.wing || '',
      'Tehsil':                s.tehsil || '',
      'MARKAZ NAME':           s.markaz_name || '',
    });
  }

  const headers = eventTypes.includes('promotion')
    ? ['Employee Personal No', 'Employee Name', 'Employee CNIC', 'Notification No', 'Effective Date',
       'Old Designation', 'New Designation', 'Old BPS', 'New BPS', 'Changes Made by', 'Time']
    : ['Employee Personal No', 'Employee Name', 'Employee CNIC', 'Event Type', 'Notification No', 'Effective Date',
       'From EMIS', 'To EMIS', 'From Markaz', 'To Markaz', 'To School', 'Swapped With', 'Changes Made by', 'Time'];

  return { headers, rows };
}

/**
 * "Awaiting Posting Issues" history — every permanent assignment made
 * through the Awaiting Posting module (event_type='awaiting_posting_
 * assigned'), plus the revert records for those that were undone
 * (event_type='awaiting_posting_reverted'). Nothing here is ever
 * deleted; a revert adds a second row rather than removing the first.
 * Only Temporary Duty and regular Transfer/Promotion events are
 * excluded by construction (different event_types), matching the
 * "Awaiting Posting only" data-source requirement.
 */
async function _awaitingPostingHistoryRows(reqUser) {
  const events = await _fetchAllRows('staff_events', '*',
    q => q.in('event_type', ['awaiting_posting_assigned', 'awaiting_posting_reverted']));
  events.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const pnos = [...new Set(events.map(e => e.personal_no).filter(Boolean).map(String))];
  let staffByPno = {};
  if (pnos.length) {
    const staffRows = await _fetchAllRows(
      'staff',
      'personal_no, cnic, designation, bps, school_emis_code, school_name, markaz_name, district, wing, tehsil',
      q => q.in('personal_no', pnos)
    );
    staffByPno = Object.fromEntries((staffRows || []).map(r => [String(r.personal_no), r]));
  }

  // Resolve the assigned/previous school's own jurisdiction (District/
  // Wing/Tehsil/Markaz columns the grid asks for) rather than the
  // employee's CURRENT jurisdiction, since a reverted employee's
  // current record no longer points at that school at all.
  const emisSet = new Set();
  events.forEach(e => {
    const d = e.details || {};
    if (d.assigned_school_emis) emisSet.add(d.assigned_school_emis);
    if (d.previous_school_emis) emisSet.add(d.previous_school_emis);
  });
  let schoolByEmis = {};
  if (emisSet.size) {
    const emisList = [...emisSet];
    const [{ data: pub }, { data: priv }] = await Promise.all([
      _sb.from('public_schools').select('emis, district, wing, tehsil, markaz_name').in('emis', emisList),
      _sb.from('private_schools').select('emis, district, tehsil, markaz_name').in('emis', emisList),
    ]);
    (pub || []).forEach(s => schoolByEmis[s.emis] = s);
    (priv || []).forEach(s => { if (!schoolByEmis[s.emis]) schoolByEmis[s.emis] = s; });
  }

  // Reverted-status lookup: an assigned event is only revertible if no
  // reverted event referencing it exists yet.
  const revertedEventIds = new Set(
    events.filter(e => e.event_type === 'awaiting_posting_reverted')
      .map(e => (e.details || {}).reverted_event_id).filter(Boolean)
  );

  const filterFn = _buildUserSchoolFilter(reqUser, { idKey: 'school_emis_code' });

  const rows = [];
  for (const e of events) {
    const s = staffByPno[String(e.personal_no)] || {};
    if (filterFn && staffByPno[String(e.personal_no)] && !filterFn(s)) continue;

    const d = e.details || {};
    const isAssigned = e.event_type === 'awaiting_posting_assigned';
    const schoolEmis = isAssigned ? d.assigned_school_emis : d.previous_school_emis;
    const schoolName = isAssigned ? d.assigned_school_name : d.previous_school_name;
    const school = schoolEmis ? (schoolByEmis[schoolEmis] || {}) : {};
    const alreadyReverted = isAssigned && revertedEventIds.has(e.id);

    rows.push({
      'Action Date & Time':   e.created_at || '',
      'Employee Name':        e.employee_name || '',
      'Personal No':          e.personal_no || '',
      'CNIC':                 s.cnic || '',
      'Designation':          s.designation || '',
      'Previous Status':      isAssigned ? 'Awaiting Posting' : 'Assigned (now reverted)',
      'Assigned School':      schoolName || '',
      'EMIS Code':            schoolEmis || '',
      'District':             school.district    || s.district    || '',
      'Wing':                 school.wing         || s.wing         || '',
      'Tehsil':               school.tehsil       || s.tehsil       || '',
      'Markaz':               school.markaz_name  || s.markaz_name  || '',
      'MARKAZ NAME':          school.markaz_name  || s.markaz_name  || '', // alias: runHrClientFilter reads this key
      'Assigned By':          e.created_by || '',
      'Assignment Source':    isAssigned ? 'Awaiting Posting' : 'Awaiting Posting Revert',
      'Remarks':              isAssigned
                                 ? (alreadyReverted ? 'Reverted back to Awaiting Posting.' : '')
                                 : 'Reason: ' + (d.reason || 'Manual Revert'),
      _row:                    e.id,
      _canRevert:              isAssigned && !alreadyReverted,
      'PERSONAL NO.':          e.personal_no || '',
      'NAME OF TEACHER':       e.employee_name || '',
    });
  }

  const headers = [
    'Action Date & Time', 'Employee Name', 'Personal No', 'CNIC', 'Designation', 'Previous Status',
    'Assigned School', 'EMIS Code', 'District', 'Wing', 'Tehsil', 'Markaz',
    'Assigned By', 'Assignment Source', 'Remarks',
  ];
  return { headers, rows };
}

/** Read-only Temporary Duty history — every create/complete/cancel event. */
async function _tdHistoryRows(reqUser) {
  const events = await _fetchAllRows('staff_events', '*',
    q => q.in('event_type', ['td_created', 'td_completed', 'td_cancelled']));
  events.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const pnos = [...new Set(events.map(e => e.personal_no).filter(Boolean).map(String))];
  let staffByPno = {};
  if (pnos.length) {
    const staffRows = await _fetchAllRows(
      'staff', 'personal_no, cnic, designation, school_emis_code, markaz_name, district, wing, tehsil',
      q => q.in('personal_no', pnos)
    );
    staffByPno = Object.fromEntries((staffRows || []).map(r => [String(r.personal_no), r]));
  }
  const filterFn = _buildUserSchoolFilter(reqUser, { idKey: 'school_emis_code' });

  const rows = [];
  for (const e of events) {
    const s = staffByPno[String(e.personal_no)] || {};
    if (filterFn && staffByPno[String(e.personal_no)] && !filterFn(s)) continue;
    const d = e.details || {};
    rows.push({
      'Action Date & Time':  e.created_at || '',
      'Employee Name':       e.employee_name || '',
      'Personal No':         e.personal_no || '',
      'CNIC':                s.cnic || '',
      'Event':               e.event_type === 'td_created' ? 'Temporary Duty Created'
                            : e.event_type === 'td_completed' ? 'Temporary Duty Completed'
                            : 'Temporary Duty Cancelled',
      'Temporary School':    d.temporary_school_name || '',
      'EMIS Code':           d.temporary_school_emis || '',
      'Order Number':        d.order_number || '',
      'Start Date':          d.start_date || '',
      'Till Date':           d.end_date || '—',
      'District':            s.district || '', 'Wing': s.wing || '', 'Tehsil': s.tehsil || '', 'Markaz': s.markaz_name || '',
      'MARKAZ NAME':         s.markaz_name || '', // alias: runHrClientFilter reads this key
      _row: e.id,
      'PERSONAL NO.': e.personal_no || '', 'NAME OF TEACHER': e.employee_name || '',
    });
  }
  const headers = ['Action Date & Time', 'Employee Name', 'Personal No', 'CNIC', 'Event',
    'Temporary School', 'EMIS Code', 'Order Number', 'Start Date', 'Till Date', 'District', 'Wing', 'Tehsil', 'Markaz'];
  return { headers, rows };
}

/**
 * Live Awaiting Posting list, shaped for the SAME generic HR table
 * (headers/rows/renderHrTable/openHrMenu) that Staff, Retirement, etc.
 * already use — per request, this should open exactly like those
 * tabs rather than a separate bespoke page. RLS on
 * staff_awaiting_posting already scopes rows to the signed-in user
 * (editor/admin + jurisdiction), same as the old dedicated loader did.
 */
async function _awaitingPostingSheetRows() {
  const { data, error } = await _sb.from('staff_awaiting_posting')
    .select('*, staff(name_of_teacher, cnic, designation, bps)')
    .in('status', ['awaiting', 'on_temporary_duty'])
    .order('entry_date', { ascending: false });
  if (error) return { headers: [], rows: [] };

  const AP_REASON_LABELS = {
    outsourced_school: 'Outsourced School', school_closed: 'School Closed', removed: 'Removed',
    transfer_completed: 'Transfer Completed', manual_revert: 'Reverted (Awaiting Posting Issues)', manual: 'Manual',
  };
  const rows = (data || []).map(r => {
    const s = r.staff || {};
    return {
      'Employee Name':    s.name_of_teacher || '',
      'Personal No':       r.personal_no || '',
      'CNIC':              s.cnic || '',
      'Designation':       s.designation || '',
      'BPS':               s.bps != null ? String(s.bps) : '',
      'Status':            r.status === 'on_temporary_duty' ? 'On Temporary Duty' : 'Awaiting Posting',
      'Previous School':   r.previous_school_name || '',
      'Previous Tehsil':   r.previous_tehsil || '',
      'Previous Markaz':   r.previous_markaz || '',
      'Previous District': r.previous_district || '',
      'Entry Date':        r.entry_date || '',
      'Reason':            AP_REASON_LABELS[r.reason] || r.reason || '',
      'Remarks':           r.remarks || '',
      _row:                r.id,
      _canAssign:          true,
      'PERSONAL NO.':      r.personal_no || '',
      'NAME OF TEACHER':   s.name_of_teacher || '',
      'District':          r.previous_district || '', 'Wing': r.previous_wing || '',
      'Tehsil':            r.previous_tehsil || '',    'MARKAZ NAME': r.previous_markaz || '',
    };
  });
  const headers = ['Employee Name', 'Personal No', 'CNIC', 'Designation', 'BPS', 'Status',
    'Previous School', 'Previous Tehsil', 'Previous Markaz', 'Previous District', 'Entry Date', 'Reason', 'Remarks'];
  return { headers, rows };
}

/** Live Temporary Duty list, same generic-table treatment as above. */
async function _temporaryDutySheetRows() {
  const { data, error } = await _sb.from('staff_temporary_duty')
    .select('*, staff(name_of_teacher, cnic, designation, bps)')
    .eq('status', 'active')
    .order('start_date', { ascending: false });
  if (error) return { headers: [], rows: [] };

  const rows = (data || []).map(r => {
    const s = r.staff || {};
    return {
      'Employee Name':      s.name_of_teacher || '',
      'Personal No':         r.personal_no || '',
      'CNIC':                s.cnic || '',
      'Designation':         s.designation || '',
      'Original School':    r.original_school_name || '',
      'Temporary School':   r.temporary_school_name || '',
      'Start Date':          r.start_date || '',
      'Till Date':            r.end_date || '—',
      'Order Number':        r.order_number || '',
      _row:                   r.id,
      'PERSONAL NO.':        r.personal_no || '',
      'NAME OF TEACHER':     s.name_of_teacher || '',
    };
  });
  const headers = ['Employee Name', 'Personal No', 'CNIC', 'Designation',
    'Original School', 'Temporary School', 'Start Date', 'Till Date', 'Order Number'];
  return { headers, rows };
}

/** Current logged-in user from localStorage. */
function _getUser() {
  try {
    const raw = localStorage.getItem(CONFIG.SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Calls the admin-user-management Edge Function for privileged
 * operations (create/delete user, reset password) that need the
 * service_role key — which never lives in frontend code.
 */
async function _callAdminFunction(action, payload) {
  const { data: sessionData } = await _sb.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return { success: false, message: 'Not logged in.' };

  const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/hyper-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ action, payload }),
  });
  return res.json();
}

/**
 * Fetch ALL rows from a table, bypassing Supabase/PostgREST's default
 * 1000-row-per-request cap. Pages through in batches using .range().
 * Use this for any table that can plausibly exceed 1000 rows
 * (schools: 38k+, public_schools: 38k+, staff: 7k+, etc).
 */
async function _fetchAllRows(table, selectCols, queryBuilderFn, filterFn, keysetCol) {
  const PAGE = 1000;

  if (keysetCol) {
    // Keyset (cursor) pagination: "WHERE col > lastValue ORDER BY col
    // LIMIT 1000" — cost stays flat no matter how deep the page is.
    // Use this for large tables (tens of thousands of rows); OFFSET
    // pagination below gets slower every page since Postgres still has
    // to scan and discard everything before the offset each time,
    // which is what was causing statement timeouts on later pages of
    // public_schools.
    let allRows = [];
    let cursor = null;
    while (true) {
      let q = _sb.from(table).select(selectCols);
      if (queryBuilderFn) q = queryBuilderFn(q);
      if (filterFn) q = filterFn(q);
      if (cursor !== null) q = q.gt(keysetCol, cursor);
      q = q.order(keysetCol, { ascending: true }).limit(PAGE);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;
      allRows = allRows.concat(data);
      if (data.length < PAGE) break;  // last page
      cursor = data[data.length - 1][keysetCol];
    }
    return allRows;
  }

  let allRows = [];
  let from = 0;
  while (true) {
    let q = _sb.from(table).select(selectCols);
    if (queryBuilderFn) q = queryBuilderFn(q);
    if (filterFn) q = filterFn(q);
    q = q.range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < PAGE) break;  // last page
    from += PAGE;
  }
  return allRows;
}

/**
 * Run an UPDATE and tell the difference between "no error, but RLS
 * silently blocked it (0 rows changed)" and a real success. Without
 * .select() here, Supabase returns no error AND no row count for an
 * RLS-blocked update, so callers were reporting false "success".
 */
async function _checkedUpdate(table, dbRow, matchCol, matchVal) {
  // IMPORTANT: use count instead of .select() here. .select() forces
  // Postgres to re-read the just-written row under the table's SELECT
  // policy to return it — and for tables like `staff` where UPDATE and
  // SELECT have different scope rules (an editor can WRITE a transfer
  // that moves someone outside their own jurisdiction, but can't SELECT
  // that row afterward since it's now out of scope), that re-read fails
  // even though the write itself succeeded, surfacing as a confusing
  // "violates row-level security policy" error for a perfectly valid
  // write. Counting affected rows verifies the write happened without
  // needing to read the row's content back at all.
  const { error, count } = await _sb.from(table).update(dbRow, { count: 'exact' }).eq(matchCol, matchVal);
  if (error) return { ok: false, message: error.message };
  if (!count || count === 0) {
    return {
      ok: false,
      message: `Save blocked: no row was updated in "${table}". This is almost always a missing/too-strict ` +
               `Row Level Security UPDATE policy for this table in Supabase — check Authentication → Policies.`,
    };
  }
  return { ok: true, count };
}

// Staff writes go through a dedicated RPC instead of a plain table
// update. Reason: Postgres requires that after ANY update, the
// resulting row must still satisfy the table's SELECT policy — not
// just the UPDATE policy's own WITH CHECK. For `staff`, that meant a
// transfer moving someone to a different wing/jurisdiction than the
// acting editor's own scope got silently rejected, even though the
// UPDATE policy itself was correctly written to allow it. This RPC
// (see supabase migration) authorizes against the OLD row only, then
// writes with elevated privilege — sidestepping that automatic
// coupling entirely without weakening any other security boundary.
async function _staffPrivilegedUpdate(pno, updates) {
  const { data, error } = await _sb.rpc('staff_privileged_update', {
    p_personal_no: pno,
    p_updates: updates,
  });
  if (error) return { ok: false, message: error.message };
  if (!data || data === 0) {
    return { ok: false, message: `No staff record found for personal number "${pno}", or you're not authorized to modify it.` };
  }
  return { ok: true, count: data };
}

async function _checkedDelete(table, matchCol, matchVal) {
  const { error, count } = await _sb.from(table).delete({ count: 'exact' }).eq(matchCol, matchVal);
  if (error) return { ok: false, message: error.message };
  if (!count || count === 0) {
    return {
      ok: false,
      message: `Delete blocked: no row was deleted in "${table}". This is almost always a missing/too-strict ` +
               `Row Level Security DELETE policy for this table in Supabase — check Authentication → Policies.`,
    };
  }
  return { ok: true, count };
}

/**
 * Form inputs send '' for any field the user left blank — including
 * numeric and date columns. Postgres rejects an empty string for those
 * column types ("invalid input syntax for type integer/numeric/date"),
 * so every empty string needs to become a real null before it reaches
 * the database. Text columns are fine either way, so this is safe to
 * apply blanket across an entire row.
 */
function _sanitizeEmpty(dbRow) {
  const out = { ...dbRow };
  for (const k of Object.keys(out)) {
    if (out[k] === '') out[k] = null;
  }
  return out;
}

// Columns that are numeric/integer in the database. HTML number inputs
// still submit plain strings, and Postgres will throw "invalid input
// syntax for type integer/numeric" if it receives anything that isn't
// a clean number (including a lone '-' or stray text). Coerce these to
// real numbers (or null) before they ever reach Supabase, instead of
// trusting the raw string.
const _NUMERIC_COLUMNS = new Set([
  // public_schools
  'latitude', 'longitude', 'uc_no', 'na_no', 'pp_no', 'kanal', 'marlas', 'sarsai',
  'total_area_sqft', 'total_covered_area_sqft', 'total_uncovered_area_sqft',
  'total_rooms', 'used_for_teaching', 'non_teaching_activities', 'total_washrooms',
  'required_boundary_wall', 'total_furniture', 'total_enrollment',
  // private_schools
  'latitude', 'longitude', 'total_rooms', 'total_teaching_staff', 'total_non_teaching_staff',
  'total_enrollment', 'entry_gates', 'operational_gates', 'cctv_cameras', 'security_guards',
  'boundary_wall_height_ft', 'nearby_key_installations',
]);

function _coerceNumericColumns(dbRow) {
  const out = { ...dbRow };
  for (const k of Object.keys(out)) {
    if (!_NUMERIC_COLUMNS.has(k)) continue;
    if (out[k] === null || out[k] === undefined || out[k] === '') { out[k] = null; continue; }
    const n = Number(out[k]);
    out[k] = Number.isFinite(n) ? n : null;
  }
  return out;
}

// =====================================================================
//  MAIN API DISPATCHER
// =====================================================================
async function apiCall(action, payload) {
  const user = _getUser();

  switch (action) {

    // ── AUTH ──────────────────────────────────────────────────────────
    case 'login': {
      const cnic = Array.isArray(payload) ? payload[0] : payload?.cnic ?? payload;
      const pass = Array.isArray(payload) ? payload[1] : payload?.password ?? payload;

      // Find the user's placeholder email via their CNIC.
      // Uses a security-definer DB function since the user isn't
      // authenticated yet, so normal RLS would block a direct table read.
      const { data: loginEmail, error: profileErr } = await _sb
        .rpc('get_login_email', { p_cnic: String(cnic).trim() });

      if (profileErr || !loginEmail) {
        return { success: false, message: 'CNIC not found. Please check and try again.' };
      }

      const placeholderEmail = loginEmail;
      const { data: authData, error: authErr } = await _sb.auth
        .signInWithPassword({ email: placeholderEmail, password: String(pass) });

      if (authErr) {
        return { success: false, message: 'Invalid CNIC or password.' };
      }

      // Fetch full profile row
      const { data: fullProfile } = await _sb
        .from('app_users')
        .select('*')
        .eq('id', authData.user.id)
        .single();

      // Tehsil Representative assignments — admins implicitly have TR
      // authority everywhere, so they don't need explicit rows. TR scope
      // is now (tehsil, wing) pairs, e.g. a TR for "KAROR LALISAN / M-EE"
      // does not automatically also cover "KAROR LALISAN / W-EE".
      let trScopes = [];
      if (String(fullProfile.role).toLowerCase() === 'admin') {
        const { data: allScopes } = await _sb.from('app_users').select('tehsil, wing').not('tehsil', 'is', null);
        const seen = new Set();
        (allScopes || []).forEach(r => {
          if (!r.tehsil || !r.wing) return;
          const key = r.tehsil + '|' + r.wing;
          if (!seen.has(key)) { seen.add(key); trScopes.push({ tehsil: r.tehsil, wing: r.wing }); }
        });
      } else {
        const { data: trRows } = await _sb.from('tehsil_representatives').select('tehsil, wing').eq('user_id', authData.user.id);
        trScopes = (trRows || []).map(r => ({ tehsil: r.tehsil, wing: r.wing }));
      }

      const userObj = {
        success:     true,
        id:          fullProfile.id,
        name:        fullProfile.name,
        cnic:        fullProfile.cnic,
        personal_no: fullProfile.personal_no,
        role:        fullProfile.role,
        markaz:      fullProfile.markaz_name,
        markaz_name: fullProfile.markaz_name,
        district:    fullProfile.district,
        wing:        fullProfile.wing,
        tehsil:      fullProfile.tehsil,
        cell_no:     fullProfile.cell_no,
        email:       fullProfile.email,
        designation: fullProfile.designation,
        markaz_name_ur: fullProfile.markaz_name_ur,
        designation_ur: fullProfile.designation_ur,
        scope_type:  fullProfile.scope_type,
        scope_value: fullProfile.scope_value,
        access_type: fullProfile.access_type,
        email_was_generated: fullProfile.email_was_generated,
        page_no:        fullProfile.page_no,
        ddeo_code:      fullProfile.ddeo_code,
        bps_scale:      fullProfile.bps_scale,
        dy_office_detail: fullProfile.dy_office_detail,
        tr_scopes: trScopes, // [{tehsil, wing}] pairs this user can prepare Inspection Allowance budgets for
      };

      localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(userObj));
      return userObj;
    }

    case 'logout': {
      await _sb.auth.signOut();
      localStorage.removeItem(CONFIG.SESSION_KEY);
      return { success: true };
    }

    case 'changePassword': {
      const newPwd = payload?.newPassword || payload;
      const { error } = await _sb.auth.updateUser({ password: String(newPwd) });
      if (error) return { success: false, message: error.message };
      return { success: true, message: 'Password changed successfully.' };
    }

    case 'updateEmail': {
      const email = payload?.email || payload;
      const { error } = await _sb.auth.updateUser({ email: String(email) });
      if (error) return { success: false, message: error.message };
      return { success: true, message: 'Email update initiated. Check your new email to confirm.' };
    }

    // ── DASHBOARD KPIs ─────────────────────────────────────────────────
    case 'getSummaryCounts': {
      // NOTE: this used to assume RLS alone was enough (same wrong
      // assumption getSchoolHierarchyForUser used to make) — RLS scopes
      // by a user's PRIMARY posting but doesn't know about ADDITIONAL
      // scope_type/scope_value tags (extra Markaz/Tehsil/Wing/District
      // assignments), so a plain count() over-counted for any user with
      // extra scope.
      //
      // Fetching+filtering every row (as the correctness fix first did)
      // is only actually necessary for users who HAVE extra scope tags
      // — an additive OR-of-groups can't be expressed as simple .eq()
      // filters. For the common case (a user with just their one
      // primary posting, no extra tags) we can push the filter down to
      // Postgres as indexed .eq() calls and use a fast head:true count,
      // same performance as before. Only the minority with extra scope
      // pays for the slower fetch-then-filter path.
      try {
        const reqUser  = payload || user;
        const isAdmin  = !reqUser || String(reqUser.role || '').toLowerCase() === 'admin';
        const scopeType  = (reqUser && reqUser.scope_type  || '').trim();
        const scopeValue = (reqUser && reqUser.scope_value || '').trim();
        const hasExtraScope = !isAdmin && !!scopeType && !!scopeValue;
        const filterFn = hasExtraScope ? _buildUserSchoolFilter(reqUser, { idKey: 'emis' }) : null;

        const fastCount = async (table, statusVal) => {
          let q = _sb.from(table).select('*', { count: 'exact', head: true }).eq('status', statusVal);
          if (!isAdmin) {
            const d = (reqUser.district || '').trim();
            const w = (reqUser.wing     || '').trim();
            const t = (reqUser.tehsil   || '').trim();
            const m = (reqUser.markaz_name || reqUser.markaz || '').trim();
            if (d) q = q.eq('district', d);
            if (w && table === 'public_schools') q = q.eq('wing', w);
            if (t) q = q.eq('tehsil', t);
            if (m) q = q.eq('markaz_name', m);
          }
          const { count, error } = await q;
          if (error) throw error;
          return count || 0;
        };

        const slowFilteredCount = async (table, statusVal, idKey) => {
          const cols = table === 'private_schools'
            ? 'unique_id, district, tehsil, markaz_name, status'
            : 'emis, district, wing, tehsil, markaz_name, status';
          const rows = await _fetchAllRows(table, cols, null, q => q.eq('status', statusVal), idKey);
          return filterFn ? (rows || []).filter(filterFn).length : (rows || []).length;
        };

        const countOf = (table, statusVal, idKey) =>
          hasExtraScope ? slowFilteredCount(table, statusVal, idKey) : fastCount(table, statusVal);

        const [publicCount, outsourcedCount, privateCount, inactiveCount] = await Promise.all([
          countOf('public_schools',  'Active',      'emis'),
          countOf('public_schools',  'Out Sourced', 'emis'),
          countOf('private_schools', 'Active',      'unique_id'),
          countOf('private_schools', 'Inactive',    'unique_id'),
        ]);

        return { success: true, publicCount, outsourcedCount, privateCount, inactiveCount };
      } catch (e) {
        return { success: false, message: e && e.message ? e.message : 'Failed to load summary counts.' };
      }
    }

    case 'getKpiCards': {
      // payload (optional) is the module key the caller wants cards for,
      // e.g. 'tools', 'hr', 'public_schools', 'private_schools'.
      // Omitted/blank => 'dashboard', which also matches legacy rows saved
      // before the `module` column existed (module IS NULL).
      const moduleKey = (typeof payload === 'string' && payload.trim()) ? payload.trim() : 'dashboard';
      const { data, error } = await _sb
        .from('kpi_cards')
        .select('*')
        .eq('active', true)
        .order('display_order');
      if (error) return { success: false, message: error.message };
      // Map to the column names the frontend's renderDashboardKpiCards() uses
      const mapped = (data || [])
        .filter(c => (c.module || 'dashboard') === moduleKey)
        .map(c => ({
          'Card Title':       c.card_title       || '',
          'Card Icon':        c.card_icon        || '',
          'Card Color':       c.card_color       || '',
          'Card Description': c.card_description || '',
          'Action Type':      c.action_type      || 'module',
          'Action Value':     c.action_value     || '',
          'Display Order':    c.display_order    || 99,
          'Scope Type':       c.jurisdiction_scope_type  || 'All',
          'Scope Value':      c.jurisdiction_scope_value || '',
          'Scope District':   c.scope_district || '',
          'Scope Wing':       c.scope_wing     || '',
          'Scope Tehsil':     c.scope_tehsil   || '',
          'Scope Markaz':     c.scope_markaz   || '',
          'Module':           c.module || 'dashboard',
          _id: c.id,
        }));
      return { success: true, data: mapped };
    }

    case 'getLinksAndApps': {
      const { data, error } = await _sb.from('links_apps').select('*');
      if (error) return { success: false, message: error.message };
      const rows = (data || []).filter(r => (typeof _isScopedItemVisibleToCurrentUser !== 'function') || _isScopedItemVisibleToCurrentUser({
        'Scope Type': r.visibility_scope_type || 'All',
        'Scope District': r.scope_district || '', 'Scope Wing': r.scope_wing || '',
        'Scope Tehsil': r.scope_tehsil || '', 'Scope Markaz': r.scope_markaz || '',
      }));
      return {
        success:       true,
        importantLinks: rows.filter(r => r.link_category === 'Important Link' || r.link_name)
                            .filter(r => r.link_name && r.link_url)
                            .map(r => ({ name: r.link_name, url: r.link_url })),
        // NOTE: the Admin Panel's "App Category" dropdown actually saves
        // 'Official/Departmental' and 'By Team AEOs' (see index.html),
        // not the plain 'Official'/'Team' this used to check for — that
        // mismatch meant every categorized app fell through and showed
        // in neither section.
        officialApps:   rows.filter(r => r.app_category === 'Official/Departmental' || (!r.app_category && r.app_name))
                            .filter(r => r.app_name && r.app_url)
                            .map(r => ({ name: r.app_name, url: r.app_url })),
        teamApps:       rows.filter(r => r.app_category === 'By Team AEOs')
                            .filter(r => r.app_name && r.app_url)
                            .map(r => ({ name: r.app_name, url: r.app_url })),
      };
    }

    case 'getToolsUser': {
      const { data, error } = await _sb.from('tools').select('*');
      if (error) return { success: false, message: error.message };
      const visible = (data || []).filter(t => (typeof _isScopedItemVisibleToCurrentUser !== 'function') || _isScopedItemVisibleToCurrentUser({
        'Scope Type': t.visibility_scope_type || 'All',
        'Scope District': t.scope_district || '', 'Scope Wing': t.scope_wing || '',
        'Scope Tehsil': t.scope_tehsil || '', 'Scope Markaz': t.scope_markaz || '',
      }));
      return {
        success: true,
        tools: visible.map(t => ({ name: t.tool_name, url: t.tool_url })),
      };
    }

    // ── SCHOOL HIERARCHY (dropdown cascade) ───────────────────────────
    // NOTE: this used to return the full national hierarchy to every
    // user regardless of jurisdiction — the `reqUser`/payload argument
    // was accepted but never actually used to filter anything, so
    // Public/Private/HR dropdowns showed every district to everyone.
    // RLS on `schools` (supabase_jurisdiction_rls.sql) restricts rows
    // by the user's PRIMARY posting, but it does not know about a
    // user's ADDITIONAL scope_type/scope_value tags (e.g. a Tehsil
    // officer with a couple of extra Markazes assigned) — RLS let the
    // whole tehsil's markaz list through instead of just the assigned
    // ones. So we apply the same additive-group filter here that
    // loadSheetForClient already uses for row data, keeping dropdown
    // options and row visibility in sync for every scope type
    // (Markaz/Tehsil/Wing/District).
    // ── SCHOOL HIERARCHY — GLOBAL / UNRESTRICTED (Transfer & Promotion) ─
    // Deliberately bypasses _buildUserSchoolFilter. Transfer/Promotion
    // need to target ANY school in the system, not just the acting
    // officer's own jurisdiction — a transfer's whole point is moving
    // staff to a *different* jurisdiction. Every other caller of
    // getSchoolHierarchy/getSchoolHierarchyForUser (dropdown cascades,
    // Add/Edit Staff "current school", Public/Private school filters)
    // must stay jurisdiction-scoped, so this is a separate action
    // rather than a flag on the existing one — nobody should be able to
    // widen those by accident.
    //
    // NOTE: this still runs through the anon/session Supabase client,
    // so it is only truly unrestricted once the `schools` table's RLS
    // policy also allows any authenticated user to SELECT all rows
    // (see accompanying SQL note). If RLS still scopes by primary
    // posting, this action will silently return a jurisdiction-limited
    // set despite the app-level filter being removed here.
    case 'getAllSchoolsGlobal': {
      try {
        const data = await _fetchAllRows('schools', 'district, wing, tehsil, markaz, school_name, emis',
          null, null, 'emis');
        return (data || []).map(r => ({
          d: r.district,
          w: r.wing,
          t: r.tehsil,
          m: r.markaz,
          s: r.school_name,
          e: r.emis,
        }));
      } catch (e) {
        throw new Error('Could not load the full school list: ' + (e && e.message ? e.message : 'Unknown error'));
      }
    }

    case 'getSchoolHierarchy':
    case 'getSchoolHierarchyForUser': {
      try {
        const data = await _fetchAllRows('schools', 'district, wing, tehsil, markaz, school_name, emis',
          null, null, 'emis');
        const reqUser = payload || user;
        const filterFn = _buildUserSchoolFilter(reqUser, { idKey: 'emis' });
        // _buildUserSchoolFilter checks row.markaz_name (the column name
        // used by public_schools/private_schools/staff) — the `schools`
        // table names the same column plain `markaz`, so alias it here
        // or the markaz-level check would silently never match.
        const visible = filterFn
          ? (data || []).filter(r => filterFn({ ...r, markaz_name: r.markaz }))
          : (data || []);
        // Shape: [{d, w, t, m, s, e}] — exactly what core.js schoolCache expects
        // (s = school_name, distinct from m = markaz/cluster name)
        return visible.map(r => ({
          d: r.district,
          w: r.wing,
          t: r.tehsil,
          m: r.markaz,
          s: r.school_name,
          e: r.emis,
        }));
      } catch (e) {
        // Surface a clear, specific message instead of letting a raw
        // Postgres/RLS error string reach the UI unexplained. This is
        // most commonly caused by a malformed scope_value/tehsil/district
        // on this specific user's app_users profile — check that row if
        // this keeps happening for one particular user only.
        throw new Error('Could not load the school list (possibly a jurisdiction/scope configuration issue on this user\u2019s profile): ' + (e && e.message ? e.message : 'Unknown error'));
      }
    }

    // ── STAFF (HR) ────────────────────────────────────────────────────
    case 'loadSheetForClient': {
      // payload: 'Staff' | ['Staff', user] | ['Staff', user, filters]
      const sheetName = Array.isArray(payload) ? payload[0] : (payload || 'Staff');
      const reqUser   = Array.isArray(payload) ? payload[1] : null;

      // Transfer_History / Promotions_History aren't statuses on the
      // `staff` table at all — they're event logs written to
      // `staff_events` by executeTransfer/executeMutualTransfer/
      // executePromotion. Previously these two sheet names fell through
      // to the `statusMap[sheetName] || 'active'` default below, which
      // silently queried `staff` for status='active' — i.e. it rendered
      // the Active Staff list again instead of any history, so these
      // two tabs always looked empty/wrong to users. Route them to the
      // event log instead.
      if (sheetName === 'Transfer_History' || sheetName === 'Promotions_History') {
        const eventTypes = sheetName === 'Transfer_History'
          ? ['transfer', 'mutual_transfer']
          : ['promotion'];
        return await _staffEventHistoryRows(eventTypes, reqUser);
      }
      if (sheetName === 'AwaitingPosting_History') {
        return await _awaitingPostingHistoryRows(reqUser);
      }
      if (sheetName === 'TD_History') {
        return await _tdHistoryRows(reqUser);
      }
      if (sheetName === 'AwaitingPosting') {
        return await _awaitingPostingSheetRows();
      }
      if (sheetName === 'TemporaryDuty') {
        return await _temporaryDutySheetRows();
      }

      const statusMap = {
        'Staff':             'active',
        'Termination':       'terminated',
        'Retirement':        'retired',
        'Resignation':       'resigned',
        'Deceased':          'deceased',
        'Deleted_Archive':   'deleted',
        'ContractEnded':     'contract_ended',
      };
      const status = statusMap[sheetName] || 'active';

      const data = await _fetchAllRows('staff', '*',
        q => q.order('name_of_teacher'), q => q.eq('status', status));
      const filterFn = _buildUserSchoolFilter(reqUser, { idKey: 'school_emis_code' });
      const visible = filterFn ? (data || []).filter(filterFn) : (data || []);

      const { headers, rows } = _toHeadersRows(visible, STAFF_COL_MAP);
      return { headers, rows };
    }

    // Staff (active) whose SCHOOL EMIS CODE doesn't exist anywhere in
    // public_schools — e.g. typo'd EMIS, school since removed/merged, or
    // never entered correctly. Unlike other staff views, this is scoped
    // by DISTRICT only (not the full markaz/tehsil/wing hierarchy) — any
    // user should see every flagged staff member in their own district,
    // since fixing these often needs district-level coordination. The
    // EMIS existence check itself is against the FULL national
    // public_schools table, since an invalid code isn't "invalid within
    // a jurisdiction" — it either exists somewhere or it doesn't.
    case 'getStaffEmisNotInPublicSchools': {
      const reqUser = Array.isArray(payload) ? payload[0] : (payload || user);
      const isAdmin = !reqUser || String(reqUser.role || '').toLowerCase() === 'admin';

      const [staffRows, schoolRows] = await Promise.all([
        _fetchAllRows('staff', 'personal_no, name_of_teacher, designation, school_emis_code, school_name, markaz_name, tehsil, district, wing, status',
          q => q.order('name_of_teacher'), q => q.eq('status', 'active')),
        _fetchAllRows('public_schools', 'emis', null, null, 'emis'),
      ]);

      const validEmis = new Set(
        (schoolRows || []).map(r => String(r.emis || '').trim().toLowerCase()).filter(Boolean)
      );

      // Full jurisdiction scope (district+wing+tehsil+markaz), same
      // filter every other notification/read path uses — previously
      // this only checked district, so a Tehsil-scoped user could see
      // "incomplete info" alerts for staff outside their own tehsil.
      const filterFn = isAdmin ? null : _buildUserSchoolFilter(reqUser, { idKey: 'school_emis_code' });
      const scopedStaff = filterFn ? (staffRows || []).filter(filterFn) : (staffRows || []);

      const missing = scopedStaff.filter(r => {
        const emis = String(r.school_emis_code || '').trim().toLowerCase();
        return !emis || !validEmis.has(emis);
      });

      const { headers, rows } = _toHeadersRows(missing, STAFF_COL_MAP);
      return { success: true, headers, rows, count: missing.length };
    }

    // SNE (Sanctioned/Filled/Vacant) subject/designation-wise summary
    // per school, split into Teaching and Non-Teaching — used by the
    // "Download SNE" button in the HR module. Both sanctioned AND
    // filled figures come straight from sne_subject_sanctioned (the
    // uploaded Excel already carries both per subject/grade).
    //
    // Filters are pushed down to the DB query (not fetched-then-filtered
    // in JS) — public_schools has 38k+ rows nationwide, so pulling
    // everything before scoping it down was the cause of the export
    // hanging on slower connections. Non-admins are scoped to their own
    // district by default even with no explicit filter selected.
    //
    // Subject columns are NOT hardcoded — each school only shows the
    // subject/designation columns that actually have a row for it
    // within the current filtered scope, discovered from the data
    // itself (per category), so a narrower scope (e.g. one tehsil)
    // doesn't drag in irrelevant columns from elsewhere.
    // ── SEAT MANAGEMENT (Sanctioned & Abolished Seats) — Teaching / Non-Teaching ──
    // Built on the same sne_subject_sanctioned table the SNE export
    // already reads, extended with abolished_count/remarks — one
    // source of truth instead of a parallel table, so every vacancy
    // check across the app (check_grade_vacancy RPC) automatically
    // reflects abolished seats with no separate sync step needed.
    // Single source of truth for the "Subject" dropdown/suggestions used
    // in Staff Forms and Seat Calculations — sourced from whatever
    // subjects already exist in the Teaching Seat data
    // (sne_subject_sanctioned.subjects), so anything entered in one
    // place is immediately suggested everywhere else. Fixes the
    // subject-mapping gap where Staff Forms/Seat entry had no shared
    // subject list at all (previously plain free-text with no lookup).
    case 'getSubjectList': {
      const { data, error } = await _sb.from('sne_subject_sanctioned')
        .select('subjects').eq('category', 'teaching').not('subjects', 'is', null).neq('subjects', '');
      if (error) return { success: false, message: error.message };
      const subjects = [...new Set((data || []).map(r => (r.subjects || '').trim()).filter(Boolean))].sort();
      return { success: true, subjects };
    }

    // ── STAFF STATEMENT: VACANT SEATS + TEMPORARY DUTY ──────────────
    // Purely additive to the existing flat staff-row export — never
    // touches staff/seat tables, only reads and assembles extra rows
    // for the client to append (VACANT placeholders) plus a map of
    // Remarks to patch onto already-exported rows.
    //
    // Temporary Duty NEVER creates a second full staff row and NEVER
    // adds to the sanctioned/working seat count — it is Remarks-only,
    // in three places depending on which seat it lands on:
    //   1) The TD employee's own row, at their ORIGINAL posting
    //      ("On Temporary Duty at ...").
    //   2) If the destination post is already filled by a regular
    //      employee: patched onto THAT employee's existing row
    //      ("Temporary Duty: <name> ... from <origin school>").
    //      The working/filled count for that seat stays exactly as-is.
    //   3) If the destination post is vacant: patched onto the
    //      VACANT placeholder row for that seat (replacing the
    //      generic "Vacant Seat" text) — the seat is still counted
    //      as vacant, just annotated with who is covering it.
    // A seat/post is matched by EMIS + Designation + BPS(grade) +
    // Subject (teaching only), using the TD employee's own staff
    // record — Temporary Duty carries the employee's existing post,
    // it doesn't create a different one.
    case 'getStaffStatementExtras': {
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const emisList = [...new Set((p.emisList || []).filter(Boolean))];
      if (!emisList.length) return { success: true, vacantRows: [], tdRows: [], remarksPatch: {} };

      const colLabel = key => STAFF_COL_MAP[key] || key;
      const norm = v => String(v == null ? '' : v).trim().toLowerCase();
      // BPS/grade needs numeric comparison, not string: sne_subject_
      // sanctioned.grade is stored as a plain number (1, 14, 16...)
      // while staff.bps is free-text and can arrive as "1", "01",
      // etc. Comparing them as raw strings silently failed to match
      // ("1" !== "01"), which was producing a duplicate row — the
      // real vacant seat (generic remark, no match found) PLUS a
      // separate "no matching seat" fallback row for the same TD
      // employee. Parsing both to int fixes the match.
      const normBps = v => { const n = parseInt(v, 10); return isNaN(n) ? norm(v) : String(n); };
      const seatKey = (emis, designation, bps, subject) =>
        `${norm(emis)}|${norm(designation)}|${normBps(bps)}|${norm(subject)}`;

      // Subject only means anything for Teaching posts (it disambiguates
      // e.g. two SESE seats of the same BPS by subject). For Non-Teaching
      // seats, "subject_label" in sne_subject_sanctioned is often reused
      // for other text instead of being left blank, while the matching
      // staff record's own "subject" field commonly holds a placeholder
      // like "NIL" — neither is blank, so comparing them as text always
      // fails and a real seat looks unmatched. Force subject out of the
      // key entirely for anything that isn't Teaching.
      const seatMatchKey = s => seatKey(
        s.emis, s.designation, s.grade,
        norm(s.category) === 'teaching' ? s.subject_label : ''
      );

      const plainVacantRow = (s, remarkOverride) => ({
        [colLabel('school_emis_code')]: s.emis,
        [colLabel('school_name')]:      s.school_name || '',
        [colLabel('markaz_name')]:      s.markaz_name || '',
        [colLabel('district')]:         s.district || '',
        [colLabel('wing')]:             s.wing || '',
        [colLabel('tehsil')]:           s.tehsil || '',
        [colLabel('designation')]:      'VACANT',
        [colLabel('bps')]:              s.grade || '',
        [colLabel('subject')]:          s.subject_label || '',
        'REMARKS': remarkOverride || (s.remarks && s.remarks.trim()) || 'Vacant Seat — No Staff Currently Posted',
      });

      // 1) Sanctioned seats (both categories) for schools in scope —
      // the source of truth for the actual sanctioned-seat structure.
      const { data: seats } = await _sb.from('sne_subject_sanctioned')
        .select('emis, school_name, district, wing, tehsil, markaz_name, category, designation, grade, subject_label, sanctioned_count, abolished_count, filled_count, remarks')
        .in('emis', emisList);

      // 2) Active Temporary Duty records touching any school in scope,
      // either as the TD destination or the employee's original posting.
      const { data: tds } = await _sb.from('staff_temporary_duty')
        .select('personal_no, original_school_emis, temporary_school_emis, temporary_school_name, order_number')
        .eq('status', 'active')
        .or(`temporary_school_emis.in.(${emisList.join(',')}),original_school_emis.in.(${emisList.join(',')})`);

      const remarksPatch = {}; // personal_no -> [texts]
      const addRemark = (pno, text) => { (remarksPatch[pno] = remarksPatch[pno] || []).push(text); };

      // No TD activity touching this scope — plain vacant-seat list.
      if (!tds || !tds.length) {
        const vacantRows = [];
        (seats || []).forEach(s => {
          const effective = (s.sanctioned_count || 0) - (s.abolished_count || 0);
          const vacant = Math.max(0, effective - (s.filled_count || 0));
          for (let i = 0; i < vacant; i++) vacantRows.push(plainVacantRow(s));
        });
        return { success: true, vacantRows, tdRows: [], remarksPatch: {} };
      }

      const personalNos = [...new Set(tds.map(t => t.personal_no))];
      const touchedEmis = [...new Set(tds.flatMap(t => [t.original_school_emis, t.temporary_school_emis]).filter(Boolean))];

      const [{ data: staffRows }, { data: pubMeta }, { data: privMeta }, { data: destStaff }] = await Promise.all([
        _sb.from('staff').select('*').in('personal_no', personalNos),
        _sb.from('public_schools').select('emis, school_name, markaz_name, tehsil, wing').in('emis', touchedEmis),
        _sb.from('private_schools').select('emis, school_name, markaz_name, tehsil').in('emis', touchedEmis),
        // Active regular staff already posted at any in-scope school —
        // used to detect whether a TD destination post is already
        // filled by a real, non-TD employee.
        _sb.from('staff').select('personal_no, name_of_teacher, designation, bps, subject, school_emis_code')
          .in('school_emis_code', emisList).eq('status', 'active'),
      ]);

      const staffByPno = {};
      (staffRows || []).forEach(s => { staffByPno[s.personal_no] = s; });
      const schoolMetaByEmis = {};
      [...(pubMeta || []), ...(privMeta || [])].forEach(m => { schoolMetaByEmis[m.emis] = m; });

      // Every key a real seat actually resolves to (category-aware —
      // see seatMatchKey above), so TD/staff-side lookups know whether
      // to trust a subject-specific key or fall back to the
      // subject-less one for that particular post.
      const knownSeatKeys = new Set((seats || []).map(seatMatchKey));
      const resolveMatchKey = (emis, designation, bps, subject) => {
        const withSubj = seatKey(emis, designation, bps, subject);
        if (knownSeatKeys.has(withSubj)) return withSubj;
        const blank = seatKey(emis, designation, bps, '');
        return knownSeatKeys.has(blank) ? blank : withSubj;
      };

      const regularBySeat = {};
      (destStaff || []).forEach(st => {
        // Indexed under both the subject-specific and subject-less key
        // so resolveMatchKey's chosen key always finds them.
        const k1 = seatKey(st.school_emis_code, st.designation, st.bps, st.subject);
        const k2 = seatKey(st.school_emis_code, st.designation, st.bps, '');
        (regularBySeat[k1] = regularBySeat[k1] || []).push(st);
        if (k2 !== k1) (regularBySeat[k2] = regularBySeat[k2] || []).push(st);
      });

      // TD text queued against a vacant seat key — consumed one per
      // vacant unit when building vacantRows below.
      const vacantSeatTdRemarks = {};

      tds.forEach(t => {
        const staffRow = staffByPno[t.personal_no];
        if (!staffRow) return; // orphaned TD record — nothing to attach

        const destMeta = schoolMetaByEmis[t.temporary_school_emis] || {};
        const originMeta = schoolMetaByEmis[t.original_school_emis] || {};
        const destSchoolName = t.temporary_school_name || destMeta.school_name || '';

        // (a) TD employee's OWN row, at their original posting.
        if (emisList.includes(t.original_school_emis)) {
          addRemark(t.personal_no,
            `On Temporary Duty at ${t.temporary_school_emis} - ${destSchoolName}, ${destMeta.markaz_name || ''}, ${destMeta.tehsil || ''}, ${destMeta.wing || ''}`);
        }

        // (b) Destination side, if in scope.
        if (emisList.includes(t.temporary_school_emis)) {
          const key = resolveMatchKey(t.temporary_school_emis, staffRow.designation, staffRow.bps, staffRow.subject);
          const regulars = (regularBySeat[key] || []).filter(r => r.personal_no !== t.personal_no);
          const originSchoolName = originMeta.school_name || t.original_school_emis;
          const bpsLabel = staffRow.bps ? `BPS-${String(staffRow.bps).padStart(2, '0')}` : '';
          // Personal No, Designation, BPS, original EMIS + school name,
          // and Order No if one was recorded — everything needed to
          // trace the employee back to their original place of posting
          // straight from this Remarks cell.
          const tdText = [
            `Temporary Duty: ${staffRow.name_of_teacher || 'Employee'}`,
            `Personal No: ${t.personal_no}`,
            staffRow.designation ? `Designation: ${staffRow.designation}` : null,
            bpsLabel || null,
            `From EMIS: ${t.original_school_emis} (${originSchoolName})`,
            (originMeta.markaz_name || originMeta.tehsil)
              ? `${[originMeta.markaz_name, originMeta.tehsil].filter(Boolean).join(', ')}`
              : null,
            t.order_number ? `Order No: ${t.order_number}` : null,
          ].filter(Boolean).join(' | ');

          if (regulars.length) {
            // Case 3/4 — seat already filled: patch the actual seat
            // holder's row(s). Never create an extra staff row, never
            // bump the working count.
            regulars.forEach(r => addRemark(r.personal_no, tdText));
          } else {
            // Case 2 — TD against a vacant post: Remarks on the
            // seat/post row itself, no full employee row.
            (vacantSeatTdRemarks[key] = vacantSeatTdRemarks[key] || []).push(tdText);
          }
        }
      });

      // 3) Build vacant-seat rows, substituting TD remarks where a TD
      // employee is covering an otherwise-vacant post. One TD remark
      // consumes one vacant unit; a unit with no TD gets the generic
      // vacant message. The vacant count itself is untouched by TD.
      const vacantRows = [];
      (seats || []).forEach(s => {
        const effective = (s.sanctioned_count || 0) - (s.abolished_count || 0);
        const vacant = Math.max(0, effective - (s.filled_count || 0));
        const key = seatMatchKey(s);
        const tdTexts = (vacantSeatTdRemarks[key] || []).slice();
        for (let i = 0; i < vacant; i++) vacantRows.push(plainVacantRow(s, tdTexts.shift()));
        // More TD employees landed on this vacant post than there are
        // vacant units on record (a seat-data gap, not a TD problem) —
        // still surface them, folded onto the last vacant row instead
        // of fabricating a new seat.
        if (tdTexts.length && vacantRows.length) {
          const last = vacantRows[vacantRows.length - 1];
          last['REMARKS'] = [last['REMARKS'], ...tdTexts].filter(Boolean).join(' | ');
        }
        delete vacantSeatTdRemarks[key];
      });

      // Any TD-against-vacant-post remarks left over matched no seat
      // record at all (missing/not-yet-entered seat data for that EMIS +
      // Designation + BPS + Subject combo). Surface as a clearly-
      // marked informational row rather than silently dropping the
      // employee, but keep it visually distinct from a real sanctioned
      // vacant seat so it can't be mistaken for one. Carries the same
      // Markaz/EMIS/Tehsil/Wing fields as every other row so the export
      // sort places it with its own school instead of floating to the
      // top (a blank Markaz sorts first, ahead of everything).
      Object.entries(vacantSeatTdRemarks).forEach(([key, texts]) => {
        const [emis] = key.split('|');
        const originalCaseEmis = touchedEmis.find(e => norm(e) === emis) || emis;
        const meta = schoolMetaByEmis[originalCaseEmis] || {};
        vacantRows.push({
          [colLabel('school_emis_code')]: originalCaseEmis,
          [colLabel('school_name')]:      meta.school_name || '',
          [colLabel('markaz_name')]:      meta.markaz_name || '',
          [colLabel('tehsil')]:           meta.tehsil || '',
          [colLabel('wing')]:             meta.wing || '',
          [colLabel('designation')]:      'TEMPORARY DUTY (NO SANCTIONED SEAT RECORD FOUND)',
          'REMARKS': texts.join(' | ') + ' — please verify sanctioned seat data for this post.',
        });
      });

      const finalRemarksPatch = {};
      Object.entries(remarksPatch).forEach(([pno, texts]) => { finalRemarksPatch[pno] = texts.join('; '); });

      return { success: true, vacantRows, tdRows: [], remarksPatch: finalRemarksPatch };
    }

    case 'getSystemSetting': {
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const { data } = await _sb.from('system_settings').select('value').eq('key', p.key).maybeSingle();
      return { success: true, value: data ? data.value : null };
    }

    case 'saveSystemSetting': {
      if (!user || !user.id || (user.role || '').toLowerCase() !== 'admin') {
        return { success: false, message: 'Only Admins can change system settings.' };
      }
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      if (!p.key) return { success: false, message: 'Setting key is required.' };
      const { error } = await _sb.from('system_settings').upsert({
        key: p.key, value: String(p.value ?? ''), updated_by: user.id, updated_at: new Date().toISOString(),
      });
      if (error) return { success: false, message: error.message };
      return { success: true, message: 'Setting saved.' };
    }

    case 'getSeatManagementList': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const category = p.category === 'non_teaching' ? 'non_teaching' : 'teaching';
      let q = _sb.from('sne_subject_sanctioned').select('*').eq('category', category);
      if (p.district) q = q.eq('district', p.district);
      if (p.wing)     q = q.eq('wing', p.wing);
      if (p.tehsil)   q = q.eq('tehsil', p.tehsil);
      if (p.markaz)   q = q.eq('markaz_name', p.markaz);
      if (p.emis)     q = q.eq('emis', p.emis);
      q = q.order('school_name').order('grade', { ascending: false }).order('subject_label');
      const { data, error } = await q.limit(5000);
      if (error) return { success: false, message: error.message };

      const filterFn = _buildUserSchoolFilter(user, { idKey: 'emis' });
      const rows = filterFn ? (data || []).filter(filterFn) : (data || []);
      return { success: true, rows };
    }

    case 'checkSeatManagementPermissions': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const isAdminOrTr = await _isAdminOrTr(user);
      return { success: true, canEditNonTeaching: isAdminOrTr, canAddTeaching: isAdminOrTr, canEditTeachingSanctioned: isAdminOrTr };
    }

    case 'saveSeatRecord': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const category = p.category === 'non_teaching' ? 'non_teaching' : 'teaching';
      const isAdminOrTr = await _isAdminOrTr(user);

      // Non-Teaching Sanctioned Seats (add, edit, and bulk import all
      // route through this same action) are restricted to Admins and
      // Tehsil Representatives.
      if (category === 'non_teaching' && !isAdminOrTr) {
        return { success: false, message: 'Only Admins and Tehsil Representatives can add, edit, or import Non-Teaching Sanctioned Seats.' };
      }
      // Teaching Sanctioned Seats: adding a brand-new seat record is
      // restricted to Admins/TRs (so a missed seat doesn't have to
      // wait on a direct Supabase upload — they can add it here now).
      // Everyone else can still only edit an existing seat's Abolished
      // count (see the Total Sanctioned lock below).
      if (category === 'teaching' && !p.id && !isAdminOrTr) {
        return { success: false, message: 'Only Admins and Tehsil Representatives can add new Teaching Sanctioned Seats.' };
      }

      const emis = (p.emis || '').trim();
      if (!emis) return { success: false, message: 'EMIS Code is required.' };
      const grade = parseInt(p.grade);
      if (!grade || grade < 1) return { success: false, message: 'Grade/BPS is required.' };
      let sanctioned = parseInt(p.sanctionedCount);
      const abolished  = parseInt(p.abolishedCount) || 0;

      // Teaching Seat Rule: Total Sanctioned is locked on existing
      // records for everyone EXCEPT Admins/TRs, who can correct a
      // missed/wrong sanctioned count directly. Regular editors can
      // still only change Abolished Seats. Enforced here (not just
      // hidden in the UI) so bulk imports and direct API calls can't
      // bypass it either.
      if (category === 'teaching' && p.id && !isAdminOrTr) {
        const { data: existing } = await _sb.from('sne_subject_sanctioned')
          .select('sanctioned_count').eq('id', p.id).maybeSingle();
        if (existing) sanctioned = existing.sanctioned_count;
      }
      if (!Number.isFinite(sanctioned) || sanctioned < 0) return { success: false, message: 'Total Sanctioned Seats must be 0 or more.' };
      if (abolished < 0) return { success: false, message: 'Abolished Seats cannot be negative.' };
      if (abolished > sanctioned) return { success: false, message: 'Abolished Seats cannot exceed Total Sanctioned Seats.' };

      // Duplicate-record prevention (same EMIS+Grade+Subject+Designation):
      // subject_code already encodes designation+subject+grade, so this
      // is exactly the natural key requested.
      const designation = (p.designation || '').trim();
      const subject = (p.subject || '').trim();
      const codePart = s => (s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const subjectCode = subject ? `${codePart(designation)}_${codePart(subject)}_G${grade}` : `${codePart(designation)}_G${grade}`;
      const subjectLabel = subject ? `${designation} (${subject})` : designation;
      const asOfDate = p.asOfDate || new Date().toISOString().slice(0, 10);

      let schoolMeta = { school_name: p.schoolName || '', district: p.district || '', wing: p.wing || '', tehsil: p.tehsil || '', markaz_name: p.markazName || '' };
      if (!schoolMeta.school_name || !schoolMeta.district) {
        const { data: school } = await _sb.from('public_schools').select('school_name, district, wing, tehsil, markaz_name').eq('emis', emis).maybeSingle();
        if (school) schoolMeta = { ...schoolMeta, ...Object.fromEntries(Object.entries(school).filter(([, v]) => v)) };
      }

      // Non-Teaching filled seats are never taken from the client —
      // always computed live from the Staff Statement (EMIS +
      // Designation, active staff only). The trg_staff_sync_non_teaching_filled
      // trigger keeps this correct afterward as staff records change;
      // this handles the moment a seat row is first created/edited.
      let filled = parseInt(p.filledCount) || 0;
      if (category === 'non_teaching') {
        const { count } = await _sb.from('staff')
          .select('id', { count: 'exact', head: true })
          .eq('school_emis_code', emis).eq('designation', designation).eq('status', 'active');
        filled = count || 0;
      }

      // Prevent Invalid Seat Abolishment: a seat currently occupied by
      // an active employee can never be abolished. If abolishing would
      // push effective sanctioned seats (sanctioned - abolished) below
      // the number of employees actually sitting in this Grade/Subject/
      // Designation/EMIS combination, reject it outright.
      const effectiveAfterAbolish = sanctioned - abolished;
      if (effectiveAfterAbolish < filled) {
        const maxAbolishable = Math.max(sanctioned - filled, 0);
        return {
          success: false,
          message: `Cannot abolish ${abolished} seat(s) — ${filled} employee(s) currently occupy this position (${designation}${subject ? ' / ' + subject : ''}, Grade ${grade}, EMIS ${emis}). Only vacant seats can be abolished; at most ${maxAbolishable} seat(s) can be abolished here right now.`,
        };
      }

      const dbRow = {
        category, emis, designation, subjects: subject, grade,
        subject_code: subjectCode, subject_label: subjectLabel,
        sanctioned_count: sanctioned, abolished_count: abolished, filled_count: filled,
        remarks: (p.remarks || '').trim(), as_of_date: asOfDate,
        ...schoolMeta,
      };

      let savedId = p.id;
      if (p.id) {
        const r = await _checkedUpdate('sne_subject_sanctioned', dbRow, 'id', p.id);
        if (!r.ok) return { success: false, message: r.message };
      } else {
        const { data: dupe } = await _sb.from('sne_subject_sanctioned').select('id')
          .eq('emis', emis).eq('subject_code', subjectCode).eq('as_of_date', asOfDate).maybeSingle();
        if (dupe) return { success: false, message: 'A record already exists for this EMIS + Grade + Subject + Designation. Edit the existing row instead.' };
        const { data: inserted, error } = await _sb.from('sne_subject_sanctioned').insert([dbRow]).select('id').single();
        if (error) return { success: false, message: error.message };
        savedId = inserted?.id;
      }
      // Attach the optional change reason to the audit row the trigger
      // just created (set_config can't be used here — each REST call is
      // its own transaction, so a prior "set the session var" call
      // wouldn't carry over to this one anyway).
      if (p.reason && savedId) {
        const { data: latestAudit } = await _sb.from('sne_seat_audit_log')
          .select('id').eq('sne_id', savedId).order('changed_at', { ascending: false }).limit(1).maybeSingle();
        if (latestAudit) await _sb.from('sne_seat_audit_log').update({ reason: p.reason }).eq('id', latestAudit.id);
      }
      return { success: true, message: 'Saved.' };
    }

    case 'deleteSeatRecord': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      if (!p.id) return { success: false, message: 'Missing record.' };
      const r = await _checkedDelete('sne_subject_sanctioned', 'id', p.id);
      if (!r.ok) return { success: false, message: r.message };
      if (p.reason) {
        const { data: latestAudit } = await _sb.from('sne_seat_audit_log')
          .select('id').eq('sne_id', p.id).order('changed_at', { ascending: false }).limit(1).maybeSingle();
        if (latestAudit) await _sb.from('sne_seat_audit_log').update({ reason: p.reason }).eq('id', latestAudit.id);
      }
      return { success: true, message: 'Deleted.' };
    }

    // First-time entry gate: has ANY seat data been entered yet for this
    // user's own tehsil+wing? Admins are never gated (they need to be
    // able to move around freely to fix/seed data for others). Deleting
    // all of a jurisdiction's rows naturally re-triggers the gate next
    // time, since this is a live existence check, not a stored flag.
    case 'getSeatEntryStatus': {
      if (!user || !user.id) return { success: true, required: false };
      const isAdmin = String(user.role || '').toLowerCase() === 'admin';
      if (isAdmin || !user.tehsil) return { success: true, required: false };
      const { count } = await _sb.from('sne_subject_sanctioned')
        .select('id', { count: 'exact', head: true })
        .eq('tehsil', user.tehsil).eq('wing', user.wing || '');
      return { success: true, required: (count || 0) === 0 };
    }

    case 'getSeatAuditLog': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      let q = _sb.from('sne_seat_audit_log').select('*').order('changed_at', { ascending: false }).limit(200);
      if (p.emis) q = q.eq('emis', p.emis);
      const { data, error } = await q;
      if (error) return { success: false, message: error.message };
      return { success: true, rows: data || [] };
    }

    case 'getSneSummary': {
      const args    = Array.isArray(payload) ? payload : [payload];
      const reqUser = args[0] || user;
      const filters = args[1] || {};
      const isAdmin = !reqUser || String(reqUser.role || '').toLowerCase() === 'admin';

      const raw = await _fetchAllRows('sne_subject_sanctioned', '*', q => {
        if (filters.district) q = q.eq('district', filters.district);
        else if (!isAdmin && reqUser?.district) q = q.eq('district', reqUser.district);
        if (filters.wing)   q = q.eq('wing', filters.wing);
        if (filters.tehsil) q = q.eq('tehsil', filters.tehsil);
        if (filters.markaz) q = q.eq('markaz_name', filters.markaz);
        if (filters.emis)   q = q.eq('emis', filters.emis);
        return q;
      });

      const filterFn = _buildUserSchoolFilter(reqUser, { idKey: 'emis' });
      const scoped = filterFn ? (raw || []).filter(filterFn) : (raw || []);

      function buildCategory(catRows) {
        // Discover the subject columns actually present, ordered by
        // grade (senior/higher BPS first) then subject label.
        const subjectMap = {}; // code -> {code, label, grade}
        catRows.forEach(r => {
          if (!subjectMap[r.subject_code]) {
            subjectMap[r.subject_code] = { code: r.subject_code, label: r.subject_label || r.subject_code, grade: r.grade || 0 };
          }
        });
        const subjectColumns = Object.values(subjectMap).sort((a, b) =>
          (b.grade - a.grade) || a.label.localeCompare(b.label));

        const bySchool = {};
        catRows.forEach(r => {
          const key = r.emis;
          if (!bySchool[key]) {
            bySchool[key] = {
              emis: r.emis, school_name: r.school_name, markaz_name: r.markaz_name,
              district: r.district, wing: r.wing, tehsil: r.tehsil,
              subjects: {}, // code -> {sanctioned, abolished, effective, filled, vacant}
              grade16: { sanctioned: 0, abolished: 0, effective: 0, filled: 0, vacant: 0 },
              grade15: { sanctioned: 0, abolished: 0, effective: 0, filled: 0, vacant: 0 },
              grade14: { sanctioned: 0, abolished: 0, effective: 0, filled: 0, vacant: 0 },
            };
          }
          const s  = Number(r.sanctioned_count) || 0;
          const ab = Number(r.abolished_count) || 0;
          const ef = Number(r.effective_sanctioned_count ?? (s - ab)) || 0;
          const f  = Number(r.filled_count) || 0;
          const v  = Number(r.vacant_count ?? (ef - f)) || 0;
          bySchool[key].subjects[r.subject_code] = { sanctioned: s, abolished: ab, effective: ef, filled: f, vacant: v };
          const gKey = r.grade === 16 ? 'grade16' : r.grade === 15 ? 'grade15' : r.grade === 14 ? 'grade14' : null;
          if (gKey) {
            bySchool[key][gKey].sanctioned += s;
            bySchool[key][gKey].abolished  += ab;
            bySchool[key][gKey].effective  += ef;
            bySchool[key][gKey].filled     += f;
            bySchool[key][gKey].vacant     += v;
          }
        });

        const rows = Object.values(bySchool).map(row => {
          let gt = { sanctioned: 0, abolished: 0, effective: 0, filled: 0, vacant: 0 };
          subjectColumns.forEach(col => {
            const v = row.subjects[col.code];
            if (v) { gt.sanctioned += v.sanctioned; gt.abolished += v.abolished; gt.effective += v.effective; gt.filled += v.filled; gt.vacant += v.vacant; }
          });
          row.grandTotal = gt;
          return row;
        });
        return { subjectColumns, rows };
      }

      const teaching    = buildCategory(scoped.filter(r => r.category === 'teaching'));
      const nonTeaching = buildCategory(scoped.filter(r => r.category === 'non_teaching'));

      // School Level (Primary/Middle/High/...), not stored on
      // sne_subject_sanctioned itself.
      const allEmis = [...new Set([...teaching.rows, ...nonTeaching.rows].map(r => r.emis))];
      let levelByEmis = {};
      if (allEmis.length) {
        const { data: schoolRows } = await _sb.from('public_schools').select('emis, level').in('emis', allEmis);
        levelByEmis = Object.fromEntries((schoolRows || []).map(s => [s.emis, s.level]));
      }
      [...teaching.rows, ...nonTeaching.rows].forEach(r => { r.school_level = levelByEmis[r.emis] || ''; });

      return {
        success: true,
        teaching,
        nonTeaching,
      };
    }

    case 'addStaffRow': {
      const row = Array.isArray(payload) ? payload[0] : payload;
      // Convert display-header keys back to Supabase column names
      const reverseMap = Object.fromEntries(
        Object.entries(STAFF_COL_MAP).map(([col, hdr]) => [hdr, col])
      );
      const dbRow = {};
      for (const [hdr, val] of Object.entries(row)) {
        const col = reverseMap[hdr] || hdr;
        dbRow[col] = val;
      }
      dbRow.status          = 'active';
      dbRow.changes_made_by = user?.name || '';
      dbRow.changes_made_at = new Date().toISOString();

      // Never trust the client for school_name/district/wing/tehsil/markaz —
      // always derive them from the EMIS itself. The Add/Edit Staff form's
      // "School Name" field is meant to auto-fill from EMIS client-side, but
      // that's a display convenience, not something to rely on for the
      // record that actually gets saved.
      if (dbRow.school_emis_code) {
        const { data: sc } = await _sb.from('schools')
          .select('district, wing, tehsil, markaz, school_name')
          .eq('emis', dbRow.school_emis_code).maybeSingle();
        if (sc) {
          dbRow.school_name = sc.school_name;
          dbRow.markaz_name = sc.markaz;
          dbRow.district     = sc.district;
          dbRow.wing         = sc.wing;
          dbRow.tehsil       = sc.tehsil;
        }
      }

      const cleanRow = _sanitizeEmpty(dbRow);
      const { data: inserted, error } = await _sb
        .from('staff').insert([cleanRow]).select().single();
      if (error) return { success: false, error: error.message };

      await _sb.from('staff_events').insert([{
        personal_no:   inserted.personal_no,
        employee_name: inserted.name_of_teacher,
        event_type:    'create',
        created_by:    user?.name || '',
      }]);
      return { success: true, message: 'Staff record added successfully.' };
    }

    case 'updateStaffRow': {
      const row = Array.isArray(payload) ? payload[0] : payload;
      const pno = row['PERSONAL NO.'] || row.personal_no;
      const reverseMap = Object.fromEntries(
        Object.entries(STAFF_COL_MAP).map(([col, hdr]) => [hdr, col])
      );
      const dbRow = {};
      for (const [hdr, val] of Object.entries(row)) {
        const col = reverseMap[hdr] || hdr;
        dbRow[col] = val;
      }
      dbRow.changes_made_by = user?.name || '';
      dbRow.changes_made_at = new Date().toISOString();
      delete dbRow.personal_no;  // don't overwrite the PK

      // Same as addStaffRow: whenever the EMIS is present in the submitted
      // row (i.e. the edit form touched it), re-derive school_name/district/
      // wing/tehsil/markaz from the schools table server-side rather than
      // trusting whatever the client's readonly display field happened to
      // hold. This is what was silently wiping school_name to blank on
      // transfers/edits before.
      if (dbRow.school_emis_code) {
        const { data: sc } = await _sb.from('schools')
          .select('district, wing, tehsil, markaz, school_name')
          .eq('emis', dbRow.school_emis_code).maybeSingle();
        if (sc) {
          dbRow.school_name = sc.school_name;
          dbRow.markaz_name = sc.markaz;
          dbRow.district     = sc.district;
          dbRow.wing         = sc.wing;
          dbRow.tehsil       = sc.tehsil;
        }
      }

      const r = await _staffPrivilegedUpdate(pno, _sanitizeEmpty(dbRow));
      if (!r.ok) return { success: false, error: r.message };

      await _sb.from('staff_events').insert([{
        personal_no:   pno,
        employee_name: row['NAME OF TEACHER'] || '',
        event_type:    'update',
        created_by:    user?.name || '',
        details:       { updated_fields: Object.keys(row) },
      }]);
      return { success: true, message: 'Record updated successfully.' };
    }

    case 'deleteStaffRow': {
      const pno = Array.isArray(payload) ? payload[0] : (payload?.personal_no || payload);
      const reason = Array.isArray(payload) ? payload[1] : payload?.reason;
      const { data: s } = await _sb.from('staff').select('name_of_teacher').eq('personal_no', pno).single();

      const r = await _staffPrivilegedUpdate(pno, {
        status: 'deleted',
        changes_made_by: user?.name || '',
        changes_made_at: new Date().toISOString(),
      });
      if (!r.ok) return { success: false, error: r.message };

      await _sb.from('staff_events').insert([{
        personal_no:   pno,
        employee_name: s?.name_of_teacher || '',
        event_type:    'delete',
        details:       { reason: reason || '' },
        created_by:    user?.name || '',
      }]);
      return { success: true, message: 'Record archived successfully.' };
    }

    case 'executeTransfer': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const pno = p.personalNo || p['PERSONAL NO.'] || p.personal_no;
      if (!pno) return { success: false, error: 'Missing employee personal number.' };

      const targetEmis = p.targetEmis || p.to_emis || p['To EMIS'];
      if (!targetEmis) return { success: false, error: 'Missing destination EMIS.' };

      const { data: s } = await _sb.from('staff')
        .select('name_of_teacher, school_emis_code, markaz_name, tehsil, district, wing, bps')
        .eq('personal_no', pno).single();
      if (!s) return { success: false, error: `No staff record found for personal number "${pno}".` };

      // The Transfer form only collects the destination EMIS — look up
      // that school's actual district/wing/tehsil/markaz from the
      // schools table rather than expecting the frontend to send them
      // (it never did, which is why transfers silently wrote blanks
      // into those columns before).
      const { data: dest } = await _sb.from('schools')
        .select('district, wing, tehsil, markaz, school_name')
        .eq('emis', targetEmis).maybeSingle();
      if (!dest) return { success: false, error: `EMIS "${targetEmis}" was not found in the schools list.` };

      // SNE vacancy check: the employee keeps their current grade on a
      // transfer, so confirm the destination EMIS has a vacant seat at
      // that grade before moving them.
      const targetGrade = parseInt(s?.bps, 10);
      if (!isNaN(targetGrade)) {
        const { data: hasVacancy, error: vacErr } = await _sb.rpc('check_grade_vacancy', {
          p_emis: targetEmis, p_grade: targetGrade,
        });
        if (!vacErr && hasVacancy === false) {
          return { success: false, error: `Vacant seat not available for BPS-${targetGrade} at EMIS ${targetEmis}.` };
        }
      }

      const r = await _staffPrivilegedUpdate(pno, _sanitizeEmpty({
        school_emis_code:              targetEmis,
        school_name:                   dest.school_name,
        markaz_name:                   dest.markaz,
        tehsil:                        dest.tehsil,
        district:                      dest.district,
        wing:                          dest.wing,
        date_of_posting_present_school:p.newJoiningDate || p.date_of_joining_new_school || '',
        status:                        'active',
        changes_made_by:               user?.name || '',
        changes_made_at:               new Date().toISOString(),
      }));
      if (!r.ok) return { success: false, error: r.message };

      await _sb.from('staff_events').insert([{
        personal_no:   pno,
        employee_name: s?.name_of_teacher || '',
        event_type:    'transfer',
        notification_no: p.notificationNo || p.notification_no || p['Notification No'] || '',
        effective_date:  p.newJoiningDate || p.effective_date  || p['Transfer Date'] || '',
        details:         {
          from_emis:    s?.school_emis_code || '',
          to_emis:      targetEmis,
          from_markaz:  s?.markaz_name || '',
          to_markaz:    dest.markaz || '',
          to_school:    dest.school_name || '',
        },
        created_by: user?.name || '',
      }]);
      return { success: true, message: 'Transfer completed successfully.' };
    }

    // Mutual Transfer — step 1: find candidates to swap with.
    // A mutual/exchange transfer moves two employees of the SAME BPS
    // grade to each other's schools, so no SNE vacancy check is needed
    // (headcount at each grade is unchanged at both ends). The search
    // must reach across jurisdictions on purpose — that's the entire
    // point of a mutual transfer, mirroring 'getAllSchoolsGlobal'
    // above — so this goes through a SECURITY DEFINER RPC
    // (staff_by_emis_bps_privileged, see sql/mutual_transfer_setup.sql)
    // instead of a plain table select, which would otherwise be
    // silently narrowed to the acting officer's own jurisdiction by
    // the `staff` table's SELECT RLS policy (see the big comment on
    // _checkedUpdate above for why that policy exists).
    case 'getMutualTransferCandidates': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const emis = (p?.emis || p?.targetEmis || '').toString().trim();
      const bps  = (p?.bps  || '').toString().trim();
      const excludePno = p?.excludePersonalNo || p?.personalNo || '';
      if (!emis) return { success: false, error: 'Missing target EMIS code.' };
      if (!bps)  return { success: false, error: 'Missing BPS to match against.' };

      let rows = null;
      const { data: rpcData, error: rpcErr } = await _sb.rpc('staff_by_emis_bps_privileged', {
        p_emis: emis, p_bps: bps, p_exclude_personal_no: excludePno || null,
      });
      if (!rpcErr) {
        rows = rpcData;
      } else {
        // Fallback for installs that haven't run the SQL setup yet —
        // works, but is silently limited to the acting officer's own
        // jurisdiction by RLS until the RPC above is installed.
        const { data: fallback } = await _sb.from('staff')
          .select('personal_no, name_of_teacher, designation, working_as_head, bps, pps, school_emis_code, school_name, markaz_name, tehsil, district, wing, date_of_posting_present_school')
          .eq('school_emis_code', emis).eq('status', 'active');
        rows = (fallback || []).filter(r => String(r.bps || '').trim() === bps);
      }

      const candidates = (rows || [])
        .filter(r => !excludePno || String(r.personal_no) !== String(excludePno))
        .map(r => ({
          personalNo:   r.personal_no,
          name:         r.name_of_teacher,
          designation:  r.designation,
          workingAsHead:r.working_as_head,
          bps:          r.bps,
          pps:          r.pps,
          emis:         r.school_emis_code,
          schoolName:   r.school_name,
          markaz:       r.markaz_name,
          tehsil:       r.tehsil,
          district:     r.district,
          wing:         r.wing,
          postedSince:  r.date_of_posting_present_school,
        }));
      return { success: true, candidates, usedPrivilegedSearch: !rpcErr };
    }

    // Mutual Transfer — step 2: swap two same-BPS employees' postings.
    // Employee A moves to Employee B's (pre-swap) school and vice versa.
    // Both writes happen atomically in a single RPC
    // (staff_mutual_transfer_privileged, see Supabase migration
    // add_atomic_mutual_transfer_rpc) authorized once against both
    // records together, since a mutual transfer routinely moves at
    // least one side outside the acting officer's own jurisdiction —
    // see that migration's comments for why the old "two separate
    // jurisdiction-checked writes + manual app-level rollback"
    // approach could silently strand an employee one-sided.
    case 'executeMutualTransfer': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const pnoA = p?.personalNoA || p?.personalNo;
      const pnoB = p?.personalNoB;
      if (!pnoA || !pnoB) return { success: false, error: 'Both employees are required for a mutual transfer.' };
      if (String(pnoA) === String(pnoB)) return { success: false, error: 'Cannot mutually transfer an employee with themself.' };

      // IMPORTANT: this read must bypass the `staff` table's SELECT RLS
      // policy, same reason getMutualTransferCandidates above uses the
      // privileged RPC instead of a plain select. A mutual transfer's
      // whole point is that Employee B usually lives OUTSIDE the acting
      // officer's own jurisdiction (that's how they got found via
      // staff_by_emis_bps_privileged in step 1). A plain
      // `.from('staff').select(...)` here is silently narrowed to the
      // officer's own jurisdiction by RLS, so B's row (and sometimes
      // even A's, if the officer is receiving someone into their
      // jurisdiction) comes back empty — surfacing as the confusing
      // "No staff record found for personal number ..." error even
      // though the record clearly exists. Route through
      // staff_by_personal_no_privileged (see
      // sql/mutual_transfer_personal_no_lookup.sql) instead, with the
      // old plain-select behaviour kept only as a fallback for installs
      // that haven't run that SQL yet.
      let staffRows = null;
      const { data: rpcRows, error: rpcRowsErr } = await _sb.rpc('staff_by_personal_no_privileged', {
        p_personal_nos: [String(pnoA), String(pnoB)],
      });
      if (!rpcRowsErr) {
        staffRows = rpcRows;
      } else {
        const { data: fallbackRows } = await _sb.from('staff')
          .select('personal_no, name_of_teacher, school_emis_code, school_name, markaz_name, tehsil, district, wing, bps, status')
          .in('personal_no', [pnoA, pnoB]);
        staffRows = fallbackRows;
      }
      const a = (staffRows || []).find(r => String(r.personal_no) === String(pnoA));
      const b = (staffRows || []).find(r => String(r.personal_no) === String(pnoB));
      if (!a) {
        return { success: false, error: rpcRowsErr
          ? `No staff record found for personal number "${pnoA}". (Cross-jurisdiction lookup RPC isn't installed yet — ask an admin to run sql/mutual_transfer_personal_no_lookup.sql, otherwise employees outside your own jurisdiction won't be found here.)`
          : `No staff record found for personal number "${pnoA}".` };
      }
      if (!b) {
        return { success: false, error: rpcRowsErr
          ? `No staff record found for personal number "${pnoB}". (Cross-jurisdiction lookup RPC isn't installed yet — ask an admin to run sql/mutual_transfer_personal_no_lookup.sql, otherwise employees outside your own jurisdiction won't be found here.)`
          : `No staff record found for personal number "${pnoB}".` };
      }
      if (a.status !== 'active' || b.status !== 'active') {
        return { success: false, error: 'Both employees must be active to process a mutual transfer.' };
      }
      if (String(a.bps || '').trim() !== String(b.bps || '').trim()) {
        return { success: false, error: `BPS mismatch: ${a.name_of_teacher || pnoA} is BPS-${a.bps}, ${b.name_of_teacher || pnoB} is BPS-${b.bps}. Mutual transfer requires the same BPS.` };
      }
      const aEmis = String(a.school_emis_code || '').trim();
      const bEmis = String(b.school_emis_code || '').trim();
      if (!aEmis || !bEmis) {
        const who = !aEmis ? (a.name_of_teacher || pnoA) : (b.name_of_teacher || pnoB);
        return { success: false, error: `Cannot process: ${who}'s staff record has no School EMIS Code on file. Fix that record first, then retry the mutual transfer.` };
      }
      if (aEmis === bEmis) {
        return { success: false, error: 'Both employees are already posted at the same school.' };
      }

      const dateA = p.dateA || p.newJoiningDateA || p.effective_date || '';
      const dateB = p.dateB || p.newJoiningDateB || dateA;
      const notif = p.notificationNo || p.notification_no || '';

      const updA = {
        school_emis_code: b.school_emis_code, school_name: b.school_name,
        markaz_name: b.markaz_name, tehsil: b.tehsil, district: b.district, wing: b.wing,
        date_of_posting_present_school: dateA, status: 'active',
        changes_made_by: user?.name || '', changes_made_at: new Date().toISOString(),
      };
      const updB = {
        school_emis_code: a.school_emis_code, school_name: a.school_name,
        markaz_name: a.markaz_name, tehsil: a.tehsil, district: a.district, wing: a.wing,
        date_of_posting_present_school: dateB, status: 'active',
        changes_made_by: user?.name || '', changes_made_at: new Date().toISOString(),
      };

      // BUGFIX (2026-07-24): this used to be two sequential
      // _staffPrivilegedUpdate calls, each authorized independently
      // against whatever that record's jurisdiction was AT THE MOMENT
      // of that write, with a manual app-level "roll the first one
      // back" on failure. That let the first write (inside the acting
      // officer's own jurisdiction) succeed, the second (outside it)
      // correctly fail -- but by then the first record had ALSO moved
      // outside the officer's jurisdiction, so even the rollback call
      // was silently blocked by the same check, and its result was
      // never checked. That stranded the employee one-sided with a
      // false "rolled back" message and no audit trail (incident:
      // personal_no 31715221 / Nasir Hussain Shah). Now both writes go
      // through a single atomic RPC (staff_mutual_transfer_privileged,
      // see Supabase migration) that authorizes once up front against
      // BOTH original records together and performs both updates in
      // one transaction -- they always succeed or fail together, with
      // no possibility of a one-sided move.
      const { error: mtErr } = await _sb.rpc('staff_mutual_transfer_privileged', {
        p_personal_no_a: pnoA, p_personal_no_b: pnoB,
        p_updates_a: _sanitizeEmpty(updA), p_updates_b: _sanitizeEmpty(updB),
      });
      if (mtErr) {
        return { success: false, error: `Mutual transfer could not be completed: ${mtErr.message}` };
      }

      await _sb.from('staff_events').insert([
        {
          personal_no: pnoA, employee_name: a.name_of_teacher || '', event_type: 'mutual_transfer',
          notification_no: notif, effective_date: dateA,
          details: {
            from_emis: a.school_emis_code || '', to_emis: b.school_emis_code || '',
            from_markaz: a.markaz_name || '', to_markaz: b.markaz_name || '', to_school: b.school_name || '',
            swapped_with_personal_no: pnoB, swapped_with_name: b.name_of_teacher || '',
          },
          created_by: user?.name || '',
        },
        {
          personal_no: pnoB, employee_name: b.name_of_teacher || '', event_type: 'mutual_transfer',
          notification_no: notif, effective_date: dateB,
          details: {
            from_emis: b.school_emis_code || '', to_emis: a.school_emis_code || '',
            from_markaz: b.markaz_name || '', to_markaz: a.markaz_name || '', to_school: a.school_name || '',
            swapped_with_personal_no: pnoA, swapped_with_name: a.name_of_teacher || '',
          },
          created_by: user?.name || '',
        },
      ]);

      return {
        success: true,
        message: `Mutual transfer completed: ${a.name_of_teacher || pnoA} ↔ ${b.name_of_teacher || pnoB}.`,
      };
    }

    case 'executePromotion': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const pno = p.personalNo || p['PERSONAL NO.'] || p.personal_no;
      if (!pno) return { success: false, error: 'Missing employee personal number.' };

      const { data: s } = await _sb.from('staff').select('name_of_teacher, designation, bps').eq('personal_no', pno).single();
      if (!s) return { success: false, error: `No staff record found for personal number "${pno}".` };

      const targetEmis = p.targetEmis || p.to_emis;
      let destFields = {};
      if (targetEmis) {
        const { data: dest } = await _sb.from('schools')
          .select('district, wing, tehsil, markaz, school_name')
          .eq('emis', targetEmis).maybeSingle();
        if (dest) {
          destFields = {
            school_emis_code: targetEmis,
            school_name:      dest.school_name,
            markaz_name:      dest.markaz,
            tehsil:           dest.tehsil,
            district:         dest.district,
            wing:             dest.wing,
          };
        }
      }

      // SNE vacancy check: promotion moves the employee to a NEW grade,
      // so confirm the (destination, or current if unchanged) EMIS has
      // a vacant seat at the new grade before recording it.
      const newBps = parseInt(p.newBps || p.new_bps || p['New BPS'], 10);
      const checkEmis = targetEmis || s?.school_emis_code;
      if (!isNaN(newBps) && checkEmis) {
        const { data: hasVacancy, error: vacErr } = await _sb.rpc('check_grade_vacancy', {
          p_emis: checkEmis, p_grade: newBps,
        });
        if (!vacErr && hasVacancy === false) {
          return { success: false, error: `Vacant seat not available for BPS-${newBps} at EMIS ${checkEmis}.` };
        }
      }

      const r = await _staffPrivilegedUpdate(pno, _sanitizeEmpty({
        designation:                  p.newDesignation || p.new_designation || p['New Designation'] || '',
        bps:                          p.newBps         || p.new_bps         || p['New BPS'] || '',
        date_of_posting_present_school:p.newPostingDate || '',
        date_of_joining_present_scale:p.newScaleJoiningDate || p.effective_date  || '',
        ...destFields,
        changes_made_by:              user?.name || '',
        changes_made_at:              new Date().toISOString(),
      }));
      if (!r.ok) return { success: false, error: r.message };

      await _sb.from('staff_events').insert([{
        personal_no:    pno,
        employee_name:  s?.name_of_teacher || '',
        event_type:     'promotion',
        notification_no:p.notificationNo || p.notification_no || '',
        effective_date: p.newScaleJoiningDate || p.effective_date  || '',
        details:        {
          old_designation: s?.designation || '',
          new_designation: p.newDesignation || p.new_designation || '',
          old_bps:         s?.bps || '',
          new_bps:         p.newBps || p.new_bps || '',
        },
        created_by: user?.name || '',
      }]);
      return { success: true, message: 'Promotion recorded successfully.' };
    }

    case 'executeStaffAction': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const pno = p.personalNo || p['PERSONAL NO.'] || p.personal_no;
      if (!pno) return { success: false, errors: ['Missing employee personal number.'] };
      const actionType = (p.actionType || p.action_type || p['Action Type'] || '').toLowerCase();
      const statusMap2 = {
        retire: 'retired', retirement: 'retired',
        resign: 'resigned', resignation: 'resigned',
        terminate: 'terminated', termination: 'terminated',
        deceased: 'deceased', death: 'deceased',
      };
      const newStatus = statusMap2[actionType] || actionType;
      const targetSheet = {
        retired: 'Retirement', resigned: 'Resignation',
        terminated: 'Termination', deceased: 'Deceased',
      }[newStatus] || '';

      const { data: s } = await _sb.from('staff').select('name_of_teacher').eq('personal_no', pno).single();
      if (!s) return { success: false, errors: [`No staff record found for personal number "${pno}".`] };

      const r = await _staffPrivilegedUpdate(pno, _sanitizeEmpty({
        status: newStatus,
        changes_made_by: user?.name || '',
        changes_made_at: new Date().toISOString(),
      }));
      if (!r.ok) return { success: false, errors: [r.message] };

      await _sb.from('staff_events').insert([{
        personal_no:    pno,
        employee_name:  s?.name_of_teacher || '',
        event_type:     newStatus,
        notification_no:p.notificationNo || p.notification_no || p['Notification No'] || '',
        effective_date: p.effectiveDate  || p.effective_date  || p['Effective Date'] || '',
        created_by:     user?.name || '',
      }]);
      return { success: true, message: 'Action completed.', targetSheet };
    }

    // ── CONTRACT EMPLOYEE LIFECYCLE ─────────────────────────────────────
    // "End Contract" — only valid for staff whose nature_of_job is
    // 'Contract' and who are currently active. Moves them into the
    // ContractEnded list (status='contract_ended') without deleting the
    // record, same soft-status pattern as Retirement/Resignation/etc.
    case 'endStaffContract': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const pno = p.personalNo || p.personal_no;
      if (!pno) return { success: false, message: 'Missing employee personal number.' };

      const { data: s } = await _sb.from('staff')
        .select('name_of_teacher, nature_of_job, status').eq('personal_no', pno).maybeSingle();
      if (!s) return { success: false, message: `No staff record found for personal number "${pno}".` };
      if ((s.nature_of_job || '').trim() !== 'Contract') {
        return { success: false, message: 'Only Contract employees can be moved to Contract Ended.' };
      }
      if (s.status !== 'active') {
        return { success: false, message: `This employee is not currently active (status: ${s.status}).` };
      }
      if (!p.contractEndDate) return { success: false, message: 'Contract End Date is required.' };

      const r = await _staffPrivilegedUpdate(pno, _sanitizeEmpty({
        status: 'contract_ended',
        contract_end_date: p.contractEndDate,
        contract_end_order_no: p.orderNumber || null,
        contract_end_remarks: p.remarks || null,
        changes_made_by: user?.name || '',
        changes_made_at: new Date().toISOString(),
      }));
      if (!r.ok) return { success: false, message: r.message };

      await _sb.from('staff_events').insert([{
        personal_no: pno,
        employee_name: s.name_of_teacher || '',
        event_type: 'contract_ended',
        notification_no: p.orderNumber || '',
        effective_date: p.contractEndDate,
        details: { remarks: p.remarks || '' },
        created_by: user?.name || '',
      }]);
      return { success: true, message: 'Contract ended. Employee moved to Contract Ended list.' };
    }

    // "Renew Contract" — reassigns a Contract Ended employee to a
    // (possibly new) school and reactivates them, mirroring the
    // Awaiting Posting assignment flow. School lookup checks public
    // then private schools, same as searchSchoolsForAssignment.
    case 'renewStaffContract': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const pno = p.personalNo || p.personal_no;
      const targetEmis = (p.targetEmis || '').trim();
      if (!pno) return { success: false, message: 'Missing employee personal number.' };
      if (!targetEmis) return { success: false, message: 'Target school EMIS is required.' };
      if (!p.orderNumber) return { success: false, message: 'Contract Renewal Order Number is required.' };
      if (!p.newEndDate) return { success: false, message: 'New Contract End Date is required.' };

      const { data: s } = await _sb.from('staff')
        .select('name_of_teacher, status').eq('personal_no', pno).maybeSingle();
      if (!s) return { success: false, message: `No staff record found for personal number "${pno}".` };
      if (s.status !== 'contract_ended') {
        return { success: false, message: `This employee is not in Contract Ended status (status: ${s.status}).` };
      }

      let school = (await _sb.from('public_schools')
        .select('emis, school_name, district, wing, tehsil, markaz_name').eq('emis', targetEmis).maybeSingle()).data;
      let wing = school?.wing || '';
      if (!school) {
        school = (await _sb.from('private_schools')
          .select('emis, school_name, district, tehsil, markaz_name').eq('emis', targetEmis).maybeSingle()).data;
        wing = '';
      }
      if (!school) return { success: false, message: `School with EMIS "${targetEmis}" was not found.` };

      const r = await _staffPrivilegedUpdate(pno, _sanitizeEmpty({
        status: 'active',
        school_emis_code: school.emis,
        school_name: school.school_name,
        district: school.district,
        wing: wing,
        tehsil: school.tehsil,
        markaz_name: school.markaz_name,
        contract_end_date: p.newEndDate,
        contract_renewal_order_no: p.orderNumber,
        contract_end_order_no: null,
        contract_end_remarks: null,
        changes_made_by: user?.name || '',
        changes_made_at: new Date().toISOString(),
      }));
      if (!r.ok) return { success: false, message: r.message };

      await _sb.from('staff_events').insert([{
        personal_no: pno,
        employee_name: s.name_of_teacher || '',
        event_type: 'contract_renewed',
        notification_no: p.orderNumber,
        effective_date: p.newEndDate,
        details: { renewed_to_emis: school.emis, renewed_to_school: school.school_name },
        created_by: user?.name || '',
      }]);
      return { success: true, message: 'Contract renewed. Employee moved back to Active Staff.' };
    }

    // Called by the HR "View Staff Details" modal every time it's opened.
    // Safety net for the case an employee reaches retirement age but
    // nobody remembered to run the manual "🎓 Retirement" separation
    // action on them — this catches it the next time anyone views their
    // record and flips status to 'retired' automatically, logging the
    // same staff_events trail the manual action would.
    //
    // Retirement age is recomputed fresh from DOB (not read from the
    // stored date_of_retirement column) using the same "day before the
    // 60th birthday" rule as calcRetirementDate() in hr_view.js, so this
    // self-heals even for older records where that column is blank/wrong.
    case 'checkAndAutoRetire': {
      const p   = Array.isArray(payload) ? payload[0] : payload;
      const pno = p.personalNo || p.personal_no || p['PERSONAL NO.'];
      if (!pno) return { success: false, retired: false, error: 'Missing personal number.' };

      const { data: s } = await _sb.from('staff')
        .select('personal_no, name_of_teacher, date_of_birth, status')
        .eq('personal_no', pno).maybeSingle();
      if (!s) return { success: false, retired: false, error: 'Staff record not found.' };

      // Only active staff are eligible — already-separated records
      // (resigned/terminated/deceased/retired) are left untouched.
      if (s.status !== 'active') return { success: true, retired: false };

      const dob = s.date_of_birth ? new Date(s.date_of_birth) : null;
      if (!dob || isNaN(dob.getTime())) return { success: true, retired: false };

      // Mirrors calcRetirementDate(): retirement date = the day before
      // the employee's 60th birthday.
      let retYear  = dob.getUTCFullYear() + 60;
      let retMonth = dob.getUTCMonth();       // 0-based
      let retDay   = dob.getUTCDate() - 1;
      if (retDay === 0) {
        retMonth -= 1;
        if (retMonth < 0) { retMonth = 11; retYear -= 1; }
        retDay = new Date(Date.UTC(retYear, retMonth + 1, 0)).getUTCDate();
      }
      const retirementDate = new Date(Date.UTC(retYear, retMonth, retDay));

      const today = new Date();
      const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      if (todayUtc < retirementDate) return { success: true, retired: false };

      const r = await _staffPrivilegedUpdate(pno, _sanitizeEmpty({
        status:           'retired',
        changes_made_by:  'System (Auto - Age 60)',
        changes_made_at:  new Date().toISOString(),
      }));
      if (!r.ok) return { success: false, retired: false, error: r.message };

      await _sb.from('staff_events').insert([{
        personal_no:     pno,
        employee_name:   s.name_of_teacher || '',
        event_type:      'retired',
        notification_no: 'AUTO - Age 60',
        effective_date:  retirementDate.toISOString().slice(0, 10),
        created_by:      'System (Auto - Age 60)',
      }]);

      return {
        success: true,
        retired: true,
        message: `${s.name_of_teacher || 'This employee'} has reached age 60 and was automatically moved to Retired status.`,
      };
    }

    case 'revertToActiveStaff': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const pno = p.personalNo || p['PERSONAL NO.'] || p.personal_no;
      const sourceSheetName = p.sourceSheetName || p.source_sheet_name || '';
      const rowNum = p.rowNum || p.row_num || p._row;

      // BUGFIX (2026-07-24): this case used to ALWAYS just flip status
      // back to 'active' regardless of sourceSheetName — which is the
      // right thing for undoing a Termination/Retirement/Resignation/
      // Deceased action, but does nothing for Transfer_History or
      // Promotions_History rows (those employees are already 'active';
      // the thing that needs undoing is their school or designation/
      // BPS). "Undo Transfer" and "Undo Promotion" called this same
      // case but the school/designation was never actually restored.
      // Now each sheet type restores what it's actually supposed to.

      if (sourceSheetName === 'Transfer_History') {
        if (!rowNum) return { success: false, error: 'Could not identify which transfer to undo (missing event id).' };
        const { data: ev } = await _sb.from('staff_events').select('*').eq('id', rowNum).maybeSingle();
        if (!ev) return { success: false, error: 'That transfer record could not be found — it may have already been reverted.' };

        const winErr = _checkRevertWindow(user, ev.created_at);
        if (winErr) return { success: false, error: winErr };

        const d = ev.details || {};
        const fromEmis = d.from_emis;
        if (!fromEmis) return { success: false, error: 'This transfer has no recorded original school to revert to.' };
        const { data: fromSchool } = await _sb.from('schools')
          .select('district, wing, tehsil, markaz, school_name').eq('emis', fromEmis).maybeSingle();
        if (!fromSchool) return { success: false, error: `The original school (EMIS ${fromEmis}) could not be found — it may have been removed from the schools list.` };

        if (ev.event_type === 'mutual_transfer') {
          const partnerPno = d.swapped_with_personal_no;
          if (!partnerPno) return { success: false, error: 'This mutual transfer has no recorded swap partner to revert.' };
          // to_emis on MY event is the partner's ORIGINAL school (that's
          // how the swap was built), so no separate lookup of the
          // partner's own event is needed to know where they should go.
          const toEmis = d.to_emis;
          const { data: toSchool } = await _sb.from('schools')
            .select('district, wing, tehsil, markaz, school_name').eq('emis', toEmis).maybeSingle();
          if (!toSchool) return { success: false, error: `The swap partner's original school (EMIS ${toEmis}) could not be found.` };

          const { error: mtErr } = await _sb.rpc('staff_mutual_transfer_privileged', {
            p_personal_no_a: pno, p_personal_no_b: partnerPno,
            p_updates_a: _sanitizeEmpty({
              school_emis_code: fromEmis, school_name: fromSchool.school_name, markaz_name: fromSchool.markaz,
              tehsil: fromSchool.tehsil, district: fromSchool.district, wing: fromSchool.wing,
              changes_made_by: user?.name || '', changes_made_at: new Date().toISOString(),
            }),
            p_updates_b: _sanitizeEmpty({
              school_emis_code: toEmis, school_name: toSchool.school_name, markaz_name: toSchool.markaz,
              tehsil: toSchool.tehsil, district: toSchool.district, wing: toSchool.wing,
              changes_made_by: user?.name || '', changes_made_at: new Date().toISOString(),
            }),
          });
          if (mtErr) return { success: false, error: `Could not undo mutual transfer: ${mtErr.message}` };

          // Remove the partner's matching mutual_transfer event too, so
          // their side disappears from Transfer_History as well. Matched
          // by the JSONB details rather than notification_no/date, which
          // can be blank/shared across unrelated transfers.
          await _sb.from('staff_events').delete()
            .eq('personal_no', partnerPno).eq('event_type', 'mutual_transfer')
            .contains('details', { swapped_with_personal_no: pno });
        } else {
          const r = await _staffPrivilegedUpdate(pno, _sanitizeEmpty({
            school_emis_code: fromEmis, school_name: fromSchool.school_name, markaz_name: fromSchool.markaz,
            tehsil: fromSchool.tehsil, district: fromSchool.district, wing: fromSchool.wing,
            changes_made_by: user?.name || '', changes_made_at: new Date().toISOString(),
          }));
          if (!r.ok) return { success: false, error: r.message };
        }

        await _sb.from('staff_events').delete().eq('id', rowNum);
        await _sb.from('staff_events').insert([{
          personal_no: pno, employee_name: ev.employee_name || '', event_type: 'revert',
          details: { reverted_event_type: ev.event_type, restored_to_emis: fromEmis },
          created_by: user?.name || '',
        }]);
        return { success: true, message: 'Transfer undone successfully.' };
      }

      if (sourceSheetName === 'Promotions_History') {
        if (!rowNum) return { success: false, error: 'Could not identify which promotion to undo (missing event id).' };
        const { data: ev } = await _sb.from('staff_events').select('*').eq('id', rowNum).maybeSingle();
        if (!ev) return { success: false, error: 'That promotion record could not be found — it may have already been reverted.' };

        const winErr = _checkRevertWindow(user, ev.created_at);
        if (winErr) return { success: false, error: winErr };

        const d = ev.details || {};
        const r = await _staffPrivilegedUpdate(pno, _sanitizeEmpty({
          designation: d.old_designation || '', bps: d.old_bps || '',
          changes_made_by: user?.name || '', changes_made_at: new Date().toISOString(),
        }));
        if (!r.ok) return { success: false, error: r.message };

        await _sb.from('staff_events').delete().eq('id', rowNum);
        await _sb.from('staff_events').insert([{
          personal_no: pno, employee_name: ev.employee_name || '', event_type: 'revert',
          details: { reverted_event_type: 'promotion', restored_designation: d.old_designation || '', restored_bps: d.old_bps || '' },
          created_by: user?.name || '',
        }]);
        return { success: true, message: 'Promotion undone successfully.' };
      }

      // ── Status-change reverts (Termination / Retirement / Resignation
      // / Deceased → back to Active). Unchanged apart from routing
      // through the shared _checkRevertWindow helper above.
      const { data: s } = await _sb.from('staff').select('name_of_teacher, status, changes_made_at').eq('personal_no', pno).single();
      if (!s) return { success: false, error: `No staff record found for personal number "${pno}".` };

      const winErr = _checkRevertWindow(user, s.changes_made_at);
      if (winErr) return { success: false, error: winErr };

      const r = await _staffPrivilegedUpdate(pno, {
        status: 'active',
        changes_made_by: user?.name || '',
        changes_made_at: new Date().toISOString(),
      });
      if (!r.ok) return { success: false, error: r.message };

      await _sb.from('staff_events').insert([{
        personal_no:   pno,
        employee_name: s?.name_of_teacher || '',
        event_type:    'revert',
        details:       { reverted_from_status: s?.status || '' },
        created_by:    user?.name || '',
      }]);
      return { success: true, message: 'Reverted to active successfully.' };
    }

    // ── DUPLICATE CHECKS ──────────────────────────────────────────────
    case 'checkPersonalNoDuplicate': {
      const pno  = Array.isArray(payload) ? payload[0] : payload?.personal_no ?? payload;
      const excl = Array.isArray(payload) ? payload[1] : payload?.exclude;
      let q = _sb.from('staff').select('personal_no').eq('personal_no', String(pno).trim());
      if (excl) q = q.neq('personal_no', excl);
      const { data } = await q;
      return { found: (data?.length || 0) > 0, sheet: 'Staff' };
    }

    case 'checkCnicDuplicate': {
      const cnic = Array.isArray(payload) ? payload[0] : payload?.cnic ?? payload;
      const excl = Array.isArray(payload) ? payload[1] : payload?.exclude;
      let q = _sb.from('staff').select('personal_no').eq('cnic', String(cnic).trim());
      if (excl) q = q.neq('personal_no', excl);
      const { data } = await q;
      return { found: (data?.length || 0) > 0, sheet: 'Staff' };
    }

    case 'checkIbanDuplicate': {
      const iban = Array.isArray(payload) ? payload[0] : payload?.iban ?? payload;
      const excl = Array.isArray(payload) ? payload[1] : payload?.exclude;
      let q = _sb.from('staff').select('personal_no').eq('salary_account_iban_no', String(iban).trim());
      if (excl) q = q.neq('personal_no', excl);
      const { data } = await q;
      return { found: (data?.length || 0) > 0, sheet: 'Staff' };
    }

    // ── PUBLIC SCHOOLS ────────────────────────────────────────────────
    case 'getPublicDashboardData': {
      // The frontend sends the SHEET NAME the user clicked ('Public' /
      // 'Out Sourced School'), not the actual DB status value — map it
      // the same way exportSheetData already does below.
      const p = Array.isArray(payload) ? payload : [payload];
      const reqUser  = p[0];
      const sheetName = p[1] || 'Public';
      const status = sheetName === 'Out Sourced School' ? 'Out Sourced' : 'Active';
      // Keyset pagination on emis (unique, indexed) instead of OFFSET —
      // this table has 38,000+ rows, and OFFSET pagination was hitting
      // the statement timeout on later pages. Final display order is
      // handled client-side (sorted by markaz + emis), so the fetch
      // order here doesn't need to match what the user sees.
      const data = await _fetchAllRows('public_schools', '*',
        null, q => q.eq('status', status), 'emis');
      const filterFn = _buildUserSchoolFilter(reqUser, { idKey: 'emis' });
      const visible = filterFn ? (data || []).filter(filterFn) : (data || []);
      return { success: true, ..._toHeadersData(visible, getPubColMap()) };
    }

    case 'savePublicSchool': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const isNew = !!p._isNew;
      const emis = p['Emis'] || p.emis;
      if (!emis) return { success: false, message: 'Emis code is required.' };
      // Convert display keys back to db columns
      const reverseMap = Object.fromEntries(Object.entries(getPubColMap()).map(([c,h])=>[h,c]));
      let dbRow = {};
      for (const [h, v] of Object.entries(p)) {
        const col = reverseMap[h];
        if (col) dbRow[col] = v;  // silently drop any key with no matching column
      }
      dbRow = _sanitizeEmpty(dbRow);
      dbRow = _coerceNumericColumns(dbRow);
      dbRow.updated_at = new Date().toISOString();

      if (isNew) {
        // Guard against accidentally overwriting an existing school if
        // the Emis the admin typed already exists.
        const { data: existing } = await _sb.from('public_schools').select('emis').eq('emis', emis).maybeSingle();
        if (existing) {
          return { success: false, message: `A school with Emis "${emis}" already exists. Use Edit instead, or check the Emis code.` };
        }
        dbRow.status = dbRow.status || 'Active';
        const { error } = await _sb.from('public_schools').insert([dbRow]);
        if (error) return { success: false, message: error.message };
        return { success: true, message: 'School added.' };
      }

      delete dbRow.emis;  // don't overwrite PK
      const r = await _checkedUpdate('public_schools', dbRow, 'emis', emis);
      if (!r.ok) return { success: false, message: r.message };
      return { success: true, message: 'School record updated.' };
    }

    case 'exportSheetData': {
      // Used by public/private export buttons — returns { success, headers, rows (2D) }
      const sheetName = Array.isArray(payload) ? payload[0] : (payload?.sheet || payload);
      const reqUser   = Array.isArray(payload) ? payload[1] : payload?.user;
      if (sheetName === 'Public' || sheetName === 'Out Sourced School') {
        const status = sheetName === 'Out Sourced School' ? 'Out Sourced' : 'Active';
        const data = await _fetchAllRows('public_schools', '*', null, q => q.eq('status', status), 'emis');
        const filterFn = _buildUserSchoolFilter(reqUser, { idKey: 'emis' });
        const visible = filterFn ? (data || []).filter(filterFn) : (data || []);
        const hdrs = _headers(getPubColMap());
        const rows2d = visible.map(r => hdrs.map(h => {
          const col = Object.entries(getPubColMap()).find(([,v])=>v===h)?.[0];
          return col ? (r[col] ?? '') : '';
        }));
        return { success: true, headers: hdrs, rows: rows2d };
      }
      if (sheetName === 'Private' || sheetName === 'Inactive') {
        const status = sheetName === 'Inactive' ? 'Inactive' : 'Active';
        const data = await _fetchAllRows('private_schools', '*', null, q => q.eq('status', status));
        const filterFn = _buildUserSchoolFilter(reqUser, { idKey: 'unique_id' });
        const visible = filterFn ? (data || []).filter(filterFn) : (data || []);
        const hdrs = _headers(getPrivColMap());
        const rows2d = visible.map(r => hdrs.map(h => {
          const col = Object.entries(getPrivColMap()).find(([,v])=>v===h)?.[0];
          return col ? (r[col] ?? '') : '';
        }));
        return { success: true, headers: hdrs, rows: rows2d };
      }
      // Staff sheet export
      const statusMap3 = { Staff:'active', Termination:'terminated', Retirement:'retired', Resignation:'resigned', Deceased:'deceased', Deleted_Archive:'deleted' };
      const st = statusMap3[sheetName] || 'active';
      const data = await _fetchAllRows('staff', '*', null, q => q.eq('status', st));
      const staffFilterFn = _buildUserSchoolFilter(reqUser, { idKey: 'school_emis_code' });
      const visibleStaff = staffFilterFn ? (data || []).filter(staffFilterFn) : (data || []);
      const hdrs = _headers(STAFF_COL_MAP);
      const rows2d = visibleStaff.map(r => hdrs.map(h => {
        const col = Object.entries(STAFF_COL_MAP).find(([,v])=>v===h)?.[0];
        return col ? (r[col] ?? '') : '';
      }));
      return { success: true, headers: hdrs, rows: rows2d };
    }

    // ── PRIVATE SCHOOLS ───────────────────────────────────────────────
    case 'getPrivateDashboardData': {
      // Same fix as getPublicDashboardData: 'Private' sheet → Active rows,
      // 'Inactive' sheet → Inactive rows. Previously this filtered on the
      // literal sheet name, so almost nothing matched.
      const p = Array.isArray(payload) ? payload : [payload];
      const reqUser  = p[0];
      const sheetName = p[1] || 'Private';
      const status = sheetName === 'Inactive' ? 'Inactive' : 'Active';
      const data = await _fetchAllRows('private_schools', '*',
        q => q.order('school_name'), q => q.eq('status', status));
      const filterFn = _buildUserSchoolFilter(reqUser, { idKey: 'unique_id' });
      const visible = filterFn ? (data || []).filter(filterFn) : (data || []);
      return { success: true, ..._toHeadersData(visible, getPrivColMap()) };
    }

    case 'savePrivateSchool': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const uid = p['Unique ID'] || p.unique_id;
      const reverseMap = Object.fromEntries(Object.entries(getPrivColMap()).map(([c,h])=>[h,c]));
      let dbRow = {};
      for (const [h, v] of Object.entries(p)) {
        const col = reverseMap[h];
        if (col) dbRow[col] = v;  // silently drop any key with no matching column
      }
      dbRow = _sanitizeEmpty(dbRow);
      dbRow = _coerceNumericColumns(dbRow);
      dbRow.updated_at = new Date().toISOString();
      if (uid) {
        delete dbRow.unique_id;
        const r = await _checkedUpdate('private_schools', dbRow, 'unique_id', uid);
        if (!r.ok) return { success: false, message: r.message };
      } else {
        dbRow.status = dbRow.status || 'Active';
        // This column has no database-level default — without this,
        // new private schools were being inserted with unique_id left
        // NULL, which then made Edit unable to find them afterward
        // (it looks records up by this exact value). Match the
        // existing ID format used across the table: PS-YYYY-XXXXXXXX.
        const year = new Date().getFullYear();
        const genId = () => `PS-${year}-` + Array.from({length: 8}, () => '0123456789ABCDEF'[Math.floor(Math.random()*16)]).join('');
        dbRow.unique_id = genId();
        let { error } = await _sb.from('private_schools').insert([dbRow]);
        if (error && error.code === '23505') {
          // Collision on the generated id (astronomically unlikely) — retry once with a fresh one.
          dbRow.unique_id = genId();
          ({ error } = await _sb.from('private_schools').insert([dbRow]));
        }
        if (error) return { success: false, message: error.message };
      }
      return { success: true, message: 'School saved.' };
    }

    case 'searchExistingSchools': {
      const query = Array.isArray(payload) ? payload[0] : (payload?.query || payload);
      const { data, error } = await _sb
        .from('private_schools')
        .select('unique_id, school_name, district, tehsil, markaz_name, status')
        .ilike('school_name', `%${query}%`)
        .limit(20);
      if (error) return [];
      return (data||[]).map(r => _remap(r, getPrivColMap()));
    }

    // ── ADMIN — USERS ─────────────────────────────────────────────────
    case 'getUsers': {
      const { data, error } = await _sb.from('app_users').select('*').order('name');
      if (error) return { success: false, message: error.message };
      const headers = Object.values(USER_COL_MAP);
      const mapped  = (data||[]).map(r => ({ ..._remap(r, USER_COL_MAP), _id: r.id }));
      return { success: true, headers, data: mapped };
    }

    // ── PERSONAL PROFILE (self-service, any logged-in user) ────────────
    case 'getMyProfile': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const { data, error } = await _sb.from('app_users').select('*').eq('id', user.id).single();
      if (error) return { success: false, message: error.message };
      return {
        success:     true,
        personal_no: data.personal_no,
        name:        data.name,
        cnic:        data.cnic,
        cell_no:     data.cell_no,
        email:       data.email,
        designation: data.designation,
        district:    data.district,
        wing:        data.wing,
        tehsil:      data.tehsil,
        markaz_name: data.markaz_name,
        markaz_name_ur: data.markaz_name_ur,
        designation_ur: data.designation_ur,
        page_no:        data.page_no,
        ddeo_code:      data.ddeo_code,
        bps_scale:      data.bps_scale,
        dy_office_detail: data.dy_office_detail,
      };
    }

    case 'updateMyProfile': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const p = Array.isArray(payload) ? payload[0] : payload;
      const newPersonalNo = (p.personalNo ?? p.personal_no ?? '').toString().trim();
      const newName       = (p.name ?? '').toString().trim();
      const newCnic        = (p.cnic ?? '').toString().trim();
      const newEmail       = (p.email ?? '').toString().trim();
      const newDesignation = (p.designation ?? '').toString().trim();

      if (!newPersonalNo) return { success: false, message: 'Personal No. is required.' };
      if (!newName)       return { success: false, message: 'Name is required.' };
      if (!newCnic || !/^\d{13}$/.test(newCnic)) return { success: false, message: 'CNIC must be exactly 13 digits.' };
      if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return { success: false, message: 'Please enter a valid email address.' };

      const { data: existing, error: fetchErr } = await _sb.from('app_users').select('cnic').eq('id', user.id).single();
      if (fetchErr) return { success: false, message: fetchErr.message };

      // CNIC doubles as the login identifier (see get_login_email()), so
      // changing it has to keep the Auth account in sync — that needs the
      // service-role key, so it's routed through the same privileged Edge
      // Function used for admin actions, rather than a plain table update.
      if (newCnic !== existing.cnic) {
        const cnicResult = await _callAdminFunction('updateCnic', { userId: user.id, newCnic });
        if (!cnicResult.success) {
          return { success: false, message: 'Could not update CNIC: ' + (cnicResult.message || 'Unknown error') };
        }
      }

      const r = await _checkedUpdate('app_users', _sanitizeEmpty({
        personal_no: newPersonalNo,
        name:        newName,
        cnic:        newCnic,
        email:       newEmail,
        designation: newDesignation,
      }), 'id', user.id);
      if (!r.ok) return { success: false, message: r.message };

      // Keep the locally-stored session in sync so the header/name shown
      // elsewhere in the app updates immediately without a re-login.
      const updatedUser = { ...user, personal_no: newPersonalNo, name: newName, cnic: newCnic, email: newEmail, designation: newDesignation };
      localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(updatedUser));

      return {
        success: true,
        message: newCnic !== existing.cnic
          ? 'Profile updated. Your CNIC changed — use the new CNIC next time you log in.'
          : 'Profile updated successfully.',
      };
    }

    // ── INSPECTION ALLOWANCE BILL PREP ──────────────────────────────────
    case 'getInspectionAllowanceRate': {
      const { data, error } = await _sb.from('inspection_allowance_settings').select('allowance_rate').eq('id', 1).single();
      if (error) return { success: false, message: error.message };
      return { success: true, rate: Number(data.allowance_rate) };
    }

    case 'getInspectionAllowanceHistory': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const isAdmin = String(user.role).toLowerCase() === 'admin';
      const targetUserId = (isAdmin && p.userId) ? p.userId : user.id;
      const { data, error } = await _sb
        .from('inspection_allowance_deductions')
        .select('year, month, allowance_rate, deduction, due, downloaded_at, created_at')
        .eq('user_id', targetUserId)
        .order('year', { ascending: false })
        .order('month', { ascending: false });
      if (error) return { success: false, message: error.message };
      return { success: true, data: data || [] };
    }

    // Resolves whether the logged-in user's tehsil+wing is Collective
    // (TR-prepared, Download-only) or Individual (self-serve Generate Bill).
    // No config row = Individual by default.
    case 'getMyBudgetMode': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const { data: me, error: meErr } = await _sb.from('app_users').select('tehsil, wing').eq('id', user.id).single();
      if (meErr) return { success: false, message: 'Could not load your profile: ' + meErr.message };
      if (!me?.tehsil || !me?.wing) return { success: false, message: 'Your profile is missing tehsil/wing.' };
      const { data: cfg, error: cfgErr } = await _sb.from('tehsil_budget_config')
        .select('budget_type').eq('tehsil', me.tehsil).eq('wing', me.wing).maybeSingle();
      if (cfgErr) return { success: false, message: 'Could not load budget config: ' + cfgErr.message };
      return { success: true, tehsil: me.tehsil, wing: me.wing, mode: cfg?.budget_type || 'individual' };
    }

    // Collective mode: fetch ALL of this user's prepared months (can span
    // years) — not just never-downloaded ones. AEOs may need to re-download
    // a bill any time (lost file, deleted file, etc.), so download history
    // is informational only and never blocks a month from being picked
    // again; markInspectionAllowanceDownloaded below just refreshes the
    // timestamp on every download. Capped at 18 to match the Bill History
    // depth shown elsewhere.
    case 'getMyPendingCollectiveBill': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const { data: me, error: meErr } = await _sb.from('app_users').select('tehsil, wing').eq('id', user.id).single();
      if (meErr) return { success: false, message: 'Could not load your profile: ' + meErr.message };
      const months = await _resolveCollectiveMonthsForUser(user.id, me.tehsil, me.wing);
      return { success: true, months };
    }

    // Individual mode: self-submit 1-4 (year, month, deduction) entries.
    case 'submitIndividualBill': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const entries = Array.isArray(p.entries) ? p.entries : [];
      const { data, error } = await _sb.rpc('submit_my_inspection_allowance', { p_entries: entries });
      if (error) return { success: false, message: error.message };
      return { success: true, ...data };
    }

    // Refreshes downloaded_at (to now) for the given rows every time a bill
    // is downloaded — including re-downloads of a month downloaded before.
    // Never blocks or errors on rows that already have a downloaded_at set.
    case 'markInspectionAllowanceDownloaded': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const ids = Array.isArray(p.ids) ? p.ids.filter(Boolean) : [];
      if (!ids.length) return { success: true };
      const { error } = await _sb.rpc('mark_inspection_allowance_downloaded', { p_ids: ids });
      if (error) return { success: false, message: error.message };
      return { success: true };
    }

    // ── INSPECTION ALLOWANCE — DOWNLOAD FOR ANY AEO (TR / Admin) ────────
    // Lets a Tehsil Rep or Admin generate/download an AEO's bill on
    // their behalf, using the exact same collective-mode data (and PDF
    // generation logic client-side) as the AEO's own "My Bill" screen.
    // Only AEOs whose tehsil+wing already has budget_preparations for
    // the requested period are eligible, per spec.
    case 'getBillEligibleTehsilWings': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const isAdmin = String(user.role).toLowerCase() === 'admin';
      let scopes;
      if (isAdmin) {
        const { data } = await _sb.from('budget_preparations').select('tehsil, wing');
        scopes = data || [];
      } else {
        const { data } = await _sb.from('tehsil_representatives').select('tehsil, wing').eq('user_id', user.id);
        scopes = data || [];
      }
      const seen = new Set();
      const unique = [];
      scopes.forEach(s => {
        const key = `${s.tehsil}||${s.wing}`;
        if (!seen.has(key)) { seen.add(key); unique.push({ tehsil: s.tehsil, wing: s.wing }); }
      });
      unique.sort((a, b) => (a.tehsil + a.wing).localeCompare(b.tehsil + b.wing));
      return { success: true, scopes: unique };
    }

    case 'getEligibleAeosForBill': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const tehsil = (p.tehsil || '').trim();
      const wing = (p.wing || '').trim();
      if (!tehsil || !wing) return { success: false, message: 'Select a tehsil and wing.' };

      const { data: authOk } = await _sb.rpc('is_tehsil_rep', { p_user_id: user.id, p_tehsil: tehsil, p_wing: wing });
      if (!authOk) return { success: false, message: 'Not authorized for this tehsil/wing.' };

      // "Eligible" = at least one budget_preparations row exists at all
      // for this tehsil+wing (any period) — the per-AEO, per-period
      // picker inside the bill screen then narrows to actual prepared
      // months for whichever AEO is chosen.
      const { data: anyPrep } = await _sb.from('budget_preparations')
        .select('year').eq('tehsil', tehsil).eq('wing', wing).limit(1);
      if (!anyPrep || !anyPrep.length) {
        return { success: true, aeos: [], message: 'No Budget Preparation completed yet for this tehsil/wing.' };
      }

      const { data: aeos, error } = await _sb.from('app_users')
        .select('id, personal_no, name, designation, markaz_name, tehsil, wing')
        .eq('tehsil', tehsil).eq('wing', wing).order('name');
      if (error) return { success: false, message: error.message };
      return { success: true, aeos: aeos || [] };
    }

    // Any AEO's profile, for building their bill — same fields
    // getMyProfile returns, just for an arbitrary target instead of
    // the caller.
    case 'getAeoProfileForBill': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const targetId = p.userId;
      if (!targetId) return { success: false, message: 'Missing AEO.' };

      const { data, error } = await _sb.from('app_users').select('*').eq('id', targetId).single();
      if (error || !data) return { success: false, message: 'AEO not found.' };

      const { data: authOk } = await _sb.rpc('is_tehsil_rep', { p_user_id: user.id, p_tehsil: data.tehsil, p_wing: data.wing });
      if (!authOk) return { success: false, message: 'Not authorized for this AEO.' };

      return {
        success: true,
        personal_no: data.personal_no, name: data.name, cnic: data.cnic, cell_no: data.cell_no, email: data.email,
        designation: data.designation, district: data.district, wing: data.wing, tehsil: data.tehsil,
        markaz_name: data.markaz_name, markaz_name_ur: data.markaz_name_ur, designation_ur: data.designation_ur,
        page_no: data.page_no, ddeo_code: data.ddeo_code, bps_scale: data.bps_scale, dy_office_detail: data.dy_office_detail,
      };
    }

    // Same shape as getMyPendingCollectiveBill, for an arbitrary target
    // AEO — reuses the exact same month-resolution logic (prepared
    // months, missing row = full rate) so figures always match what
    // the AEO would see downloading their own bill.
    case 'getAeoPendingCollectiveBill': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const targetId = p.userId;
      if (!targetId) return { success: false, message: 'Missing AEO.' };

      const { data: target, error } = await _sb.from('app_users').select('tehsil, wing').eq('id', targetId).single();
      if (error || !target) return { success: false, message: 'AEO not found.' };

      const { data: authOk } = await _sb.rpc('is_tehsil_rep', { p_user_id: user.id, p_tehsil: target.tehsil, p_wing: target.wing });
      if (!authOk) return { success: false, message: 'Not authorized for this AEO.' };

      const months = await _resolveCollectiveMonthsForUser(targetId, target.tehsil, target.wing);
      return { success: true, months };
    }

    // Mirrors markInspectionAllowanceDownloaded, but for a TR/Admin
    // acting on an AEO's behalf — checked server-side against that
    // AEO's own tehsil/wing, not the caller's.
    case 'markInspectionAllowanceDownloadedAs': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const ids = Array.isArray(p.ids) ? p.ids.filter(Boolean) : [];
      if (!ids.length || !p.userId) return { success: true };
      const { error } = await _sb.rpc('mark_inspection_allowance_downloaded_as', { p_ids: ids, p_target_user_id: p.userId });
      if (error) return { success: false, message: error.message };
      return { success: true };
    }

    // ── BUDGET PREPARATION (Tehsil Representatives + Admins only) ──────
    // Roster of AEOs in a tehsil+wing, for the TR's prep grid.
    case 'getTehsilRosterForBudget': {
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const tehsil = (p.tehsil || '').trim();
      const wing = (p.wing || '').trim();
      if (!user || !tehsil || !wing) return { success: false, message: 'Missing tehsil/wing.' };
      const { data: authOk } = await _sb.rpc('is_tehsil_rep', { p_user_id: user.id, p_tehsil: tehsil, p_wing: wing });
      if (!authOk) return { success: false, message: 'Not authorized for this tehsil/wing.' };

      const { data, error } = await _sb.from('app_users')
        .select('id, personal_no, name, wing, tehsil, markaz_name, designation, ddeo_code')
        .eq('tehsil', tehsil).eq('wing', wing).order('name');
      if (error) return { success: false, message: error.message };
      return { success: true, data: data || [] };
    }

    // Existing deductions already on file for a tehsil+wing+year (to pre-fill
    // the grid) and which months are already marked prepared.
    case 'getBudgetPrepStatus': {
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const tehsil = (p.tehsil || '').trim();
      const wing = (p.wing || '').trim();
      const year = Number(p.year);
      if (!user || !tehsil || !wing || !year) return { success: false, message: 'Missing tehsil/wing/year.' };

      const { data: preps, error: prepErr } = await _sb.from('budget_preparations')
        .select('month, prepared_by_name, prepared_at, updated_at, pdf_sent_at, send_error')
        .eq('tehsil', tehsil).eq('wing', wing).eq('year', year);
      if (prepErr) return { success: false, message: prepErr.message };

      const { data: users } = await _sb.from('app_users').select('id').eq('tehsil', tehsil).eq('wing', wing);
      const userIds = (users || []).map(u => u.id);
      let deductions = [];
      if (userIds.length) {
        const { data: dedRows, error: dedErr } = await _sb.from('inspection_allowance_deductions')
          .select('user_id, month, deduction, due').eq('year', year).in('user_id', userIds);
        if (dedErr) return { success: false, message: dedErr.message };
        deductions = dedRows || [];
      }
      // Annual "how many times has this employee already had a
      // deduction this year" counter, for the fairness nudge in the
      // roster UI. Computed from the SAME dedRows already fetched
      // above (year is already the whole year, not just the selected
      // months) — no extra DB round trip, so this doesn't add load
      // even on a large roster.
      const deductionCounts = {};
      (deductions || []).forEach(d => {
        if (Number(d.deduction) > 0) {
          deductionCounts[d.user_id] = (deductionCounts[d.user_id] || 0) + 1;
        }
      });

      return { success: true, preparedMonths: preps || [], deductions, deductionCounts };
    }

    case 'prepareTehsilBudget': {
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const { tehsil, wing, year, month, entries } = p;
      if (!user || !tehsil || !wing || !year || !month || !Array.isArray(entries) || !entries.length) {
        return { success: false, message: 'Missing tehsil, wing, year, month, or entries.' };
      }
      const { data, error } = await _sb.rpc('prepare_tehsil_budget', {
        p_tehsil: tehsil, p_wing: wing, p_year: year, p_month: month, p_entries: entries,
      });
      if (error) return { success: false, message: error.message };

      // Fetch the id of the (now upserted) budget_preparations row so the
      // frontend can hand it to the send-budget-pdf edge function.
      const { data: prepRow } = await _sb.from('budget_preparations')
        .select('id').eq('tehsil', tehsil).eq('wing', wing).eq('year', year).eq('month', month).single();

      return { success: true, bill: data, prepId: prepRow?.id || null };
    }

    // Admin-only: manage which users hold Tehsil Representative authority.
    case 'listTehsilReps': {
      if (!user || String(user.role).toLowerCase() !== 'admin') return { success: false, message: 'Admin access required.' };
      const { data, error } = await _sb.from('tehsil_representatives')
        .select('id, user_id, tehsil, wing, assigned_at, app_users(name, personal_no)').order('tehsil');
      if (error) return { success: false, message: error.message };
      return { success: true, data: data || [] };
    }

    case 'addTehsilRep': {
      if (!user || String(user.role).toLowerCase() !== 'admin') return { success: false, message: 'Admin access required.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const { error } = await _sb.from('tehsil_representatives')
        .insert([{ user_id: p.userId, tehsil: p.tehsil, wing: p.wing, assigned_by: user.id }]);
      if (error) return { success: false, message: error.message };
      return { success: true };
    }

    case 'removeTehsilRep': {
      if (!user || String(user.role).toLowerCase() !== 'admin') return { success: false, message: 'Admin access required.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const { error } = await _sb.from('tehsil_representatives').delete().eq('id', p.id);
      if (error) return { success: false, message: error.message };
      return { success: true };
    }

    // Admin-only: Tehsil Budget Configuration screen (General Management).
    // Lists every tehsil+wing that actually has users, merged with whatever
    // config rows exist (missing = Individual by default).
    case 'listTehsilBudgetConfig': {
      if (!user || String(user.role).toLowerCase() !== 'admin') return { success: false, message: 'Admin access required.' };
      const { data: scopes } = await _sb.from('app_users').select('tehsil, wing').not('tehsil', 'is', null).not('wing', 'is', null);
      const { data: cfgRows } = await _sb.from('tehsil_budget_config').select('tehsil, wing, budget_type, updated_at');
      const cfgMap = Object.fromEntries((cfgRows || []).map(r => [r.tehsil + '|' + r.wing, r]));
      const seen = new Set();
      const list = [];
      (scopes || []).forEach(s => {
        const key = s.tehsil + '|' + s.wing;
        if (seen.has(key)) return;
        seen.add(key);
        const cfg = cfgMap[key];
        list.push({ tehsil: s.tehsil, wing: s.wing, budget_type: cfg?.budget_type || 'individual', updated_at: cfg?.updated_at || null });
      });
      list.sort((a, b) => a.tehsil.localeCompare(b.tehsil) || a.wing.localeCompare(b.wing));
      return { success: true, data: list };
    }

    case 'setTehsilBudgetType': {
      if (!user || String(user.role).toLowerCase() !== 'admin') return { success: false, message: 'Admin access required.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      if (!p.tehsil || !p.wing || !['collective', 'individual'].includes(p.type)) {
        return { success: false, message: 'Missing tehsil/wing/type.' };
      }
      const { error } = await _sb.rpc('set_tehsil_budget_type', { p_tehsil: p.tehsil, p_wing: p.wing, p_type: p.type });
      if (error) return { success: false, message: error.message };
      return { success: true };
    }

    // Self-service: what does MY tehsil+wing's budget prep look like for a
    // given year? Returns all 12 months: whether prepared, and my
    // deduction/due (0/full-rate if prepared but I wasn't individually
    // adjusted). Used as the read-only history table in both modes.
    case 'getMyInspectionAllowanceMonths': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const year = Number(p.year) || new Date().getFullYear();

      const { data: me } = await _sb.from('app_users').select('tehsil, wing').eq('id', user.id).single();
      const tehsil = me?.tehsil;
      const wing = me?.wing;
      if (!tehsil) return { success: false, message: 'No tehsil on your profile.' };

      const { data: preps, error: prepErr } = await _sb.from('budget_preparations')
        .select('month').eq('tehsil', tehsil).eq('wing', wing).eq('year', year);
      if (prepErr) return { success: false, message: prepErr.message };
      const preparedSet = new Set((preps || []).map(p => p.month));

      const { data: rate } = await _sb.from('inspection_allowance_settings').select('allowance_rate').eq('id', 1).single();
      const fullRate = Number(rate?.allowance_rate) || 25000;

      const { data: myDeds } = await _sb.from('inspection_allowance_deductions')
        .select('month, deduction, due').eq('user_id', user.id).eq('year', year);
      const dedByMonth = Object.fromEntries((myDeds || []).map(d => [d.month, d]));

      const months = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const prepared = preparedSet.has(m) || !!dedByMonth[m]; // individual self-entries count as "prepared" too
        const ded = dedByMonth[m];
        return {
          month: m,
          prepared,
          deduction: prepared ? Number(ded?.deduction || 0) : null,
          due: prepared ? Number(ded?.due ?? fullRate) : null,
        };
      });
      return { success: true, tehsil, wing, rate: fullRate, months };
    }

    // TR/Admin equivalent of getMyInspectionAllowanceMonths — same
    // shape, same "prepared" logic, just for an arbitrary target AEO
    // instead of the caller. Powers "Prepare Performance" inside
    // Download for AEO — the Performance tab's own rendering/PDF logic
    // (perfRenderMonthsGrid, perfDownloadCertificate, etc.) is reused
    // completely unchanged; only the months source differs.
    case 'getAeoInspectionAllowanceMonths': {
      if (!user || !user.id) return { success: false, message: 'Not logged in.' };
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const targetId = p.userId;
      const year = Number(p.year) || new Date().getFullYear();
      if (!targetId) return { success: false, message: 'Missing AEO.' };

      const { data: target } = await _sb.from('app_users').select('tehsil, wing').eq('id', targetId).single();
      if (!target?.tehsil) return { success: false, message: 'AEO not found or missing tehsil.' };

      const { data: authOk } = await _sb.rpc('is_tehsil_rep', { p_user_id: user.id, p_tehsil: target.tehsil, p_wing: target.wing });
      if (!authOk) return { success: false, message: 'Not authorized for this AEO.' };

      const { tehsil, wing } = target;
      const { data: preps, error: prepErr } = await _sb.from('budget_preparations')
        .select('month').eq('tehsil', tehsil).eq('wing', wing).eq('year', year);
      if (prepErr) return { success: false, message: prepErr.message };
      const preparedSet = new Set((preps || []).map(p => p.month));

      const { data: rate } = await _sb.from('inspection_allowance_settings').select('allowance_rate').eq('id', 1).single();
      const fullRate = Number(rate?.allowance_rate) || 25000;

      const { data: theirDeds } = await _sb.from('inspection_allowance_deductions')
        .select('month, deduction, due').eq('user_id', targetId).eq('year', year);
      const dedByMonth = Object.fromEntries((theirDeds || []).map(d => [d.month, d]));

      const months = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const prepared = preparedSet.has(m) || !!dedByMonth[m];
        const ded = dedByMonth[m];
        return {
          month: m, prepared,
          deduction: prepared ? Number(ded?.deduction || 0) : null,
          due: prepared ? Number(ded?.due ?? fullRate) : null,
        };
      });
      return { success: true, tehsil, wing, rate: fullRate, months };
    }

    // Admin-only: lightweight roster for the batch-generate picker
    case 'saveUser': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const isTehsilRep = !!p.isTehsilRep;
      const reverseMap = Object.fromEntries(Object.entries(USER_COL_MAP).map(([c,h])=>[h,c]));
      const dbRow = {};
      for (const [h, v] of Object.entries(p)) {
        if (h === 'Password') continue;  // never write plaintext passwords to app_users
        if (h === '_id') continue;       // internal field, not a real column
        if (h === 'isTehsilRep') continue; // handled separately below (tehsil_representatives table, not a column)
        const col = reverseMap[h] || h;
        if (col === 'dy_office_detail') continue; // Postgres GENERATED column (wing+tehsil) — read-only
        dbRow[col] = v;
      }
      const newPassword = p['Password'] || '';
      const cnic = dbRow.cnic;

      // Keeps tehsil_representatives in sync with the "Is this person a
      // Tehsil Representative?" checkbox. Scope is always this user's OWN
      // tehsil+wing (never an arbitrary admin-picked one), so we simply
      // clear any existing rows for them and re-add one if still checked.
      async function syncTehsilRep(userId) {
        if (!userId) return null;
        const { error: delErr } = await _sb.from('tehsil_representatives').delete().eq('user_id', userId);
        if (delErr) return 'Could not update Tehsil Representative status: ' + delErr.message;
        if (isTehsilRep && dbRow.tehsil && dbRow.wing) {
          const { error: insErr } = await _sb.from('tehsil_representatives')
            .insert([{ user_id: userId, tehsil: dbRow.tehsil, wing: dbRow.wing, assigned_by: user.id }]);
          if (insErr) return 'Could not assign Tehsil Representative: ' + insErr.message;
        }
        return null;
      }

      // Reliable edit-vs-create detection: look up by CNIC (always present,
      // unique) rather than trusting an id/_id field the frontend form
      // may not be sending back (it wasn't, originally — Apps Script-era
      // forms used row index instead of a real id).
      let existingId = p._id || p.id || null;
      if (!existingId && cnic) {
        const { data: existing } = await _sb.from('app_users').select('id').eq('cnic', cnic).maybeSingle();
        if (existing) existingId = existing.id;
      }

      if (existingId) {
        // IMPORTANT: .select() here is required — without it, Supabase
        // returns no error AND no row count even when Row Level Security
        // silently blocks the update (0 rows actually changed). That was
        // previously causing "User saved." to show even though nothing
        // was written. With .select(), we can tell the two cases apart.
        const { data: updated, error } = await _sb.from('app_users').update(dbRow).eq('id', existingId).select();
        if (error) return { success: false, message: error.message };
        if (!updated || updated.length === 0) {
          return {
            success: false,
            message: 'Save blocked: no row was updated. This is almost always a Row Level Security (RLS) ' +
                     'policy on app_users that does not allow this account to UPDATE other users\u2019 rows. ' +
                     'Add/adjust an UPDATE policy for the admin role on app_users in Supabase.',
          };
        }
        const trErr = await syncTehsilRep(existingId);
        if (trErr) return { success: true, message: 'User saved, but: ' + trErr };
        if (newPassword) {
          const pwResult = await _callAdminFunction('resetPassword', { userId: existingId, newPassword });
          if (!pwResult.success) {
            return { success: true, message: 'Profile saved, but password reset failed: ' + pwResult.message };
          }
          return { success: true, message: 'User saved and password reset successfully.' };
        }
        return { success: true, message: 'User saved.' };
      } else {
        // Genuinely new user — needs a real Auth account, routed through
        // the Edge Function since it requires the service_role key.
        const result = await _callAdminFunction('createUser', {
          cnic:        dbRow.cnic,
          personal_no: dbRow.personal_no,
          name:        dbRow.name,
          role:        dbRow.role,
          markaz_name: dbRow.markaz_name,
          cell_no:     dbRow.cell_no,
          district:    dbRow.district,
          wing:        dbRow.wing,
          tehsil:      dbRow.tehsil,
          scope_type:  dbRow.scope_type,
          scope_value: dbRow.scope_value,
          access_type: dbRow.access_type,
          email:       dbRow.email,
        });
        // Fallback: if the Edge Function doesn't (yet) persist the email
        // column itself, write it directly here as the admin — this only
        // runs if creation succeeded and gives us a new user id back.
        const newId = result && (result.userId || result.id || (result.user && result.user.id));
        if (result && result.success && dbRow.email && newId) {
          await _sb.from('app_users').update({ email: dbRow.email }).eq('id', newId);
        }
        if (result && result.success) {
          const trErr = await syncTehsilRep(newId);
          if (trErr) result.message = (result.message || 'User created.') + ' But: ' + trErr;
        }
        return result;
      }
    }

    case 'deleteUser': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      let userId = (p && typeof p === 'object') ? (p.id || p._id) : p;
      if (!userId) {
        // Fallback: look up by CNIC if no id was passed
        const cnic = (p && typeof p === 'object') ? (p['CNIC'] || p.cnic) : null;
        const { data: row } = await _sb.from('app_users').select('id').eq('cnic', cnic).single();
        if (!row) return { success: false, message: 'User not found.' };
        return await _callAdminFunction('deleteUser', { userId: row.id });
      }
      return await _callAdminFunction('deleteUser', { userId });
    }

    case 'resetUserPassword': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const userId = p?.id || p?._id || p?.userId;
      const newPassword = p?.newPassword || p?.password;
      if (!userId || !newPassword) {
        return { success: false, message: 'User and new password are required.' };
      }
      return await _callAdminFunction('resetPassword', { userId, newPassword });
    }

    // ── ADMIN — JURISDICTION DROPDOWNS ────────────────────────────────
    case 'getJurisdictionDropdownData': {
      const rows = await _fetchAllRows('schools', 'district, wing, tehsil, markaz, emis',
        null, null, 'emis');
      return {
        success:   true,
        districts: [...new Set(rows.map(r=>r.district).filter(Boolean))].sort(),
        wings:     [...new Set(rows.map(r=>r.wing).filter(Boolean))].sort(),
        tehsils:   [...new Set(rows.map(r=>r.tehsil).filter(Boolean))].sort(),
        markazes:  [...new Set(rows.map(r=>r.markaz).filter(Boolean))].sort(),
        jMap: rows.map(r => ({ district:r.district, wing:r.wing, tehsil:r.tehsil, markaz:r.markaz, emis:r.emis })),
        schools: [],  // lazy-loaded via getSchoolsListForScope
      };
    }

    case 'getSchoolsListForScope': {
      const [pub, priv] = await Promise.all([
        _fetchAllRows('public_schools', 'emis, school_name, district, wing, tehsil, markaz_name, status'),
        _fetchAllRows('private_schools', 'unique_id, school_name, district, tehsil, markaz_name, status'),
      ]);
      const pubSchools  = pub.map(r => ({ emis:r.emis,   name:r.school_name, district:r.district, wing:r.wing,  tehsil:r.tehsil, markaz:r.markaz_name, sheet:'Public',  status:r.status }));
      const privSchools = priv.map(r => ({ uid:r.unique_id, name:r.school_name, district:r.district, wing:null, tehsil:r.tehsil, markaz:r.markaz_name, sheet:'Private', status:r.status }));
      return { success: true, schools: [...pubSchools, ...privSchools] };
    }

    // ── ADMIN — KPI CARDS ─────────────────────────────────────────────
    case 'getKpiCardsAdmin': {
      const { data, error } = await _sb.from('kpi_cards').select('*').order('display_order');
      if (error) return { success: false, message: error.message };
      const headers = ['Card Title','Card Icon','Card Color','Card Description','Action Type','Action Value','Display Order','Module','Scope Type','Scope Value','Scope District','Scope Wing','Scope Tehsil','Scope Markaz','Active'];
      const mapped = (data||[]).map(c => ({
        'Card Title':       c.card_title       || '',
        'Card Icon':        c.card_icon        || '',
        'Card Color':       c.card_color       || '',
        'Card Description': c.card_description || '',
        'Action Type':      c.action_type      || '',
        'Action Value':     c.action_value     || '',
        'Display Order':    c.display_order    || '',
        'Module':           c.module || 'dashboard',
        'Scope Type':       c.jurisdiction_scope_type  || 'All',
        'Scope Value':      c.jurisdiction_scope_value || '',
        'Scope District':   c.scope_district || '',
        'Scope Wing':       c.scope_wing     || '',
        'Scope Tehsil':     c.scope_tehsil   || '',
        'Scope Markaz':     c.scope_markaz   || '',
        'Active':           c.active === false ? 'No' : 'Yes',
        _id: c.id,
      }));
      return { success: true, headers, data: mapped };
    }

    case 'saveKpiCard': {
      const arr = Array.isArray(payload) ? payload : [payload];
      const p = arr[0] || {};
      const id = p._id || arr[1] || null;   // admin.js sends (rowData, rowId, currentUser)

      // ── Server-side hierarchy validation (mirrors the frontend rules) ──
      // District-level KPI  -> District required
      // Wing-level KPI      -> District + Wing required
      // Tehsil-level KPI    -> District + Wing + Tehsil required
      // Markaz-level KPI    -> District + Wing + Tehsil + Markaz required
      const scopeType = p['Scope Type'] || 'All';
      const scopeDistrict = (p['Scope District'] || '').trim();
      const scopeWing      = (p['Scope Wing']     || '').trim();
      const scopeTehsil    = (p['Scope Tehsil']   || '').trim();
      const scopeMarkaz    = (p['Scope Markaz']   || '').trim();
      const requiredByType = {
        District: ['District'],
        Wing:     ['District', 'Wing'],
        Tehsil:   ['District', 'Wing', 'Tehsil'],
        Markaz:   ['District', 'Wing', 'Tehsil', 'Markaz'],
      };
      if (requiredByType[scopeType]) {
        const values = { District: scopeDistrict, Wing: scopeWing, Tehsil: scopeTehsil, Markaz: scopeMarkaz };
        const missing = requiredByType[scopeType].filter(lvl => !values[lvl]);
        if (missing.length) {
          return { success: false, message: `Missing required location for a ${scopeType}-level card: ${missing.join(', ')}.` };
        }
      }

      const dbRow = {
        card_title:       p['Card Title']       || '',
        card_icon:        p['Card Icon']        || '',
        card_color:       p['Card Color']       || '',
        card_description: p['Card Description'] || '',
        action_type:      p['Action Type']      || 'module',
        action_value:     p['Action Value']     || '',
        display_order:    parseInt(p['Display Order']) || 99,
        module:           p['Module'] || 'dashboard',
        jurisdiction_scope_type:  scopeType,
        jurisdiction_scope_value: p['Scope Value'] || (scopeMarkaz || scopeTehsil || scopeWing || scopeDistrict) || '',
        scope_district:   scopeType === 'All' ? '' : scopeDistrict,
        scope_wing:       (scopeType === 'Wing' || scopeType === 'Tehsil' || scopeType === 'Markaz') ? scopeWing : '',
        scope_tehsil:     (scopeType === 'Tehsil' || scopeType === 'Markaz') ? scopeTehsil : '',
        scope_markaz:     scopeType === 'Markaz' ? scopeMarkaz : '',
        active:           p['Active'] === 'No' ? false : true,
      };
      if (id) {
        const r = await _checkedUpdate('kpi_cards', dbRow, 'id', id);
        if (!r.ok) return { success: false, message: r.message };
      } else {
        const { error } = await _sb.from('kpi_cards').insert([dbRow]);
        if (error) return { success: false, message: error.message };
      }
      return { success: true, message: 'KPI card saved.' };
    }

    case 'deleteKpiCard': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const id = p?._id || p?.id || p;
      const r = await _checkedDelete('kpi_cards', 'id', id);
      if (!r.ok) return { success: false, message: r.message };
      return { success: true, message: 'KPI card deleted.' };
    }

// Same District/Wing/Tehsil/Markaz "who can see this" rules as KPI
// Cards, shared here so Links & Apps and Tools Manager saves enforce
// the identical required-selection rule server-side:
//   District level -> District
//   Wing level     -> District + Wing
//   Tehsil level    -> District + Wing + Tehsil
//   Markaz level    -> District + Wing + Tehsil + Markaz
function _validateHierarchyScope(p) {
  const scopeType = p['Scope Type'] || 'All';
  const requiredByType = {
    District: ['Scope District'],
    Wing:     ['Scope District', 'Scope Wing'],
    Tehsil:   ['Scope District', 'Scope Wing', 'Scope Tehsil'],
    Markaz:   ['Scope District', 'Scope Wing', 'Scope Tehsil', 'Scope Markaz'],
  };
  if (!requiredByType[scopeType]) return null;
  const missing = requiredByType[scopeType].filter(f => !(p[f] || '').trim());
  if (missing.length) {
    return `Missing required location for a ${scopeType}-level visibility scope: ${missing.map(f => f.replace('Scope ', '')).join(', ')}.`;
  }
  return null;
}

function _hierarchyScopeDbFields(p) {
  const scopeType = p['Scope Type'] || 'All';
  return {
    visibility_scope_type: scopeType,
    scope_district: scopeType === 'All' ? '' : (p['Scope District'] || ''),
    scope_wing:     ['Wing','Tehsil','Markaz'].includes(scopeType) ? (p['Scope Wing'] || '') : '',
    scope_tehsil:   ['Tehsil','Markaz'].includes(scopeType) ? (p['Scope Tehsil'] || '') : '',
    scope_markaz:   scopeType === 'Markaz' ? (p['Scope Markaz'] || '') : '',
  };
}

// ── ADMIN — LINKS & APPS ──────────────────────────────────────────
    case 'getLinksAppsAdmin': {
      const { data, error } = await _sb.from('links_apps').select('*');
      if (error) return { success: false, message: error.message };
      const headers = ['Link Name','Link URL','App Name','App URL','App Category','Link Category'];
      const mapped = (data||[]).map(r => ({
        'Link Name':     r.link_name     || '',
        'Link URL':      r.link_url      || '',
        'App Name':      r.app_name      || '',
        'App URL':       r.app_url       || '',
        'App Category':  r.app_category  || '',
        'Link Category': r.link_category || '',
        'Scope Type':     r.visibility_scope_type || 'All',
        'Scope District': r.scope_district || '',
        'Scope Wing':     r.scope_wing     || '',
        'Scope Tehsil':   r.scope_tehsil   || '',
        'Scope Markaz':   r.scope_markaz   || '',
        _id: r.id,
      }));
      return { success: true, headers, data: mapped };
    }

    case 'saveLinksAppsRow': {
      const arr = Array.isArray(payload) ? payload : [payload];
      const p = arr[0] || {};
      const id = p._id || arr[1] || null;   // admin.js sends (obj, rowId, currentUser)

      const scopeErr = _validateHierarchyScope(p);
      if (scopeErr) return { success: false, message: scopeErr };

      const dbRow = {
        link_name:     p['Link Name']     || p[0] || '',
        link_url:      p['Link URL']      || p[1] || '',
        app_name:      p['App Name']      || p[2] || '',
        app_url:       p['App URL']       || p[3] || '',
        app_category:  p['App Category']  || p[4] || '',
        link_category: p['Link Category'] || p[5] || '',
        ..._hierarchyScopeDbFields(p),
      };
      if (id) {
        const r = await _checkedUpdate('links_apps', dbRow, 'id', id);
        if (!r.ok) return { success: false, message: r.message };
      } else {
        const { error } = await _sb.from('links_apps').insert([dbRow]);
        if (error) return { success: false, message: error.message };
      }
      return { success: true, message: 'Link/App saved.' };
    }

    case 'deleteLinksAppsRow': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const id = p?._id || p?.id || p;
      const r = await _checkedDelete('links_apps', 'id', id);
      if (!r.ok) return { success: false, message: r.message };
      return { success: true, message: 'Link/App deleted.' };
    }

    // ── ADMIN — TOOLS ─────────────────────────────────────────────────
    case 'getToolsAdmin': {
      const { data, error } = await _sb.from('tools').select('*');
      if (error) return { success: false, message: error.message };
      const headers = ['Tool Name','Tool URL'];
      const mapped = (data||[]).map(r => ({
        'Tool Name': r.tool_name || '',
        'Tool URL':  r.tool_url  || '',
        'Scope Type':     r.visibility_scope_type || 'All',
        'Scope District': r.scope_district || '',
        'Scope Wing':     r.scope_wing     || '',
        'Scope Tehsil':   r.scope_tehsil   || '',
        'Scope Markaz':   r.scope_markaz   || '',
        _id: r.id,
      }));
      return { success: true, headers, data: mapped };
    }

    case 'saveToolRow': {
      const arr = Array.isArray(payload) ? payload : [payload];
      const p = arr[0] || {};
      const id = p._id || arr[1] || null;   // admin.js sends (obj, rowId, currentUser)

      const scopeErr = _validateHierarchyScope(p);
      if (scopeErr) return { success: false, message: scopeErr };

      const dbRow = {
        tool_name: p['Tool Name'] || p[0] || '',
        tool_url:  p['Tool URL']  || p[1] || '',
        ..._hierarchyScopeDbFields(p),
      };
      if (id) {
        const r = await _checkedUpdate('tools', dbRow, 'id', id);
        if (!r.ok) return { success: false, message: r.message };
      } else {
        const { error } = await _sb.from('tools').insert([dbRow]);
        if (error) return { success: false, message: error.message };
      }
      return { success: true, message: 'Tool saved.' };
    }

    case 'deleteToolRow': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const id = p?._id || p?.id || p;
      const r = await _checkedDelete('tools', 'id', id);
      if (!r.ok) return { success: false, message: r.message };
      return { success: true, message: 'Tool deleted.' };
    }

    // ── GENERAL MANAGEMENT — simple name lookup lists ──────────────────
    // Staff Designations (Staff Form) and Private School Categories
    // (Private School form) are both just an admin-managed name list —
    // same shape, same CRUD, just two different tables — so one small
    // set of generic helpers backs both instead of duplicating logic.
    case 'getStaffDesignations':
    case 'getPrivateCategories': {
      const table = action === 'getStaffDesignations' ? 'staff_designations' : 'private_school_categories';
      let q = _sb.from(table).select('*').eq('active', true);
      // Designations are always A–Z automatically — no manual ordering
      // field for these. Categories keep their manual display_order.
      q = table === 'staff_designations' ? q.order('name') : q.order('display_order');
      // Teaching vs Non-Teaching split (Designation Synchronization):
      // the Staff Form's "Staff Category" dropdown and Seat Management's
      // teaching/non_teaching seat category both filter designations
      // through this same param, so there's still exactly one list —
      // just scoped by category instead of duplicated per category.
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      if (table === 'staff_designations' && p && p.category) {
        q = q.eq('category', p.category);
      }
      const { data, error } = await q;
      if (error) return { success: false, message: error.message };
      return { success: true, items: (data || []).map(r => r.name) };
    }

    // Name → category map for every designation (active or not), so
    // the Staff Form can infer an existing employee's Teaching /
    // Non-Teaching category from their already-saved Designation
    // without needing that category stored separately on the staff row.
    case 'getDesignationCategoryMap': {
      const { data, error } = await _sb.from('staff_designations').select('name, category');
      if (error) return { success: false, message: error.message };
      const map = {};
      (data || []).forEach(r => { map[r.name] = r.category || 'teaching'; });
      return { success: true, map };
    }

    case 'getStaffDesignationsAdmin':
    case 'getPrivateCategoriesAdmin': {
      const table = action === 'getStaffDesignationsAdmin' ? 'staff_designations' : 'private_school_categories';
      let q = _sb.from(table).select('*');
      q = table === 'staff_designations' ? q.order('name') : q.order('display_order');
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      if (table === 'staff_designations' && p && p.category) {
        q = q.eq('category', p.category);
      }
      const { data, error } = await q;
      if (error) return { success: false, message: error.message };
      const headers = table === 'staff_designations' ? ['Name', 'Active'] : ['Name', 'Display Order', 'Active'];
      const mapped = (data || []).map(r => ({
        'Name': r.name || '',
        'Display Order': r.display_order || 99,
        'Active': r.active === false ? 'No' : 'Yes',
        'Category': r.category || 'teaching',
        _id: r.id,
      }));
      return { success: true, headers, data: mapped };
    }

    case 'saveDesignationRow':
    case 'saveCategoryRow': {
      const table = action === 'saveDesignationRow' ? 'staff_designations' : 'private_school_categories';
      const arr = Array.isArray(payload) ? payload : [payload];
      const p = arr[0] || {};
      const id = p._id || arr[1] || null;
      const name = (p['Name'] || '').trim();
      if (!name) return { success: false, message: 'Name is required.' };

      // Designations are always kept alphabetical automatically — no
      // manual "Display Order" input for these; display_order is left
      // at a constant placeholder since nothing reads it for this
      // table anymore (both queries above sort by name instead).
      // Category ('teaching'/'non_teaching') is fixed by which admin
      // sub-tab the row was added/edited from — the panel is scoped to
      // one category at a time, so there's no separate picker for it.
      const dbRow = table === 'staff_designations'
        ? { name, active: p['Active'] === 'No' ? false : true, category: p['Category'] === 'non_teaching' ? 'non_teaching' : 'teaching' }
        : { name, display_order: parseInt(p['Display Order']) || 99, active: p['Active'] === 'No' ? false : true };
      if (id) {
        const r = await _checkedUpdate(table, dbRow, 'id', id);
        if (!r.ok) return { success: false, message: r.message };
      } else {
        const { data: dupe } = await _sb.from(table).select('id').ilike('name', name).maybeSingle();
        if (dupe) return { success: false, message: `"${name}" already exists.` };
        const { error } = await _sb.from(table).insert([dbRow]);
        if (error) return { success: false, message: error.message };
      }
      return { success: true, message: 'Saved.' };
    }

    case 'deleteDesignationRow':
    case 'deleteCategoryRow': {
      const table = action === 'deleteDesignationRow' ? 'staff_designations' : 'private_school_categories';
      const p = Array.isArray(payload) ? payload[0] : payload;
      const id = p?._id || p?.id || p;
      const r = await _checkedDelete(table, 'id', id);
      if (!r.ok) return { success: false, message: r.message };
      return { success: true, message: 'Deleted.' };
    }

    // ── POSTING AWAITING STAFF ──────────────────────────────────────────
    case 'loadAwaitingPosting': {
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      let q = _sb.from('staff_awaiting_posting')
        .select('*, staff(name_of_teacher, cnic, designation, bps)')
        .order('entry_date', { ascending: false });
      if (p.status) q = q.eq('status', p.status);
      else if (!('status' in p)) q = q.eq('status', 'awaiting'); // default view; explicit '' means "All"
      if (p.reason) q = q.eq('reason', p.reason);
      if (p.district) q = q.eq('previous_district', p.district);
      if (p.wing) q = q.eq('previous_wing', p.wing);
      if (p.tehsil) q = q.eq('previous_tehsil', p.tehsil);
      if (p.markaz) q = q.eq('previous_markaz', p.markaz);
      const { data, error } = await q;
      if (error) return { success: false, message: error.message };
      let rows = data || [];
      if (p.keyword) {
        const kw = p.keyword.trim().toLowerCase();
        rows = rows.filter(r =>
          (r.staff?.name_of_teacher || '').toLowerCase().includes(kw) ||
          (r.personal_no || '').toLowerCase().includes(kw) ||
          (r.staff?.cnic || '').toLowerCase().includes(kw));
      }
      return { success: true, rows };
    }

    case 'revertAwaitingPostingAssignment': {
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const { data, error } = await _sb.rpc('revert_awaiting_posting_assignment', { p_event_id: p.eventId });
      if (error) return { success: false, message: error.message };
      return data;
    }

    case 'assignAwaitingStaffToSchool': {
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const { data, error } = await _sb.rpc('assign_awaiting_staff_to_school', {
        p_awaiting_id: p.awaitingId,
        p_target_emis: p.targetEmis,
        p_order_number: p.orderNumber || null,
        p_order_date: p.orderDate || null,
      });
      if (error) return { success: false, message: error.message };
      return data; // RPC already returns {success, message}
    }

    // ── TEMPORARY DUTY ───────────────────────────────────────────────────
    // Lightweight counts for the HR dashboard summary cards — RLS on
    // both tables already scopes these to the signed-in user's own
    // jurisdiction (and to editors/admins only), same as every other
    // read of these two tables, so no extra client-side filtering is
    // needed here.
    // Main-dashboard notification bell — every user-visible automatic
    // change the SYSTEM made on its own (not a manual HR action):
    //   • a school marked outsourced/closed moving its staff into
    //     Awaiting Posting (staff_awaiting_posting reason column)
    //   • any other reason a staff member landed in Awaiting Posting
    //   • staff auto-retired at age 60 by the nightly job
    // RLS on staff_awaiting_posting/staff_events already scopes results
    // to what this user is allowed to see (editor/admin + jurisdiction),
    // same as everywhere else these tables are read.
    case 'getSystemNotifications': {
      const sinceIso = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString(); // last 60 days

      const [{ data: awaitingRows }, { data: retiredRows }] = await Promise.all([
        _sb.from('staff_awaiting_posting')
          .select('id, personal_no, previous_school_name, previous_district, previous_tehsil, previous_markaz, reason, remarks, entry_date, created_at, staff(name_of_teacher)')
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false }),
        _sb.from('staff_events')
          .select('id, personal_no, employee_name, created_at, details')
          .eq('event_type', 'retired')
          .eq('created_by', 'System (Auto - Age 60)')
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false }),
      ]);

      const AP_REASON_LABELS = {
        outsourced_school: 'School Outsourced', school_closed: 'School Closed', removed: 'Removed',
        transfer_completed: 'Transfer Completed', manual_revert: 'Manual Revert', manual: 'Manual',
      };
      const SYSTEM_REASONS = new Set(['outsourced_school', 'school_closed']); // system-DRIVEN moves specifically

      const notifications = [];
      (awaitingRows || []).forEach(r => {
        const isSystemDriven = SYSTEM_REASONS.has(r.reason);
        notifications.push({
          id: 'ap_' + r.id,
          category: isSystemDriven ? 'school_change' : 'awaiting_posting',
          title: isSystemDriven
            ? `School ${AP_REASON_LABELS[r.reason] || r.reason}: ${r.previous_school_name || 'a school'}`
            : `${(r.staff || {}).name_of_teacher || r.personal_no} moved to Awaiting Posting`,
          detail: `${(r.staff || {}).name_of_teacher || r.personal_no} — was at ${r.previous_school_name || '—'} ` +
                   `(${[r.previous_markaz, r.previous_tehsil, r.previous_district].filter(Boolean).join(', ') || '—'}). ` +
                   `Reason: ${AP_REASON_LABELS[r.reason] || r.reason || 'Not specified'}.${r.remarks ? ' ' + r.remarks : ''}`,
          time: r.created_at || r.entry_date,
        });
      });
      (retiredRows || []).forEach(e => {
        const d = e.details || {};
        notifications.push({
          id: 'rt_' + e.id,
          category: 'auto_retired',
          title: `${e.employee_name || e.personal_no} auto-retired by system`,
          detail: `${e.employee_name || e.personal_no} reached retirement age and was automatically moved to Retired status` +
                   (d.effective_date ? ` effective ${d.effective_date}.` : '.'),
          time: e.created_at,
        });
      });

      notifications.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
      return { success: true, notifications };
    }

    case 'getHrSummaryCounts': {
      const [{ count: awaitingCount, error: e1 }, { count: tdActiveCount, error: e2 }] = await Promise.all([
        _sb.from('staff_awaiting_posting').select('id', { count: 'exact', head: true })
          .in('status', ['awaiting', 'on_temporary_duty']),
        _sb.from('staff_temporary_duty').select('id', { count: 'exact', head: true })
          .eq('status', 'active'),
      ]);
      if (e1 || e2) return { success: false, message: (e1 || e2).message };
      return { success: true, awaitingCount: awaitingCount || 0, tdActiveCount: tdActiveCount || 0 };
    }

    case 'loadTemporaryDuty': {
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      let q = _sb.from('staff_temporary_duty')
        .select('*, staff(name_of_teacher, designation, bps)')
        .order('start_date', { ascending: false });
      if (p.status) q = q.eq('status', p.status);
      const { data, error } = await q;
      if (error) return { success: false, message: error.message };
      let rows = data || [];
      if (p.keyword) {
        const kw = p.keyword.trim().toLowerCase();
        rows = rows.filter(r =>
          (r.staff?.name_of_teacher || '').toLowerCase().includes(kw) ||
          (r.personal_no || '').toLowerCase().includes(kw));
      }
      return { success: true, rows };
    }

    case 'createTemporaryDuty': {
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const { data, error } = await _sb.rpc('create_temporary_duty', {
        p_personal_no: p.personalNo,
        p_temp_emis: p.tempEmis,
        p_start_date: p.startDate,
        p_end_date: p.endDate || null,
        p_reason: p.reason || null,
        p_remarks: p.remarks || null,
        p_order_number: p.orderNumber || null,
        p_order_date: p.orderDate || null,
        p_awaiting_id: p.awaitingId || null,
      });
      if (error) return { success: false, message: error.message };
      return data;
    }

    case 'completeTemporaryDuty':
    case 'cancelTemporaryDuty': {
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const fn = action === 'completeTemporaryDuty' ? 'complete_temporary_duty' : 'cancel_temporary_duty';
      const { data, error } = await _sb.rpc(fn, { p_td_id: p.tdId });
      if (error) return { success: false, message: error.message };
      return data;
    }

    case 'searchSchoolsForAssignment': {
      const p = Array.isArray(payload) ? payload[0] : (payload || {});
      const kw = (p.keyword || '').trim();
      const isEmis = /^\d+$/.test(kw);
      // EMIS codes are 8 digits, but within one tehsil the first several
      // digits are usually shared — waiting for the full 8 before
      // showing anything meant nothing appeared until the very last
      // keystroke. Once 7+ digits are typed, search by prefix instead
      // of requiring an exact match, so results (often just one) show
      // up a keystroke early and the person can pick before finishing.
      if (isEmis && kw.length < 7) return { success: true, rows: [] };
      if (!isEmis && kw.length < 2) return { success: true, rows: [] };
      const [pubRes, privRes] = await Promise.all([
        isEmis
          ? _sb.from('public_schools').select('emis, school_name, district, wing, tehsil, markaz_name').like('emis', `${kw}%`).limit(10)
          : _sb.from('public_schools').select('emis, school_name, district, wing, tehsil, markaz_name').ilike('school_name', `%${kw}%`).limit(10),
        isEmis
          ? _sb.from('private_schools').select('emis, school_name, district, tehsil, markaz_name').like('emis', `${kw}%`).limit(10)
          : _sb.from('private_schools').select('emis, school_name, district, tehsil, markaz_name').ilike('school_name', `%${kw}%`).limit(10),
      ]);
      const rows = [
        ...(pubRes.data || []).map(r => ({ ...r, wing: r.wing || '' })),
        ...(privRes.data || []).map(r => ({ ...r, wing: '' })),
      ];
      return { success: true, rows };
    }

    // ── FALLTHROUGH ───────────────────────────────────────────────────
    default:
      console.warn(`[api.js] Unknown action: "${action}"`);
      return { success: false, message: `Unknown API action: "${action}"` };
  }
}

// =====================================================================
//  google.script.run SHIM  —  identical to original api.js
//  All other JS files call google.script.run.xyz() — this intercepts
//  and routes through apiCall() above. ZERO changes in other files.
// =====================================================================
const google = {
  script: {
    get run() {
      let _onSuccess = () => {};
      let _onFailure = (err) => console.error('[api.js]', err);

      const handler = new Proxy(
        {
          withSuccessHandler(fn) {
            if (typeof fn === 'function') _onSuccess = fn;
            return handler;
          },
          withFailureHandler(fn) {
            if (typeof fn === 'function') _onFailure = fn;
            return handler;
          },
        },
        {
          get(target, prop) {
            if (prop in target) return target[prop];
            return (...args) => {
              const onSuccess = _onSuccess;
              const onFailure = _onFailure;
              const payload   = args.length === 0 ? undefined
                              : args.length === 1 ? args[0] : args;
              apiCall(prop, payload).then(onSuccess).catch(onFailure);
            };
          },
        }
      );
      return handler;
    },
  },
};
