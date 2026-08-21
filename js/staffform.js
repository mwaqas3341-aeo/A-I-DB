// ── StaffForm module JS ──
// ══════════════════════════════════════════════════════════════════
//  STAFF FORM — unified Add / Edit / View
// ══════════════════════════════════════════════════════════════════

// ---------- State ----------
var sfmEmisMap    = {};   // emis_lowercase → {d,w,t,m,e}  (jurisdiction-scoped — Add/Edit "current school")
var sfmTargetSchoolPool = [];  // ALL schools, no jurisdiction filter — Transfer/Promotion target EMIS only
var sfmTargetSchoolMap  = {};  // emis_lowercase → {d,w,t,m,e}, built from sfmTargetSchoolPool
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
  sf_designationGroup:     'designation_group',
  sf_adjustedAgainst:      'posted_against_seat_id',
  sf_workingAsHead:        'working_as_head',
  sf_bps:                  'bps',
  sf_pps:                  'pps',
  sf_natureOfJob:          'nature_of_job',
  sf_regularizationDate:   'date_of_permanentization',
  sf_contractStartDate:      'contract_start_date',
  sf_contractTenure:         'contract_tenure_months',
  sf_contractExpectedEndDate: 'contract_expected_end_date',
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

// ---------- Global (unrestricted) school pool — Transfer/Promotion target EMIS ----------
// Deliberately NOT jurisdiction-scoped: a transfer/promotion target school can be
// anywhere in the system, so this pulls the full national list via getAllSchoolsGlobal
// instead of reusing hrSchoolCache/schoolCache (which openTransferModal/openPromotionModal
// callers must NOT be pointed at, since those stay jurisdiction-filtered everywhere else).
function buildSfmTargetSchoolMap() {
  sfmTargetSchoolMap = {};
  sfmTargetSchoolPool.forEach(function(s) {
    if (s.e) sfmTargetSchoolMap[s.e.toString().trim().toLowerCase()] = s;
  });
}

function sfmEnsureTargetSchoolCache(callback) {
  if (sfmTargetSchoolPool.length > 0) {
    buildSfmTargetSchoolMap();
    if (callback) callback();
    return;
  }
  google.script.run
    .withSuccessHandler(function(data) {
      sfmTargetSchoolPool = data || [];
      buildSfmTargetSchoolMap();
      if (callback) callback();
    })
    .withFailureHandler(function(err) {
      if (typeof showToast === 'function') {
        showToast('Error loading full school list: ' + (err && err.message ? err.message : 'Unknown error'), 'error');
      }
      if (callback) callback();
    })
    .getAllSchoolsGlobal();
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

  sfmRefreshAdjustedAgainstOptions();
}

// ---------- Designation Group → Adjusted Against (seat) live-lookup ----------
// "Adjusted Against" replaces the old auto-pooling-by-designation-string
// logic: the user explicitly picks which sanctioned seat (from the same
// live sne_subject_sanctioned data Seat Management shows) this posting
// counts against, instead of the system guessing via fuzzy designation
// matching. filled_count/vacant_count on that seat update immediately
// from this single explicit link — no ambiguity possible.
var sfmSeatsCache = []; // last fetched list, kept so sfv_adjustedAgainst (view mode) can show a label, not just the id

function sfmOnDesignationGroupChange() {
  sfmRefreshAdjustedAgainstOptions();
}

function sfmRefreshAdjustedAgainstOptions() {
  var emis = (document.getElementById('sf_emis').value || '').trim();
  var group = (document.getElementById('sf_designationGroup').value || '').trim();
  var sel = document.getElementById('sf_adjustedAgainst');
  if (!sel) return;

  var previousValue = sel.value;
  sfmSeatsCache = [];

  if (!/^\d{8}$/.test(emis) || !group) {
    sel.innerHTML = '<option value="">Select a school and Designation Group first…</option>';
    sel.disabled = true;
    return;
  }

  sel.disabled = true;
  sel.innerHTML = '<option value="">⏳ Loading seats…</option>';

  google.script.run
    .withSuccessHandler(function(resp) {
      sel.disabled = false;
      if (!resp || !resp.success) {
        sel.innerHTML = '<option value="">⚠ Could not load seats' + (resp && resp.message ? ': ' + resp.message : '') + '</option>';
        return;
      }
      sfmSeatsCache = resp.seats || [];
      if (sfmSeatsCache.length === 0) {
        sel.innerHTML = '<option value="">No sanctioned seats found for this school + group</option>';
        return;
      }
      var html = '<option value="">Select a seat…</option>';
      sfmSeatsCache.forEach(function(s) {
        var label = (s.subject_label || s.designation) + ' — Grade ' + s.grade +
          (s.is_head_post ? ' (Head)' : '') +
          ' — Sanctioned: ' + s.sanctioned_count + ', Filled: ' + s.filled_count + ', Vacant: ' + s.vacant_count;
        if (s.vacant_count <= 0) label += '  ⚠ FULL';
        html += '<option value="' + s.id + '"' + (String(s.id) === previousValue ? ' selected' : '') + '>' + escHtml(label) + '</option>';
      });
      sel.innerHTML = html;
    })
    .withFailureHandler(function() {
      sel.disabled = false;
      sel.innerHTML = '<option value="">⚠ Could not load seats — try again</option>';
    })
    .getSeatsForPosting({ emis: emis, designationGroup: group });
}

// Called just before submit, if the user picked an already-full seat —
// warns but does not block, per design (overfill is allowed with a
// warning, matching how it already works elsewhere in this app).
function sfmCheckAdjustedAgainstOverfill() {
  var sel = document.getElementById('sf_adjustedAgainst');
  if (!sel || !sel.value) return true;
  var seat = sfmSeatsCache.find(function(s) { return String(s.id) === sel.value; });
  if (seat && seat.vacant_count <= 0) {
    return confirm(
      'This seat is already fully filled (Sanctioned: ' + seat.sanctioned_count + ', Filled: ' + seat.filled_count + ').\n\n' +
      'You can still adjust this employee against it, but it will show as overfilled in Seat Management and SNE.\n\n' +
      'Continue anyway?'
    );
  }
  return true;
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

// ---------- Contract fields toggle + auto Expected End Date ----------
// Contract Start Date + Tenure are only relevant for Contract employees.
// Expected End Date is always derived (Start Date + Tenure in months),
// never typed directly, and is intentionally separate from the
// "End Contract" HR action's Contract End Date (see the DB migration
// note) — this one's a forecast, that one's what actually happened.
function toggleContractFields() {
  var jobNature = document.getElementById('sf_natureOfJob').value;
  var isContract = jobNature === 'Contract';
  ['contractStartContainer', 'contractTenureContainer', 'contractExpectedEndContainer'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = isContract ? 'flex' : 'none';
  });
  if (!isContract && sfmMode !== 'view') {
    document.getElementById('sf_contractStartDate').value = '';
    document.getElementById('sf_contractTenure').value = '';
    document.getElementById('sf_contractExpectedEndDate').value = '';
  }
}

function sfmCalcContractExpectedEndDate() {
  var startVal = document.getElementById('sf_contractStartDate').value;
  var months   = parseInt(document.getElementById('sf_contractTenure').value, 10);
  var out      = document.getElementById('sf_contractExpectedEndDate');
  if (!startVal || !months) { out.value = ''; return; }

  var parts = startVal.split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  d.setMonth(d.getMonth() + months);
  // Contract runs THROUGH the tenure — end date is the day before the
  // same calendar date N months later (e.g. 1 Jan + 12 months tenure
  // ends 31 Dec, not 1 Jan next year).
  d.setDate(d.getDate() - 1);

  out.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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
    if (span) {
      if (id === 'sf_contractTenure' && val) {
        var tenureLabels = {'3':'3 Months','6':'6 Months','12':'1 Year','18':'1.5 Years','24':'2 Years','36':'3 Years','48':'4 Years','60':'5 Years'};
        span.textContent = tenureLabels[val] || (val + ' Months');
      } else {
        span.textContent = val || '—';
      }
    }
  });

  if (row && sfmMode !== 'view') sfmOnEmisInput();
  toggleRegularizationDate();
  toggleContractFields();
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

  // Contract Start Date + Tenure only make sense together — not
  // hard-required overall (same reasoning as Designation/BPS/etc.
  // below), but if only one of the pair is filled in, that's a
  // half-entered state worth flagging rather than silently saving.
  if (v('sf_natureOfJob') === 'Contract') {
    var cStart = v('sf_contractStartDate');
    var cTenure = v('sf_contractTenure');
    if (cStart && !cTenure) e('sf_contractTenure', 'sfe_contractTenure', 'Select a tenure to calculate the Expected End Date.');
    if (cTenure && !cStart) e('sf_contractStartDate', 'sfe_contractStartDate', 'Contract Start Date is required to calculate the Expected End Date.');
  }

  // Name/DOB/Gender/Designation/BPS/Govt-Entry-Date are no longer
  // hard-required — AEOs entering or updating a record from a paper
  // file don't always have every field on hand in one sitting, and the
  // old behavior blocked saving ANY change (even something as small as
  // a phone number update) until all of these were filled in. They can
  // still be added later via Edit. Personal No. and EMIS Code stay
  // required below: Personal No. is the record's identity key used
  // everywhere else (transfers/promotions/revert/uniqueness), and EMIS
  // Code is what the whole jurisdiction-visibility system derives
  // District/Wing/Tehsil/Markaz from — leaving it blank would silently
  // make the record invisible in every non-admin user's filtered views.
  if (!v('sf_name')) e('sf_name', 'sfe_name', 'Name of Teacher is required.');

  var bps = v('sf_bps');
  if (bps && (isNaN(bps) || +bps < 1 || +bps > 22))
    e('sf_bps', 'sfe_bps', 'BPS must be 1–22.');

  var pps = v('sf_pps');
  if (pps && (isNaN(pps) || +pps < 1 || +pps > 22))
    e('sf_pps', 'sfe_pps', 'PPS must be 1–22.');

  // Optional — see note above; format isn't checked either since it's
  // a plain date input (browser already constrains it to a valid date).

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

function sfmOnStaffCategoryChange() {
  var sel = document.getElementById('sf_designation');
  var cat = document.getElementById('sf_staffCategory').value;
  if (!cat) {
    if (sel) sel.innerHTML = '<option value="">Select a Staff Category first…</option>';
    return;
  }
  // A manual category switch invalidates whatever designation was
  // selected under the old category — clear it rather than trying to
  // carry it over, so the person always re-picks from the right list.
  if (sel) sel.value = '';
  refreshDesignationOptions();
}

function refreshDesignationOptions(callback) {
  var cat = (document.getElementById('sf_staffCategory') || {}).value || '';
  if (!cat) {
    var sel0 = document.getElementById('sf_designation');
    if (sel0) sel0.innerHTML = '<option value="">Select a Staff Category first…</option>';
    if (callback) callback();
    return;
  }
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
    .getStaffDesignations({ category: cat });
}

function openStaffFormModal(mode, row) {
  sfmMode       = mode;
  sfmCurrentRow = row || null;
  sfmSubmitting = false;

  if (typeof hrEnsureSubjectCache === 'function') hrEnsureSubjectCache();

  var catSel = document.getElementById('sf_staffCategory');
  if (row && row['DESIGNATION']) {
    // Existing employee: figure out which category their current
    // designation belongs to, so the Designation dropdown re-populates
    // with the right filtered list before we try to select it.
    google.script.run
      .withSuccessHandler(function(res) {
        var cat = (res && res.success && res.map && res.map[row['DESIGNATION']]) || '';
        if (catSel) catSel.value = cat;
        var catSpan = document.getElementById('sfv_staffCategory');
        if (catSpan) catSpan.textContent = cat === 'non_teaching' ? 'Non-Teaching Staff' : cat === 'teaching' ? 'Teaching Staff' : '—';
        refreshDesignationOptions(function() {
          var sel = document.getElementById('sf_designation');
          if (sel && sel.value !== row['DESIGNATION']) {
            if (![].some.call(sel.options, function(o) { return o.value === row['DESIGNATION']; })) {
              sel.insertAdjacentHTML('beforeend', '<option>' + row['DESIGNATION'] + '</option>');
            }
            sel.value = row['DESIGNATION'];
          }
        });
      })
      .withFailureHandler(function() { refreshDesignationOptions(); })
      .getDesignationCategoryMap();
  } else {
    // New employee: nothing to prefill — Designation stays disabled
    // until a Staff Category is chosen (see sfmOnStaffCategoryChange).
    if (catSel) catSel.value = '';
    var dsel = document.getElementById('sf_designation');
    if (dsel) dsel.innerHTML = '<option value="">Select a Staff Category first…</option>';
  }

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
  document.getElementById('sf_natureOfJob').onchange = function() {
    toggleRegularizationDate();
    toggleContractFields();
  };

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

  if (!sfmCheckAdjustedAgainstOverfill()) return;

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

  // Target EMIS must be searchable against the FULL school list, not just
  // this officer's jurisdiction — sfmEnsureTargetSchoolCache loads that
  // separately from sfmEnsureSchoolCache (which stays jurisdiction-scoped).
  sfmEnsureTargetSchoolCache(function() {
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
      '<input type="date" id="tf_joiningDate" onclick="smartDatePickerClick(this)">' +
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

  var found = sfmTargetSchoolMap[emis.toLowerCase()];
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
  } else if (!sfmTargetSchoolMap[targetEmis.toLowerCase()]) {
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
      var vacCheck = await hrGateway.checkGradeVacancy(targetEmis, currentBps);
      if (!vacCheck.error && vacCheck.data === false) {
        showToast('Vacant seat not available for BPS-' + currentBps + ' at EMIS ' + targetEmis + '.', 'error');
        return;
      }
    } catch (e) { /* fail open — server-side check in executeTransfer still applies */ }
  }

  var newSchool     = sfmTargetSchoolMap[targetEmis.toLowerCase()];
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
//  MUTUAL TRANSFER MODAL
// ──────────────────────────────────────────────────────────────────
//  Step 1: pick a target EMIS (the OTHER school in the swap) and look
//          up its active employees with the same BPS as the employee
//          who triggered the modal.
//  Step 2: pick one of those employees, then confirm — both employees
//          swap postings (and each other's "date of joining new
//          school") in one call to executeMutualTransfer.
//  Like Transfer/Promotion, the target-school search deliberately uses
//  the unrestricted sfmTargetSchoolMap/getAllSchoolsGlobal pool — a
//  mutual transfer's whole point is that it can cross jurisdictions in
//  either direction.
// ══════════════════════════════════════════════════════════════════
var mtRowA       = null;   // the employee the modal was opened for ("Employee A")
var mtCandidates = [];     // last search results ("Employee B" candidates)
var mtSelectedB  = null;   // the chosen candidate
var mtSubmitting = false;
var mtUsedPrivilegedSearch = true;   // false = fell back to a jurisdiction-scoped search (see sql/mutual_transfer_setup.sql)

window.openMutualTransferModal = function(row) {
  mtRowA       = row;
  mtCandidates = [];
  mtSelectedB  = null;
  mtSubmitting = false;
  mtUsedPrivilegedSearch = true;

  sfmEnsureTargetSchoolCache(function() {
    _mtRenderStep1(row);
  });
};

function _mtRenderStep1(row) {
  var teacherName   = safeVal(row['NAME OF TEACHER']);
  var personalNo    = safeVal(row['PERSONAL NO.']);
  var currentEmis   = safeVal(row['SCHOOL EMIS CODE']);
  var currentSchool = safeVal(row['SCHOOL NAME']);
  var currentMark   = safeVal(row['MARKAZ NAME']);
  var bps           = safeVal(row['BPS']);

  document.getElementById('mutualTransferModalBody').innerHTML =
    '<div class="transfer-info-box">' +
      '<strong>📋 Employee</strong>' +
      '<div><b>Teacher:</b> ' + escHtml(teacherName) + ' &nbsp;|&nbsp; <b>P.No:</b> ' + escHtml(personalNo) + '</div>' +
      '<div><b>EMIS:</b> ' + escHtml(currentEmis) + ' &nbsp;|&nbsp; <b>School:</b> ' + escHtml(currentSchool) + '</div>' +
      '<div><b>Markaz:</b> ' + escHtml(currentMark) + ' &nbsp;|&nbsp; <b>BPS:</b> ' + escHtml(bps) + '</div>' +
    '</div>' +
    '<hr class="transfer-divider">' +

    '<div class="transfer-step">' +
      '<label>Target EMIS Code (School To Swap With) <span style="color:var(--danger)">*</span></label>' +
      '<input type="text" id="mt_targetEmis" placeholder="8-digit EMIS code" maxlength="8" inputmode="numeric" oninput="mtOnTargetEmis()">' +
      '<div class="transfer-err" id="mte_emis"></div>' +
      '<div id="mt_schoolInfo" class="transfer-info-box hidden" style="margin-top:8px"></div>' +
      '<div class="transfer-hint">Mutual transfer can be within or outside your own jurisdiction.</div>' +
    '</div>' +

    '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:10px;">' +
      '<button type="button" class="primary-btn" id="mtFindBtn" onclick="mtFindCandidates()" disabled>🔍 Find BPS-' + escHtml(bps) + ' Employees</button>' +
      '<button type="button" class="secondary-btn" onclick="closeMutualTransferModal()">Cancel</button>' +
    '</div>' +

    '<div id="mt_candidatesWrap" style="margin-top:16px;"></div>';

  document.getElementById('mutualTransferModal').classList.remove('hidden');
}

function mtOnTargetEmis() {
  var emis    = (document.getElementById('mt_targetEmis').value || '').trim();
  var infoBox = document.getElementById('mt_schoolInfo');
  var errEl   = document.getElementById('mte_emis');
  var el      = document.getElementById('mt_targetEmis');
  var findBtn = document.getElementById('mtFindBtn');

  infoBox.classList.add('hidden'); infoBox.innerHTML = '';
  errEl.textContent = '';
  el.classList.remove('invalid', 'valid');
  if (findBtn) findBtn.disabled = true;
  document.getElementById('mt_candidatesWrap').innerHTML = '';
  mtCandidates = []; mtSelectedB = null;

  if (!/^\d{8}$/.test(emis)) return;

  var found = sfmTargetSchoolMap[emis.toLowerCase()];
  if (!found) {
    errEl.textContent = '⚠ EMIS not found in Schools data.';
    el.classList.add('invalid');
    return;
  }
  if (emis === safeVal(mtRowA['SCHOOL EMIS CODE'])) {
    errEl.textContent = "⚠ That's this employee's current school — enter a different EMIS.";
    el.classList.add('invalid');
    return;
  }
  el.classList.add('valid');
  infoBox.classList.remove('hidden');
  infoBox.innerHTML =
    '<strong>✓ School Found</strong>' +
    '<div><b>School:</b> ' + escHtml(found.s) + '</div>' +
    '<div><b>District:</b> ' + escHtml(found.d) + ' &nbsp;|&nbsp; <b>Wing:</b> ' + escHtml(found.w) + '</div>' +
    '<div><b>Tehsil:</b> ' + escHtml(found.t) + ' &nbsp;|&nbsp; <b>Markaz:</b> ' + escHtml(found.m) + '</div>';
  if (findBtn) findBtn.disabled = false;
}

function mtFindCandidates() {
  var emis = (document.getElementById('mt_targetEmis').value || '').trim();
  if (!/^\d{8}$/.test(emis)) return;
  var bps  = safeVal(mtRowA['BPS']);
  var wrap = document.getElementById('mt_candidatesWrap');
  wrap.innerHTML = '<div class="mt-empty-state">Searching…</div>';
  mtSelectedB = null;

  google.script.run
    .withFailureHandler(function(err) {
      wrap.innerHTML = '<div class="mt-empty-state">Search failed: ' + escHtml(err && err.message ? err.message : 'Unknown error') + '</div>';
    })
    .withSuccessHandler(function(res) {
      if (!res || !res.success) {
        wrap.innerHTML = '<div class="mt-empty-state">' + escHtml((res && res.error) || 'Search failed.') + '</div>';
        return;
      }
      mtCandidates = res.candidates || [];
      mtUsedPrivilegedSearch = res.usedPrivilegedSearch !== false;
      _mtRenderCandidates();
    })
    .getMutualTransferCandidates({
      emis: emis,
      bps: bps,
      excludePersonalNo: safeVal(mtRowA['PERSONAL NO.']),
    });
}

function _mtRenderCandidates() {
  var wrap = document.getElementById('mt_candidatesWrap');
  var warning = !mtUsedPrivilegedSearch
    ? '<div class="mt-empty-state" style="color:#B45309;background:#FEF3C7;border-color:#FDE68A;">' +
        '⚠ Showing employees only within your own jurisdiction — the cross-jurisdiction search (staff_by_emis_bps_privileged) ' +
        'isn\'t installed yet, so employees at this school outside your own district/wing/tehsil/markaz won\'t appear here. ' +
        'Ask an admin to run sql/mutual_transfer_setup.sql.' +
      '</div>'
    : '';

  if (!mtCandidates.length) {
    wrap.innerHTML = warning + '<div class="mt-empty-state">No active BPS-' + escHtml(safeVal(mtRowA['BPS'])) + ' employees found at this EMIS.</div>';
    return;
  }

  var html = warning;
  html += '<label style="display:block;font-size:.75rem;font-weight:700;color:#475569;margin-bottom:6px;text-transform:uppercase;">Choose an employee to swap with</label>';
  html += '<div class="mt-candidate-list">';
  mtCandidates.forEach(function(c, i) {
    html +=
      '<div class="mt-candidate-card" id="mt_cand_' + i + '" onclick="mtSelectCandidate(' + i + ')">' +
        '<div>' +
          '<div class="mt-candidate-name">' + escHtml(c.name) + '</div>' +
          '<div class="mt-candidate-meta">P.No: ' + escHtml(c.personalNo) + ' &nbsp;|&nbsp; ' + escHtml(c.designation) + ' &nbsp;|&nbsp; BPS-' + escHtml(c.bps) + '</div>' +
          '<div class="mt-candidate-meta">' + escHtml(c.schoolName) + ' — ' + escHtml(c.markaz) + '</div>' +
        '</div>' +
        '<button type="button" class="mt-candidate-pick" onclick="event.stopPropagation(); mtSelectCandidate(' + i + ')">Select</button>' +
      '</div>';
  });
  html += '</div><div id="mt_confirmWrap" style="margin-top:16px;"></div>';
  wrap.innerHTML = html;
}

function mtSelectCandidate(i) {
  mtSelectedB = mtCandidates[i];
  document.querySelectorAll('.mt-candidate-card').forEach(function(el, idx) {
    el.classList.toggle('selected', idx === i);
  });
  _mtRenderConfirmStep();
}

function _mtRenderConfirmStep() {
  var a = mtRowA, b = mtSelectedB;
  var confirmWrap = document.getElementById('mt_confirmWrap');
  if (!confirmWrap || !b) return;

  confirmWrap.innerHTML =
    '<div class="mt-swap-summary">' +
      '<div>' + escHtml(safeVal(a['NAME OF TEACHER'])) + ' (' + escHtml(safeVal(a['SCHOOL EMIS CODE'])) + ') ' +
        '<span class="mt-swap-arrow">⇄</span> ' + escHtml(b.schoolName) + ' (' + escHtml(b.emis) + ')</div>' +
      '<div>' + escHtml(b.name) + ' (' + escHtml(b.emis) + ') ' +
        '<span class="mt-swap-arrow">⇄</span> ' + escHtml(safeVal(a['SCHOOL NAME'])) + ' (' + escHtml(safeVal(a['SCHOOL EMIS CODE'])) + ')</div>' +
    '</div>' +

    '<div class="transfer-step">' +
      '<label>Notification No. <span style="color:var(--danger)">*</span></label>' +
      '<input type="text" id="mt_notifNo" placeholder="Mutual transfer order / notification number">' +
      '<div class="transfer-err" id="mte_notif"></div>' +
    '</div>' +

    '<div class="transfer-step">' +
      '<label>Date of Joining New School — ' + escHtml(safeVal(a['NAME OF TEACHER'])) + ' <span style="color:var(--danger)">*</span></label>' +
      '<input type="date" id="mt_dateA" onclick="smartDatePickerClick(this)" onchange="mtSyncDateB()">' +
      '<div class="transfer-err" id="mte_dateA"></div>' +
    '</div>' +

    '<div class="transfer-step">' +
      '<label>Date of Joining New School — ' + escHtml(b.name) + ' <span style="color:var(--danger)">*</span></label>' +
      '<input type="date" id="mt_dateB" onclick="smartDatePickerClick(this)">' +
      '<div class="transfer-err" id="mte_dateB"></div>' +
      '<div class="transfer-hint">Defaults to the same date as above — edit if they join on different days.</div>' +
    '</div>' +

    '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">' +
      '<button type="button" class="primary-btn" id="mtSubmitBtn" onclick="mtSubmit()">✅ Confirm Mutual Transfer</button>' +
      '<button type="button" class="secondary-btn" onclick="closeMutualTransferModal()">Cancel</button>' +
    '</div>';

  confirmWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function mtSyncDateB() {
  var dA = document.getElementById('mt_dateA');
  var dB = document.getElementById('mt_dateB');
  if (dA && dB && !dB.value) dB.value = dA.value;
}

async function mtSubmit() {
  if (mtSubmitting) return;
  if (!mtSelectedB) { showToast('Please select an employee to swap with.', 'warning'); return; }

  var notif = (document.getElementById('mt_notifNo').value || '').trim();
  var dateA = (document.getElementById('mt_dateA').value || '').trim();
  var dateB = (document.getElementById('mt_dateB').value || '').trim();
  var ok = true;

  document.querySelectorAll('#mt_confirmWrap .transfer-err').forEach(function(e) { e.textContent = ''; });

  if (!notif) { document.getElementById('mte_notif').textContent = 'Notification No. is required.'; ok = false; }
  if (!dateA) { document.getElementById('mte_dateA').textContent = 'Date is required.'; ok = false; }
  if (!dateB) { document.getElementById('mte_dateB').textContent = 'Date is required.'; ok = false; }
  if (!ok) {
    showToast('Please fix the highlighted errors before confirming.', 'warning');
    return;
  }

  var a = mtRowA, b = mtSelectedB;
  if (!confirm(
    'Confirm mutual transfer?\n\n' +
    safeVal(a['NAME OF TEACHER']) + ' → ' + b.schoolName + ' (EMIS ' + b.emis + ')\n' +
    b.name + ' → ' + safeVal(a['SCHOOL NAME']) + ' (EMIS ' + safeVal(a['SCHOOL EMIS CODE']) + ')\n\n' +
    'Notification: ' + notif
  )) return;

  mtSubmitting = true;
  var btn = document.getElementById('mtSubmitBtn');
  if (btn) btn.disabled = true;
  showLoading();

  function finishUI() {
    mtSubmitting = false;
    if (btn) btn.disabled = false;
    hideLoading();
  }

  var userPayload = getUserPayload();

  google.script.run
    .withFailureHandler(function(err) {
      finishUI();
      showToast('Mutual transfer failed: ' + (err && err.message ? err.message : 'Unknown error'), 'error');
    })
    .withSuccessHandler(function(res) {
      finishUI();
      try {
        if (res && res.success) {
          showToast(res.message || 'Mutual transfer completed.', 'success');
          closeMutualTransferModal();
          invalidateCache('Staff');
          applyFilter();
          if (typeof hrInvalidateCache === 'function') hrInvalidateCache('Staff');
          if (typeof applyHrFilter === 'function') applyHrFilter();
        } else {
          showToast('Error: ' + ((res && res.error) || 'Unknown error'), 'error');
        }
      } catch (uiErr) {
        closeMutualTransferModal();
        try { applyFilter(); } catch (_e) {}
        showToast('Saved, but the view could not refresh automatically. Please click Apply Filter.', 'warning');
      }
    })
    .executeMutualTransfer({
      personalNoA:    safeVal(a['PERSONAL NO.']),
      personalNoB:    b.personalNo,
      notificationNo: notif,
      dateA:          dateA,
      dateB:          dateB,
    }, userPayload);
}

function closeMutualTransferModal() {
  document.getElementById('mutualTransferModal').classList.add('hidden');
  mtRowA       = null;
  mtCandidates = [];
  mtSelectedB  = null;
  mtSubmitting = false;
}

// ══════════════════════════════════════════════════════════════════
//  PROMOTION MODAL
// ══════════════════════════════════════════════════════════════════
var promotionRowData = null;
var pmSubmitting     = false;

window.openPromotionModal = function(row) {
  promotionRowData = row;
  pmSubmitting     = false;

  // Same rationale as Transfer: promotion can move staff to a school
  // outside the acting officer's jurisdiction, so target EMIS lookup
  // uses the unrestricted pool, not the jurisdiction-scoped one.
  sfmEnsureTargetSchoolCache(function() {
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
      '<input type="date" id="pm_postingDate" onclick="smartDatePickerClick(this)">' +
      '<div class="transfer-hint">Leave blank to keep current value.</div>' +
    '</div>' +

    '<div class="transfer-step">' +
      '<label>Date of Joining in Present Scale (col R) <span style="color:var(--danger)">*</span></label>' +
      '<input type="date" id="pm_scaleDate" onclick="smartDatePickerClick(this)">' +
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

  var found = sfmTargetSchoolMap[emis.toLowerCase()];
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
  } else if (!sfmTargetSchoolMap[targetEmis.toLowerCase()]) {
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
      var vacCheck = await hrGateway.checkGradeVacancy(targetEmis, newBpsNum);
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
