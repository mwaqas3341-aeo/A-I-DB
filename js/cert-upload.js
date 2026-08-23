// ══════════════════════════════════════════════════════════════════════
//  Shared certificate/document picture upload widget (multi-picture)
// ══════════════════════════════════════════════════════════════════════
// Used by:
//   Private Schools — E-License / Building Fitness / Health & Hygiene
//   Public Schools  — Fard Malikiat
//
// Each certificate type holds a LIST of pictures (not just one). Every
// field's own hidden input (id = f.id) carries the current list as a
// JSON string — the exact same generic header<->column mechanism every
// other field on these forms already uses, so no special-casing is
// needed anywhere else in buildXForm()/editX()/submitXForm(). That JSON
// text is written straight into a single `..._pics` column server-side
// (private_schools.e_license_pics etc. — see migration
// 20260823062055_multi_picture_support_school_certs.sql).
//
// Handles: JPG-only validation, client-side compression targeting well
// under 50KB per picture (iterative — drops quality, then dimensions,
// until under the cap or a sane floor is hit), thumbnails with a "View"
// button (never the raw Drive file id/url as visible text — see
// _certRenderThumbs), a "Remove" button per picture, and the actual
// add/delete calls to the school-cert-upload Edge Function. That
// function does the Google Drive folder resolution and the `..._pics`
// column read-modify-write server-side.
//
// Depends on: _sb, CONFIG, showToast (already global via api.js/config.js).
// Load AFTER api.js and BEFORE public_schools.js / private_schools.js /
// schools-import.js — all three reference things defined here.
// ══════════════════════════════════════════════════════════════════════

// Headers that hold system-managed picture-list JSON. Never hand-typed,
// and excluded from every bulk-import template (see schools-import.js)
// for the same reason — see private_schools.js/public_schools.js's
// PRIV_SYSTEM_REF_HEADERS / PUB_SYSTEM_REF_HEADERS, which also use this
// list to keep the picture columns permanently locked/read-only (View-
// only, never raw text) everywhere in the table, not just here.
const SCHOOL_CERT_HIDDEN_HEADERS = [
  'E-License Pictures',
  'Building Fitness Certificate Pictures',
  'Health & Hygiene Certificate Pictures',
  'Fard Malikiat Pictures',
];

// Maps each photo field's DOM id to what it needs to do its job. Must
// stay in sync with the `cert_type`/`school_type` values the
// school-cert-upload Edge Function expects, and with the field ids
// defined in PRIVATE_FIELD_CONFIG / PUB_EDITABLE_FIELDS.
const CERT_FIELD_REGISTRY = {
  priv_e_license_pic:    { certType: 'e_license',        schoolType: 'private', getSchoolKey: () => document.getElementById('privEditId')?.value || '' },
  priv_bldg_fitness_pic: { certType: 'building_fitness',  schoolType: 'private', getSchoolKey: () => document.getElementById('privEditId')?.value || '' },
  priv_health_pic:       { certType: 'health_hygiene',    schoolType: 'private', getSchoolKey: () => document.getElementById('privEditId')?.value || '' },
  pub_fard_malikiat_pic: { certType: 'fard_malikiat',     schoolType: 'public',  getSchoolKey: () => document.getElementById('pubEditId')?.value  || '' },
};

const CERT_MAX_PHOTOS_DEFAULT = 6;
const CERT_TARGET_MAX_BYTES   = 50 * 1024; // hard target ceiling per picture
const CERT_TARGET_MIN_BYTES   = 25 * 1024; // don't bother squeezing harder than this once we're under it

// ── Compression — iteratively steps quality down, then dimension down,
//    until the JPEG is under CERT_TARGET_MAX_BYTES (or we hit a floor
//    we won't go below, to keep the picture legible) ────────────────
const _CERT_QUALITY_STEPS = [0.72, 0.6, 0.5, 0.4, 0.32, 0.25];
const _CERT_DIM_STEPS     = [1600, 1400, 1200, 1000, 800, 640];

function _certLoadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file does not look like a valid image.'));
      img.onload = () => resolve(img);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function _certCanvasBlob(img, maxDim, quality) {
  return new Promise((resolve, reject) => {
    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Could not compress this image.')),
      'image/jpeg', quality
    );
  });
}

// Tries quality steps at the largest dimension first (keeps pictures as
// sharp as possible while shrinking file size); once quality is
// exhausted at a given dimension, drops to the next smaller dimension
// and starts back at the top quality step. Stops as soon as a result is
// under CERT_TARGET_MAX_BYTES, or returns the smallest attempt made if
// even the floor (640px @ quality 0.25) is still over the cap — a very
// busy/high-detail photo at the absolute floor is accepted rather than
// degraded to the point of being useless.
async function _compressCertImage(file) {
  const img = await _certLoadImage(file);
  let best = null;
  for (const dim of _CERT_DIM_STEPS) {
    for (const q of _CERT_QUALITY_STEPS) {
      const blob = await _certCanvasBlob(img, dim, q);
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= CERT_TARGET_MAX_BYTES) return blob;
    }
  }
  return best; // floor reached — return the smallest we managed
}

function _certBlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not encode the image for upload.'));
    reader.readAsDataURL(blob);
  });
}

function _certFmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function _certEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Reads the field's own hidden JSON text and returns a safe array,
// tolerating anything unexpected (empty string, malformed JSON, a
// leftover non-array value) rather than throwing.
function _certGetPhotos(fieldId) {
  const el = document.getElementById(fieldId);
  if (!el || !el.value) return [];
  try {
    const parsed = JSON.parse(el.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function _certSetPhotos(fieldId, photos) {
  const el = document.getElementById(fieldId);
  if (el) el.value = JSON.stringify(photos);
}

// ── Render — called from buildPrivateForm()/buildPublicForm() for any
//    field with `photo: true` instead of the normal input markup.
//    Note the hidden input here (id=f.id) IS the field's real value for
//    the generic save/edit-populate loops in private_schools.js /
//    public_schools.js — nothing else needs to know this is special. ──
function renderCertField(f) {
  const maxPhotos = f.maxPhotos || CERT_MAX_PHOTOS_DEFAULT;
  return `
    <div class="ff cert-ff" id="wrap_${f.id}" style="grid-column:1/-1">
      <span class="flabel" title="${_certEsc(f.hint || f.header)}">${_certEsc(f.hint || f.header)} <span class="cert-hint-fmt">(JPG/JPEG only, up to ${maxPhotos} pictures)</span></span>
      <input type="hidden" id="${f.id}" data-header="${_certEsc(f.header)}" value="[]">
      <div class="cert-widget" id="certw_${f.id}" data-max="${maxPhotos}">
        <input type="file" accept=".jpg,.jpeg,image/jpeg" multiple id="${f.id}_file" style="display:none" onchange="_onCertFilesSelected('${f.id}')">
        <div class="cert-widget-row">
          <button type="button" class="btn btn-sm btn-outline-secondary" id="${f.id}_btn" onclick="document.getElementById('${f.id}_file').click()">
            <i class="bi bi-camera"></i> Add Picture(s)
          </button>
          <span class="cert-count" id="${f.id}_count"></span>
        </div>
        <div class="cert-thumbs" id="${f.id}_thumbs"></div>
        <div class="cert-progress-track" id="${f.id}_progressTrack" style="display:none">
          <div class="cert-progress-bar" id="${f.id}_progressBar"></div>
        </div>
        <div class="cert-sizes" id="${f.id}_sizes"></div>
        <div class="cert-error field-error" id="${f.id}_error"></div>
      </div>
    </div>`;
}

// Renders each existing picture as a "View" button + "Remove" button.
// Deliberately never prints the Drive file id or the raw URL as visible
// text anywhere — only as the href of a same-labelled "View" button —
// so nothing resembling a Drive id/link is ever shown to a user.
function _certRenderThumbs(fieldId) {
  const thumbsEl = document.getElementById(fieldId + '_thumbs');
  const countEl  = document.getElementById(fieldId + '_count');
  const widgetEl = document.getElementById('certw_' + fieldId);
  if (!thumbsEl) return;
  const photos  = _certGetPhotos(fieldId);
  const maxPhotos = widgetEl ? parseInt(widgetEl.dataset.max || CERT_MAX_PHOTOS_DEFAULT) : CERT_MAX_PHOTOS_DEFAULT;

  thumbsEl.innerHTML = photos.map((p, i) => `
    <span class="cert-thumb">
      <a href="${_certEsc(p.url)}" target="_blank" rel="noopener" class="btn btn-xs btn-outline-secondary cert-view-btn">
        <i class="bi bi-eye"></i> View${photos.length > 1 ? ' ' + (i + 1) : ''}
      </a>
      <button type="button" class="btn btn-xs btn-outline-danger cert-remove-btn" title="Remove this picture"
              onclick="_onCertRemovePhoto('${fieldId}', '${_certEsc(p.id)}')">
        <i class="bi bi-trash"></i>
      </button>
    </span>`).join('');

  if (countEl) countEl.textContent = photos.length ? `${photos.length} of ${maxPhotos} uploaded` : '';
  const btnEl = document.getElementById(fieldId + '_btn');
  if (btnEl) btnEl.disabled = photos.length >= maxPhotos;
}

// ── Upload flow — one file at a time (sequential), so progress/labels
//    stay simple and a failure partway through only affects the picture
//    that failed, not the whole batch ───────────────────────────────
async function _onCertFilesSelected(fieldId) {
  const input = document.getElementById(fieldId + '_file');
  const files = input && input.files ? Array.from(input.files) : [];
  if (input) input.value = '';
  if (!files.length) return;

  const reg = CERT_FIELD_REGISTRY[fieldId];
  if (!reg) return;

  const errEl    = document.getElementById(fieldId + '_error');
  const sizesEl  = document.getElementById(fieldId + '_sizes');
  const btnEl    = document.getElementById(fieldId + '_btn');
  const trackEl  = document.getElementById(fieldId + '_progressTrack');
  const barEl    = document.getElementById(fieldId + '_progressBar');
  const widgetEl = document.getElementById('certw_' + fieldId);
  const maxPhotos = widgetEl ? parseInt(widgetEl.dataset.max || CERT_MAX_PHOTOS_DEFAULT) : CERT_MAX_PHOTOS_DEFAULT;
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  const schoolKey = reg.getSchoolKey();
  if (!schoolKey) {
    if (errEl) { errEl.textContent = 'Save the record first, then upload pictures.'; errEl.style.display = 'block'; }
    return;
  }

  let currentCount = _certGetPhotos(fieldId).length;
  if (currentCount >= maxPhotos) {
    if (errEl) { errEl.textContent = `Maximum ${maxPhotos} pictures already uploaded.`; errEl.style.display = 'block'; }
    return;
  }

  if (btnEl) btnEl.disabled = true;
  if (trackEl) trackEl.style.display = 'block';

  const { data: { session } } = await _sb.auth.getSession();
  if (!session || !session.access_token) {
    if (errEl) { errEl.textContent = 'Your session has expired — please sign in again.'; errEl.style.display = 'block'; }
    if (btnEl) btnEl.disabled = false;
    if (trackEl) trackEl.style.display = 'none';
    return;
  }

  let uploaded = 0, failed = 0;
  for (let idx = 0; idx < files.length; idx++) {
    if (currentCount >= maxPhotos) { failed++; continue; }
    const file = files[idx];
    if (barEl) barEl.style.width = Math.round((idx / files.length) * 15) + '%';

    const isJpg = /image\/jpe?g/i.test(file.type) || /\.(jpe?g)$/i.test(file.name);
    if (!isJpg) {
      failed++;
      if (errEl) { errEl.textContent = `"${file.name}" skipped — only JPG/JPEG files are allowed.`; errEl.style.display = 'block'; }
      continue;
    }

    try {
      if (sizesEl) sizesEl.textContent = `(${idx + 1}/${files.length}) Original: ${_certFmtSize(file.size)} — compressing…`;
      const compressed = await _compressCertImage(file);
      if (barEl) barEl.style.width = Math.round(((idx + 0.5) / files.length) * 70) + '%';
      if (sizesEl) sizesEl.textContent = `(${idx + 1}/${files.length}) Original: ${_certFmtSize(file.size)} → Compressed: ${_certFmtSize(compressed.size)} — uploading…`;

      const base64 = await _certBlobToBase64(compressed);
      const res = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/school-cert-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
        body: JSON.stringify({
          action: 'add',
          cert_type: reg.certType,
          school_type: reg.schoolType,
          school_key: schoolKey,
          filename: (file.name || 'certificate.jpg').replace(/\.[^.]+$/, '') + '.jpg',
          content_base64: base64,
        }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok || !result || !result.success) throw new Error((result && result.message) || `Upload failed (HTTP ${res.status}).`);

      _certSetPhotos(fieldId, result.pics || []);
      currentCount = (result.pics || []).length;
      uploaded++;
      const savedPct = file.size > compressed.size ? Math.round((1 - compressed.size / file.size) * 100) : 0;
      if (sizesEl) sizesEl.textContent = `(${idx + 1}/${files.length}) Compressed: ${_certFmtSize(compressed.size)}` + (savedPct > 0 ? ` (${savedPct}% smaller)` : '') + ' — uploaded ✓';
    } catch (e) {
      failed++;
      if (errEl) { errEl.textContent = (e && e.message) || 'Upload failed. Please try again.'; errEl.style.display = 'block'; }
    }
    _certRenderThumbs(fieldId);
  }

  if (barEl) barEl.style.width = '100%';
  if (uploaded && typeof showToast === 'function') showToast(`${uploaded} picture${uploaded > 1 ? 's' : ''} uploaded${failed ? `, ${failed} failed` : ''}.`, !failed);
  else if (failed && typeof showToast === 'function') showToast('Picture upload failed.', false);

  if (btnEl) btnEl.disabled = _certGetPhotos(fieldId).length >= maxPhotos;
  setTimeout(() => {
    if (trackEl) trackEl.style.display = 'none';
    if (barEl) barEl.style.width = '0%';
    if (sizesEl && !failed) sizesEl.textContent = '';
  }, 1200);
}

async function _onCertRemovePhoto(fieldId, photoId) {
  const reg = CERT_FIELD_REGISTRY[fieldId];
  if (!reg) return;
  if (!confirm('Remove this picture? This cannot be undone.')) return;

  const schoolKey = reg.getSchoolKey();
  const errEl = document.getElementById(fieldId + '_error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  try {
    const { data: { session } } = await _sb.auth.getSession();
    if (!session || !session.access_token) throw new Error('Your session has expired — please sign in again.');

    const res = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/school-cert-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
      body: JSON.stringify({ action: 'delete', cert_type: reg.certType, school_type: reg.schoolType, school_key: schoolKey, drive_id: photoId }),
    });
    const result = await res.json().catch(() => null);
    if (!res.ok || !result || !result.success) throw new Error((result && result.message) || `Could not remove the picture (HTTP ${res.status}).`);

    _certSetPhotos(fieldId, result.pics || []);
    _certRenderThumbs(fieldId);
    if (typeof showToast === 'function') showToast('Picture removed.', true);
  } catch (e) {
    if (errEl) { errEl.textContent = (e && e.message) || 'Could not remove the picture.'; errEl.style.display = 'block'; }
    if (typeof showToast === 'function') showToast('Could not remove the picture.', false);
  }
}

// Called after a field's hidden JSON input has been populated (edit
// mode) or reset (add mode) to refresh the widget's thumbnail display.
function certWidgetSync(fieldId) {
  const sizesEl = document.getElementById(fieldId + '_sizes');
  const errEl   = document.getElementById(fieldId + '_error');
  if (sizesEl) sizesEl.textContent = '';
  if (errEl)   { errEl.style.display = 'none'; errEl.textContent = ''; }
  _certRenderThumbs(fieldId);
}

function certWidgetSyncAll() {
  Object.keys(CERT_FIELD_REGISTRY).forEach(certWidgetSync);
}

// Shared by private_schools.js / public_schools.js for both the normal
// (read-only) table cell and the locked Row-Editing-Mode cell for a
// picture-list column — a row of "View" buttons only, exactly like the
// form widget's thumbnails, never the raw JSON/id/url as text.
function certPhotoCellHtml(rawVal) {
  let photos = [];
  try { const parsed = rawVal ? JSON.parse(rawVal) : []; photos = Array.isArray(parsed) ? parsed : []; } catch { photos = []; }
  if (!photos.length) return '<span class="text-muted">—</span>';
  return photos.map((p, i) => `
    <a href="${_certEsc(p.url)}" target="_blank" rel="noopener" class="btn btn-xs btn-outline-secondary cert-view-btn" style="margin:1px">
      <i class="bi bi-eye"></i> View${photos.length > 1 ? ' ' + (i + 1) : ''}
    </a>`).join('');
}
