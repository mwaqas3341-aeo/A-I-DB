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
  cell_no:      'Cell No',
  cnic:         'CNIC',
  role:         'Role',
  district:     'District',
  wing:         'Wing',
  tehsil:       'Tehsil',
  scope_type:   'Scope Type',
  scope_value:  'Scope Value',
  access_type:  'Access Type',
};

// Public school: Supabase column → display header
const PUB_COL_MAP = {
  emis: 'Emis', school_name: 'School Name', district: 'District',
  wing: 'Wing', tehsil: 'Tehsil', markaz_name: 'Markaz Name',
  level: 'Level', type: 'Type', area: 'Area',
  physical_address: 'Physical Address of School',
  latitude: 'Latitude', longitude: 'Longitude',
  uc_name: 'Uc Name', uc_no: 'Uc No.', na_no: 'Na', pp_no: 'Pp',
  kanal: 'Kanal', marlas: 'Marlas', sarsai: 'Sarsai',
  total_area_sqft: 'Total Area Square Feet',
  total_covered_area_sqft: 'Total Covered Area Square Feet',
  total_uncovered_area_sqft: 'Total Uncovered Area Square Feet',
  total_rooms: 'Total rooms', used_for_teaching: 'Used For Teaching',
  non_teaching_activities: 'Non Teaching Activities',
  total_washrooms: 'Total Washrooms', electricity_source: 'Electricity Source',
  boundary_wall_status: 'Boundary Wall', required_boundary_wall: 'Required Boundary Wall',
  total_furniture: 'Total Furniture', total_enrollment: 'Total Enrollment',
  school_category: 'School Category',
  grade16_sanctioned: 'Grade16', grade15_sanctioned: 'Grade15',
  grade14_sanctioned: 'Grade14',
  grade1_12_nonteaching_sanctioned: 'Grade1-12 Non Teaching',
  bank_name: 'Bank Name', bank_address: 'Address',
  branch_code: 'Branch Code', iban_no: 'IBAN NO.', status: 'Status',
};

// Private school: Supabase column → display header
const PRIV_COL_MAP = {
  unique_id: 'Unique ID', district: 'District', tehsil: 'Tehsil',
  markaz_name: 'Markaz Name', school_category: 'School Category',
  school_name: 'School Name', registration_status: 'Registeration Status',
  registration_no: 'Registeration No',
  registration_expiry_date: 'Date of Expiry of Registeration',
  level: 'Level', school_gender: 'School Gender',
  physical_address: 'School Physical Address', zebra_crossing: 'Zebra Crossing',
  latitude: 'Latitude', longitude: 'Longitude',
  owner_name: 'Owner name', owner_cnic: 'Owner CNIC', owner_cell_no: 'Owner Cell No',
  principal_name: 'Principal Name', principal_cnic: 'Principal CNIC',
  principal_cell_no: 'Principal Cell No',
  building_certificate_expiry: 'Building Certificate Expirey',
  health_hygiene_cert_expiry: 'Health and hygiene Certificate Expirey',
  total_rooms: 'Total Rooms', total_teaching_staff: 'Total Teaching Staff',
  total_non_teaching_staff: 'Total Non Teaching Staff',
  total_enrollment: 'Total Enrolment', security_category: 'Security Category',
  entry_gates: 'Entry Gates', operational_gates: 'Operational Gates',
  cctv_cameras: 'CCTV Cameras', security_guards: 'Security Guards',
  boundary_wall_height_ft: 'Height of boundary walls',
  barbed_wires: 'Barbed wires', firefighting_system: 'Fire fighting system',
  nearby_key_installations: 'Nearby key installations',
  key_installation_name: 'Name of Key Installation',
  gate_facing_ki: 'Gate facing KI', status: 'Status',
};

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

/** Current logged-in user from localStorage. */
function _getUser() {
  try {
    const raw = localStorage.getItem(CONFIG.SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
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

      // Find the user's placeholder email via their CNIC
      const { data: profile, error: profileErr } = await _sb
        .from('app_users')
        .select('cnic, id')
        .eq('cnic', String(cnic).trim())
        .single();

      if (profileErr || !profile) {
        return { success: false, message: 'CNIC not found. Please check and try again.' };
      }

      const placeholderEmail = `${profile.cnic}@placeholder.internal`;
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
      const [pubRes, privRes] = await Promise.all([
        _sb.from('public_schools').select('status'),
        _sb.from('private_schools').select('status'),
      ]);
      const pub  = pubRes.data  || [];
      const priv = privRes.data || [];
      return {
        success:        true,
        publicCount:    pub.filter(r => r.status === 'Active').length,
        outsourcedCount:pub.filter(r => r.status === 'Out Sourced').length,
        privateCount:   priv.filter(r => r.status === 'Active').length,
        inactiveCount:  priv.filter(r => r.status === 'Inactive').length,
      };
    }

    case 'getKpiCards': {
      const { data, error } = await _sb
        .from('kpi_cards')
        .select('*')
        .eq('active', true)
        .order('display_order');
      if (error) return { success: false, message: error.message };
      // Map to the column names the frontend's renderDashboardKpiCards() uses
      const mapped = (data || []).map(c => ({
        'Card Title':       c.card_title       || '',
        'Card Icon':        c.card_icon        || '',
        'Card Color':       c.card_color       || '',
        'Card Description': c.card_description || '',
        'Action Type':      c.action_type      || 'module',
        'Action Value':     c.action_value     || '',
        'Display Order':    c.display_order    || 99,
        _id: c.id,
      }));
      return { success: true, data: mapped };
    }

    case 'getLinksAndApps': {
      const { data, error } = await _sb.from('links_apps').select('*');
      if (error) return { success: false, message: error.message };
      const rows = data || [];
      return {
        success:       true,
        importantLinks: rows.filter(r => r.link_category === 'Important' || r.link_name)
                            .filter(r => r.link_name && r.link_url)
                            .map(r => ({ name: r.link_name, url: r.link_url })),
        officialApps:   rows.filter(r => r.app_category === 'Official' || (!r.app_category && r.app_name))
                            .filter(r => r.app_name && r.app_url)
                            .map(r => ({ name: r.app_name, url: r.app_url })),
        teamApps:       rows.filter(r => r.app_category === 'Team')
                            .filter(r => r.app_name && r.app_url)
                            .map(r => ({ name: r.app_name, url: r.app_url })),
      };
    }

    case 'getToolsUser': {
      const { data, error } = await _sb.from('tools').select('*');
      if (error) return { success: false, message: error.message };
      return {
        success: true,
        tools: (data || []).map(t => ({ name: t.tool_name, url: t.tool_url })),
      };
    }

    // ── SCHOOL HIERARCHY (dropdown cascade) ───────────────────────────
    case 'getSchoolHierarchy':
    case 'getSchoolHierarchyForUser': {
      const { data, error } = await _sb
        .from('schools')
        .select('district, wing, tehsil, markaz, emis')
        .order('district').order('wing').order('tehsil').order('markaz');
      if (error) throw error;
      // Shape: [{d, w, t, m, e}] — exactly what core.js schoolCache expects
      return (data || []).map(r => ({
        d: r.district,
        w: r.wing,
        t: r.tehsil,
        m: r.markaz,
        e: r.emis,
      }));
    }

    // ── STAFF (HR) ────────────────────────────────────────────────────
    case 'loadSheetForClient': {
      // payload: 'Staff' | ['Staff', user] | ['Staff', user, filters]
      const sheetName = Array.isArray(payload) ? payload[0] : (payload || 'Staff');
      const statusMap = {
        'Staff':             'active',
        'Termination':       'terminated',
        'Retirement':        'retired',
        'Resignation':       'resigned',
        'Deceased':          'deceased',
        'Deleted_Archive':   'deleted',
      };
      const status = statusMap[sheetName] || 'active';

      const { data, error } = await _sb
        .from('staff')
        .select('*')
        .eq('status', status)
        .order('name_of_teacher');

      if (error) return { error: error.message };

      const { headers, rows } = _toHeadersRows(data, STAFF_COL_MAP);
      return { headers, rows };
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

      const { data: inserted, error } = await _sb
        .from('staff').insert([dbRow]).select().single();
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

      const { error } = await _sb.from('staff').update(dbRow).eq('personal_no', pno);
      if (error) return { success: false, error: error.message };

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

      const { error } = await _sb.from('staff').update({
        status: 'deleted',
        changes_made_by: user?.name || '',
        changes_made_at: new Date().toISOString(),
      }).eq('personal_no', pno);

      if (error) return { success: false, error: error.message };

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
      const pno = p['PERSONAL NO.'] || p.personal_no;
      const { data: s } = await _sb.from('staff').select('name_of_teacher').eq('personal_no', pno).single();

      const { error } = await _sb.from('staff').update({
        school_emis_code:              p.to_emis              || p['To EMIS'] || '',
        markaz_name:                   p.to_markaz            || p['To Markaz'] || '',
        tehsil:                        p.to_tehsil            || p['To Tehsil'] || '',
        district:                      p.to_district          || p['To District'] || '',
        wing:                          p.to_wing              || p['To Wing'] || '',
        date_of_posting_present_school:p.date_of_joining_new_school || p['Date of Joining New School'] || '',
        status:                        'active',
        changes_made_by:               user?.name || '',
        changes_made_at:               new Date().toISOString(),
      }).eq('personal_no', pno);

      if (error) return { success: false, error: error.message };

      await _sb.from('staff_events').insert([{
        personal_no:   pno,
        employee_name: s?.name_of_teacher || '',
        event_type:    'transfer',
        notification_no: p.notification_no || p['Notification No'] || '',
        effective_date:  p.effective_date  || p['Transfer Date'] || '',
        details:         {
          from_emis:    p.from_emis    || p['From EMIS'] || '',
          to_emis:      p.to_emis      || p['To EMIS'] || '',
          from_markaz:  p.from_markaz  || p['From Markaz'] || '',
          to_markaz:    p.to_markaz    || p['To Markaz'] || '',
          transfer_type:p.transfer_type|| p['Transfer Type'] || '',
        },
        created_by: user?.name || '',
      }]);
      return { success: true, message: 'Transfer completed successfully.' };
    }

    case 'executePromotion': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const pno = p['PERSONAL NO.'] || p.personal_no;
      const { data: s } = await _sb.from('staff').select('name_of_teacher, designation, bps').eq('personal_no', pno).single();

      const { error } = await _sb.from('staff').update({
        designation:                  p.new_designation || p['New Designation'] || '',
        bps:                          p.new_bps         || p['New BPS'] || '',
        date_of_joining_present_scale:p.effective_date  || '',
        changes_made_by:              user?.name || '',
        changes_made_at:              new Date().toISOString(),
      }).eq('personal_no', pno);

      if (error) return { success: false, error: error.message };

      await _sb.from('staff_events').insert([{
        personal_no:    pno,
        employee_name:  s?.name_of_teacher || '',
        event_type:     'promotion',
        notification_no:p.notification_no || '',
        effective_date: p.effective_date  || '',
        details:        {
          old_designation: s?.designation || '',
          new_designation: p.new_designation || '',
          old_bps:         s?.bps || '',
          new_bps:         p.new_bps || '',
        },
        created_by: user?.name || '',
      }]);
      return { success: true, message: 'Promotion recorded successfully.' };
    }

    case 'executeStaffAction': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const pno = p['PERSONAL NO.'] || p.personal_no;
      const actionType = (p.action_type || p['Action Type'] || '').toLowerCase();
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
      const { error } = await _sb.from('staff').update({
        status: newStatus,
        changes_made_by: user?.name || '',
        changes_made_at: new Date().toISOString(),
      }).eq('personal_no', pno);

      if (error) return { success: false, errors: [error.message] };

      await _sb.from('staff_events').insert([{
        personal_no:    pno,
        employee_name:  s?.name_of_teacher || '',
        event_type:     newStatus,
        notification_no:p.notification_no || p['Notification No'] || '',
        effective_date: p.effective_date  || p['Effective Date'] || '',
        created_by:     user?.name || '',
      }]);
      return { success: true, message: 'Action completed.', targetSheet };
    }

    case 'revertToActiveStaff': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const pno = p['PERSONAL NO.'] || p.personal_no;
      const { data: s } = await _sb.from('staff').select('name_of_teacher, status').eq('personal_no', pno).single();

      const { error } = await _sb.from('staff').update({
        status: 'active',
        changes_made_by: user?.name || '',
        changes_made_at: new Date().toISOString(),
      }).eq('personal_no', pno);

      if (error) return { success: false, error: error.message };

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
      const status = Array.isArray(payload) ? payload[1] : (payload?.status || 'Active');
      const { data, error } = await _sb
        .from('public_schools').select('*').eq('status', status).order('school_name');
      if (error) return { success: false, message: error.message };
      return { success: true, ..._toHeadersData(data, PUB_COL_MAP) };
    }

    case 'savePublicSchool': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const emis = p['Emis'] || p.emis;
      // Convert display keys back to db columns
      const reverseMap = Object.fromEntries(Object.entries(PUB_COL_MAP).map(([c,h])=>[h,c]));
      const dbRow = {};
      for (const [h, v] of Object.entries(p)) {
        const col = reverseMap[h] || h;
        dbRow[col] = v;
      }
      dbRow.updated_at = new Date().toISOString();
      delete dbRow.emis;  // don't overwrite PK
      const { error } = await _sb.from('public_schools').update(dbRow).eq('emis', emis);
      if (error) return { success: false, message: error.message };
      return { success: true, message: 'School record updated.' };
    }

    case 'exportSheetData': {
      // Used by public/private export buttons — returns { success, headers, rows (2D) }
      const sheetName = Array.isArray(payload) ? payload[0] : (payload?.sheet || payload);
      if (sheetName === 'Public' || sheetName === 'Out Sourced School') {
        const status = sheetName === 'Out Sourced School' ? 'Out Sourced' : 'Active';
        const { data, error } = await _sb.from('public_schools').select('*').eq('status', status);
        if (error) return { success: false, message: error.message };
        const hdrs = _headers(PUB_COL_MAP);
        const rows2d = (data||[]).map(r => hdrs.map(h => {
          const col = Object.entries(PUB_COL_MAP).find(([,v])=>v===h)?.[0];
          return col ? (r[col] ?? '') : '';
        }));
        return { success: true, headers: hdrs, rows: rows2d };
      }
      if (sheetName === 'Private' || sheetName === 'Inactive') {
        const status = sheetName === 'Inactive' ? 'Inactive' : 'Active';
        const { data, error } = await _sb.from('private_schools').select('*').eq('status', status);
        if (error) return { success: false, message: error.message };
        const hdrs = _headers(PRIV_COL_MAP);
        const rows2d = (data||[]).map(r => hdrs.map(h => {
          const col = Object.entries(PRIV_COL_MAP).find(([,v])=>v===h)?.[0];
          return col ? (r[col] ?? '') : '';
        }));
        return { success: true, headers: hdrs, rows: rows2d };
      }
      // Staff sheet export
      const statusMap3 = { Staff:'active', Termination:'terminated', Retirement:'retired', Resignation:'resigned', Deceased:'deceased', Deleted_Archive:'deleted' };
      const st = statusMap3[sheetName] || 'active';
      const { data, error } = await _sb.from('staff').select('*').eq('status', st);
      if (error) return { success: false, message: error.message };
      const hdrs = _headers(STAFF_COL_MAP);
      const rows2d = (data||[]).map(r => hdrs.map(h => {
        const col = Object.entries(STAFF_COL_MAP).find(([,v])=>v===h)?.[0];
        return col ? (r[col] ?? '') : '';
      }));
      return { success: true, headers: hdrs, rows: rows2d };
    }

    // ── PRIVATE SCHOOLS ───────────────────────────────────────────────
    case 'getPrivateDashboardData': {
      const status = Array.isArray(payload) ? payload[1] : (payload?.status || 'Active');
      const { data, error } = await _sb
        .from('private_schools').select('*').eq('status', status).order('school_name');
      if (error) return { success: false, message: error.message };
      return { success: true, ..._toHeadersData(data, PRIV_COL_MAP) };
    }

    case 'savePrivateSchool': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const uid = p['Unique ID'] || p.unique_id;
      const reverseMap = Object.fromEntries(Object.entries(PRIV_COL_MAP).map(([c,h])=>[h,c]));
      const dbRow = {};
      for (const [h, v] of Object.entries(p)) {
        const col = reverseMap[h] || h;
        dbRow[col] = v;
      }
      dbRow.updated_at = new Date().toISOString();
      if (uid) {
        delete dbRow.unique_id;
        const { error } = await _sb.from('private_schools').update(dbRow).eq('unique_id', uid);
        if (error) return { success: false, message: error.message };
      } else {
        dbRow.status = dbRow.status || 'Active';
        const { error } = await _sb.from('private_schools').insert([dbRow]);
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
      return (data||[]).map(r => _remap(r, PRIV_COL_MAP));
    }

    // ── ADMIN — USERS ─────────────────────────────────────────────────
    case 'getUsers': {
      const { data, error } = await _sb.from('app_users').select('*').order('name');
      if (error) return { success: false, message: error.message };
      const headers = Object.values(USER_COL_MAP);
      const mapped  = (data||[]).map(r => _remap(r, USER_COL_MAP));
      return { success: true, headers, data: mapped };
    }

    case 'saveUser': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const reverseMap = Object.fromEntries(Object.entries(USER_COL_MAP).map(([c,h])=>[h,c]));
      const dbRow = {};
      for (const [h, v] of Object.entries(p)) {
        const col = reverseMap[h] || h;
        dbRow[col] = v;
      }
      const { id, ...fields } = dbRow;
      if (id) {
        const { error } = await _sb.from('app_users').update(fields).eq('id', id);
        if (error) return { success: false, message: error.message };
      } else {
        const { error } = await _sb.from('app_users').insert([fields]);
        if (error) return { success: false, message: error.message };
      }
      return { success: true, message: 'User saved.' };
    }

    case 'deleteUser': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const cnic = p['CNIC'] || p.cnic;
      const { error } = await _sb.from('app_users').delete().eq('cnic', cnic);
      if (error) return { success: false, message: error.message };
      return { success: true, message: 'User removed.' };
    }

    // ── ADMIN — JURISDICTION DROPDOWNS ────────────────────────────────
    case 'getJurisdictionDropdownData': {
      const { data, error } = await _sb
        .from('schools')
        .select('district, wing, tehsil, markaz, emis')
        .order('district').order('wing').order('tehsil').order('markaz');
      if (error) return { success: false, message: error.message };
      const rows = data || [];
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
        _sb.from('public_schools').select('emis, school_name, district, wing, tehsil, markaz_name, status'),
        _sb.from('private_schools').select('unique_id, school_name, district, tehsil, markaz_name, status'),
      ]);
      const pubSchools  = (pub.data||[]).map(r => ({ emis:r.emis,   name:r.school_name, district:r.district, wing:r.wing,  tehsil:r.tehsil, markaz:r.markaz_name, sheet:'Public',  status:r.status }));
      const privSchools = (priv.data||[]).map(r => ({ uid:r.unique_id, name:r.school_name, district:r.district, wing:null, tehsil:r.tehsil, markaz:r.markaz_name, sheet:'Private', status:r.status }));
      return { success: true, schools: [...pubSchools, ...privSchools] };
    }

    // ── ADMIN — KPI CARDS ─────────────────────────────────────────────
    case 'getKpiCardsAdmin': {
      const { data, error } = await _sb.from('kpi_cards').select('*').order('display_order');
      if (error) return { success: false, message: error.message };
      const headers = ['Card Title','Card Icon','Card Color','Card Description','Action Type','Action Value','Display Order'];
      const mapped = (data||[]).map(c => ({
        'Card Title':       c.card_title       || '',
        'Card Icon':        c.card_icon        || '',
        'Card Color':       c.card_color       || '',
        'Card Description': c.card_description || '',
        'Action Type':      c.action_type      || '',
        'Action Value':     c.action_value     || '',
        'Display Order':    c.display_order    || '',
        _id: c.id,
      }));
      return { success: true, headers, data: mapped };
    }

    case 'saveKpiCard': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const dbRow = {
        card_title:       p['Card Title']       || '',
        card_icon:        p['Card Icon']        || '',
        card_color:       p['Card Color']       || '',
        card_description: p['Card Description'] || '',
        action_type:      p['Action Type']      || 'module',
        action_value:     p['Action Value']     || '',
        display_order:    parseInt(p['Display Order']) || 99,
        active:           true,
      };
      if (p._id) {
        const { error } = await _sb.from('kpi_cards').update(dbRow).eq('id', p._id);
        if (error) return { success: false, message: error.message };
      } else {
        const { error } = await _sb.from('kpi_cards').insert([dbRow]);
        if (error) return { success: false, message: error.message };
      }
      return { success: true, message: 'KPI card saved.' };
    }

    case 'deleteKpiCard': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const id = p?._id || p?.id || p;
      const { error } = await _sb.from('kpi_cards').delete().eq('id', id);
      if (error) return { success: false, message: error.message };
      return { success: true, message: 'KPI card deleted.' };
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
        _id: r.id,
      }));
      return { success: true, headers, data: mapped };
    }

    case 'saveLinksAppsRow': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const dbRow = {
        link_name:     p['Link Name']     || p[0] || '',
        link_url:      p['Link URL']      || p[1] || '',
        app_name:      p['App Name']      || p[2] || '',
        app_url:       p['App URL']       || p[3] || '',
        app_category:  p['App Category']  || p[4] || '',
        link_category: p['Link Category'] || p[5] || '',
      };
      if (p._id) {
        const { error } = await _sb.from('links_apps').update(dbRow).eq('id', p._id);
        if (error) return { success: false, message: error.message };
      } else {
        const { error } = await _sb.from('links_apps').insert([dbRow]);
        if (error) return { success: false, message: error.message };
      }
      return { success: true, message: 'Link/App saved.' };
    }

    case 'deleteLinksAppsRow': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const id = p?._id || p?.id || p;
      const { error } = await _sb.from('links_apps').delete().eq('id', id);
      if (error) return { success: false, message: error.message };
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
        _id: r.id,
      }));
      return { success: true, headers, data: mapped };
    }

    case 'saveToolRow': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const dbRow = {
        tool_name: p['Tool Name'] || p[0] || '',
        tool_url:  p['Tool URL']  || p[1] || '',
      };
      if (p._id) {
        const { error } = await _sb.from('tools').update(dbRow).eq('id', p._id);
        if (error) return { success: false, message: error.message };
      } else {
        const { error } = await _sb.from('tools').insert([dbRow]);
        if (error) return { success: false, message: error.message };
      }
      return { success: true, message: 'Tool saved.' };
    }

    case 'deleteToolRow': {
      const p = Array.isArray(payload) ? payload[0] : payload;
      const id = p?._id || p?.id || p;
      const { error } = await _sb.from('tools').delete().eq('id', id);
      if (error) return { success: false, message: error.message };
      return { success: true, message: 'Tool deleted.' };
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
