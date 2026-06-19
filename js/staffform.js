// ── StaffForm module JS ──
// ══════════════════════════════════════════════════════════════════
//  STAFF FORM — unified Add / Edit / View
//  Loaded AFTER Script.html — all window.X overrides work correctly.
// ══════════════════════════════════════════════════════════════════

// ---------- State ----------
// sfmMode and sfmCurrentRow are declared in hr_view.js (shared state)
// var sfmMode       = 'view';     ← declared in hr_view.js
// var sfmCurrentRow = null;       ← declared in hr_view.js
var sfmEmisMap    = {};   // emis_lowercase → {d,w,t,m,e} from schoolCache / hrSchoolCache
var sfmSubmitting = false; // guard against double-submit / re-entrancy
var sfmPnoStatus  = 'unchecked'; // ← add this line
var sfmCnicStatus = 'unchecked'; // ← add this line
var sfmIbanStatus = 'unchecked'; // ← add this line

// ---------- Field map: DOM id → sheet header key ----------
var SF_FIELD_MAP = {
  sf_emis:                 'SCHOOL EMIS CODE',
  sf_markaz:               'MARKAZ NAME',
  sf_district:             'District',
  sf_wing:                 'Wing',
  sf_tehsil:               'Tehsil',
  sf_personalNo:           'PERSONAL NO.',
  sf_name:                 'NAME OF TEACHER',
  sf_parentName:           'PARENT NAME',
  sf_dob:                  'DATE OF BIRTH',
  sf_gender:               'GENDER',
  sf_designation:          'DESIGNATION',
  sf_workingAsHead:        'WORKING AS HEAD',
  sf_bps:                  'BPS',
  sf_pps:                  'PPS',
  sf_natureOfJob:          'NATURE OF JOB',
  sf_regularizationDate:   'date of regularizaton',
  sf_govtEntry:            'DATE OF ENTRY IN GOVT- SERVICE',
  sf_firstPosting:         'FIRST PLACE OF POSTING',
  sf_presentSchoolPosting: 'DATE OF POSTING IN PRESENT SCHOOL',
  sf_presentScaleJoining:  'DATE OF JOINING IN PRESENT SCALE',
  sf_subject:              'SUBJECT',
  sf_academicQual:         'ACADEMIC QUALIFICATION',
  sf_profQual:             'PROFESSIONAL QUALIFICATION',
  sf_cellNo:               'CELL NO',
  sf_whatsapp:             'WHATSAPP NO.',
  sf_email:                'EMAIL ID',
  sf_cnic:                 'CNIC',
  sf_address:              'ADDRESS AS PER CNIC',
  sf_bankName:             'BANK NAME & BRANCH CODE WHERE SALARY IS CREDIT',
  sf_iban:                 'SALARY ACCOUNT IBAN NO.'
};

// ---------- Resolve whichever school-cache variable is actually populated ----------
// FIX: previously this function only ever read `schoolCache`, a variable that
// is never assigned anywhere in this codebase. The HR module populates
// `hrSchoolCache` (see hr_view.js → openHrModule / openStaffFormModal /
// openTransferModal). Because of that mismatch, sfmEmisMap stayed permanently
// empty and every EMIS lookup inside Add/Edit/Transfer/Promotion silently
// failed even though the EMIS codes existed in the data.
//
// This helper now checks both names, preferring whichever has data, so it
// works regardless of which module populated it first.
function _sfmResolveSchoolPool() {
  if (typeof hrSchoolCache !== 'undefined' && Array.isArray(hrSchoolCache) && hrSchoolCache.length) {
    return hrSchoolCache;
  }
  if (typeof schoolCache !== 'undefined' && Array.isArray(schoolCache) && schoolCache.length) {
    return schoolCache;
  }
  return [];
}

// ---------- Build EMIS map from whichever school cache is populated ----------
function buildSfmEmisMap() {
  sfmEmisMap = {};
  var pool = _sfmResolveSchoolPool();
  pool.forEach(function(s) {
    if (s.e) sfmEmisMap[s.e.toString().trim().toLowerCase()] = s;
  });
}

// ---------- Ensure the school cache is actually loaded before we need it ----------
// If neither hrSchoolCache nor schoolCache has data yet (e.g. the user opened
// Add/Edit/Transfer/Promotion before the background load finished), fetch it
// once via the same server call the HR module uses, then rebuild the map and
// invoke the callback. If data is already present, the callback fires
// immediately and synchronously.
function sfmEnsureSchoolCache(callback) {
  if (_sfmResolveSchoolPool().length > 0) {
    buildSfmEmisMap();
    if (callback) callback();
    return;
  }
  var userPayload = (typeof currentUser !== 'undefined') ? currentUser : null;
  google.script.run
    .withSuccessHandler(function(data) {
      // Populate hrSchoolCache if that global exists in this page; otherwise
      // fall back to schoolCache so buildSfmEmisMap() still finds it.
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
      // Still invoke the callback so the UI doesn't hang — lookups will just
      // report "not found" until the user retries.
      if (callback) callback();
    })
    .getSchoolHierarchyForUser(userPayload);
}

// ---------- EMIS live-lookup (client-side, instant from cache) ----------
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

  // Clear derived location fields
  ['sf_markaz','sf_district','sf_wing','sf_tehsil'].forEach(function(id) {
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

  // If the map is still empty (cache not loaded yet), try to load it once
  // and re-run the lookup automatically instead of reporting a false negative.
  if (Object.keys(sfmEmisMap).length === 0 && _sfmResolveSchoolPool().length === 0) {
    errEl.textContent = '⏳ Loading school data…';
    sfmEnsureSchoolCache(function() {
      // Only re-trigger if the field still holds the same value
      if ((document.getElementById('sf_emis').value || '').trim() === emis) {
        sfmOnEmisInput();
      }
    });
    return;
  }

  // Lookup from client-side cache (instant)
  var found = sfmEmisMap[emis.toLowerCase()];
  if (!found) {
    errEl.textContent = '⚠ EMIS code not found in Schools data.';
    emisInp.classList.add('invalid');
    return;
  }

  // Valid — populate derived fields
  badge.classList.remove('hidden');
  emisInp.classList.add('valid');

  document.getElementById('sf_markaz').value   = found.m || '';
  document.getElementById('sf_district').value = found.d || '';
  document.getElementById('sf_wing').value      = found.w || '';
  document.getElementById('sf_tehsil').value    = found.t || '';

  infoEl.classList.remove('hidden');
  infoEl.textContent = '✓ ' + (found.d || '') + ' › ' + (found.w || '') + ' › ' + (found.t || '') + ' › ' + (found.m || '');
}

// ---------- Personal No. live-check (client-side against sheetDataCache) ----------
function sfmOnPersonalNoInput() {
  var inputEl = document.getElementById('sf_personalNo');
  inputEl.value = inputEl.value.replace(/[^0-9]/g, '').slice(0, 8);

  var pno    = inputEl.value;
  var infoEl = document.getElementById('sfm_pnoInfo');
  var errEl  = document.getElementById('sfe_personalNo');

  infoEl.classList.add('hidden');
  infoEl.className = 'sfm-pno-info hidden';
  errEl.textContent = '';
  sfmPnoStatus = 'unchecked';  // ← reset on every keystroke

  if (!pno || sfmMode !== 'add') return;
  if (pno.length < 8) return;

  // ── 1. Client-side — main sheets (col D) ─────────────────────
  var mainSheets = ['Staff','Deleted_Archive','Promotions_History',
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

  // ── 2. Client-side — Transfer_History (col B) ────────────────
  if (!foundIn) {
    var thCache = sheetDataCache['Transfer_History'];
    if (thCache && thCache.rows) {
      var thHdr = null;
      (thCache.headers || []).forEach(function(h) {
        if (h && h.toString().trim() === 'Employee Personal No') thHdr = h;
      });
      if (thHdr && thCache.rows.some(function(r) {
        return safeVal(r[thHdr]).trim() === pno;
      })) foundIn = 'Transfer_History';
    }
  }

  if (foundIn) {
    sfmPnoStatus = 'duplicate';  // ← block submission
    infoEl.classList.remove('hidden');
    infoEl.className = 'sfm-pno-info warn';
    infoEl.style.background  = '#FFF7ED';
    infoEl.style.borderColor = '#FDE68A';
    infoEl.style.color       = '#D97706';
    infoEl.textContent = '⚠ Personal No. already exists in "' + foundIn + '".';
    return;
  }

  // ── 3. Server-side fallback ───────────────────────────────────
  sfmPnoStatus = 'checking';  // ← hold submission until resolved
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
        sfmPnoStatus = 'duplicate';  // ← block submission
        infoEl.className = 'sfm-pno-info warn';
        infoEl.style.background  = '#FFF7ED';
        infoEl.style.borderColor = '#FDE68A';
        infoEl.style.color       = '#D97706';
        infoEl.textContent = '⚠ Personal No. already exists in "' + res.sheet + '".';
      } else {
        sfmPnoStatus = 'available';  // ← allow submission
        infoEl.className = 'sfm-pno-info ok';
        infoEl.style.background  = '#F0FDF4';
        infoEl.style.borderColor = '#BBF7D0';
        infoEl.style.color       = '#059669';
        infoEl.textContent = '✓ Personal No. is available.';
      }
    })
    .withFailureHandler(function() {
      sfmPnoStatus = 'unchecked';  // ← don't block if check fails
      infoEl.classList.add('hidden');
    })
    .checkPersonalNoDuplicate(pno, null);
}// ---------- Toggle Date of Regularization based on Nature of Job ----------
function toggleRegularizationDate() {
  var jobNature = document.getElementById('sf_natureOfJob').value;
  var container = document.getElementById('regDateContainer');
  var dateInput = document.getElementById('sf_regularizationDate');
  
  if (!container) return;

  if (jobNature === 'Permanent') {
    container.style.display = 'flex'; // Show field
  } else {
    container.style.display = 'none'; // Hide field
    if (sfmMode !== 'view') {
      dateInput.value = ''; // Clear value if hidden (so it doesn't accidentally save)
    }
  }
}

// ---------- CNIC live-check (client-side) ----------
function sfmOnCnicInput() {
  var cnic   = (document.getElementById('sf_cnic').value || '').trim();
  var infoEl = document.getElementById('sfm_cnicInfo');
  var errEl  = document.getElementById('sfe_cnic');

  infoEl.classList.add('hidden');
  infoEl.className = 'sfm-cnic-info hidden';
  errEl.textContent = '';
  sfmCnicStatus = 'unchecked'; // ← reset on every keystroke

  if (!cnic) return;

  if (!/^\d{13}$/.test(cnic)) {
    if (cnic.length === 13) {
      errEl.textContent = 'CNIC must be exactly 13 digits.';
    }
    return;
  }

  // Skip check in edit mode for the same record's own CNIC
  var ownCnic = sfmCurrentRow ? safeVal(sfmCurrentRow['CNIC']).trim() : '';
  if (sfmMode === 'edit' && cnic === ownCnic) {
    sfmCnicStatus = 'available';
    return;
  }

  // ── 1. Client-side — main sheets (col W) ─────────────────────
  var mainSheets = ['Staff','Deleted_Archive','Promotions_History',
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

  // ── 2. Client-side — Transfer_History (col C) ────────────────
  if (!foundIn) {
    var thCache = sheetDataCache['Transfer_History'];
    if (thCache && thCache.rows) {
      var thHdr = null;
      (thCache.headers || []).forEach(function(h) {
        if (h && h.toString().trim() === 'Employee CNIC') thHdr = h;
      });
      if (thHdr && thCache.rows.some(function(r) {
        return safeVal(r[thHdr]).trim() === cnic;
      })) foundIn = 'Transfer_History';
    }
  }

  if (foundIn) {
    sfmCnicStatus = 'duplicate'; // ← block submission
    infoEl.classList.remove('hidden');
    infoEl.className = 'sfm-cnic-info warn';
    infoEl.style.background  = '#FFF7ED';
    infoEl.style.borderColor = '#FDE68A';
    infoEl.style.color       = '#D97706';
    infoEl.textContent = '⚠ CNIC already exists in "' + foundIn + '".';
    return;
  }

  // ── 3. Server-side fallback ───────────────────────────────────
  sfmCnicStatus = 'checking'; // ← hold submission until resolved
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
        sfmCnicStatus = 'duplicate'; // ← block submission
        infoEl.className = 'sfm-cnic-info warn';
        infoEl.style.background  = '#FFF7ED';
        infoEl.style.borderColor = '#FDE68A';
        infoEl.style.color       = '#D97706';
        infoEl.textContent = '⚠ CNIC already exists in "' + res.sheet + '".';
      } else {
        sfmCnicStatus = 'available'; // ← allow submission
        infoEl.className = 'sfm-cnic-info ok';
        infoEl.style.background  = '#F0FDF4';
        infoEl.style.borderColor = '#BBF7D0';
        infoEl.style.color       = '#059669';
        infoEl.textContent = '✓ CNIC is available.';
      }
    })
    .withFailureHandler(function() {
      sfmCnicStatus = 'unchecked'; // ← don't block if check fails
      infoEl.classList.add('hidden');
    })
    .checkCnicDuplicate(cnic, excludeSheet);
}
function sfmOnIbanInput() {
  var iban   = (document.getElementById('sf_iban').value || '').trim().toUpperCase();
  var errEl  = document.getElementById('sfe_iban');

  errEl.textContent = '';
  sfmIbanStatus = 'unchecked'; // ← reset on every keystroke

  if (!iban) return;

  if (iban.length !== 24) return; // only check when full 24 chars entered

  if (!/^PK\d{2}[A-Z0-9]{20}$/i.test(iban)) {
    errEl.textContent = 'Pakistani IBAN: PK + 2 digits + 20 alphanumeric chars (24 total).';
    return;
  }

  // Skip check in edit mode for the same record's own IBAN
  var ownIban = sfmCurrentRow ? safeVal(sfmCurrentRow['SALARY ACCOUNT IBAN NO.']).trim().toUpperCase() : '';
  if (sfmMode === 'edit' && iban === ownIban) {
    sfmIbanStatus = 'available';
    return;
  }

  // ── 1. Client-side — main sheets (col Z) ─────────────────────
  var mainSheets = ['Staff','Deleted_Archive','Promotions_History',
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
    sfmIbanStatus = 'duplicate'; // ← block submission
    errEl.textContent = '⚠ IBAN already exists in "' + foundIn + '".';
    errEl.style.color = '#D97706';
    return;
  }

  // ── 2. Server-side fallback ───────────────────────────────────
  sfmIbanStatus = 'checking'; // ← hold submission until resolved
  errEl.textContent = '⏳ Verifying IBAN across all records…';
  errEl.style.color = '#475569';

  var excludeSheet = sfmMode === 'edit' ? 'Staff' : null;

  google.script.run
    .withSuccessHandler(function(res) {
      if ((document.getElementById('sf_iban').value || '').trim().toUpperCase() !== iban) return;
      if (res && res.found) {
        sfmIbanStatus = 'duplicate'; // ← block submission
        errEl.textContent = '⚠ IBAN already exists in "' + res.sheet + '".';
        errEl.style.color = '#D97706';
      } else {
        sfmIbanStatus = 'available'; // ← allow submission
        errEl.textContent = '✓ IBAN is available.';
        errEl.style.color = '#059669';
      }
    })
    .withFailureHandler(function() {
      sfmIbanStatus = 'unchecked'; // ← don't block if check fails
      errEl.textContent = '';
    })
    .checkIbanDuplicate(iban, excludeSheet);
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  var m = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    var months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                  jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    var mo = months[m[2].toLowerCase()];
    return mo ? (m[3] + '-' + mo + '-' + m[1].padStart(2,'0')) : '';
  }
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

// ---------- Populate form from row data ----------
function sfmPopulateForm(row) {
  buildSfmEmisMap();

  Object.keys(SF_FIELD_MAP).forEach(function(id) {
    var key  = SF_FIELD_MAP[id];
    var el   = document.getElementById(id);
    if (!el) return;
    var val  = (row && row[key] !== undefined) ? row[key].toString() : '';

    if (el.tagName === 'SELECT') {
      el.value = val;
    } else if (el.type === 'date') {
      el.value = toDateInputVal(val);
    } else {
      el.value = val;
    }

    // View-mode span
    var spanId = 'sfv_' + id.replace('sf_', '');
    var span   = document.getElementById(spanId);
    if (span) span.textContent = val || '—';
  });

  // Show EMIS info chip in non-view modes
  if (row && sfmMode !== 'view') sfmOnEmisInput();
  
  // Run visibility toggle on load
  toggleRegularizationDate(); 
}

// ---------- Collect form data ----------
function sfmCollectData() {
  var data = sfmCurrentRow ? { _row: sfmCurrentRow._row } : {};
  Object.keys(SF_FIELD_MAP).forEach(function(id) {
    var key = SF_FIELD_MAP[id];
    var el  = document.getElementById(id);
    if (!el) return;
    var val = el.value || '';
    if (el.type === 'date' && val) val = fromDateInputVal(val);
    data[key] = val;
  });
  return data;
}

// ---------- Validation ----------
// Returns true ONLY if every field passes its validation rules.
// sfmSubmit() must treat this as a hard gate: on false, do NOT call
// the server and do NOT close/alter the form.
function sfmValidate() {
  var ok = true;
  document.querySelectorAll('.sfm-err').forEach(function(e) { e.textContent = ''; });
  document.querySelectorAll('.sfm-input,.sfm-select').forEach(function(e) {
    e.classList.remove('invalid', 'valid');
  });

  function v(id) { return ((document.getElementById(id) || {}).value || '').trim(); }
  function e(inputId, errId, msg) { setFieldErr(inputId, errId, msg); ok = false; }

  // Personal No.
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

  // EMIS
  var emis = v('sf_emis');
  if (!emis) {
    e('sf_emis', 'sfe_emis', 'EMIS Code is required.');
  } else if (!/^\d{8}$/.test(emis)) {
    e('sf_emis', 'sfe_emis', 'Must be exactly 8 digits.');
  } else if (!sfmEmisMap[emis.toLowerCase()]) {
    e('sf_emis', 'sfe_emis', 'EMIS not found in Schools data.');
  }

  // Name
  if (!v('sf_name')) e('sf_name', 'sfe_name', 'Name of Teacher is required.');

  // DOB
  if (!v('sf_dob')) e('sf_dob', 'sfe_dob', 'Date of Birth is required.');

  // Gender
  if (!v('sf_gender')) e('sf_gender', 'sfe_gender', 'Gender is required.');

  // Designation
  if (!v('sf_designation')) e('sf_designation', 'sfe_designation', 'Designation is required.');

  // BPS
  var bps = v('sf_bps');
  if (!bps) {
    e('sf_bps', 'sfe_bps', 'BPS is required.');
  } else if (isNaN(bps) || +bps < 1 || +bps > 22) {
    e('sf_bps', 'sfe_bps', 'BPS must be 1–22.');
  }

  // PPS optional
  var pps = v('sf_pps');
  if (pps && (isNaN(pps) || +pps < 1 || +pps > 22))
    e('sf_pps', 'sfe_pps', 'PPS must be 1–22.');

  // Govt entry date
  if (!v('sf_govtEntry')) e('sf_govtEntry', 'sfe_govtEntry', 'Date of Entry in Govt. Service is required.');

  // Cell No
  var cell = v('sf_cellNo');
  if (cell && !/^\d{11}$/.test(cell)) e('sf_cellNo', 'sfe_cellNo', 'Must be exactly 11 digits.');

  // WhatsApp
  var wa = v('sf_whatsapp');
  if (wa && !/^\d{11}$/.test(wa)) e('sf_whatsapp', 'sfe_whatsapp', 'Must be exactly 11 digits.');

  // Email
  var email = v('sf_email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    e('sf_email', 'sfe_email', 'Enter a valid email address.');

  // CNIC
  var cnic = v('sf_cnic');
  if (cnic && !/^\d{13}$/.test(cnic)) {
    e('sf_cnic', 'sfe_cnic', 'CNIC must be exactly 13 digits.');
  } else if (sfmCnicStatus === 'duplicate') {
    e('sf_cnic', 'sfe_cnic', 'This CNIC already exists in another record.');
  } else if (sfmCnicStatus === 'checking') {
    e('sf_cnic', 'sfe_cnic', 'Still verifying CNIC — please wait a moment and try again.');
  }

  // IBAN
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
function openStaffFormModal(mode, row) {
  sfmMode       = mode;
  sfmCurrentRow = row || null;
  sfmSubmitting = false;

  // FIX: previously this called buildSfmEmisMap() immediately, which is a
  // no-op if the school cache hasn't loaded yet (race condition on first
  // open, or if only hrSchoolCache — not schoolCache — was ever populated).
  // sfmEnsureSchoolCache() fetches the data first if needed, builds the map,
  // then re-runs the EMIS lookup for whatever value is already in the field
  // (relevant for edit/view modes where the field is pre-filled).
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

  // Reset validation state
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
    sfmCnicStatus = 'unchecked'; // ← add this line
    sfmIbanStatus = 'unchecked'; // ← add this line
    form.classList.remove('sfm-mode-view');
    modeTag.textContent = 'EDIT';
    modeTag.className   = 'sfm-mode-tag tag-edit';
    title.textContent   = 'Edit Staff Record';
    footer.innerHTML =
      '<button type="button" class="sfm-header-btn accent" id="sfmSaveBtn" onclick="sfmSubmit()">💾 Save Changes</button>' +
      '<button type="button" class="sfm-header-btn" onclick="sfmSwitchToView()">Cancel</button>';
    hdrActions.innerHTML = '';
  } else { // add
    sfmPnoStatus = 'unchecked'; // ← add this line
    sfmCnicStatus = 'unchecked'; // ← add this line
    sfmIbanStatus = 'unchecked'; // ← add this line
    form.classList.remove('sfm-mode-view');
    modeTag.textContent = 'NEW';
    modeTag.className   = 'sfm-mode-tag tag-add';
    title.textContent   = 'Add New Staff Member';
    footer.innerHTML =
      '<button type="button" class="sfm-header-btn accent" id="sfmSaveBtn" onclick="sfmSubmit()">✅ Save Staff Member</button>' +
      '<button type="button" class="sfm-header-btn" onclick="closeStaffFormModal()">Cancel</button>';
    hdrActions.innerHTML = '';
  }

  // Wire events
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
    // Location fields are always readonly (auto from EMIS), never truly disabled for form collection
    if (['sf_markaz','sf_district','sf_wing','sf_tehsil'].includes(el.id)) {
      el.disabled = disabled;
      return;
    }
    // Personal No. is readonly in edit mode (not add)
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
// HARD GATE: if sfmValidate() returns false, we stop here completely.
// No google.script.run call is made, the modal stays open exactly as
// the user left it, and the offending fields are highlighted.
function sfmSubmit() {
  if (sfmSubmitting) return; // prevent double-submit while a request is in flight

  if (!sfmValidate()) {
    showToast('Please fix the highlighted errors before saving.', 'warning');
    var firstErr = document.querySelector('#staffForm .sfm-input.invalid, #staffForm .sfm-select.invalid');
    if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return; // <-- submission stopped, nothing sent to server
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

  // Define userPayload out here so BOTH 'add' and 'edit' can access it
  var userPayload = typeof currentUser !== 'undefined' ? currentUser : null;

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
          } else {
            showToast('Error: ' + (res && (res.errors ? res.errors.join(', ') : res.error) || 'Unknown error'), 'error');
          }
        } catch (uiErr) {
          closeStaffFormModal();
          try { applyFilter(); } catch (_e) {}
          showToast('Saved, but the view could not refresh automatically. Please click Apply Filter.', 'warning');
        }
      }).addStaffRow(data, userPayload); // <-- Now it can access userPayload
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
          } else {
            showToast('Error: ' + (res && res.error || 'Unknown error'), 'error');
          }
        } catch (uiErr) {
          closeStaffFormModal();
          try { applyFilter(); } catch (_e) {}
          showToast('Saved, but the view could not refresh automatically. Please click Apply Filter.', 'warning');
        }
      }).updateStaffRow(data, userPayload); // <-- Now it can access userPayload
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

  // FIX: was buildSfmEmisMap() called unconditionally and synchronously —
  // if the cache wasn't loaded yet, the modal would render with an empty
  // sfmEmisMap and every EMIS the user typed would report "not found".
  // sfmEnsureSchoolCache() loads it first if needed, then renders the modal.
  sfmEnsureSchoolCache(function() {
    _sfmRenderTransferModal(row);
  });
};

function _sfmRenderTransferModal(row) {
  var currentEmis    = safeVal(row['SCHOOL EMIS CODE']);
  var currentMark    = safeVal(row['MARKAZ NAME']);
  var teacherName    = safeVal(row['NAME OF TEACHER']);
  var personalNo     = safeVal(row['PERSONAL NO.']);
  var currentPosting = safeVal(row['DATE OF POSTING IN PRESENT SCHOOL']);

  document.getElementById('transferModalBody').innerHTML =
    '<div class="transfer-info-box">' +
      '<strong>📋 Current Assignment</strong>' +
      '<div><b>Teacher:</b> ' + escHtml(teacherName) + ' &nbsp;|&nbsp; <b>P.No:</b> ' + escHtml(personalNo) + '</div>' +
      '<div><b>EMIS:</b> ' + escHtml(currentEmis) + ' &nbsp;|&nbsp; <b>Markaz:</b> ' + escHtml(currentMark) + '</div>' +
      '<div><b>Posted Since:</b> ' + (escHtml(currentPosting) || '—') + '</div>' +
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

  // Validate against client-side EMIS map (built from Schools sheet col E)
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
    '<div><b>District:</b> ' + escHtml(found.d) + ' &nbsp;|&nbsp; <b>Wing:</b> ' + escHtml(found.w) + '</div>' +
    '<div><b>Tehsil:</b> ' + escHtml(found.t) + ' &nbsp;|&nbsp; <b>Markaz:</b> ' + escHtml(found.m) + '</div>';
}

// HARD GATE: invalid input -> highlighted fields + toast, no server call.
function tfSubmit() {
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
    return; // submission stopped
  }

  var newSchool     = sfmEmisMap[targetEmis.toLowerCase()];
  var formattedDate = fromDateInputVal(joiningDate);
  var teacherName   = safeVal(transferRowData['NAME OF TEACHER']);

  if (!confirm(
    'Confirm transfer of "' + teacherName + '"\n' +
    '→ New EMIS: ' + targetEmis + ' (' + newSchool.m + ')\n' +
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
        } else {
          showToast('Error: ' + (res && res.error || 'Unknown error'), 'error');
        }
      } catch (uiErr) {
        closeTransferModal();
        try { applyFilter(); } catch (_e) {}
        showToast('Saved, but the view could not refresh automatically. Please click Apply Filter.', 'warning');
      }
var userPayload = typeof currentUser !== 'undefined' ? currentUser : null;
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

  // FIX: same lazy-load guard as Transfer — ensures sfmEmisMap is populated
  // before the modal (and its EMIS input) is rendered.
  sfmEnsureSchoolCache(function() {
    _sfmRenderPromotionModal(row);
  });
};

function _sfmRenderPromotionModal(row) {
  var teacherName = safeVal(row['NAME OF TEACHER']);
  var personalNo  = safeVal(row['PERSONAL NO.']);
  var currentDes  = safeVal(row['DESIGNATION']);
  var currentBps  = safeVal(row['BPS']);
  var currentPps  = safeVal(row['PPS']); // Added PPS lookup
  var currentEmis = safeVal(row['SCHOOL EMIS CODE']);

  document.getElementById('promotionModalBody').innerHTML =
    '<div class="transfer-info-box">' +
      '<strong>📋 Current Record</strong>' +
      '<div><b>Teacher:</b> ' + escHtml(teacherName) + ' &nbsp;|&nbsp; <b>P.No:</b> ' + escHtml(personalNo) + '</div>' +
      '<div><b>Designation:</b> ' + escHtml(currentDes) + ' &nbsp;|&nbsp; <b>BPS:</b> ' + escHtml(currentBps) + '</div>' +
      '<div><b>EMIS:</b> ' + escHtml(currentEmis) + '</div>' +
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
        ['PST','ESE','EST','SESE','SST','SSE','Headmaster','Headmistress'].map(function(d) {
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

    // NEW PPS FIELD IN PROMOTION MODAL
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

  // Add event listener so PPS auto-syncs with BPS
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
    '<div><b>District:</b> ' + escHtml(found.d) + ' &nbsp;|&nbsp; <b>Wing:</b> ' + escHtml(found.w) + '</div>' +
    '<div><b>Tehsil:</b> ' + escHtml(found.t) + ' &nbsp;|&nbsp; <b>Markaz:</b> ' + escHtml(found.m) + '</div>';
}

// HARD GATE: invalid input -> highlighted fields + toast, no server call.
function pmSubmit() {
  if (pmSubmitting) return;

  var notifNo     = (document.getElementById('pm_notifNo').value || '').trim();
  var designation = (document.getElementById('pm_designation').value || '').trim();
  var bps         = (document.getElementById('pm_bps').value || '').trim();
  var pps         = (document.getElementById('pm_pps').value || '').trim(); // Get new PPS
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
    return; // submission stopped
  }

  var teacherName      = safeVal(promotionRowData['NAME OF TEACHER']);
  var formattedPosting = postingDate ? fromDateInputVal(postingDate) : '';
  var formattedScale   = fromDateInputVal(scaleDate);

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
        } else {
          showToast('Error: ' + (res && res.error || 'Unknown error'), 'error');
        }
      } catch (uiErr) {
        closePromotionModal();
        try { applyFilter(); } catch (_e) {}
        showToast('Saved, but the view could not refresh automatically. Please click Apply Filter.', 'warning');
      }
  var userPayload = typeof currentUser !== 'undefined' ? currentUser : null;
}).executePromotion({
  personalNo:         safeVal(promotionRowData['PERSONAL NO.']),
      rowNum:             promotionRowData._row,
      newDesignation:     designation,
      newBps:             bps,
      newPps:             pps, // Passing new PPS to backend
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
//  OVERRIDE BASE FUNCTIONS FROM Script.html
// ══════════════════════════════════════════════════════════════════
window.showDetailModal = function(row) { openStaffFormModal('view', row); };
window.openEditModal   = function(row) { openStaffFormModal('edit', row); };
window.openAddStaffModal = function()  { openStaffFormModal('add', null); };
