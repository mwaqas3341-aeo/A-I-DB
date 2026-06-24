// =====================================================================
//  ENROLLMENT.JS  —  PESRP Markaz Enrollment Module for AEO Portal
//  ─────────────────────────────────────────────────────────────────────
//  ✅  STANDALONE — zero edits to any existing file.
//  ✅  Injects its own HTML view into #appWrapper automatically.
//  ✅  Uses portal's schoolCache (cached hierarchy — instant dropdowns).
//  ✅  Respects user's markaz/district access restrictions.
//  ✅  Connects to enrollment GAS backend for live data.
//  ✅  Registers openEnrollmentModule() globally.
//  ✅  Integrates with portal router (back button works).
//
//  HOW TO ADD:
//  1. In index.html, after index.js:
//       <script src="js/enrollment.js"></script>
//
//  2. ⚠️  UPDATE THE URL BELOW with your enrollment GAS web app URL.
//
//  3. In Admin Panel → Dashboard Cards → Add Card:
//       Title:       Enrollment Data
//       Icon:        mortarboard-fill
//       Action Type: module
//       Module:      openEnrollmentModule
//       Active:      Yes
// =====================================================================

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════
  //  ⚙️  CONFIGURATION  —  UPDATE THIS URL
  // ══════════════════════════════════════════════════════════════════
  var ENROLLMENT_SCRIPT_URL =
    'https://script.google.com/macros/s/AKfycbynghF5JD8hchaG8FWdd12NqaXXMBA2ZZrR5a16CP-kGVPWkzcZtfPx4ywvqGxql3v-QQ/exec';
  //  ↑ Replace with your enrollment GAS deployment URL

  // ══════════════════════════════════════════════════════════════════
  //  STATE
  // ══════════════════════════════════════════════════════════════════
  var _enrollData  = [];   // results from last fetch
  var _currentMarkaz = '';

  // ══════════════════════════════════════════════════════════════════
  //  READ HELPERS
  // ══════════════════════════════════════════════════════════════════
  function _getUser() {
    try {
      var key = (typeof CONFIG !== 'undefined' && CONFIG.SESSION_KEY)
        ? CONFIG.SESSION_KEY : 'portalUser';
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (e) { return null; }
  }

  // Returns schoolCache from core.js (global) or falls back to sessionStorage
  function _getHierarchy() {
    if (typeof schoolCache !== 'undefined' && schoolCache.length) {
      return schoolCache;
    }
    try {
      var raw = sessionStorage.getItem('schoolHierarchy');
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ══════════════════════════════════════════════════════════════════
  //  INJECT VIEW HTML
  //  Adds #enrollmentView as a sibling of #homeView inside #appWrapper
  // ══════════════════════════════════════════════════════════════════
  function _injectView() {
    if (document.getElementById('enrollmentView')) return;

    var appWrapper = document.getElementById('appWrapper');
    if (!appWrapper) return;

    var view = document.createElement('div');
    view.id = 'enrollmentView';
    view.className = 'app-view';
    view.innerHTML = [
      '<div style="max-width:860px;margin:0 auto">',

        /* ── Header row ── */
        '<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;flex-wrap:wrap">',
          '<button class="btn-back-kpi" onclick="switchGlobalTab(\'homeView\',null);history.back()">',
            '<i class="bi bi-arrow-left"></i> Back',
          '</button>',
          '<div>',
            '<div class="dash-heading" style="margin-bottom:2px">',
              '<i class="bi bi-mortarboard-fill" style="color:var(--ok)"></i>',
              ' Markaz Enrollment Data',
            '</div>',
            '<div style="font-size:.75rem;color:var(--t3)">',
              'Live enrollment figures per school, fetched directly from PESRP',
            '</div>',
          '</div>',
          '<div id="enrolSyncBadge" style="',
            'margin-left:auto;display:none;',
            'padding:4px 12px;border-radius:20px;font-size:.72rem;font-weight:700;',
            'background:rgba(5,150,105,.12);color:#059669;border:1px solid rgba(5,150,105,.25)',
          '"></div>',
        '</div>',

        /* ── Filter panel ── */
        '<div class="sidebar-widget" style="margin-bottom:20px">',
          '<div class="widget-title">',
            '<i class="bi bi-funnel-fill" style="color:var(--brand)"></i> Select Markaz',
          '</div>',
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:14px">',
            '<div>',
              '<label style="font-size:.7rem;font-weight:700;color:var(--t2);text-transform:uppercase;',
                'letter-spacing:.05em;display:block;margin-bottom:5px">',
                '<i class="bi bi-geo-alt-fill"></i> District',
              '</label>',
              '<select id="enrolDistrict" style="width:100%;height:38px;border:1px solid var(--b0);',
                'border-radius:8px;padding:0 10px;font-family:inherit;font-size:.85rem;',
                'background:var(--s0);outline:none;color:var(--t1)">',
                '<option value="">Loading hierarchy...</option>',
              '</select>',
            '</div>',
            '<div>',
              '<label style="font-size:.7rem;font-weight:700;color:var(--t2);text-transform:uppercase;',
                'letter-spacing:.05em;display:block;margin-bottom:5px">',
                '<i class="bi bi-building"></i> Tehsil',
              '</label>',
              '<select id="enrolTehsil" disabled style="width:100%;height:38px;border:1px solid var(--b0);',
                'border-radius:8px;padding:0 10px;font-family:inherit;font-size:.85rem;',
                'background:var(--s0);outline:none;color:var(--t1)">',
                '<option value="">Select District first</option>',
              '</select>',
            '</div>',
            '<div>',
              '<label style="font-size:.7rem;font-weight:700;color:var(--t2);text-transform:uppercase;',
                'letter-spacing:.05em;display:block;margin-bottom:5px">',
                '<i class="bi bi-flag-fill"></i> Markaz',
              '</label>',
              '<select id="enrolMarkaz" disabled style="width:100%;height:38px;border:1px solid var(--b0);',
                'border-radius:8px;padding:0 10px;font-family:inherit;font-size:.85rem;',
                'background:var(--s0);outline:none;color:var(--t1)">',
                '<option value="">Select Tehsil first</option>',
              '</select>',
            '</div>',
          '</div>',
          '<button id="enrolFetchBtn" disabled onclick="window._enrollFetch()" ',
            'class="btn-save" style="width:100%;justify-content:center;gap:8px;height:44px">',
            '<i class="bi bi-cloud-download-fill"></i> Fetch Live Enrollment Data',
          '</button>',
        '</div>',

        /* ── Summary cards ── */
        '<div id="enrolCards" style="display:none;grid-template-columns:repeat(3,1fr);',
          'gap:12px;margin-bottom:20px">',
          '<div class="kpi-card" style="border-left-color:var(--brand);text-align:center">',
            '<div class="kpi-title">Total Enrollment</div>',
            '<div class="kpi-value" id="enrolTotal" style="font-size:2rem">—</div>',
          '</div>',
          '<div class="kpi-card" style="border-left-color:var(--accent);text-align:center">',
            '<div class="kpi-title">Male Students</div>',
            '<div class="kpi-value" id="enrolMale" style="font-size:2rem;color:var(--accent)">—</div>',
          '</div>',
          '<div class="kpi-card" style="border-left-color:#f472b6;text-align:center">',
            '<div class="kpi-title">Female Students</div>',
            '<div class="kpi-value" id="enrolFemale" style="font-size:2rem;color:#d946a8">—</div>',
          '</div>',
        '</div>',

        /* ── Accordion ── */
        '<div id="enrolAccordion"></div>',

        /* ── Export ── */
        '<div id="enrolExportBar" style="display:none;margin-top:16px">',
          '<button onclick="window._enrollExport()" class="btn-export-tbl" ',
            'style="width:100%;justify-content:center;height:44px;font-size:.88rem">',
            '<i class="bi bi-file-earmark-excel"></i> Export CSV Report',
          '</button>',
        '</div>',

      '</div>', // /max-width
    ].join('');

    appWrapper.appendChild(view);
    _injectStyles();
    _bindEvents();
  }

  // ══════════════════════════════════════════════════════════════════
  //  INJECT SCOPED STYLES
  // ══════════════════════════════════════════════════════════════════
  function _injectStyles() {
    if (document.getElementById('enrollment-css')) return;
    var s = document.createElement('style');
    s.id = 'enrollment-css';
    s.textContent = [

      /* School accordion card */
      '.enrol-school-card{',
        'background:var(--s0);border:1px solid var(--b0);border-radius:14px;',
        'margin-bottom:10px;overflow:hidden;transition:box-shadow .2s',
      '}',
      '.enrol-school-card:hover{box-shadow:var(--sh2)}',

      /* Card header */
      '.enrol-school-hdr{',
        'padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;',
        'transition:background .15s;-webkit-tap-highlight-color:transparent',
      '}',
      '.enrol-school-hdr:active{background:var(--brand-light)}',
      '.enrol-school-icon{',
        'width:44px;height:44px;border-radius:10px;flex-shrink:0;',
        'background:var(--brand-light);display:flex;align-items:center;',
        'justify-content:center;font-size:1.25rem;color:var(--brand)',
      '}',
      '.enrol-school-name{font-weight:700;font-size:.92rem;color:var(--t1);margin-bottom:3px}',
      '.enrol-school-meta{font-size:.72rem;color:var(--t3);display:flex;gap:10px;flex-wrap:wrap}',
      '.enrol-chevron{margin-left:auto;color:var(--t3);transition:transform .3s;flex-shrink:0}',
      '.enrol-school-card.open .enrol-chevron{transform:rotate(180deg)}',

      /* Enrollment stat pills */
      '.enrol-pill{display:inline-flex;align-items:center;gap:4px;',
        'padding:2px 8px;border-radius:20px;font-size:.72rem;font-weight:700}',
      '.enrol-pill-m{background:#dbeafe;color:#1e40af}',
      '.enrol-pill-f{background:#fce7f3;color:#9d174d}',
      '.enrol-pill-t{background:var(--ok-bg);color:var(--ok)}',

      /* Collapsible detail */
      '.enrol-detail{max-height:0;overflow:hidden;transition:max-height .4s cubic-bezier(.4,0,.2,1)}',
      '.enrol-school-card.open .enrol-detail{max-height:3000px}',
      '.enrol-class-row{',
        'display:flex;justify-content:space-between;align-items:center;',
        'padding:9px 16px;border-bottom:1px solid var(--s2);font-size:.83rem',
      '}',
      '.enrol-class-row:last-child{border-bottom:none}',
      '.enrol-class-name{font-weight:500;color:var(--t1);flex:1}',
      '.enrol-class-nums{display:flex;gap:14px;font-size:.8rem;font-weight:700}',

      /* Controls bar */
      '.enrol-ctrl-bar{display:flex;gap:8px;justify-content:flex-end;margin-bottom:12px}',
      '.enrol-ctrl-btn{',
        'height:32px;padding:0 14px;border:1px solid var(--b0);border-radius:20px;',
        'background:var(--s0);color:var(--t2);font-family:inherit;font-size:.75rem;',
        'font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px',
      '}',
      '.enrol-ctrl-btn:hover{background:var(--brand-light);border-color:var(--brand);color:var(--brand)}',

      /* Loading spinner in accordion area */
      '.enrol-loading{text-align:center;padding:40px;color:var(--t3);font-size:.85rem}',

      /* No data */
      '.enrol-empty{',
        'text-align:center;padding:48px 24px;color:var(--t3);',
        'background:var(--s0);border:1px dashed var(--b0);border-radius:14px',
      '}',

    ].join('');
    document.head.appendChild(s);
  }

  // ══════════════════════════════════════════════════════════════════
  //  BIND DROPDOWN EVENTS
  // ══════════════════════════════════════════════════════════════════
  function _bindEvents() {
    var distEl   = document.getElementById('enrolDistrict');
    var tehsilEl = document.getElementById('enrolTehsil');
    var markazEl = document.getElementById('enrolMarkaz');
    var fetchBtn = document.getElementById('enrolFetchBtn');

    distEl.addEventListener('change', function () {
      _populateTehsil(this.value);
      markazEl.innerHTML  = '<option value="">Select Tehsil first</option>';
      markazEl.disabled   = true;
      fetchBtn.disabled   = true;
    });

    tehsilEl.addEventListener('change', function () {
      var dist = distEl.value;
      _populateMarkaz(dist, this.value);
      fetchBtn.disabled = true;
    });

    markazEl.addEventListener('change', function () {
      fetchBtn.disabled = !this.value;
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  POPULATE DROPDOWNS from schoolCache (portal hierarchy)
  // ══════════════════════════════════════════════════════════════════
  function _populateDistricts() {
    var hierarchy = _getHierarchy();
    var distEl    = document.getElementById('enrolDistrict');
    if (!distEl) return;

    var user      = _getUser();
    var userDist  = localStorage.getItem('userMarkaz') || 'All';

    var dists;

    // If user is scoped to a specific district, only show that one
    if (hierarchy.length && userDist && userDist !== 'All') {
      // Find what districts this user's markaz belongs to
      var userDistricts = [...new Set(
        hierarchy
          .filter(function (x) { return x.m === userDist; })
          .map(function (x) { return x.d; })
      )];
      dists = userDistricts.length ? userDistricts
            : [...new Set(hierarchy.map(function (x) { return x.d; }).filter(Boolean))].sort();
    } else {
      dists = [...new Set(hierarchy.map(function (x) { return x.d; }).filter(Boolean))].sort();
    }

    distEl.innerHTML = '<option value="">Select District</option>' +
      dists.map(function (d) {
        return '<option value="' + _esc(d) + '">' + _esc(d) + '</option>';
      }).join('');
    distEl.disabled = false;

    // Auto-select if user is scoped to one district
    if (dists.length === 1) {
      distEl.value = dists[0];
      _populateTehsil(dists[0]);
    }
  }

  function _populateTehsil(district) {
    var hierarchy = _getHierarchy();
    var tehsilEl  = document.getElementById('enrolTehsil');
    var markazEl  = document.getElementById('enrolMarkaz');
    if (!tehsilEl) return;

    var tehsils = [...new Set(
      hierarchy
        .filter(function (x) { return x.d === district; })
        .map(function (x) { return x.t; })
        .filter(Boolean)
    )].sort();

    tehsilEl.innerHTML = '<option value="">Select Tehsil</option>' +
      tehsils.map(function (t) {
        return '<option value="' + _esc(t) + '">' + _esc(t) + '</option>';
      }).join('');
    tehsilEl.disabled = false;

    markazEl.innerHTML = '<option value="">Select Tehsil first</option>';
    markazEl.disabled  = true;

    // Auto-select if only one
    if (tehsils.length === 1) {
      tehsilEl.value = tehsils[0];
      _populateMarkaz(district, tehsils[0]);
    }
  }

  function _populateMarkaz(district, tehsil) {
    var hierarchy = _getHierarchy();
    var markazEl  = document.getElementById('enrolMarkaz');
    var fetchBtn  = document.getElementById('enrolFetchBtn');
    if (!markazEl) return;

    var userMarkaz = localStorage.getItem('userMarkaz') || 'All';

    var markazList = [...new Set(
      hierarchy
        .filter(function (x) { return x.d === district && x.t === tehsil; })
        .map(function (x) { return x.m; })
        .filter(Boolean)
    )].sort();

    // Filter to user's markaz if restricted
    if (userMarkaz && userMarkaz !== 'All') {
      var scoped = markazList.filter(function (m) { return m === userMarkaz; });
      if (scoped.length) markazList = scoped;
    }

    markazEl.innerHTML = '<option value="">Select Markaz</option>' +
      markazList.map(function (m) {
        return '<option value="' + _esc(m) + '">' + _esc(m) + '</option>';
      }).join('');
    markazEl.disabled = false;

    // Auto-select if only one
    if (markazList.length === 1) {
      markazEl.value   = markazList[0];
      fetchBtn.disabled = false;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  FETCH ENROLLMENT DATA from PESRP GAS backend
  // ══════════════════════════════════════════════════════════════════
  window._enrollFetch = async function () {
    var markaz  = document.getElementById('enrolMarkaz').value;
    var fetchBtn = document.getElementById('enrolFetchBtn');
    var accordion = document.getElementById('enrolAccordion');
    var badge   = document.getElementById('enrolSyncBadge');
    if (!markaz) return;

    _currentMarkaz = markaz;
    _enrollData    = [];

    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Fetching…';
    accordion.innerHTML = '<div class="enrol-loading"><span class="spinner-border spinner-border-sm"></span> Loading enrollment data from PESRP…</div>';
    badge.style.display = 'inline-block';
    badge.textContent   = '⟳ Syncing…';

    // Hide cards while loading
    document.getElementById('enrolCards').style.display = 'none';
    document.getElementById('enrolExportBar').style.display = 'none';

    try {
      var url = ENROLLMENT_SCRIPT_URL + '?markaz=' + encodeURIComponent(markaz);
      var res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var json = await res.json();

      if (json.status === 'success' || json.success) {
        _enrollData = json.data || [];
        _renderResults();
        badge.textContent = '✓ Live Data';
        badge.style.background = 'rgba(5,150,105,.12)';
        badge.style.color = '#059669';
      } else {
        throw new Error(json.message || 'Server returned error');
      }
    } catch (err) {
      accordion.innerHTML = [
        '<div class="enrol-empty">',
          '<i class="bi bi-exclamation-triangle" style="font-size:2rem;display:block;margin-bottom:12px;color:var(--warn)"></i>',
          '<strong>Could not load enrollment data</strong><br>',
          '<span style="font-size:.78rem">' + _esc(err.message) + '</span>',
        '</div>',
      ].join('');
      badge.textContent = '⚠ Failed';
      badge.style.background = 'rgba(217,119,6,.12)';
      badge.style.color = '#d97706';
      console.error('[enrollment] Fetch failed:', err);
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.innerHTML = '<i class="bi bi-cloud-download-fill"></i> Fetch Live Enrollment Data';
    }
  };

  // ══════════════════════════════════════════════════════════════════
  //  RENDER RESULTS
  // ══════════════════════════════════════════════════════════════════
  function _renderResults() {
    var accordion  = document.getElementById('enrolAccordion');
    var cardsEl    = document.getElementById('enrolCards');
    var exportEl   = document.getElementById('enrolExportBar');

    if (!_enrollData.length) {
      accordion.innerHTML = [
        '<div class="enrol-empty">',
          '<i class="bi bi-inbox" style="font-size:2rem;display:block;margin-bottom:10px"></i>',
          'No enrollment data found for <strong>' + _esc(_currentMarkaz) + '</strong>',
        '</div>',
      ].join('');
      return;
    }

    // Totals
    var totTotal = 0, totMale = 0, totFemale = 0;
    _enrollData.forEach(function (s) {
      totTotal  += (s.total  || 0);
      totMale   += (s.male   || 0);
      totFemale += (s.female || 0);
    });

    document.getElementById('enrolTotal').textContent  = totTotal.toLocaleString();
    document.getElementById('enrolMale').textContent   = totMale.toLocaleString();
    document.getElementById('enrolFemale').textContent = totFemale.toLocaleString();
    cardsEl.style.display  = 'grid';
    exportEl.style.display = 'block';

    // Controls + accordion
    var html = [
      '<div class="enrol-ctrl-bar">',
        '<span style="font-size:.78rem;color:var(--t3);margin-right:auto">',
          _enrollData.length + ' school' + (_enrollData.length !== 1 ? 's' : ''),
        '</span>',
        '<button class="enrol-ctrl-btn" onclick="window._enrollExpandAll()">',
          '<i class="bi bi-arrows-expand"></i> Expand All',
        '</button>',
        '<button class="enrol-ctrl-btn" onclick="window._enrollCollapseAll()">',
          '<i class="bi bi-arrows-collapse"></i> Collapse All',
        '</button>',
      '</div>',
    ].join('');

    _enrollData.forEach(function (school, idx) {
      var classRows = '';
      var details   = school.details || school.classes || [];
      details.forEach(function (c) {
        classRows += [
          '<div class="enrol-class-row">',
            '<span class="enrol-class-name">',
              '<i class="bi bi-book-fill" style="color:var(--brand);margin-right:5px"></i>',
              _esc(c.className || c.class || c.name),
            '</span>',
            '<div class="enrol-class-nums">',
              '<span style="color:var(--accent)"><i class="bi bi-gender-male"></i> ' + (c.m || c.male || 0).toLocaleString() + '</span>',
              '<span style="color:#d946a8"><i class="bi bi-gender-female"></i> ' + (c.f || c.female || 0).toLocaleString() + '</span>',
              '<span style="color:var(--ok);font-weight:800"><i class="bi bi-people-fill"></i> ' + (c.t || c.total || 0).toLocaleString() + '</span>',
            '</div>',
          '</div>',
        ].join('');
      });

      html += [
        '<div class="enrol-school-card" id="enrol-card-' + idx + '">',

          /* Header */
          '<div class="enrol-school-hdr" onclick="window._enrollToggle(' + idx + ')">',
            '<div class="enrol-school-icon"><i class="bi bi-building-fill"></i></div>',
            '<div style="flex:1;min-width:0">',
              '<div class="enrol-school-name">' + _esc(school.name) + '</div>',
              '<div class="enrol-school-meta">',
                '<span><i class="bi bi-123"></i> EMIS: ' + _esc(school.emis) + '</span>',
                school.level ? '<span><i class="bi bi-bookmark-fill"></i> ' + _esc(school.level) + '</span>' : '',
              '</div>',
              '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">',
                '<span class="enrol-pill enrol-pill-m"><i class="bi bi-gender-male"></i> ' + (school.male || 0).toLocaleString() + '</span>',
                '<span class="enrol-pill enrol-pill-f"><i class="bi bi-gender-female"></i> ' + (school.female || 0).toLocaleString() + '</span>',
                '<span class="enrol-pill enrol-pill-t"><i class="bi bi-people-fill"></i> ' + (school.total || 0).toLocaleString() + '</span>',
              '</div>',
            '</div>',
            '<i class="bi bi-chevron-down enrol-chevron"></i>',
          '</div>',

          /* Detail */
          '<div class="enrol-detail">',
            classRows
              ? '<div style="border-top:1px solid var(--b0)">' + classRows + '</div>'
              : '<div style="padding:16px;text-align:center;color:var(--t3);font-size:.82rem">No class breakdown available</div>',
          '</div>',

        '</div>',
      ].join('');
    });

    accordion.innerHTML = html;
  }

  // ── Toggle / expand / collapse ─────────────────────────────────
  window._enrollToggle = function (idx) {
    var card = document.getElementById('enrol-card-' + idx);
    if (card) card.classList.toggle('open');
  };

  window._enrollExpandAll = function () {
    document.querySelectorAll('.enrol-school-card').forEach(function (c) {
      c.classList.add('open');
    });
  };

  window._enrollCollapseAll = function () {
    document.querySelectorAll('.enrol-school-card').forEach(function (c) {
      c.classList.remove('open');
    });
  };

  // ══════════════════════════════════════════════════════════════════
  //  EXPORT CSV
  // ══════════════════════════════════════════════════════════════════
  window._enrollExport = function () {
    if (!_enrollData.length) {
      alert('No data to export. Fetch a Markaz first.');
      return;
    }

    var lines = ['School Name,EMIS Code,Level,Class,Male,Female,Total'];
    _enrollData.forEach(function (school) {
      var details = school.details || school.classes || [];
      if (!details.length) {
        lines.push([
          '"' + String(school.name || '').replace(/"/g, '""') + '"',
          school.emis || '',
          school.level || '',
          '—', school.male || 0, school.female || 0, school.total || 0,
        ].join(','));
      } else {
        details.forEach(function (c) {
          lines.push([
            '"' + String(school.name || '').replace(/"/g, '""') + '"',
            school.emis || '',
            school.level || '',
            '"' + String(c.className || c.class || c.name || '').replace(/"/g, '""') + '"',
            c.m || c.male || 0,
            c.f || c.female || 0,
            c.t || c.total || 0,
          ].join(','));
        });
      }
    });

    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href   = url;
    a.download = 'Enrollment_' +
      (_currentMarkaz || 'export').replace(/[^a-z0-9]/gi, '_') + '_' +
      new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ══════════════════════════════════════════════════════════════════
  //  PUBLIC OPENER — called by dashboard card / router
  // ══════════════════════════════════════════════════════════════════
  window.openEnrollmentModule = function () {
    _injectView();                                    // ensure view exists
    switchGlobalTab('enrollmentView', null);          // switch to it

    // Wait a tick then populate hierarchy
    setTimeout(function () {
      var hierarchy = _getHierarchy();
      if (hierarchy.length) {
        _populateDistricts();
      } else {
        // Hierarchy not in cache yet — fetch it
        if (typeof apiCall === 'function') {
          apiCall('getSchoolHierarchy', undefined)
            .then(function (data) {
              if (typeof schoolCache !== 'undefined') schoolCache = data || [];
              _populateDistricts();
            })
            .catch(function () {
              var distEl = document.getElementById('enrolDistrict');
              if (distEl) {
                distEl.innerHTML = '<option value="">Could not load hierarchy</option>';
              }
            });
        }
      }
    }, 50);
  };

  // ══════════════════════════════════════════════════════════════════
  //  ROUTER INTEGRATION — wire into existing ROUTES after load
  // ══════════════════════════════════════════════════════════════════
  window.addEventListener('load', function () {
    if (typeof ROUTES !== 'undefined') {
      ROUTES['enrollment'] = function () { window.openEnrollmentModule(); };
      console.log('[enrollment] ✅ Route registered: enrollment');
    }

    // Wrap openEnrollmentModule for cache-service history push
    if (typeof navigateTo === 'function' && typeof ROUTES !== 'undefined') {
      var _rawOpen = window.openEnrollmentModule;
      window.openEnrollmentModule = function () {
        _rawOpen();
        if (typeof history !== 'undefined') {
          history.pushState({ route: 'enrollment' }, '', '#enrollment');
        }
      };
    }
  });

  // ══════════════════════════════════════════════════════════════════
  //  INIT — inject view into DOM as soon as page is ready
  // ══════════════════════════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', function () {
    // Delay until appWrapper exists
    var attempts = 0;
    var interval = setInterval(function () {
      attempts++;
      if (document.getElementById('appWrapper')) {
        clearInterval(interval);
        _injectView();
        console.log('[enrollment] ✅ View injected');
      }
      if (attempts > 30) clearInterval(interval);
    }, 200);
  });

  console.log('[enrollment] Loaded ✅');

})();
