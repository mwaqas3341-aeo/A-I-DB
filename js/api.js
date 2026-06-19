// =====================================================================
//  API.JS  —  Central fetch() layer + google.script.run shim
//
//  HOW IT WORKS
//  ────────────
//  Every google.script.run call in the existing code stays UNCHANGED.
//  This file intercepts those calls via a Proxy-based shim and routes
//  them through fetch() to your deployed Apps Script Web App.
//
//  Your Apps Script doPost() receives:
//    { action: 'functionName', ...payload }
//  and must return a JSON response.
//
//  SETUP
//  ─────
//  1. In Code.gs, add / update doPost():
//
//     function doPost(e) {
//       const params = JSON.parse(e.postData.contents);
//       const action = params.action;
//       const result = dispatchAction(action, params);
//       return ContentService
//         .createTextOutput(JSON.stringify(result))
//         .setMimeType(ContentService.MimeType.JSON);
//     }
//
//     function dispatchAction(action, p) {
//       if (action === 'login')               return login(p.cnic, p.pass);
//       if (action === 'getSummaryCounts')    return getSummaryCounts(p.user);
//       if (action === 'getSchoolHierarchy')  return getSchoolHierarchy();
//       // ... map every action to its existing function
//       return { error: 'Unknown action: ' + action };
//     }
//
//  2. Deploy as Web App → Execute as: Me | Access: Anyone
//  3. Paste the /exec URL into config.js → CONFIG.WEB_APP_URL
// =====================================================================


// ─────────────────────────────────────────────────────────────────────
//  LOW-LEVEL FETCH WRAPPER
// ─────────────────────────────────────────────────────────────────────

/**
 * Call the Apps Script Web App.
 *
 * @param {string} action   - Name of the server-side function to call
 * @param {*}      payload  - Object or array to send alongside the action
 * @returns {Promise<*>}    - Resolves with the parsed JSON response
 */
async function apiCall(action, payload) {
  const body = buildBody(action, payload);

  const response = await fetch(CONFIG.WEB_APP_URL, {
    method:  'POST',
    // text/plain avoids a CORS preflight — Apps Script handles it fine
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body:    JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Network error ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Server returned non-JSON: ' + text.slice(0, 120));
  }
}

function buildBody(action, payload) {
  if (payload === undefined || payload === null) {
    return { action };
  }
  // Multi-arg calls (e.g. login(cnic, pass) or generateExport(headers, rows, type, name))
  if (Array.isArray(payload)) {
    return { action, args: payload };
  }
  // Single-object payload — spread into body for convenience
  if (typeof payload === 'object') {
    return { action, ...payload };
  }
  // Primitive (string, number, boolean)
  return { action, value: payload };
}


// ─────────────────────────────────────────────────────────────────────
//  google.script.run  COMPATIBILITY SHIM
//
//  Mirrors the exact chaining API the existing code uses:
//
//    google.script.run
//      .withFailureHandler(fn)
//      .withSuccessHandler(fn)
//      .someServerFunction(payload);
//
//  Each access to .run creates a fresh chain so parallel calls don't
//  interfere with each other.
// ─────────────────────────────────────────────────────────────────────

const google = {
  script: {

    /** Each read of .run returns a new isolated chain context. */
    get run() {
  let _onSuccess = () => {};
  let _onFailure = (err) => console.error('[api.js]', err);

  // Create the Proxy first, then reference IT inside the handler methods
  // so .withSuccessHandler() returns the Proxy (not a plain object)
  const handler = new Proxy(
    {
      withSuccessHandler(fn) {
        if (typeof fn === 'function') _onSuccess = fn;
        return handler;   // ← returns the Proxy, not a plain object
      },
      withFailureHandler(fn) {
        if (typeof fn === 'function') _onFailure = fn;
        return handler;   // ← returns the Proxy, not a plain object
      },
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return (...args) => {
          const onSuccess = _onSuccess;
          const onFailure = _onFailure;
          const payload = args.length === 0
            ? undefined
            : args.length === 1
              ? args[0]
              : args;
          apiCall(prop, payload).then(onSuccess).catch(onFailure);
        };
      },
    }
  );

  return handler;
},
  };
// ─────────────────────────────────────────────────────────────────────
//  DEBUG HELPER  (remove or set to false in production)
// ─────────────────────────────────────────────────────────────────────
const API_DEBUG = false;   // ← flip to true to log every request

if (API_DEBUG) {
  const _real = apiCall;
  window.apiCall = async (action, payload) => {
    console.groupCollapsed(`[api] → ${action}`);
    console.log('payload:', payload);
    const result = await _real(action, payload);
    console.log('result:', result);
    console.groupEnd();
    return result;
  };
}
