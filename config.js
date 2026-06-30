const CONFIG = {
  // ── Supabase ────────────────────────────────────────────────────
  SUPABASE_URL: 'https://xxxx.supabase.co',      // <-- your project URL
  SUPABASE_ANON_KEY: 'your-anon-key-here',        // <-- anon/public key

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
