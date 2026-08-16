/**
 * FUND Record Management — shared Google Drive connection + NSB upload.
 *
 * Unlike the old (removed) Report Dispatch System, this is ONE shared
 * connection for the whole module (fund_google_connection, singleton
 * row id=1) — not per logged-in user. Any Admin can connect it; whichever
 * Google account they authenticate with via the consent screen is the
 * account that gets connected (the edge function reads that back from
 * Google's own OAuth response — no account is hard-coded anywhere, so
 * there's nothing to "sign out of" or open an incognito window for).
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
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

function _fundOauthCallbackUrl() {
  return window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'oauth-callback.html';
}

/**
 * Opens Google's consent screen for the Admin to connect the shared
 * FUND Drive account. ALL FUND files (every user's jurisdiction workbook,
 * plus admin archives) live in ONE account — m.waqas3341@gmail.com — so
 * this hints that account directly. The server (google-oauth-exchange)
 * still rejects any other account regardless of what's picked here.
 * prompt=consent forces Google to return a refresh_token even on reconnect.
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

