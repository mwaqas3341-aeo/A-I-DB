// ── StaffForm module JS ──
// ══════════════════════════════════════════════════════════════════
//  STAFF FORM — unified Add / Edit / View
// ══════════════════════════════════════════════════════════════════

// ---------- State ----------
var sfmEmisMap    = {};   // emis_lowercase → {d,w,t,m,e}
var sfmSubmitting = false;
var sfmPnoStatus  = 'unchecked';
var sfmCnicStatus = 'unchecked';
var sfmIbanStatus = 'unchecked';

// ---------- Field map ----------
// Add/Edit Staff form field id → Supabase column. The actual display
// header shown on the form (and used when saving) is looked up from
// STAFF_COL_MAP (js/api.js) rather than retyped here, so a header-text
// change only ever needs to happen in one place. staffform.js loads
// after api.js, so STAFF_COL_MAP is already defined by this point.
var SF_ID_TO_COL = {
  sf_emis:                 'school_emis_code',
  sf_schoolName:           'school_name',
  sf_markaz:               'markaz_name',
  sf_district:             'district',
  sf_wing:                 'wing',
  sf_tehsil:               'tehsil',
  sf_personalNo:           'personal_no',
  sf_name:                 'name_of_teacher',
  sf_parentName:           'parent_name',
  sf_dob:                  'date_of_birth',
  sf_gender:               'gender',
  sf_designation:          'designation',
  sf_workingAsHead:        'working_as_head',
  sf_bps:                  'bps',
  sf_pps:                  'pps',
  sf_natureOfJob:          'nature_of_job',
  sf_regularizationDate:   'date_of_permanentization',
  sf_govtEntry:            'date_of_entry_govt_service',
  sf_firstPosting:         'first_place_of_posting',
  sf_presentSchoolPosting: 'date_of_posting_present_school',
  sf_presentScaleJoining:  'date_of_joining_present_scale',
  sf_subject:              'subject',
  sf_academicQual:         'academic_qualification',
  sf_profQual:             'professional_qualification',
  sf_cellNo:               'cell_no',
  sf_whatsapp:             'whatsapp_no',
  sf_email:                'email_id',
  sf_cnic:                 'cnic',
  sf_address:              'address_as_per_cnic',
  sf_bankName:             'bank_name_branch_code',
  sf_iban:                 'salary_account_iban_no',
};
var SF_FIELD_MAP = Object.fromEntries(
  Object.entries(SF_ID_TO_COL).map(([id, col]) => [id, (typeof STAFF_COL_MAP !== 'undefined' && STAFF_COL_MAP[col]) || col])
);

// ---------- User payload helper ----------
function getUserPayload() {
  return typeof currentUser !== 'undefined' ? currentUser : { name: 'Admin' };
}

// ---------- School cache helpers ----------
function _sfmResolveSchoolPool() {
  if (typeof hrSchoolCache !== 'undefined' && Array.isArray(hrSchoolCache) && hrSchoolCache.length) {
    return hrSchoolCache;
  }
  if (typeof schoolCache !== 'undefined' && Array.isArray(schoolCache) && schoolCache.length) {
    return schoolCache;
  }
  return [];
}

function buildSfmEmisMap() {
  sfmEmisMap = {};
  var pool = _sfmResolveSchoolPool();
  pool.forEach(function(s) {
    if (s.e) sfmEmisMap[s.e.toString().trim().toLowerCase()] = s;
  });
}

function sfmEnsureSchoolCache(callback) {
  if (_sfmResolveSchoolPool().length > 0) {
    buildSfmEmisMap();
    if (callback) callback();
    return;
  }
  var userPayload = getUserPayload();
  google.script.run
    .withSuccessHandler(function(data) {
      if (typeof hrSchoolCache !== 'undefined') {
        hrSchoolCache = data || [];
      } else {
        schoolCache = data || [];
      }
      buildSfmEmisMap();
      if (callback) callback();
    })
    .withFailureHandler(function(err) {
      if (typeof showToast === 'function') {
        showToast('Error loading school data: ' + (err && err.message ? err.message : 'Unknown error'), 'error');
      }
      if (callback) callback();
    })
    .getSchoolHierarchyForUser(userPayload);
}

// ---------- EMIS live-lookup ----------
function sfmOnEmisInput() {
  var emis     = (document.getElementById('sf_emis').value || '').trim();
  var badge    = document.getElementById('sfm_emisBadge');
  var infoEl   = document.getElementById('sfm_emisInfo');
  var errEl    = document.getElementById('sfe_emis');
  var emisInp  = document.getElementById('sf_emis');

  badge.classList.add('hidden');
  infoEl.classList.add('hidden');
  infoEl.textContent = '';
  errEl.textContent  = '';
  emisInp.classList.remove('valid', 'invalid');

  ['sf_schoolName','sf_markaz','sf_district','sf_wing','sf_tehsil'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });

  if (emis.length === 0) return;

  if (!/^\d{8}$/.test(emis)) {
    if (emis.length === 8) {
      errEl.textContent = 'Must be exactly 8 digits.';
      emisInp.classList.add('invalid');
    }
    return;
  }

  if (Object.keys(sfmEmisMap).length === 0 && _sfmResolveSchoolPool().length === 0) {
    errEl.textContent = '⏳ Loading school data…';
    sfmEnsureSchoolCache(function() {
      if ((document.getElementById('sf_emis').value || '').trim() === emis) {
        sfmOnEmisInput();
      }
    });
    return;
  }

  var found = sfmEmisMap[emis.toLowerCase()];
  if (!found) {
    errEl.textContent = '⚠ EMIS code not found in Schools data.';
    emisInp.classList.add('invalid');
    return;
  }

  badge.classList.remove('hidden');
  emisInp.classList.add('valid');

  var schoolNameEl = document.getElementById('sf_schoolName');
  if (schoolNameEl) schoolNameEl.value = found.s || '';
  document.getElementById('sf_markaz').value   = found.m || '';
  document.getElementById('sf_district').value = found.d || '';
  document.getElementById('sf_wing').value      = found.w || '';
  document.getElementById('sf_tehsil').value    = found.t || '';

  infoEl.classList.remove('hidden');
  infoEl.textContent = '✓ ' + (found.d || '') + ' › ' + (found.w || '') + ' › ' + (found.t || '') + ' › ' + (found.s || found.m || '');
}

// ---------- Personal No. live-check ----------
function sfmOnPersonalNoInput() {
  var inputEl = document.getElementById('sf_personalNo');
  inputEl.value = inputEl.value.replace(/[^0-9]/g, '').slice(0, 8);

  var pno    = inputEl.value;
  var infoEl = document.getElementById('sfm_pnoInfo');
  var errEl  = document.getElementById('sfe_personalNo');

  infoEl.classList.add('hidden');
  infoEl.className = 'sfm-pno-info hidden';
  errEl.textContent = '';
  sfmPnoStatus = 'unchecked';

  if (!pno || sfmMode !== 'add') return;
  if (pno.length < 8) return;

  var mainSheets = ['Staff','Deleted_Archive',
                    'Deceased','Termination','Retirement','Resignation'];
  var foundIn = null;

  mainSheets.forEach(function(sh) {
    if (foundIn) return;
    var cache = sheetDataCache[sh];
    if (!cache || !cache.rows) return;
    var pnoHdr = null;
    (cache.headers || []).forEach(function(h) {
      if (h && h.toString().trim().toUpperCase() === 'PERSONAL NO.') pnoHdr = h;
    });
    if (!pnoHdr) return;
    if (cache.rows.some(function(r) { return safeVal(r[pnoHdr]).trim() === pno; }))
      foundIn = sh;
  });

  if (foundIn) {
    sfmPnoStatus = 'duplicate';
    infoEl.classList.remove('hidden');
    infoEl.className = 'sfm-pno-info warn';
    infoEl.style.background  = '#FFF7ED';
    infoEl.style.borderColor = '#FDE68A';
    infoEl.style.color       = '#D97706';
    infoEl.textContent = '⚠ Personal No. already exists in "' + foundIn + '".';
    return;
  }

  sfmPnoStatus = 'checking';
  infoEl.classList.remove('hidden');
  infoEl.className = 'sfm-pno-info';
  infoEl.style.background  = '#F1F5F9';
  infoEl.style.borderColor = '#CBD5E1';
  infoEl.style.color       = '#475569';
  infoEl.textContent = '⏳ Verifying across all records…';

  google.script.run
    .withSuccessHandler(function(res) {
      if (document.getElementById('sf_personalNo').value !== pno) return;
      if (res && res.found) {
        sfmPnoStatus = 'duplicate';
        infoEl.className = 'sfm-pno-info warn';
        infoEl.style.background  = '#FFF7ED';
        infoEl.style.borderColor = '#FDE68A';
        infoEl.style.color       = '#D97706';
        infoEl.textContent = '⚠ Personal No. already exists in "' + res.sheet + '".';
      } else {
        sfmPnoStatus = 'available';
        infoEl.className = 'sfm-pno-info ok';
        infoEl.style.background  = '#F0FDF4';
        infoEl.style.borderColor = '#BBF7D0';
        infoEl.style.color       = '#059669';
        infoEl.textContent = '✓ No issue with this number found, good to go.';
      }
    })
    .withFailureHandler(function() {
      sfmPnoStatus = 'unchecked';
      infoEl.classList.add('hidden');
    })
    .checkPersonalNoDuplicate(pno, null);
}

// ---------- CNIC live-check ----------
function sfmOnCnicInput() {
  var cnic   = (document.getElementById('sf_cnic').value || '').trim();
  var infoEl = document.getElementById('sfm_cnicInfo');
  var errEl  = document.getElementById('sfe_cnic');

  infoEl.classList.add('hidden');
  infoEl.className = 'sfm-cnic-info hidden';
  errEl.textContent = '';
  sfmCnicStatus = 'unchecked';

  if (!cnic) return;

  if (!/^\d{13}$/.test(cnic)) {
    if (cnic.length === 13) {
      errEl.textContent = 'CNIC must be exactly 13 digits.';
    }
    return;
  }

  var ownCnic = sfmCurrentRow ? safeVal(sfmCurrentRow['CNIC']).trim() : '';
  if (sfmMode === 'edit' && cnic === ownCnic) {
    sfmCnicStatus = 'available';
    return;
  }

  var mainSheets = ['Staff','Deleted_Archive',
                    'Deceased','Termination','Retirement','Resignation'];
  var foundIn = null;

  mainSheets.forEach(function(sh) {
    if (foundIn) return;
    var cache = sheetDataCache[sh];
    if (!cache || !cache.rows) return;
    var cnicHdr = null;
    (cache.headers || []).forEach(function(h) {
      if (h && h.toString().trim().toUpperCase() === 'CNIC') cnicHdr = h;
    });
    if (!cnicHdr) return;
    if (cache.rows.some(function(r) {
      return safeVal(r[cnicHdr]).trim() === cnic;
    })) foundIn = sh;
  });

  if (foundIn) {
    sfmCnicStatus = 'duplicate';
    infoEl.classList.remove('hidden');
    infoEl.className = 'sfm-cnic-info warn';
    infoEl.style.background  = '#FFF7ED';
    infoEl.style.borderColor = '#FDE68A';
    infoEl.style.color       = '#D97706';
    infoEl.textContent = '⚠ CNIC already exists in "' + foundIn + '".';
    return;
  }

  sfmCnicStatus = 'checking';
  infoEl.classList.remove('hidden');
  infoEl.className = 'sfm-cnic-info';
  infoEl.style.background  = '#F1F5F9';
  infoEl.style.borderColor = '#CBD5E1';
  infoEl.style.color       = '#475569';
  infoEl.textContent = '⏳ Verifying CNIC across all records…';

  var excludeSheet = sfmMode === 'edit' ? 'Staff' : null;

  google.script.run
    .withSuccessHandler(function(res) {
      if ((document.getElementById('sf_cnic').value || '').trim() !== cnic) return;
      if (res && res.found) {
        sfmCnicStatus = 'duplicate';
        infoEl.className = 'sfm-cnic-info warn';
        infoEl.style.background  = '#FFF7ED';
        infoEl.style.borderColor = '#FDE68A';
        infoEl.style.color       = '#D97706';
        infoEl.textContent = '⚠ CNIC already exists in "' + res.sheet + '".';
      } else {
        sfmCnicStatus = 'available';
        infoEl.className = 'sfm-cnic-info ok';
        infoEl.style.background  = '#F0FDF4';
        infoEl.style.borderColor = '#BBF7D0';
        infoEl.style.color       = '#059669';
        infoEl.textContent = '✓ No issue with this number found, good to go.';
      }
    })
    .withFailureHandler(function() {
      sfmCnicStatus = 'unchecked';
      infoEl.classList.add('hidden');
    })
    .checkCnicDuplicate(cnic, excludeSheet);
}

// ---------- IBAN live-check ----------
function sfmOnIbanInput() {
  var iban   = (document.getElementById('sf_iban').value || '').trim().toUpperCase();
  var errEl  = document.getElementById('sfe_iban');

  errEl.textContent = '';
  sfmIbanStatus = 'unchecked';

  if (!iban) return;

  if (iban.length !== 24) return;

  if (!/^PK\d{2}[A-Z0-9]{20}$/i.test(iban)) {
    errEl.textContent = 'Pakistani IBAN: PK + 2 digits + 20 alphanumeric chars (24 total).';
    return;
  }

  var ownIban = sfmCurrentRow ? safeVal(sfmCurrentRow['SALARY ACCOUNT IBAN NO.']).trim().toUpperCase() : '';
  if (sfmMode === 'edit' && iban === ownIban) {
    sfmIbanStatus = 'available';
    return;
  }

  var mainSheets = ['Staff','Deleted_Archive',
                    'Deceased','Termination','Retirement','Resignation'];
  var foundIn = null;

  mainSheets.forEach(function(sh) {
    if (foundIn) return;
    var cache = sheetDataCache[sh];
    if (!cache || !cache.rows) return;
    var ibanHdr = null;
    (cache.headers || []).forEach(function(h) {
      if (h && h.toString().trim().toUpperCase() === 'SALARY ACCOUNT IBAN NO.') ibanHdr = h;
    });
    if (!ibanHdr) return;
    if (cache.rows.some(function(r) {
      return safeVal(r[ibanHdr]).trim().toUpperCase() === iban;
    })) foundIn = sh;
  });

  if (foundIn) {
    sfmIbanStatus = 'duplicate';
    errEl.textContent = '⚠ IBAN already exists in "' + foundIn + '".';
    errEl.style.color = '#D97706';
    return;
  }

  sfmIbanStatus = 'checking';
  errEl.textContent = '⏳ Verifying IBAN across all records…';
  errEl.style.color = '#475569';

  var excludeSheet = sfmMode === 'edit' ? 'Staff' : null;

  google.script.run
    .withSuccessHandler(function(res) {
      if ((document.getElementById('sf_iban').value || '').trim().toUpperCase() !== iban) return;
      if (res && res.found) {
        sfmIbanStatus = 'duplicate';
        errEl.textContent = '⚠ IBAN already exists in "' + res.sheet + '".';
        errEl.style.color = '#D97706';
      } else {
        sfmIbanStatus = 'available';
        errEl.textContent = '✓ No issue with this number found, good to go.';
        errEl.style.color = '#059669';
      }
    })
    .withFailureHandler(function() {
      sfmIbanStatus = 'unchecked';
      errEl.textContent = '';
    })
    .checkIbanDuplicate(iban, excludeSheet);
}

// ---------- Regularization toggle ----------
function toggleRegularizationDate() {
  var jobNature = document.getElementById('sf_natureOfJob').value;
  var container = document.getElementById('regDateContainer');
  var dateInput = document.getElementById('sf_regularizationDate');
  
  if (!container) return;

  if (jobNature === 'Permanent') {
    container.style.display = 'flex';
  } else {
    container.style.display = 'none';
    if (sfmMode !== 'view') {
      dateInput.value = '';
    }
  }
}

// ---------- Error helpers ----------
function setFieldErr(inputId, errId, msg) {
  var el = document.getElementById(inputId);
  var er = document.getElementById(errId);
  if (el) el.classList.add('invalid');
  if (er) er.textContent = msg;
}
function clearFieldErr(inputId, errId) {
  var el = document.getElementById(inputId);
  var er = document.getElementById(errId);
  if (el) el.classList.remove('invalid');
  if (er) er.textContent = '';
}

// ---------- Date helpers ----------
function toDateInputVal(str) {
  if (!str) return '';
  str = str.trim();

  // 1) Already ISO: YYYY-MM-DD (optionally with a time part attached,
  //    e.g. a timestamptz column) — take just the date portion.
  var iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];

  // 2) DD-Mon-YYYY, e.g. "15-May-1990"
  var mon = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (mon) {
    var months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                  jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    var mo = months[mon[2].toLowerCase()];
    return mo ? (mon[3] + '-' + mo + '-' + mon[1].padStart(2,'0')) : '';
  }

  // 3) Numeric DD-MM-YYYY or DD/MM/YYYY — the most common format for
  //    data originally entered by hand (as opposed to a spreadsheet's
  //    own date type), and exactly the kind of ambiguous format the
  //    native JS Date parser handles inconsistently/incorrectly rather
  //    than just failing loudly. Handle it explicitly instead of
  //    gambling on new Date(...) for this one.
  var numeric = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (numeric) {
    var day = parseInt(numeric[1], 10);
    var mo2 = parseInt(numeric[2], 10);
    var yr  = numeric[3];
    // Guard against the (less common) MM-DD-YYYY case: if the first
    // number can't be a valid day-of-month but CAN be a month, swap.
    if (day > 31) return '';
    if (mo2 > 12 && day <= 12) { var tmp = day; day = mo2; mo2 = tmp; }
    if (mo2 > 12) return '';
    return yr + '-' + String(mo2).padStart(2,'0') + '-' + String(day).padStart(2,'0');
  }

  // 4) Last resort: native parser, for anything else recognizable
  //    (e.g. a full ISO timestamp with a 'Z'/offset already handled by
  //    case 1 above, or other Date-parseable strings).
  var d = new Date(str);
  if (!isNaN(d)) {
    return d.getFullYear() + '-' +
           String(d.getMonth()+1).padStart(2,'0') + '-' +
           String(d.getDate()).padStart(2,'0');
  }
  return '';
}

function fromDateInputVal(str) {
  if (!str) return '';
  var parts = str.split('-');
  if (parts.length !== 3) return str;
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return parts[2] + '-' + months[parseInt(parts[1], 10) - 1] + '-' + parts[0];
}

// ---------- Populate form ----------
function sfmPopulateForm(row) {
  buildSfmEmisMap();

  Object.keys(SF_FIELD_MAP).forEach(function(id) {
    var key  = SF_FIELD_MAP[id];
    var el   = document.getElementById(id);
    if (!el) return;
    var val  = (row && row[key] !== undefined && row[key] !== null) ? row[key].toString() : '';

    if (el.tagName === 'SELECT') {
      el.value = val;
    } else if (el.type === 'date') {
      el.value = toDateInputVal(val);
    } else {
      el.value = val;
    }

    var spanId = 'sfv_' + id.replace('sf_', '');
    var span   = document.getElementById(spanId);
    if (span) span.textContent = val || '—';
  });

  if (row && sfmMode !== 'view') sfmOnEmisInput();
  toggleRegularizationDate();
}

// ---------- Collect form data ----------
function sfmCollectData() {
  var data = sfmCurrentRow ? { _row: sfmCurrentRow._row } : {};
  Object.keys(SF_FIELD_MAP).forEach(function(id) {
    var key = SF_FIELD_MAP[id];
    var el  = document.getElementById(id);
    if (!el) return;
    // Date inputs already give YYYY-MM-DD, exactly what Postgres date
    // columns expect — send it as-is instead of reformatting it.
    data[key] = el.value || '';
  });
  return data;
}

// ---------- Validation ----------
function sfmValidate() {
  var ok = true;
  document.querySelectorAll('.sfm-err').forEach(function(e) { e.textContent = ''; });
  document.querySelectorAll('.sfm-input,.sfm-select').forEach(function(e) {
    e.classList.remove('invalid', 'valid');
  });

  function v(id) { return ((document.getElementById(id) || {}).value || '').trim(); }
  function e(inputId, errId, msg) { setFieldErr(inputId, errId, msg); ok = false; }

  var pno = v('sf_personalNo');
  if (!pno) {
    e('sf_personalNo', 'sfe_personalNo', 'Personal No. is required.');
  } else if (pno.length !== 8) {
    e('sf_personalNo', 'sfe_personalNo', 'Must be exactly 8 digits.');
  } else if (sfmPnoStatus === 'duplicate') {
    e('sf_personalNo', 'sfe_personalNo', 'This Personal No. already exists in another record.');
  } else if (sfmPnoStatus === 'checking') {
    e('sf_personalNo', 'sfe_personalNo', 'Still verifying — please wait a moment and try again.');
  }

  var emis = v('sf_emis');
  if (!emis) {
    e('sf_emis', 'sfe_emis', 'EMIS Code is required.');
  } else if (!/^\d{8}$/.test(emis)) {
    e('sf_emis', 'sfe_emis', 'Must be exactly 8 digits.');
  } else if (!sfmEmisMap[emis.toLowerCase()]) {
    e('sf_emis', 'sfe_emis', 'EMIS not found in Schools data.');
  }

  if (!v('sf_name')) e('sf_name', 'sfe_name', 'Name of Teacher is required.');
  if (!v('sf_dob')) e('sf_dob', 'sfe_dob', 'Date of Birth is required.');
  if (!v('sf_gender')) e('sf_gender', 'sfe_gender', 'Gender is required.');
  if (!v('sf_designation')) e('sf_designation', 'sfe_designation', 'Designation is required.');

  var bps = v('sf_bps');
  if (!bps) {
    e('sf_bps', 'sfe_bps', 'BPS is required.');
  } else if (isNaN(bps) || +bps < 1 || +bps > 22) {
    e('sf_bps', 'sfe_bps', 'BPS must be 1–22.');
  }

  var pps = v('sf_pps');
  if (pps && (isNaN(pps) || +pps < 1 || +pps > 22))
    e('sf_pps', 'sfe_pps', 'PPS must be 1–22.');

  if (!v('sf_govtEntry')) e('sf_govtEntry', 'sfe_govtEntry', 'Date of Entry in Govt. Service is required.');

  var cell = v('sf_cellNo');
  if (cell && !/^\d{11}$/.test(cell)) e('sf_cellNo', 'sfe_cellNo', 'Must be exactly 11 digits.');

  var wa = v('sf_whatsapp');
  if (wa && !/^\d{11}$/.test(wa)) e('sf_whatsapp', 'sfe_whatsapp', 'Must be exactly 11 digits.');

  var email = v('sf_email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    e('sf_email', 'sfe_email', 'Enter a valid email address.');

  var cnic = v('sf_cnic');
  if (cnic && !/^\d{13}$/.test(cnic)) {
    e('sf_cnic', 'sfe_cnic', 'CNIC must be exactly 13 digits.');
  } else if (sfmCnicStatus === 'duplicate') {
    e('sf_cnic', 'sfe_cnic', 'This CNIC already exists in another record.');
  } else if (sfmCnicStatus === 'checking') {
    e('sf_cnic', 'sfe_cnic', 'Still verifying CNIC — please wait a moment and try again.');
  }

  var iban = v('sf_iban');
  if (iban && !/^PK\d{2}[A-Z0-9]{20}$/i.test(iban)) {
    e('sf_iban', 'sfe_iban', 'Pakistani IBAN: PK + 2 digits + 20 alphanumeric chars (24 total).');
  } else if (sfmIbanStatus === 'duplicate') {
    e('sf_iban', 'sfe_iban', 'This IBAN already exists in another record.');
  } else if (sfmIbanStatus === 'checking') {
    e('sf_iban', 'sfe_iban', 'Still verifying IBAN — please wait a moment and try again.');
  }

  return ok;
}

// ---------- Open modal ----------
// ---------- Designations (General Management) ----------
// The dropdown used to be a hardcoded <option> list; it now loads from
// the Admin Panel's General Management → Staff Designations list, so
// adding/editing/removing a designation there needs no code change.
var sfmDesignationsLoaded = false;

function refreshDesignationOptions(callback) {
  google.script.run
    .withSuccessHandler(function(res) {
      if (!res.success) { if (callback) callback(); return; }
      var sel = document.getElementById('sf_designation');
      if (sel) {
        var keep = sel.value;
        sel.innerHTML = '<option value="">Select…</option>' +
          res.items.map(function(name) { return '<option>' + name + '</option>'; }).join('');
        if (keep && res.items.indexOf(keep) !== -1) sel.value = keep;
        else if (keep) { // designation this employee already has, but it's no longer on the active list — keep it selectable so their record isn't silently changed
          sel.insertAdjacentHTML('beforeend', '<option>' + keep + '</option>');
          sel.value = keep;
        }
      }
      sfmDesignationsLoaded = true;
      if (callback) callback();
    })
    .withFailureHandler(function() { if (callback) callback(); })
    .getStaffDesignations();
}

function openStaffFormModal(mode, row) {
  sfmMode       = mode;
  sfmCurrentRow = row || null;
  sfmSubmitting = false;

  refreshDesignationOptions(function() {
    if (row && row['DESIGNATION']) {
      var sel = document.getElementById('sf_designation');
      if (sel && sel.value !== row['DESIGNATION']) sel.value = row['DESIGNATION'];
    }
  });

  sfmEnsureSchoolCache(function() {
    if (sfmMode !== 'add' || (document.getElementById('sf_emis') || {}).value) {
      sfmOnEmisInput();
    }
  });

  var modal      = document.getElementById('staffFormModal');
  var form       = document.getElementById('staffForm');
  var modeTag    = document.getElementById('sfmModeTag');
  var title      = document.getElementById('sfmTitle');
  var footer     = document.getElementById('sfmFooter');
  var hdrActions = document.getElementById('sfmHeaderActions');

  form.querySelectorAll('.sfm-err').forEach(function(e) { e.textContent = ''; });
  form.querySelectorAll('.sfm-input,.sfm-select').forEach(function(e) {
    e.classList.remove('invalid', 'valid');
  });
  ['sfm_emisInfo','sfm_pnoInfo','sfm_cnicInfo'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); el.textContent = ''; }
  });
  document.getElementById('sfm_emisBadge').classList.add('hidden');

  if (mode === 'view') {
    form.classList.add('sfm-mode-view');
    modeTag.textContent = 'VIEW';
    modeTag.className   = 'sfm-mode-tag tag-view';
    title.textContent   = 'Staff Details';
    footer.innerHTML =
      '<button type="button" class="sfm-header-btn accent" onclick="sfmSwitchToEdit()">✏️ Edit Record</button>' +
      '<button type="button" class="sfm-header-btn" onclick="closeStaffFormModal()">Close</button>';
    hdrActions.innerHTML = '';
  } else if (mode === 'edit') {
    sfmCnicStatus = 'unchecked';
    sfmIbanStatus = 'unchecked';
    form.classList.remove('sfm-mode-view');
    modeTag.textContent = 'EDIT';
    modeTag.className   = 'sfm-mode-tag tag-edit';
    title.textContent   = 'Edit Staff Record';
    footer.innerHTML =
      '<button type="button" class="sfm-header-btn accent" id="sfmSaveBtn" onclick="sfmSubmit()">💾 Save Changes</button>' +
      '<button type="button" class="sfm-header-btn" onclick="sfmSwitchToView()">Cancel</button>';
    hdrActions.innerHTML = '';
  } else { // add
    sfmPnoStatus = 'unchecked';
    sfmCnicStatus = 'unchecked';
    sfmIbanStatus = 'unchecked';
    form.classList.remove('sfm-mode-view');
    modeTag.textContent = 'NEW';
    modeTag.className   = 'sfm-mode-tag tag-add';
    title.textContent   = 'Add New Staff Member';
    footer.innerHTML =
      '<button type="button" class="sfm-header-btn accent" id="sfmSaveBtn" onclick="sfmSubmit()">✅ Save Staff Member</button>' +
      '<button type="button" class="sfm-header-btn" onclick="closeStaffFormModal()">Cancel</button>';
    hdrActions.innerHTML = '';
  }

  document.getElementById('sf_emis').oninput         = sfmOnEmisInput;
  document.getElementById('sf_personalNo').oninput   = sfmOnPersonalNoInput;
  document.getElementById('sf_cnic').oninput         = sfmOnCnicInput;
  document.getElementById('sf_natureOfJob').onchange = toggleRegularizationDate;

  sfmPopulateForm(row);
  sfmSetInputsDisabled(mode === 'view');

  modal.classList.remove('hidden');
  document.getElementById('staffForm').scrollTop = 0;
}

function sfmSetInputsDisabled(disabled) {
  document.getElementById('staffForm').querySelectorAll('input,select').forEach(function(el) {
    if (['sf_markaz','sf_district','sf_wing','sf_tehsil'].includes(el.id)) {
      el.disabled = disabled;
      return;
    }
    if (el.id === 'sf_personalNo' && sfmMode === 'edit') {
      el.readOnly = true;
      el.classList.add('sfm-readonly');
      return;
    }
    el.disabled = disabled;
    if (el.id === 'sf_personalNo') {
      el.readOnly = false;
      el.classList.remove('sfm-readonly');
    }
  });
}

function sfmSwitchToEdit() { openStaffFormModal('edit', sfmCurrentRow); }
function sfmSwitchToView() { openStaffFormModal('view', sfmCurrentRow); }
function closeStaffFormModal() {
  document.getElementById('staffFormModal').classList.add('hidden');
  sfmSubmitting = false;
}

// ---------- Submit ----------
function sfmSubmit() {
  if (sfmSubmitting) return;

  if (!sfmValidate()) {
    showToast('Please fix the highlighted errors before saving.', 'warning');
    var firstErr = document.querySelector('#staffForm .sfm-input.invalid, #staffForm .sfm-select.invalid');
    if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  var data = sfmCollectData();
  sfmDoSave(data);
}

function sfmDoSave(data) {
  sfmSubmitting = true;
  var saveBtn = document.getElementById('sfmSaveBtn');
  if (saveBtn) saveBtn.disabled = true;
  showLoading();

  function finishUI() {
    sfmSubmitting = false;
    if (saveBtn) saveBtn.disabled = false;
    hideLoading();
  }

  var userPayload = getUserPayload();

  if (sfmMode === 'add') {
    google.script.run
      .withFailureHandler(function(err) {
        finishUI();
        showToast('Save failed: ' + (err && err.message ? err.message : 'Unknown error'), 'error');
      })
      .withSuccessHandler(function(res) {
        finishUI();
        try {
          if (res && res.success) {
            showToast('Staff member added successfully.', 'success');
            closeStaffFormModal();
            invalidateCache('Staff');
            if (currentSheetView === 'Staff') applyFilter();
            else showEmptyState && renderTable && renderTable();
            if (typeof hrInvalidateCache === 'function') hrInvalidateCache('Staff');
            if (typeof applyHrFilter === 'function') applyHrFilter();
          } else {
            showToast('Error: ' + (res && (res.errors ? res.errors.join(', ') : res.error) || 'Unknown error'), 'error');
          }
        } catch (uiErr) {
          closeStaffFormModal();
          try { applyFilter(); } catch (_e) {}
          showToast('Saved, but the view could not refresh automatically. Please click Apply Filter.', 'warning');
        }
      }).addStaffRow(data, userPayload);
  } else {
    google.script.run
      .withFailureHandler(function(err) {
        finishUI();
        showToast('Update failed: ' + (err && err.message ? err.message : 'Unknown error'), 'error');
      })
      .withSuccessHandler(function(res) {
        finishUI();
        try {
          if (res && res.success) {
            showToast('Record updated successfully.', 'success');
            if (sfmCurrentRow) Object.assign(sfmCurrentRow, data);
            sfmSwitchToView();
            invalidateCache(currentSheetView);
            applyFilter();
            if (typeof hrInvalidateCache === 'function') hrInvalidateCache('Staff');
            if (typeof applyHrFilter === 'function') applyHrFilter();
          } else {
            showToast('Error: ' + (res && res.error || 'Unknown error'), 'error');
          }
        } catch (uiErr) {
          closeStaffFormModal();
          try { applyFilter(); } catch (_e) {}
          showToast('Saved, but the view could not refresh automatically. Please click Apply Filter.', 'warning');
        }
      }).updateStaffRow(data, userPayload);
  }
}

// ══════════════════════════════════════════════════════════════════
//  TRANSFER MODAL
// ══════════════════════════════════════════════════════════════════
var transferRowData = null;
var tfSubmitting    = false;

window.openTransferModal = function(row) {
  transferRowData = row;
  tfSubmitting     = false;

  sfmEnsureSchoolCache(function() {
    _sfmRenderTransferModal(row);
  });
};

function _sfmRenderTransferModal(row) {
  var currentEmis    = safeVal(row['SCHOOL EMIS CODE']);
  var currentSchool  = safeVal(row['SCHOOL NAME']);
  var currentMark    = safeVal(row['MARKAZ NAME']);
  var teacherName    = safeVal(row['NAME OF TEACHER']);
  var personalNo     = safeVal(row['PERSONAL NO.']);
  var currentPosting = safeVal(row['DATE OF POSTING IN PRESENT SCHOOL']);

  document.getElementById('transferModalBody').innerHTML =
    '<div class="transfer-info-box">' +
      '<strong>📋 Current Assignment</strong>' +
      '<div><b>Teacher:</b> ' + escHtml(teacherName) + ' &nbsp;|&nbsp; <b>P.No:</b> ' + escHtml(personalNo) + '</div>' +
      '<div><b>EMIS:</b> ' + escHtml(currentEmis) + ' &nbsp;|&nbsp; <b>School:</b> ' + escHtml(currentSchool) + '</div>' +
      '<div><b>Markaz:</b> ' + escHtml(currentMark) + ' &nbsp;|&nbsp; <b>Posted Since:</b> ' + (escHtml(currentPosting) || '—') + '</div>' +
    '</div>' +
    '<hr class="transfer-divider">' +

    '<div class="transfer-step">' +
      '<label>Target EMIS Code (New School) <span style="color:var(--danger)">*</span></label>' +
      '<input type="text" id="tf_targetEmis" placeholder="8-digit EMIS code" maxlength="8" inputmode="numeric" oninput="tfOnTargetEmis()">' +
      '<div class="transfer-err" id="tfe_emis"></div>' +
      '<div id="tf_newSchoolInfo" class="transfer-info-box hidden" style="margin-top:8px"></div>' +
    '</div>' +

    '<div class="transfer-step">' +
      '<label>Notification No. <span style="color:var(--danger)">*</span></label>' +
      '<input type="text" id="tf_notifNo" placeholder="Transfer order / notification number">' +
      '<div class="transfer-err" id="tfe_notif"></div>' +
    '</div>' +

    '<div class="transfer-step">' +
      '<label>Date of Joining New School <span style="color:var(--danger)">*</span></label>' +
      '<input type="date" id="tf_joiningDate" onclick="try{this.showPicker()}catch(e){}">' +
      '<div class="transfer-err" id="tfe_date"></div>' +
      '<div class="transfer-hint">This date will be written to col Q (Date of Posting in Present School).</div>' +
    '</div>' +

    '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">' +
      '<button type="button" class="primary-btn" id="tfSubmitBtn" onclick="tfSubmit()">✅ Confirm Transfer</button>' +
      '<button type="button" class="secondary-btn" onclick="closeTransferModal()">Cancel</button>' +
    '</div>';

  document.getElementById('transferModal').classList.remove('hidden');
}

function tfOnTargetEmis() {
  var emis    = (document.getElementById('tf_targetEmis').value || '').trim();
  var infoBox = document.getElementById('tf_newSchoolInfo');
  var errEl   = document.getElementById('tfe_emis');
  var el      = document.getElementById('tf_targetEmis');

  infoBox.classList.add('hidden');
  errEl.textContent = '';
  el.classList.remove('invalid', 'valid');

  if (!/^\d{8}$/.test(emis)) return;

  var found = sfmEmisMap[emis.toLowerCase()];
  if (!found) {
    errEl.textContent = '⚠ EMIS not found in Schools data.';
    el.classList.add('invalid');
    return;
  }
  el.classList.add('valid');
  infoBox.classList.remove('hidden');
  infoBox.innerHTML =
    '<strong>✓ New School Found</strong>' +
    '<div><b>School:</b> ' + escHtml(found.s) + '</div>' +
    '<div><b>District:</b> ' + escHtml(found.d) + ' &nbsp;|&nbsp; <b>Wing:</b> ' + escHtml(found.w) + '</div>' +
    '<div><b>Tehsil:</b> ' + escHtml(found.t) + ' &nbsp;|&nbsp; <b>Markaz:</b> ' + escHtml(found.m) + '</div>';
}

async function tfSubmit() {
  if (tfSubmitting) return;

  var targetEmis  = (document.getElementById('tf_targetEmis').value || '').trim();
  var notifNo     = (document.getElementById('tf_notifNo').value || '').trim();
  var joiningDate = (document.getElementById('tf_joiningDate').value || '').trim();
  var ok = true;

  document.querySelectorAll('.transfer-err').forEach(function(e) { e.textContent = ''; });
  document.querySelectorAll('#transferModalBody input').forEach(function(e) {
    e.classList.remove('invalid');
  });

  if (!targetEmis || !/^\d{8}$/.test(targetEmis)) {
    document.getElementById('tfe_emis').textContent = 'Valid 8-digit EMIS code is required.';
    document.getElementById('tf_targetEmis').classList.add('invalid'); ok = false;
  } else if (!sfmEmisMap[targetEmis.toLowerCase()]) {
    document.getElementById('tfe_emis').textContent = '⚠ EMIS not found in Schools data.';
    document.getElementById('tf_targetEmis').classList.add('invalid'); ok = false;
  }
  if (!notifNo) {
    document.getElementById('tfe_notif').textContent = 'Notification No. is required.';
    document.getElementById('tf_notifNo').classList.add('invalid'); ok = false;
  }
  if (!joiningDate) {
    document.getElementById('tfe_date').textContent = 'Date of joining is required.';
    document.getElementById('tf_joiningDate').classList.add('invalid'); ok = false;
  }
  if (!ok) {
    showToast('Please fix the highlighted errors before confirming.', 'warning');
    return;
  }

  // SNE vacancy pre-check — the teacher keeps their current grade on a
  // transfer, so confirm the destination EMIS has a vacant seat there.
  var currentBps = parseInt(safeVal(transferRowData['BPS']), 10);
  if (!isNaN(currentBps)) {
    try {
      var vacCheck = await _sb.rpc('check_grade_vacancy', { p_emis: targetEmis, p_grade: currentBps });
      if (!vacCheck.error && vacCheck.data === false) {
        showToast('Vacant seat not available for BPS-' + currentBps + ' at EMIS ' + targetEmis + '.', 'error');
        return;
      }
    } catch (e) { /* fail open — server-side check in executeTransfer still applies */ }
  }

  var newSchool     = sfmEmisMap[targetEmis.toLowerCase()];
  var formattedDate = joiningDate;  // already YYYY-MM-DD from the date input
  var teacherName   = safeVal(transferRowData['NAME OF TEACHER']);

  if (!confirm(
    'Confirm transfer of "' + teacherName + '"\n' +
    '→ New EMIS: ' + targetEmis + ' (' + (newSchool.s || newSchool.m) + ')\n' +
    '→ Notification: ' + notifNo + '\n' +
    '→ Joining Date (col Q): ' + formattedDate
  )) return;

  tfSubmitting = true;
  var btn = document.getElementById('tfSubmitBtn');
  if (btn) btn.disabled = true;
  showLoading();

  function finishUI() {
    tfSubmitting = false;
    if (btn) btn.disabled = false;
    hideLoading();
  }

  var userPayload = getUserPayload();

  google.script.run
    .withFailureHandler(function(err) {
      finishUI();
      showToast('Transfer failed: ' + (err && err.message ? err.message : 'Unknown error'), 'error');
    })
    .withSuccessHandler(function(res) {
      finishUI();
      try {
        if (res && res.success) {
          showToast(res.message || 'Transfer completed.', 'success');
          closeTransferModal();
          invalidateCache('Staff');
          applyFilter();
          if (typeof hrInvalidateCache === 'function') hrInvalidateCache('Staff');
          if (typeof applyHrFilter === 'function') applyHrFilter();
        } else {
          showToast('Error: ' + (res && res.error || 'Unknown error'), 'error');
        }
      } catch (uiErr) {
        closeTransferModal();
        try { applyFilter(); } catch (_e) {}
        showToast('Saved, but the view could not refresh automatically. Please click Apply Filter.', 'warning');
      }
    }).executeTransfer({
      personalNo:     safeVal(transferRowData['PERSONAL NO.']),
      rowNum:         transferRowData._row,
      targetEmis:     targetEmis,
      notificationNo: notifNo,
      newJoiningDate: formattedDate
    }, userPayload);
}

function closeTransferModal() {
  document.getElementById('transferModal').classList.add('hidden');
  transferRowData = null;
  tfSubmitting     = false;
}

// ══════════════════════════════════════════════════════════════════
//  PROMOTION MODAL
// ══════════════════════════════════════════════════════════════════
var promotionRowData = null;
var pmSubmitting     = false;

window.openPromotionModal = function(row) {
  promotionRowData = row;
  pmSubmitting     = false;

  sfmEnsureSchoolCache(function() {
    _sfmRenderPromotionModal(row);
  });
};

function _sfmRenderPromotionModal(row) {
  var teacherName = safeVal(row['NAME OF TEACHER']);
  var personalNo  = safeVal(row['PERSONAL NO.']);
  var currentDes  = safeVal(row['DESIGNATION']);
  var currentBps  = safeVal(row['BPS']);
  var currentPps  = safeVal(row['PPS']);
  var currentEmis   = safeVal(row['SCHOOL EMIS CODE']);
  var currentSchool = safeVal(row['SCHOOL NAME']);

  document.getElementById('promotionModalBody').innerHTML =
    '<div class="transfer-info-box">' +
      '<strong>📋 Current Record</strong>' +
      '<div><b>Teacher:</b> ' + escHtml(teacherName) + ' &nbsp;|&nbsp; <b>P.No:</b> ' + escHtml(personalNo) + '</div>' +
      '<div><b>Designation:</b> ' + escHtml(currentDes) + ' &nbsp;|&nbsp; <b>BPS:</b> ' + escHtml(currentBps) + '</div>' +
      '<div><b>EMIS:</b> ' + escHtml(currentEmis) + ' &nbsp;|&nbsp; <b>School:</b> ' + escHtml(currentSchool) + '</div>' +
    '</div>' +
    '<hr class="transfer-divider">' +

    '<div class="transfer-step">' +
      '<label>Notification No. <span style="color:var(--danger)">*</span></label>' +
      '<input type="text" id="pm_notifNo" placeholder="Promotion order / notification number">' +
      '<div class="transfer-err" id="pme_notif"></div>' +
    '</div>' +

    '<div class="transfer-step">' +
      '<label>New Designation <span style="color:var(--danger)">*</span></label>' +
      '<select id="pm_designation">' +
        '<option value="">Select…</option>' +
        ['PST','ESE','EST','PET','SESE','SST','SSE','Headmaster','Headmistress'].map(function(d) {
          return '<option value="' + d + '"' + (d === currentDes ? ' selected' : '') + '>' + d + '</option>';
        }).join('') +
      '</select>' +
      '<div class="transfer-err" id="pme_designation"></div>' +
    '</div>' +

    '<div class="transfer-step">' +
      '<label>New BPS (Scale) <span style="color:var(--danger)">*</span></label>' +
      '<input type="number" id="pm_bps" min="1" max="22" placeholder="1–22" value="' + escHtml(currentBps) + '">' +
      '<div class="transfer-err" id="pme_bps"></div>' +
    '</div>' +

    '<div class="transfer-step">' +
      '<label>New PPS</label>' +
      '<input type="number" id="pm_pps" min="1" max="22" placeholder="Auto-fills with BPS" value="' + escHtml(currentPps) + '">' +
      '<div class="transfer-err" id="pme_pps"></div>' +
    '</div>' +

    '<div class="transfer-step">' +
      '<label>Target EMIS Code (New School after Promotion) <span style="color:var(--danger)">*</span></label>' +
      '<input type="text" id="pm_targetEmis" placeholder="8-digit EMIS code" maxlength="8" inputmode="numeric" oninput="pmOnTargetEmis()">' +
      '<div class="transfer-err" id="pme_emis"></div>' +
      '<div id="pm_newSchoolInfo" class="transfer-info-box hidden" style="margin-top:8px"></div>' +
    '</div>' +

    '<div class="transfer-step">' +
      '<label>Date of Posting in Present School (col Q)</label>' +
      '<input type="date" id="pm_postingDate" onclick="try{this.showPicker()}catch(e){}">' +
      '<div class="transfer-hint">Leave blank to keep current value.</div>' +
    '</div>' +

    '<div class="transfer-step">' +
      '<label>Date of Joining in Present Scale (col R) <span style="color:var(--danger)">*</span></label>' +
      '<input type="date" id="pm_scaleDate" onclick="try{this.showPicker()}catch(e){}">' +
      '<div class="transfer-err" id="pme_scaleDate"></div>' +
      '<div class="transfer-hint">This date will be written to col R.</div>' +
    '</div>' +

    '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">' +
      '<button type="button" class="primary-btn" id="pmSubmitBtn" onclick="pmSubmit()">✅ Confirm Promotion</button>' +
      '<button type="button" class="secondary-btn" onclick="closePromotionModal()">Cancel</button>' +
    '</div>';

  document.getElementById('promotionModal').classList.remove('hidden');

  document.getElementById('pm_bps').addEventListener('input', function(e) {
    document.getElementById('pm_pps').value = e.target.value;
  });
}

function pmOnTargetEmis() {
  var emis    = (document.getElementById('pm_targetEmis').value || '').trim();
  var infoBox = document.getElementById('pm_newSchoolInfo');
  var errEl   = document.getElementById('pme_emis');
  var el      = document.getElementById('pm_targetEmis');

  infoBox.classList.add('hidden');
  errEl.textContent = '';
  el.classList.remove('invalid', 'valid');

  if (!/^\d{8}$/.test(emis)) return;

  var found = sfmEmisMap[emis.toLowerCase()];
  if (!found) {
    errEl.textContent = '⚠ EMIS not found in Schools data.';
    el.classList.add('invalid');
    return;
  }
  el.classList.add('valid');
  infoBox.classList.remove('hidden');
  infoBox.innerHTML =
    '<strong>✓ Target School Found</strong>' +
    '<div><b>School:</b> ' + escHtml(found.s) + '</div>' +
    '<div><b>District:</b> ' + escHtml(found.d) + ' &nbsp;|&nbsp; <b>Wing:</b> ' + escHtml(found.w) + '</div>' +
    '<div><b>Tehsil:</b> ' + escHtml(found.t) + ' &nbsp;|&nbsp; <b>Markaz:</b> ' + escHtml(found.m) + '</div>';
}

async function pmSubmit() {
  if (pmSubmitting) return;

  var notifNo     = (document.getElementById('pm_notifNo').value || '').trim();
  var designation = (document.getElementById('pm_designation').value || '').trim();
  var bps         = (document.getElementById('pm_bps').value || '').trim();
  var pps         = (document.getElementById('pm_pps').value || '').trim();
  var targetEmis  = (document.getElementById('pm_targetEmis').value || '').trim();
  var postingDate = (document.getElementById('pm_postingDate').value || '').trim();
  var scaleDate   = (document.getElementById('pm_scaleDate').value || '').trim();
  var ok = true;

  document.querySelectorAll('#promotionModalBody .transfer-err').forEach(function(e) { e.textContent = ''; });
  document.querySelectorAll('#promotionModalBody input, #promotionModalBody select').forEach(function(e) {
    e.classList.remove('invalid');
  });

  if (!notifNo) {
    document.getElementById('pme_notif').textContent = 'Notification No. is required.';
    document.getElementById('pm_notifNo').classList.add('invalid'); ok = false;
  }
  if (!designation) {
    document.getElementById('pme_designation').textContent = 'New Designation is required.';
    document.getElementById('pm_designation').classList.add('invalid'); ok = false;
  }
  if (!bps || isNaN(bps) || +bps < 1 || +bps > 22) {
    document.getElementById('pme_bps').textContent = 'BPS must be 1–22.';
    document.getElementById('pm_bps').classList.add('invalid'); ok = false;
  }
  if (pps && (isNaN(pps) || +pps < 1 || +pps > 22)) {
    document.getElementById('pme_pps').textContent = 'PPS must be 1–22.';
    document.getElementById('pm_pps').classList.add('invalid'); ok = false;
  }
  if (!targetEmis || !/^\d{8}$/.test(targetEmis)) {
    document.getElementById('pme_emis').textContent = 'Valid 8-digit EMIS code is required.';
    document.getElementById('pm_targetEmis').classList.add('invalid'); ok = false;
  } else if (!sfmEmisMap[targetEmis.toLowerCase()]) {
    document.getElementById('pme_emis').textContent = '⚠ EMIS not found in Schools data.';
    document.getElementById('pm_targetEmis').classList.add('invalid'); ok = false;
  }
  if (!scaleDate) {
    document.getElementById('pme_scaleDate').textContent = 'Date of Joining in Present Scale is required.';
    document.getElementById('pm_scaleDate').classList.add('invalid'); ok = false;
  }
  if (!ok) {
    showToast('Please fix the highlighted errors before confirming.', 'warning');
    return;
  }

  // SNE vacancy pre-check — promotion moves the employee to a NEW grade,
  // so confirm the target EMIS has a vacant seat at that new grade.
  var newBpsNum = parseInt(bps, 10);
  if (!isNaN(newBpsNum)) {
    try {
      var vacCheck = await _sb.rpc('check_grade_vacancy', { p_emis: targetEmis, p_grade: newBpsNum });
      if (!vacCheck.error && vacCheck.data === false) {
        showToast('Vacant seat not available for BPS-' + newBpsNum + ' at EMIS ' + targetEmis + '.', 'error');
        return;
      }
    } catch (e) { /* fail open — server-side check in executePromotion still applies */ }
  }

  var teacherName      = safeVal(promotionRowData['NAME OF TEACHER']);
  var formattedPosting = postingDate || '';  // already YYYY-MM-DD from the date input
  var formattedScale   = scaleDate;           // already YYYY-MM-DD from the date input

  if (!confirm(
    'Confirm promotion of "' + teacherName + '"?\n' +
    '→ New Designation: ' + designation + '\n' +
    '→ New BPS: ' + bps + '\n' +
    '→ Target EMIS: ' + targetEmis + '\n' +
    '→ Notification: ' + notifNo + '\n' +
    '→ Scale Joining Date (col R): ' + formattedScale +
    (formattedPosting ? '\n→ Posting Date (col Q): ' + formattedPosting : '')
  )) return;

  pmSubmitting = true;
  var btn = document.getElementById('pmSubmitBtn');
  if (btn) btn.disabled = true;
  showLoading();

  function finishUI() {
    pmSubmitting = false;
    if (btn) btn.disabled = false;
    hideLoading();
  }

  var userPayload = getUserPayload();

  google.script.run
    .withFailureHandler(function(err) {
      finishUI();
      showToast('Promotion failed: ' + (err && err.message ? err.message : 'Unknown error'), 'error');
    })
    .withSuccessHandler(function(res) {
      finishUI();
      try {
        if (res && res.success) {
          showToast(res.message || 'Promotion recorded.', 'success');
          closePromotionModal();
          invalidateCache('Staff');
          applyFilter();
          if (typeof hrInvalidateCache === 'function') hrInvalidateCache('Staff');
          if (typeof applyHrFilter === 'function') applyHrFilter();
        } else {
          showToast('Error: ' + (res && res.error || 'Unknown error'), 'error');
        }
      } catch (uiErr) {
        closePromotionModal();
        try { applyFilter(); } catch (_e) {}
        showToast('Saved, but the view could not refresh automatically. Please click Apply Filter.', 'warning');
      }
    }).executePromotion({
      personalNo:         safeVal(promotionRowData['PERSONAL NO.']),
      rowNum:             promotionRowData._row,
      newDesignation:     designation,
      newBps:             bps,
      newPps:             pps,
      targetEmis:         targetEmis,
      newPostingDate:     formattedPosting,
      newScaleJoiningDate: formattedScale,
      notificationNo:     notifNo
    }, userPayload);
}

function closePromotionModal() {
  document.getElementById('promotionModal').classList.add('hidden');
  promotionRowData = null;
  pmSubmitting     = false;
}

// ══════════════════════════════════════════════════════════════════
//  OVERRIDE BASE FUNCTIONS
// ══════════════════════════════════════════════════════════════════
window.showDetailModal = function(row) { openStaffFormModal('view', row); };
window.openEditModal   = function(row) { openStaffFormModal('edit', row); };
window.openAddStaffModal = function()  { openStaffFormModal('add', null); };
