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
      (!g.wing     || row.wing === g.wing) &&
      (!g.tehsil   || row.tehsil === g.tehsil) &&
      (!g.markaz   || row.markaz_name === g.markaz)
    );
  };
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
      // e.g. 'tools', 'hr', 'public_schools', 'private_schools', 'dispatch'.
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
      const statusMap = {
        'Staff':             'active',
        'Termination':       'terminated',
        'Retirement':        'retired',
        'Resignation':       'resigned',
        'Deceased':          'deceased',
        'Deleted_Archive':   'deleted',
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
      const district = (reqUser && reqUser.district || '').trim();

      const [staffRows, schoolRows] = await Promise.all([
        _fetchAllRows('staff', 'personal_no, name_of_teacher, designation, school_emis_code, school_name, markaz_name, tehsil, district, wing, status',
          q => q.order('name_of_teacher'), q => q.eq('status', 'active')),
        _fetchAllRows('public_schools', 'emis', null, null, 'emis'),
      ]);

      const validEmis = new Set(
        (schoolRows || []).map(r => String(r.emis || '').trim().toLowerCase()).filter(Boolean)
      );

      const scopedStaff = (isAdmin || !district)
        ? (staffRows || [])
        : (staffRows || []).filter(r => (r.district || '').trim() === district);

      const missing = scopedStaff.filter(r => {
        const emis = String(r.school_emis_code || '').trim().toLowerCase();
        return !emis || !validEmis.has(emis);
      });

      const { headers, rows } = _toHeadersRows(missing, STAFF_COL_MAP);
      return { success: true, headers, rows, count: missing.length };
    }

    // SNE (Sanctioned/Filled/Vacant) grade-wise summary per school, used
    // by the "Download SNE" button in the HR module. Sanctioned figures
    // come from sne_subject_sanctioned (uploaded per Excel); filled
    // figures are always computed live from active staff records.
    //
    // Filters are pushed down to the DB query (not fetched-then-filtered
    // in JS) — public_schools has 38k+ rows nationwide, so pulling
    // everything before scoping it down was the cause of the export
    // hanging on slower connections. Non-admins are scoped to their own
    // district by default even with no explicit filter selected.
    case 'getSneSummary': {
      const args    = Array.isArray(payload) ? payload : [payload];
      const reqUser = args[0] || user;
      const filters = args[1] || {};
      const isAdmin = !reqUser || String(reqUser.role || '').toLowerCase() === 'admin';

      const data = await _fetchAllRows('sne_summary', '*', q => {
        if (filters.district) q = q.eq('district', filters.district);
        else if (!isAdmin && reqUser?.district) q = q.eq('district', reqUser.district);
        if (filters.wing)   q = q.eq('wing', filters.wing);
        if (filters.tehsil) q = q.eq('tehsil', filters.tehsil);
        if (filters.markaz) q = q.eq('markaz_name', filters.markaz);
        if (filters.emis)   q = q.eq('emis', filters.emis);
        return q;
      }, null, 'emis');

      const filterFn = _buildUserSchoolFilter(reqUser, { idKey: 'emis' });
      const visible = filterFn ? (data || []).filter(filterFn) : (data || []);
      return { success: true, rows: visible };
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

    case 'revertToActiveStaff': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const pno = p.personalNo || p['PERSONAL NO.'] || p.personal_no;
      const { data: s } = await _sb.from('staff').select('name_of_teacher, status, changes_made_at').eq('personal_no', pno).single();
      if (!s) return { success: false, error: `No staff record found for personal number "${pno}".` };

      // Non-admins can only revert within 24 hours of the action that
      // needs undoing — admins have no time restriction at all.
      if (!user || String(user.role || '').toLowerCase() !== 'admin') {
        const changedAt = s.changes_made_at ? new Date(s.changes_made_at) : null;
        const hoursSince = changedAt ? (Date.now() - changedAt.getTime()) / (1000 * 60 * 60) : Infinity;
        if (hoursSince > 24) {
          return {
            success: false,
            error: 'This action can no longer be reverted — it was made more than 24 hours ago. ' +
                   'Please contact an admin, who can revert it at any time.',
          };
        }
      }

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
        email:       data.email,
        designation: data.designation,
        district:    data.district,
        wing:        data.wing,
        tehsil:      data.tehsil,
        markaz_name: data.markaz_name,
        markaz_name_ur: data.markaz_name_ur,
        designation_ur: data.designation_ur,
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

    case 'saveUser': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const reverseMap = Object.fromEntries(Object.entries(USER_COL_MAP).map(([c,h])=>[h,c]));
      const dbRow = {};
      for (const [h, v] of Object.entries(p)) {
        if (h === 'Password') continue;  // never write plaintext passwords to app_users
        if (h === '_id') continue;       // internal field, not a real column
        const col = reverseMap[h] || h;
        dbRow[col] = v;
      }
      const newPassword = p['Password'] || '';
      const cnic = dbRow.cnic;

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
        if (result && result.success && dbRow.email) {
          const newId = result.userId || result.id || (result.user && result.user.id);
          if (newId) {
            await _sb.from('app_users').update({ email: dbRow.email }).eq('id', newId);
          }
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
      const { data, error } = await _sb.from(table).select('*').eq('active', true).order('display_order');
      if (error) return { success: false, message: error.message };
      return { success: true, items: (data || []).map(r => r.name) };
    }

    case 'getStaffDesignationsAdmin':
    case 'getPrivateCategoriesAdmin': {
      const table = action === 'getStaffDesignationsAdmin' ? 'staff_designations' : 'private_school_categories';
      const { data, error } = await _sb.from(table).select('*').order('display_order');
      if (error) return { success: false, message: error.message };
      const headers = ['Name', 'Display Order', 'Active'];
      const mapped = (data || []).map(r => ({
        'Name': r.name || '',
        'Display Order': r.display_order || 99,
        'Active': r.active === false ? 'No' : 'Yes',
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

      const dbRow = {
        name,
        display_order: parseInt(p['Display Order']) || 99,
        active: p['Active'] === 'No' ? false : true,
      };
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
