// =====================================================================
//  API.JS  —  Supabase backend (replaces Apps Script + Google Sheets)
//  Drop-in replacement: same google.script.run interface, same apiCall()
//  signature. No changes needed to any other JS file.
//
//  LOAD ORDER in index.html:
//    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//    <script src="config.js"></script>
//    <script src="js/api.js"></script>   ← this file
//    ... rest of your JS files unchanged ...
// =====================================================================

// ── Supabase client singleton ────────────────────────────────────────
const _supabase = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);

// Expose globally so other files can use it if needed
window._supabase = _supabase;

// ── Session helpers ──────────────────────────────────────────────────
function _getUser() {
  try {
    const raw = localStorage.getItem(CONFIG.SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function _saveUser(user) {
  localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(user));
}

// =====================================================================
//  MAIN API DISPATCHER
//  Maps action names to Supabase queries.
//  Same interface as the old Apps Script dispatcher.
// =====================================================================
async function apiCall(action, payload) {
  const user = _getUser();

  switch (action) {

    // ── AUTH ──────────────────────────────────────────────────────────
    case 'login': {
      const { cnic, password } = payload;
      // Lookup placeholder email from CNIC
      const { data: profile } = await _supabase
        .from('app_users')
        .select('cnic')
        .eq('cnic', cnic)
        .single();
      if (!profile) throw new Error('User not found');

      const placeholderEmail = `${cnic}@placeholder.internal`;
      const { data: authData, error } = await _supabase.auth
        .signInWithPassword({ email: placeholderEmail, password });
      if (error) throw new Error('Invalid CNIC or password');

      // Fetch full profile
      const { data: fullProfile } = await _supabase
        .from('app_users')
        .select('*')
        .eq('id', authData.user.id)
        .single();

      _saveUser({ ...fullProfile, _authId: authData.user.id });
      return fullProfile;
    }

    case 'logout': {
      await _supabase.auth.signOut();
      localStorage.removeItem(CONFIG.SESSION_KEY);
      return { success: true };
    }

    case 'changePassword': {
      const { newPassword } = payload;
      const { error } = await _supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
      return { success: true };
    }

    case 'updateEmail': {
      const { email } = payload;
      const { error } = await _supabase.auth.updateUser({ email });
      if (error) throw new Error(error.message);
      return { success: true };
    }

    // ── DASHBOARD ─────────────────────────────────────────────────────
    case 'getSummaryCounts': {
      const [staff, pub, priv] = await Promise.all([
        _supabase.from('staff').select('status', { count: 'exact', head: false }),
        _supabase.from('public_schools').select('status', { count: 'exact', head: false }),
        _supabase.from('private_schools').select('status', { count: 'exact', head: false }),
      ]);
      // Group by status
      const count = (rows, status) =>
        rows?.filter(r => r.status === status).length ?? 0;
      return {
        totalStaff:          staff.data?.length ?? 0,
        activeStaff:         count(staff.data, 'active'),
        totalPublicSchools:  pub.data?.length ?? 0,
        totalPrivateSchools: priv.data?.length ?? 0,
        activePrivate:       count(priv.data, 'Active'),
        inactivePrivate:     count(priv.data, 'Inactive'),
      };
    }

    case 'getKpiCards': {
      const { data, error } = await _supabase
        .from('kpi_cards')
        .select('*')
        .eq('active', true)
        .order('display_order');
      if (error) throw error;
      return data;
    }

    case 'getLinksAndApps': {
      const { data, error } = await _supabase
        .from('links_apps')
        .select('*');
      if (error) throw error;
      return data;
    }

    case 'getToolsUser': {
      const { data, error } = await _supabase
        .from('tools')
        .select('*');
      if (error) throw error;
      return data;
    }

    // ── SCHOOL HIERARCHY (dropdowns) ──────────────────────────────────
    case 'getSchoolHierarchy': {
      const { data, error } = await _supabase
        .from('schools')
        .select('district, wing, tehsil, markaz, emis, school_name, level, type, area')
        .order('district').order('wing').order('tehsil').order('markaz');
      if (error) throw error;
      return data;
    }

    case 'getSchoolHierarchyForUser': {
      // Same as getSchoolHierarchy but RLS scopes it to user's jurisdiction automatically
      const { data, error } = await _supabase
        .from('schools')
        .select('district, wing, tehsil, markaz, emis, school_name, level, type, area')
        .order('district').order('wing').order('tehsil').order('markaz');
      if (error) throw error;
      return data;
    }

    // ── HR STAFF ──────────────────────────────────────────────────────
    case 'loadSheetForClient': {
      // payload: ['Staff', user] or ['Staff', user, filters]
      const { data, error } = await _supabase
        .from('staff')
        .select('*')
        .eq('status', 'active')
        .order('name_of_teacher');
      if (error) throw error;
      return { values: data };
    }

    case 'addStaffRow': {
      const { data, error } = await _supabase
        .from('staff')
        .insert([{ ...payload, status: 'active', changes_made_by: user?.name, changes_made_at: new Date().toISOString() }])
        .select()
        .single();
      if (error) throw error;
      // Log event
      await _supabase.from('staff_events').insert([{
        personal_no: data.personal_no,
        employee_name: data.name_of_teacher,
        event_type: 'create',
        created_by: user?.name,
      }]);
      return { success: true, data };
    }

    case 'updateStaffRow': {
      const { personal_no, ...fields } = payload;
      const { data, error } = await _supabase
        .from('staff')
        .update({ ...fields, changes_made_by: user?.name, changes_made_at: new Date().toISOString() })
        .eq('personal_no', personal_no)
        .select()
        .single();
      if (error) throw error;
      await _supabase.from('staff_events').insert([{
        personal_no,
        employee_name: data.name_of_teacher,
        event_type: 'update',
        created_by: user?.name,
        details: { updated_fields: Object.keys(fields) },
      }]);
      return { success: true };
    }

    case 'deleteStaffRow': {
      const { personal_no, reason } = payload;
      const { data } = await _supabase.from('staff').select('name_of_teacher').eq('personal_no', personal_no).single();
      await _supabase.from('staff').update({ status: 'deleted', changes_made_by: user?.name, changes_made_at: new Date().toISOString() }).eq('personal_no', personal_no);
      await _supabase.from('staff_events').insert([{
        personal_no,
        employee_name: data?.name_of_teacher,
        event_type: 'delete',
        details: { reason },
        created_by: user?.name,
      }]);
      return { success: true };
    }

    case 'executeTransfer': {
      const { personal_no, notification_no, effective_date, from_emis, to_emis,
              to_markaz, to_tehsil, to_district, to_wing, transfer_type,
              date_of_joining_new_school } = payload;
      // Update staff's current posting
      await _supabase.from('staff').update({
        school_emis_code: to_emis,
        markaz_name: to_markaz,
        tehsil: to_tehsil,
        district: to_district,
        wing: to_wing,
        date_of_posting_present_school: date_of_joining_new_school,
        status: 'active',
        changes_made_by: user?.name,
        changes_made_at: new Date().toISOString(),
      }).eq('personal_no', personal_no);
      // Log the event
      const { data: staffRow } = await _supabase.from('staff').select('name_of_teacher').eq('personal_no', personal_no).single();
      await _supabase.from('staff_events').insert([{
        personal_no,
        employee_name: staffRow?.name_of_teacher,
        event_type: 'transfer',
        notification_no,
        effective_date,
        details: { from_emis, to_emis, to_markaz, to_tehsil, to_district, transfer_type, date_of_joining_new_school },
        created_by: user?.name,
      }]);
      return { success: true };
    }

    case 'executePromotion': {
      const { personal_no, notification_no, effective_date, new_designation, new_bps } = payload;
      const { data: staffRow } = await _supabase.from('staff').select('designation, bps, name_of_teacher').eq('personal_no', personal_no).single();
      await _supabase.from('staff').update({
        designation: new_designation,
        bps: new_bps,
        date_of_joining_present_scale: effective_date,
        changes_made_by: user?.name,
        changes_made_at: new Date().toISOString(),
      }).eq('personal_no', personal_no);
      await _supabase.from('staff_events').insert([{
        personal_no,
        employee_name: staffRow?.name_of_teacher,
        event_type: 'promotion',
        notification_no,
        effective_date,
        details: { old_designation: staffRow?.designation, new_designation, old_bps: staffRow?.bps, new_bps },
        created_by: user?.name,
      }]);
      return { success: true };
    }

    case 'executeStaffAction': {
      // Handles: retire, resign, terminate, deceased
      const { personal_no, action_type, notification_no, effective_date } = payload;
      const statusMap = { retire: 'retired', resign: 'resigned', terminate: 'terminated', deceased: 'deceased' };
      const new_status = statusMap[action_type] || action_type;
      const { data: staffRow } = await _supabase.from('staff').select('name_of_teacher').eq('personal_no', personal_no).single();
      await _supabase.from('staff').update({
        status: new_status,
        changes_made_by: user?.name,
        changes_made_at: new Date().toISOString(),
      }).eq('personal_no', personal_no);
      await _supabase.from('staff_events').insert([{
        personal_no,
        employee_name: staffRow?.name_of_teacher,
        event_type: new_status,
        notification_no,
        effective_date,
        created_by: user?.name,
      }]);
      return { success: true };
    }

    case 'revertToActiveStaff': {
      const { personal_no } = payload;
      const { data: staffRow } = await _supabase.from('staff').select('name_of_teacher, status').eq('personal_no', personal_no).single();
      await _supabase.from('staff').update({
        status: 'active',
        changes_made_by: user?.name,
        changes_made_at: new Date().toISOString(),
      }).eq('personal_no', personal_no);
      await _supabase.from('staff_events').insert([{
        personal_no,
        employee_name: staffRow?.name_of_teacher,
        event_type: 'revert',
        details: { reverted_from_status: staffRow?.status },
        created_by: user?.name,
      }]);
      return { success: true };
    }

    // ── DUPLICATE CHECKS ──────────────────────────────────────────────
    case 'checkCnicDuplicate': {
      const cnic = Array.isArray(payload) ? payload[0] : payload?.cnic;
      const excludePno = Array.isArray(payload) ? payload[1] : payload?.exclude_personal_no;
      let q = _supabase.from('staff').select('personal_no, name_of_teacher').eq('cnic', cnic);
      if (excludePno) q = q.neq('personal_no', excludePno);
      const { data } = await q;
      return { duplicate: data?.length > 0, existing: data?.[0] || null };
    }

    case 'checkIbanDuplicate': {
      const iban = Array.isArray(payload) ? payload[0] : payload?.iban;
      const excludePno = Array.isArray(payload) ? payload[1] : payload?.exclude_personal_no;
      let q = _supabase.from('staff').select('personal_no, name_of_teacher').eq('salary_account_iban_no', iban);
      if (excludePno) q = q.neq('personal_no', excludePno);
      const { data } = await q;
      return { duplicate: data?.length > 0, existing: data?.[0] || null };
    }

    case 'checkPersonalNoDuplicate': {
      const pno = Array.isArray(payload) ? payload[0] : payload?.personal_no;
      const { data } = await _supabase.from('staff').select('personal_no').eq('personal_no', pno);
      return { duplicate: data?.length > 0 };
    }

    // ── PUBLIC SCHOOLS ────────────────────────────────────────────────
    case 'getPublicDashboardData': {
      const status = Array.isArray(payload) ? payload[1] : (payload?.status || 'Active');
      const { data, error } = await _supabase
        .from('public_schools')
        .select('*')
        .eq('status', status)
        .order('school_name');
      if (error) throw error;
      return { values: data };
    }

    case 'savePublicSchool': {
      const { emis, ...fields } = payload;
      const { error } = await _supabase.from('public_schools').update({ ...fields, updated_at: new Date().toISOString() }).eq('emis', emis);
      if (error) throw error;
      return { success: true };
    }

    // ── PRIVATE SCHOOLS ───────────────────────────────────────────────
    case 'getPrivateDashboardData': {
      const status = Array.isArray(payload) ? payload[1] : (payload?.status || 'Active');
      const { data, error } = await _supabase
        .from('private_schools')
        .select('*')
        .eq('status', status)
        .order('school_name');
      if (error) throw error;
      return { values: data };
    }

    case 'savePrivateSchool': {
      const { unique_id, ...fields } = payload;
      if (unique_id) {
        // update
        const { error } = await _supabase.from('private_schools').update({ ...fields, updated_at: new Date().toISOString() }).eq('unique_id', unique_id);
        if (error) throw error;
      } else {
        // insert
        const { error } = await _supabase.from('private_schools').insert([{ ...fields, status: 'Active' }]);
        if (error) throw error;
      }
      return { success: true };
    }

    case 'searchExistingSchools': {
      const query = payload?.query || payload;
      const { data, error } = await _supabase
        .from('private_schools')
        .select('unique_id, school_name, district, tehsil, markaz_name, status')
        .ilike('school_name', `%${query}%`)
        .limit(20);
      if (error) throw error;
      return data;
    }

    // ── ADMIN — USERS ─────────────────────────────────────────────────
    case 'getUsers': {
      const { data, error } = await _supabase.from('app_users').select('*').order('name');
      if (error) throw error;
      return data;
    }

    case 'saveUser': {
      const { id, ...fields } = payload;
      if (id) {
        const { error } = await _supabase.from('app_users').update(fields).eq('id', id);
        if (error) throw error;
      } else {
        // New user — needs to be created via Auth too
        // For now, insert only the profile (Auth account creation requires admin flow)
        const { error } = await _supabase.from('app_users').insert([fields]);
        if (error) throw error;
      }
      return { success: true };
    }

    case 'deleteUser': {
      const { id } = payload;
      const { error } = await _supabase.from('app_users').delete().eq('id', id);
      if (error) throw error;
      // Note: deleting from auth.users requires service_role key — do via Supabase dashboard for now
      return { success: true };
    }

    // ── ADMIN — KPI CARDS ─────────────────────────────────────────────
    case 'getKpiCardsAdmin': {
      const { data, error } = await _supabase.from('kpi_cards').select('*').order('display_order');
      if (error) throw error;
      return data;
    }

    case 'saveKpiCard': {
      const { id, ...fields } = payload;
      if (id) {
        await _supabase.from('kpi_cards').update(fields).eq('id', id);
      } else {
        await _supabase.from('kpi_cards').insert([fields]);
      }
      return { success: true };
    }

    case 'deleteKpiCard': {
      const id = Array.isArray(payload) ? payload[0] : payload?.id;
      await _supabase.from('kpi_cards').delete().eq('id', id);
      return { success: true };
    }

    // ── ADMIN — LINKS & APPS ──────────────────────────────────────────
    case 'getLinksAppsAdmin': {
      const { data, error } = await _supabase.from('links_apps').select('*');
      if (error) throw error;
      return data;
    }

    case 'saveLinksAppsRow': {
      const { id, ...fields } = payload;
      if (id) {
        await _supabase.from('links_apps').update(fields).eq('id', id);
      } else {
        await _supabase.from('links_apps').insert([fields]);
      }
      return { success: true };
    }

    case 'deleteLinksAppsRow': {
      const id = Array.isArray(payload) ? payload[0] : payload?.id;
      await _supabase.from('links_apps').delete().eq('id', id);
      return { success: true };
    }

    // ── ADMIN — TOOLS ─────────────────────────────────────────────────
    case 'getToolsAdmin': {
      const { data, error } = await _supabase.from('tools').select('*');
      if (error) throw error;
      return data;
    }

    case 'saveToolRow': {
      const { id, ...fields } = payload;
      if (id) {
        await _supabase.from('tools').update(fields).eq('id', id);
      } else {
        await _supabase.from('tools').insert([fields]);
      }
      return { success: true };
    }

    case 'deleteToolRow': {
      const id = Array.isArray(payload) ? payload[0] : payload?.id;
      await _supabase.from('tools').delete().eq('id', id);
      return { success: true };
    }

    // ── ADMIN — SCOPE / JURISDICTION ──────────────────────────────────
    case 'getJurisdictionDropdownData':
    case 'getSchoolsListForScope': {
      const { data, error } = await _supabase
        .from('schools')
        .select('district, wing, tehsil, markaz')
        .order('district').order('wing').order('tehsil').order('markaz');
      if (error) throw error;
      return data;
    }

    default:
      console.warn(`[api.js] Unknown action: "${action}"`);
      throw new Error(`Unknown API action: "${action}"`);
  }
}

// ── Helper: build payload (kept for backward compat with any direct callers)
function buildBody(action, payload) {
  if (payload === undefined || payload === null) return { action };
  if (Array.isArray(payload)) return { action, args: payload };
  if (typeof payload === 'object') return { action, ...payload };
  return { action, value: payload };
}

// =====================================================================
//  google.script.run SHIM  —  unchanged from original api.js
//  Your other JS files call google.script.run.xyz() and it routes
//  through apiCall() above. Zero changes needed in any other file.
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
              const payload = args.length === 0
                ? undefined
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
