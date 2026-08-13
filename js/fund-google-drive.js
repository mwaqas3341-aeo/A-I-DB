/**
 * FUND Record Management — shared Google Drive connection + NSB upload.
 *
 * Unlike the old (removed) Report Dispatch System, this is ONE shared
 * connection for the whole module (fund_google_connection, singleton
 * row id=1) — not per logged-in user. The Admin who clicks "Connect"
 * must sign in as m.waqas3341@gmail.com; the edge function rejects any
 * other account.
 *
 * Reuses the existing OAuth client (same GOOGLE_CLIENT_ID, same
 * oauth-callback.html redirect flow) already registered in Google Cloud
 * Console for this app — no new console setup needed.
 *
 * Standalone file; load after config.js and api.js (needs the shared
 * `_sb` Supabase client and `currentUser`/`showToast` helpers already
 * used elsewhere in the app).
 */

const FUND_GOOGLE_CLIENT_ID = '908847014598-lpq4ohrh8oniek0a1k22sasn19jkao9b.apps.googleusercontent.com';
const FUND_GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

function _fundOauthCallbackUrl() {
  return window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'oauth-callback.html';
}

/**
 * Opens Google's consent screen for the Admin to connect the shared
 * FUND Drive account. prompt=consent forces Google to return a
 * refresh_token even on a re-connect.
 */
function fundConnectGoogleAccount() {
  const params = new URLSearchParams({
    client_id: FUND_GOOGLE_CLIENT_ID,
    redirect_uri: _fundOauthCallbackUrl(),
    response_type: 'code',
    scope: FUND_GOOGLE_OAUTH_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    login_hint: 'm.waqas3341@gmail.com',
  });
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();

  const popup = window.open(url, 'fundGoogleConnect', 'width=480,height=640');
  if (!popup) {
    if (typeof showToast === 'function') showToast('Please allow popups for this site to connect Google Drive.', false);
    return;
  }

  window.addEventListener('message', function handler(ev) {
    if (!ev.data || ev.data.type !== 'google-connected') return;
    window.removeEventListener('message', handler);
    if (ev.data.success) {
      if (typeof showToast === 'function') showToast('FUND Google Drive account connected.', true);
      if (typeof fundRefreshGoogleConnectionStatus === 'function') fundRefreshGoogleConnectionStatus();
    } else {
      if (typeof showToast === 'function') showToast(ev.data.message || 'Failed to connect Google Drive.', false);
    }
  });
}

/**
 * Connection status for the ONE shared FUND Drive account.
 * Admin-only (RLS on fund_google_connection restricts select to is_admin());
 * a normal user will just get connected:false back, which is fine — the
 * UI should only show the connect/status card to Admins anyway.
 * result shape: { connected: bool, google_email }
 */
function getFundGoogleConnectionStatus(callback) {
  _sb.from('fund_google_connection')
    .select('google_email, connected_at')
    .eq('id', 1)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error || !data) { callback({ connected: false }); return; }
      callback({ connected: true, google_email: data.google_email, connected_at: data.connected_at });
    });
}

function fundRefreshGoogleConnectionStatus() {
  getFundGoogleConnectionStatus(status => {
    const notConnectedEl = document.getElementById('fundGoogleNotConnectedView');
    const connectedEl = document.getElementById('fundGoogleConnectedView');
    if (!notConnectedEl || !connectedEl) return;

    if (status.connected) {
      notConnectedEl.style.display = 'none';
      connectedEl.style.display = 'block';
      const emailEl = document.getElementById('fundGoogleConnectedEmail');
      if (emailEl) emailEl.textContent = status.google_email || '';
    } else {
      notConnectedEl.style.display = 'block';
      connectedEl.style.display = 'none';
    }
  });
}

/** SHA-256 hash of a File/Blob, as a lowercase hex string. Computed
 * client-side so exact-duplicate uploads can be blocked before we ever
 * touch Drive or the edge function. */
async function fundHashFile(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _fundFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads an NSB quarterly file. Handles the full dedupe/replace flow:
 *   1. Hashes the file locally.
 *   2. Calls fund-nsb-upload. If it's an exact duplicate of the current
 *      active file, the function refuses without touching Drive.
 *   3. If a *different* file already exists for that FY+Quarter, the
 *      function returns needsConfirmation + the existing file's info —
 *      call opts.onNeedsConfirmation(existing) to show your compare/
 *      replace UI, then call this again with confirmReplace: true.
 *
 * @param {File} file
 * @param {{financialYear:string, quarter:number, confirmReplace?:boolean, replacementReason?:string}} opts
 * @param {{onNeedsConfirmation?:Function, onDuplicate?:Function}} callbacks
 * @returns {Promise<{success:boolean, file?:object, message?:string}>}
 */
async function fundUploadNsbFile(file, opts, callbacks = {}) {
  const { data: { session } } = await _sb.auth.getSession();
  if (!session) return { success: false, message: 'Not logged in.' };

  const fileHash = await fundHashFile(file);
  const fileBase64 = await _fundFileToBase64(file);

  const res = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/fund-nsb-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify({
      financial_year: opts.financialYear,
      quarter: opts.quarter,
      file_name: file.name,
      mime_type: file.type,
      file_size: file.size,
      file_hash: fileHash,
      file_base64: fileBase64,
      confirm_replace: !!opts.confirmReplace,
      replacement_reason: opts.replacementReason || null,
    }),
  });
  const result = await res.json();

  if (!result.success) {
    if (result.duplicate && typeof callbacks.onDuplicate === 'function') callbacks.onDuplicate(result.existing, result.message);
    if (result.needsConfirmation && typeof callbacks.onNeedsConfirmation === 'function') callbacks.onNeedsConfirmation(result.existing, result.message);
  }
  return result;
}
