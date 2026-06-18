// =====================================================================
//  CONFIG.JS  —  Single source of truth for all environment settings
//  ▸ After deploying your Apps Script as a Web App, paste the URL below
//  ▸ This file is the ONLY place you need to change the URL
// =====================================================================

const CONFIG = {

  // ── Apps Script Web App URL ────────────────────────────────────────
  //  Deploy as:  Execute as → Me  |  Who has access → Anyone
  //  Then paste the  /exec  URL here:
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbz_O8TNLD_qw6wlqMb3oFXzV-cjunw2q2iLmic3l2awPtnzQKR1_GUfTgroXM0WG1i6WA/exec',

  // ── App identity ──────────────────────────────────────────────────
  APP_NAME:    'School Staff Portal',
  APP_VERSION: '1.0.0',

  // ── Session / cache ───────────────────────────────────────────────
  SESSION_KEY:      'portalUser',          // sessionStorage key for logged-in user
  SCHOOL_CACHE_KEY: 'schoolHierarchy',     // sessionStorage key for school hierarchy

  // ── Pagination ───────────────────────────────────────────────────
  PAGE_SIZE: 100,

  // ── Feature flags (set false to hide a module) ───────────────────
  FEATURES: {
    hrView:         true,
    staffForm:      true,
    adminPanel:     true,
    publicSchools:  true,
    privateSchools: true,
  }

};
