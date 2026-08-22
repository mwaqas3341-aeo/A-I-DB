// ══════════════════════════════════════════════════════════════════════
//  Shared certificate/document picture upload widget
// ══════════════════════════════════════════════════════════════════════
// Used by:
//   Private Schools — E-License / Building Fitness / Health & Hygiene
//   Public Schools  — Fard Malikiat
//
// Handles: JPG-only validation, client-side compression (same canvas
// approach as dispatch-report-form.js's _compressImage — maxDim 1600,
// quality 0.72), original/compressed size + progress UI, and the actual
// upload to the school-cert-upload Edge Function. That function does the
// Google Drive folder resolution, old-file replacement (at most one
// active picture per school+certificate type), and database reference
// update server-side — this file only compresses, uploads, and reflects
// the result in the form.
//
// Depends on: _sb, CONFIG, showToast (already global via api.js/config.js).
// Load AFTER api.js and BEFORE public_schools.js / private_schools.js /
// schools-import.js — all three reference things defined here.
// ══════════════════════════════════════════════════════════════════════

// Headers that exist purely to carry the Drive file id/url between the
// server and this widget. Never shown as a normal input, and excluded
// from every bulk-import template (see schools-import.js) since they
// are never meant to be hand-entered or bulk-uploaded.
const SCHOOL_CERT_HIDDEN_HEADERS = [
  'E-License Picture Drive ID', 'E-License Picture URL',
  'Building Fitness Certificate Picture Drive ID', 'Building Fitness Certificate Picture URL',
  'Health & Hygiene Certificate Picture Drive ID', 'Health & Hygiene Certificate Picture URL',
  'Fard Malikiat Picture Drive ID', 'Fard Malikiat Picture URL',
];

// Maps each photo field's DOM id to what it needs to do its job. Must
// stay in sync with the `cert_type`/`school_type` values the
// school-cert-upload Edge Function expects, and with the field ids
// defined in PRIVATE_FIELD_CONFIG / PUB_EDITABLE_FIELDS below.
const CERT_FIELD_REGISTRY = {
  priv_e_license_pic: {
    certType: 'e_license', schoolType: 'private',
    driveIdField: 'priv_e_license_drive_id', urlField: 'priv_e_license_url',
    getSchoolKey: () => document.getElementById('privEditId')?.value || '',
  },
  priv_bldg_fitness_pic: {
    certType: 'building_fitness', schoolType: 'private',
    driveIdField: 'priv_bldg_fitness_drive_id', urlField: 'priv_bldg_fitness_url',
    getSchoolKey: () => document.getElementById('privEditId')?.value || '',
  },
  priv_health_pic: {
    certType: 'health_hygiene', schoolType: 'private',
    driveIdField: 'priv_health_drive_id', urlField: 'priv_health_url',
    getSchoolKey: () => document.getElementById('privEditId')?.value || '',
  },
  pub_fard_malikiat_pic: {
    certType: 'fard_malikiat', schoolType: 'public',
    driveIdField: 'pub_fard_malikiat_drive_id', urlField: 'pub_fard_malikiat_url',
    getSchoolKey: () => document.getElementById('pubEditId')?.value || '',
  },
};

const CERT_MAX_DIM = 1600;
const CERT_QUALITY = 0.72;

// ── Compression (mirrors dispatch-report-form.js's _compressImage) ────
function _compressCertImage(file, maxDim = CERT_MAX_DIM, quality = CERT_QUALITY) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file does not look like a valid image.'));
      img.onload = () => {
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
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
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

// ── Render — called from buildPrivateForm()/buildPublicForm() for any
//    field with `photo: true` instead of the normal input markup ──────
function renderCertField(f) {
  return `
    <div class="ff cert-ff" id="wrap_${f.id}" style="grid-column:1/-1">
      <span class="flabel" title="${f.hint || f.header}">${f.hint || f.header} <span class="cert-hint-fmt">(JPG/JPEG only)</span></span>
      <div class="cert-widget" id="certw_${f.id}">
        <input type="file" accept=".jpg,.jpeg,image/jpeg" id="${f.id}_file" style="display:none" onchange="_onCertFileSelected('${f.id}')">
        <div class="cert-widget-row">
          <button type="button" class="btn btn-sm btn-outline-secondary" id="${f.id}_btn" onclick="document.getElementById('${f.id}_file').click()">
            <i class="bi bi-camera"></i> <span id="${f.id}_btnLabel">Choose JPG</span>
          </button>
          <span class="cert-existing" id="${f.id}_existing" style="display:none">
            <i class="bi bi-check-circle-fill"></i> Picture already uploaded
            <a href="#" id="${f.id}_link" target="_blank" rel="noopener">View</a>
          </span>
        </div>
        <div class="cert-progress-track" id="${f.id}_progressTrack" style="display:none">
          <div class="cert-progress-bar" id="${f.id}_progressBar"></div>
        </div>
        <div class="cert-sizes" id="${f.id}_sizes"></div>
        <div class="cert-error field-error" id="${f.id}_error"></div>
      </div>
    </div>`;
}

// ── Upload flow ─────────────────────────────────────────────────────
async function _onCertFileSelected(fieldId) {
  const input = document.getElementById(fieldId + '_file');
  const file = input && input.files && input.files[0];
  if (input) input.value = '';
  if (!file) return;

  const reg = CERT_FIELD_REGISTRY[fieldId];
  if (!reg) return;

  const errEl   = document.getElementById(fieldId + '_error');
  const sizesEl = document.getElementById(fieldId + '_sizes');
  const btnEl   = document.getElementById(fieldId + '_btn');
  const trackEl = document.getElementById(fieldId + '_progressTrack');
  const barEl   = document.getElementById(fieldId + '_progressBar');
  if (errEl)   { errEl.style.display = 'none'; errEl.textContent = ''; }
  if (sizesEl) sizesEl.textContent = '';

  const schoolKey = reg.getSchoolKey();
  if (!schoolKey) {
    if (errEl) {
      errEl.textContent = 'Save the record first, then upload the picture.';
      errEl.style.display = 'block';
    }
    return;
  }

  const isJpg = /image\/jpe?g/i.test(file.type) || /\.(jpe?g)$/i.test(file.name);
  if (!isJpg) {
    if (errEl) {
      errEl.textContent = 'Only JPG/JPEG files are allowed.';
      errEl.style.display = 'block';
    }
    return;
  }

  if (btnEl) btnEl.disabled = true;
  if (trackEl) trackEl.style.display = 'block';
  if (barEl) barEl.style.width = '12%';
  if (sizesEl) sizesEl.textContent = `Original: ${_certFmtSize(file.size)} — compressing…`;

  try {
    const compressed = await _compressCertImage(file);
    if (barEl) barEl.style.width = '45%';
    if (sizesEl) sizesEl.textContent = `Original: ${_certFmtSize(file.size)} → Compressed: ${_certFmtSize(compressed.size)} — uploading…`;

    const base64 = await _certBlobToBase64(compressed);
    if (barEl) barEl.style.width = '70%';

    const { data: { session } } = await _sb.auth.getSession();
    if (!session || !session.access_token) throw new Error('Your session has expired — please sign in again.');

    const res = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/school-cert-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
      body: JSON.stringify({
        cert_type: reg.certType,
        school_type: reg.schoolType,
        school_key: schoolKey,
        filename: (file.name || 'certificate.jpg').replace(/\.[^.]+$/, '') + '.jpg',
        content_base64: base64,
      }),
    });
    const result = await res.json().catch(() => null);
    if (!res.ok || !result || !result.success) {
      throw new Error((result && result.message) || `Upload failed (HTTP ${res.status}).`);
    }

    if (barEl) barEl.style.width = '100%';
    const driveIdEl = document.getElementById(reg.driveIdField);
    const urlEl     = document.getElementById(reg.urlField);
    if (driveIdEl) driveIdEl.value = result.drive_id || '';
    if (urlEl)     urlEl.value     = result.url || '';
    _certShowExisting(fieldId, result.url);

    const savedPct = file.size > compressed.size ? Math.round((1 - compressed.size / file.size) * 100) : 0;
    if (sizesEl) {
      sizesEl.textContent = `Original: ${_certFmtSize(file.size)} → Compressed: ${_certFmtSize(compressed.size)}` +
        (savedPct > 0 ? ` (${savedPct}% smaller)` : '') + ' — uploaded ✓';
    }
    if (typeof showToast === 'function') showToast('Picture uploaded.', true);
  } catch (e) {
    if (errEl) {
      errEl.textContent = e && e.message ? e.message : 'Upload failed. Please try again.';
      errEl.style.display = 'block';
    }
    if (sizesEl) sizesEl.textContent = '';
    if (typeof showToast === 'function') showToast('Picture upload failed.', false);
  } finally {
    if (btnEl) btnEl.disabled = false;
    setTimeout(() => {
      if (trackEl) trackEl.style.display = 'none';
      if (barEl) barEl.style.width = '0%';
    }, 800);
  }
}

function _certShowExisting(fieldId, url) {
  const existingEl = document.getElementById(fieldId + '_existing');
  const linkEl     = document.getElementById(fieldId + '_link');
  const labelEl    = document.getElementById(fieldId + '_btnLabel');
  if (!existingEl) return;
  if (url) {
    existingEl.style.display = 'inline-flex';
    if (linkEl) linkEl.href = url;
    if (labelEl) labelEl.textContent = 'Replace';
  } else {
    existingEl.style.display = 'none';
    if (labelEl) labelEl.textContent = 'Choose JPG';
  }
}

// Called after a field's hidden url/drive-id inputs have been populated
// (edit mode) or cleared (add mode) to refresh the widget's display.
function certWidgetSync(fieldId) {
  const reg = CERT_FIELD_REGISTRY[fieldId];
  if (!reg) return;
  const urlEl = document.getElementById(reg.urlField);
  _certShowExisting(fieldId, urlEl ? urlEl.value : '');
  const sizesEl = document.getElementById(fieldId + '_sizes');
  const errEl   = document.getElementById(fieldId + '_error');
  if (sizesEl) sizesEl.textContent = '';
  if (errEl)   { errEl.style.display = 'none'; errEl.textContent = ''; }
}

function certWidgetSyncAll() {
  Object.keys(CERT_FIELD_REGISTRY).forEach(certWidgetSync);
}
