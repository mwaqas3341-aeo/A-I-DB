// =====================================================================
//  CONFIG.JS  —  Single source of truth for environment settings
//  ▸ Fill in SUPABASE_URL and SUPABASE_ANON_KEY below
//  ▸ Find both in: Supabase Dashboard → Project Settings → API
// =====================================================================

const CONFIG = {

  // ── Supabase ─────────────────────────────────────────────────────
  SUPABASE_URL:      'https://bnvrblekeppkpvcjjpli.supabase.co/rest/v1/',   // <-- paste your Project URL
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJudnJibGVrZXBwa3B2Y2pqcGxpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MTEyMjIsImV4cCI6MjA5ODI4NzIyMn0.9qmk8Msddi5FwQPY6SvM4WXVQiZUjLXJEsjxHdsgw68',   // <-- paste your anon public key

  // ── App identity ──────────────────────────────────────────────────
  APP_NAME:    'School Staff Portal',
  APP_VERSION: '2.0.0',

  // ── Session / cache ───────────────────────────────────────────────
  SESSION_KEY:      'portalUser',
  SCHOOL_CACHE_KEY: 'schoolHierarchy',

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
