const CONFIG = {
  // ── Supabase ────────────────────────────────────────────────────
  SUPABASE_URL: 'https://xxxx.supabase.co',      // <-- your project URL
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJudnJibGVrZXBwa3B2Y2pqcGxpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MTEyMjIsImV4cCI6MjA5ODI4NzIyMn0.9qmk8Msddi5FwQPY6SvM4WXVQiZUjLXJEsjxHdsgw68',        // <-- anon/public key

  // ── App identity ─────────────────────────────────────────────────
  APP_NAME:    'School Staff Portal',
  APP_VERSION: '2.0.0',

  // ── Session ──────────────────────────────────────────────────────
  SESSION_KEY:      'portalUser',
  SCHOOL_CACHE_KEY: 'schoolHierarchy',

  // ── Pagination ───────────────────────────────────────────────────
  PAGE_SIZE: 100,

  // ── Feature flags ────────────────────────────────────────────────
  FEATURES: {
    hrView:         true,
    staffForm:      true,
    adminPanel:     true,
    publicSchools:  true,
    privateSchools: true,
  }
};
