/**
 * Report Dispatch System — Google connection management.
 * Standalone file; only needs config.js loaded first (for CONFIG and
 * the already-created `_sb` Supabase client from api.js — reused, not
 * recreated, so we share the same session).
 */

const GOOGLE_CLIENT_ID = '908847014598-lpq4ohrh8oniek0a1k22sasn19jkao9b.apps.googleusercontent.com';
const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

function _dispatchCallbackUrl() {
  // Same folder as index.html, since oauth-callback.html sits alongside it.
  return window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'oauth-callback.html';
}

/**
 * Opens Google's consent screen in a popup window. prompt=consent is
 * forced so Google always returns a refresh_token, even if the user
 * already granted access before (Google only returns one by default
 * on the very first consent otherwise).
 */
function connectGoogleAccount() {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: _dispatchCallbackUrl(),
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  });
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();

  const popup = window.open(url, 'googleConnect', 'width=480,height=640');
  if (!popup) {
    showToast('Please allow popups for this site to connect your Google account.', false);
    return;
  }

  window.addEventListener('message', function handler(ev) {
    if (!ev.data || ev.data.type !== 'google-connected') return;
    window.removeEventListener('message', handler);
    if (ev.data.success) {
      showToast('Google account connected successfully!', true);
      if (typeof refreshGoogleConnectionStatus === 'function') refreshGoogleConnectionStatus();
    } else {
      showToast(ev.data.message || 'Failed to connect Google account.', false);
    }
  });
}

/**
 * Checks current connection status for the logged-in user. Callers
 * pass a callback since this is async; result shape:
 *   { connected: bool, google_email, drive_folder_id }
 */
function getGoogleConnectionStatus(callback) {
  _sb.from('dispatch_user_google')
    .select('connected, google_email, drive_folder_id, signature_url')
    .eq('user_id', (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null))
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) { callback({ connected: false }); return; }
      callback(data || { connected: false });
    });
}

function refreshGoogleConnectionStatus() {
  getGoogleConnectionStatus(status => {
    const notConnectedEl = document.getElementById('googleNotConnectedView');
    const connectedEl = document.getElementById('googleConnectedView');
    if (!notConnectedEl || !connectedEl) return;

    if (status.connected) {
      notConnectedEl.style.display = 'none';
      connectedEl.style.display = 'block';
      document.getElementById('googleConnectedEmail').textContent = status.google_email || '';
      const sigPreview = document.getElementById('signaturePreview');
      if (status.signature_url) {
        sigPreview.src = status.signature_url;
        sigPreview.style.display = 'block';
      }
    } else {
      notConnectedEl.style.display = 'block';
      connectedEl.style.display = 'none';
    }
  });
}
