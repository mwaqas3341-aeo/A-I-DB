// =====================================================================
//  SHARED IMPORT CONFLICT DIALOG
//  Used by hr-staff-import.js, schools-import.js (public + private) —
//  any importer that needs to ask "some existing records have values
//  that differ from the uploaded file, update or skip them?" before
//  writing anything. One shared modal + promise wrapper so all three
//  importers behave identically instead of three separate dialogs.
//
//  Field-level sync rule these importers all follow:
//    • Imported value blank            → keep existing value, always.
//    • Imported value equals existing  → no-op, never even counted.
//    • Imported value differs from a
//      non-blank existing value        → counted as a "conflict" and
//                                         held back until the reviewer
//                                         picks Update All or Skip All
//                                         (Skip All == today's default
//                                         behaviour: never overwrite).
// =====================================================================
let _impResolveFn = null;

/**
 * @param {Array<{label:string, fields:Array<{header:string, existing:string, incoming:string}>}>} diffRows
 * @param {(choice:'update'|'skip') => void} onResolve
 */
function showImportConflictDialog(diffRows, onResolve) {
  _impResolveFn = onResolve;
  document.getElementById('impConflictSummary').textContent =
    `${diffRows.length} existing record${diffRows.length !== 1 ? 's' : ''} in the database ${diffRows.length !== 1 ? 'have' : 'has'} different values than the uploaded file. Do you want to update the database using the uploaded file?`;

  const totalFields = diffRows.reduce((n, r) => n + r.fields.length, 0);
  document.getElementById('impConflictCount').textContent =
    `${totalFields} field${totalFields !== 1 ? 's' : ''} across ${diffRows.length} record${diffRows.length !== 1 ? 's' : ''}`;

  const listEl = document.getElementById('impConflictList');
  listEl.innerHTML = diffRows.map(r => `
    <div class="imp-conflict-row">
      <strong>${_impEsc(r.label)}</strong>
      <ul>${r.fields.map(f => `<li><span class="imp-field">${_impEsc(f.header)}:</span> <s>${_impEsc(f.existing)}</s> → <b>${_impEsc(f.incoming)}</b></li>`).join('')}</ul>
    </div>`).join('');
  listEl.style.display = 'none';
  document.getElementById('impConflictReviewBtn').textContent = 'Review Differences';
  document.getElementById('impConflictModal').classList.remove('hidden');
}

function impToggleReview() {
  const el  = document.getElementById('impConflictList');
  const btn = document.getElementById('impConflictReviewBtn');
  const show = el.style.display === 'none';
  el.style.display = show ? 'block' : 'none';
  btn.textContent = show ? 'Hide Differences' : 'Review Differences';
}

function impResolve(choice) {
  document.getElementById('impConflictModal').classList.add('hidden');
  const fn = _impResolveFn;
  _impResolveFn = null;
  if (fn) fn(choice);
}

function _impEsc(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Promise-based wrapper, so importers can `await` the reviewer's choice. */
function askImportConflict(diffRows) {
  if (!diffRows.length) return Promise.resolve('skip'); // nothing to ask about
  return new Promise(resolve => showImportConflictDialog(diffRows, resolve));
}
