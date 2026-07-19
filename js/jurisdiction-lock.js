// ── Jurisdiction dropdown lock/grey-out (shared) ──────────────────────
// Applies the same District/Wing/Tehsil/Markaz lock rules uniformly
// across Public Schools, Private Schools, and Staff (HR) filters.
//
// Data restriction (which options a dropdown offers) is now handled by
// Postgres RLS on the `schools` table (see supabase_jurisdiction_rls.sql)
// — getSchoolHierarchyForUser() already only returns rows the signed-in
// user is allowed to see, so this file only decides which selects are
// enabled/disabled and greyed out. It does not filter data itself.
//
// Rules (District > Wing > Tehsil > Markaz):
//   base     (only a primary Markaz, no extra scope)
//              → lock+grey District, Wing, Tehsil, Markaz
//   markaz   (extra Markazes assigned)
//              → lock+grey District, Wing, Tehsil; unlock Markaz
//   tehsil   (Tehsil(s) assigned)
//              → lock+grey District, Wing; lock Tehsil to the assigned
//                value(s); unlock Markaz
//   wing     (Wing(s) assigned)
//              → lock+grey District; lock Wing to the assigned
//                value(s); unlock Tehsil, Markaz
//   district (District(s) assigned)
//              → unlock all four; District restricted to assigned
//                districts (via RLS-scoped hierarchy data)
//   admin    → unlock all four, no restriction
// ────────────────────────────────────────────────────────────────────

/**
 * Reads currentUser's scope and returns which jurisdiction level
 * applies. Does not touch the DOM.
 */
function getJurisdictionLockLevel(user) {
  if (!user || String(user.role || '').toLowerCase() === 'admin') {
    return { level: 'admin', tags: [] };
  }
  const scopeType  = (user.scope_type  || '').trim();
  const scopeValue = (user.scope_value || '').trim();
  const tags = scopeValue ? scopeValue.split(',').map(s => s.trim()).filter(Boolean) : [];

  if (tags.length && scopeType === 'District') return { level: 'district', tags };
  if (tags.length && scopeType === 'Wing')     return { level: 'wing',     tags };
  if (tags.length && scopeType === 'Tehsil')   return { level: 'tehsil',   tags };
  if (tags.length && scopeType === 'Markaz')   return { level: 'markaz',   tags };
  // 'Schools' scope (exact school IDs) or no scope at all → treat like
  // base level for the four cascade dropdowns; the Schools-scope data
  // restriction itself is enforced by RLS regardless.
  return { level: 'base', tags: [] };
}

/**
 * Applies the lock/grey-out state to a module's filter <select>s.
 *
 * @param {Object} ids - element IDs for this module's dropdowns, e.g.
 *   { district:'pubFltDistrict', wing:'pubFltWing',
 *     tehsil:'pubFltTehsil', markaz:'pubFltMarkaz' }
 *   Omit `wing` for modules with no Wing filter (Private Schools).
 * @param {Object} user - currentUser
 * @returns {Object} the computed level info, in case the caller wants it
 */
function applyJurisdictionLock(ids, user) {
  const info = getJurisdictionLockLevel(user);

  const setLocked = (key, locked) => {
    const id = ids[key];
    if (!id) return;                 // this module has no such dropdown
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = !!locked;
    el.classList.toggle('jur-locked', !!locked);
  };

  switch (info.level) {
    case 'admin':
      setLocked('district', false); setLocked('wing', false);
      setLocked('tehsil', false);   setLocked('markaz', false);
      break;
    case 'base':
      setLocked('district', true); setLocked('wing', true);
      setLocked('tehsil', true);   setLocked('markaz', true);
      break;
    case 'markaz':
      setLocked('district', true); setLocked('wing', true);
      setLocked('tehsil', true);   setLocked('markaz', false);
      break;
    case 'tehsil':
      setLocked('district', true); setLocked('wing', true);
      // Only one Tehsil assigned → nothing to choose, grey it out too.
      setLocked('tehsil', info.tags.length <= 1);
      setLocked('markaz', false);
      break;
    case 'wing':
      setLocked('district', true);
      setLocked('wing', info.tags.length <= 1);
      setLocked('tehsil', false); setLocked('markaz', false);
      break;
    case 'district':
      setLocked('district', false); setLocked('wing', false);
      setLocked('tehsil', false);   setLocked('markaz', false);
      break;
  }
  return info;
}

// One-time injected CSS for the greyed-out look — avoids having to
// touch css/styles.css / css/theme.css for this.
(function _injectJurLockStyle() {
  if (document.getElementById('jur-lock-style')) return;
  const style = document.createElement('style');
  style.id = 'jur-lock-style';
  style.textContent = `
    select.jur-locked {
      background-color: #eceff1 !important;
      color: #78909c !important;
      cursor: not-allowed !important;
      opacity: 0.85;
    }
  `;
  document.head.appendChild(style);
})();
