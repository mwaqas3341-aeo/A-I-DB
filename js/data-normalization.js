/**
 * Data Normalization & Auto-Correction Engine
 * ─────────────────────────────────────────────────────────────────
 * Cleans and standardizes values coming from uploaded Excel/CSV files
 * BEFORE they're validated or written to Supabase, so a logically
 * correct row (e.g. status "ACTIVE.", "  active", "Active ") is never
 * rejected — or silently missing from a dashboard/filter — just
 * because of capitalization, spacing, or stray punctuation.
 *
 * Used by: js/schools-import.js (Private + Public School template
 * uploads). Written to be reusable anywhere else a controlled-value
 * (dropdown) or numeric-ID field needs the same cleanup before an
 * insert/update.
 *
 * HOW TO TEACH IT A NEW VALUE
 * ─────────────────────────────────────────────────────────────────
 * Add one line to DN_DICTIONARY — either under the specific DB column
 * name (e.g. `school_gender`), or under `_shared` if the synonym
 * applies across more than one field. That's the only file that ever
 * needs to change to extend the correction rules.
 *
 * The key must be the "normalized key" for the input text (see
 * DN_key() below — lowercased, punctuation/spacing/hyphens/underscores
 * stripped) and the value is the exact canonical string to store.
 */

// ── 1. Low-level text cleanup ──────────────────────────────────────

// Invisible characters that sneak in when text is copied out of Excel:
// zero-width space/joiner/non-joiner, BOM, soft hyphen.
const DN_HIDDEN_CHARS_RE = /[\u200B\u200C\u200D\uFEFF\u00AD]/g;

/** Strip hidden/invisible characters and normalize Unicode form. */
function DN_stripHidden(s) {
  return String(s)
    .normalize('NFKC')
    .replace(DN_HIDDEN_CHARS_RE, '')
    .replace(/\u00A0/g, ' '); // non-breaking space -> normal space
}

/** Trim + collapse internal whitespace to a single space, hidden chars removed. */
function DN_clean(raw) {
  if (raw === undefined || raw === null) return '';
  return DN_stripHidden(raw).replace(/\s+/g, ' ').trim();
}

/**
 * Reduces a value to a case/space/punctuation-insensitive lookup key —
 * "Non-Registered", "non registered", "NON_REGISTERED" all become
 * "nonregistered" — so uploaded text can be matched against dropdown
 * options and the correction dictionary regardless of how it was typed.
 */
function DN_key(raw) {
  return DN_clean(raw).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// ── 2. Dictionary of known controlled-value fields ─────────────────
// Keys are already DN_key()'d. `_shared` synonyms are only trusted for
// a given field when they resolve to one of THAT field's own valid
// options (see DN_normalizeValue) — so a "Male"/"Female" synonym can't
// leak into an unrelated free-text column.
const DN_DICTIONARY = {
  _shared: {
    active: 'Active', activated: 'Active',
    inactive: 'Inactive', deactivated: 'Inactive', notactive: 'Inactive',
    yes: 'Yes', no: 'No',
    male: 'Male', female: 'Female',
    registered: 'Registered',
    private: 'Private', public: 'Public',
  },
  status: {
    active: 'Active', inactive: 'Inactive',
  },
  // School Gender — Male / Female / Both, incl. co-education synonyms.
  school_gender: {
    male: 'Male', female: 'Female',
    boy: 'Male', boys: 'Male',
    girl: 'Female', girls: 'Female',
    both: 'Both', bothgender: 'Both', bothgenders: 'Both',
    coeducation: 'Both', coed: 'Both',
    mixed: 'Both', mixedgender: 'Both', mixedschool: 'Both',
  },
  registration_status: {
    registered: 'Registered',
    nonregistered: 'Non Registered', unregistered: 'Non Registered',
    notregistered: 'Non Registered',
    expired: 'Expired',
    inprocess: 'In Process', processing: 'In Process', pending: 'In Process',
    provisionalelicenseissued: 'Provisional E-License Issued',
    provisionalelicense: 'Provisional E-License Issued',
    provisionallicenseissued: 'Provisional E-License Issued',
    elicenseissued: 'Provisional E-License Issued',
  },
};

// Columns reduced to digits only (CNIC / cell numbers).
const DN_DIGIT_FIELDS = new Set([
  'owner_cnic', 'owner_cell_no', 'principal_cnic', 'principal_cell_no',
]);
// Columns that may legitimately hold more than one number
// (Registeration No hint: "e.g. 123456 or 123456, 789012").
const DN_MULTI_NUMERIC_FIELDS = new Set(['registration_no']);

// ── 3. Correction log (debugging aid only — never blocks an upload) ─
let DN_LOG = [];
function DN_logCorrection(entry) { DN_LOG.push(entry); }
function DN_clearLog() { DN_LOG = []; }
function DN_getLog() { return DN_LOG; }
function DN_logSummary() {
  const byField = {};
  DN_LOG.forEach(e => { byField[e.field] = (byField[e.field] || 0) + 1; });
  return { total: DN_LOG.length, byField };
}

// ── 4. Numeric cleaning ─────────────────────────────────────────────
function DN_cleanDigits(raw) {
  return DN_clean(raw).replace(/[^\d]/g, '');
}
// Keeps digits and comma separators; strips spaces/dashes/anything else.
function DN_cleanMultiNumeric(raw) {
  return DN_clean(raw).split(',').map(p => p.replace(/[^\d]/g, '')).filter(Boolean).join(', ');
}

// ── 5. Main entry point ─────────────────────────────────────────────
/**
 * Normalizes a single uploaded cell value.
 *   col     — DB column name (e.g. 'status', 'school_gender'), used to
 *             pick the numeric/dictionary rule; may be undefined.
 *   raw     — the raw uploaded cell value.
 *   options — the field's real dropdown options if it's a controlled
 *             field (e.g. ['Active','Inactive']); pass null/[] for
 *             plain text fields.
 *   header  — display header, used only for the correction log.
 * Returns the corrected string, and (silently) records a DN_LOG entry
 * whenever the final value differs from the merely-whitespace-trimmed
 * original, for the debugging log described in the feature request.
 */
function DN_normalizeValue(col, raw, options, header) {
  const original = (raw === undefined || raw === null) ? '' : String(raw);
  const cleaned = DN_clean(original);
  if (!cleaned) return '';

  let result = cleaned;

  if (col && DN_DIGIT_FIELDS.has(col)) {
    result = DN_cleanDigits(cleaned);
  } else if (col && DN_MULTI_NUMERIC_FIELDS.has(col)) {
    result = DN_cleanMultiNumeric(cleaned);
  } else if ((options && options.length) || (col && DN_DICTIONARY[col])) {
    const key = DN_key(cleaned);
    const optHit = (options || []).find(o => DN_key(o) === key);          // a) exact match vs the field's real options
    const colHit = col && DN_DICTIONARY[col] && DN_DICTIONARY[col][key];  // b) column-specific dictionary
    const sharedHit = DN_DICTIONARY._shared[key];                          // c) shared vocabulary, only if valid for this field
    const sharedOk = sharedHit && (!options || !options.length || options.includes(sharedHit));
    result = optHit || colHit || (sharedOk ? sharedHit : cleaned);
  }

  if (result !== original.trim()) {
    DN_logCorrection({ field: header || col || '(unknown)', from: original, to: result });
  }
  return result;
}
