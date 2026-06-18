// =====================================================================
//  API.JS  —  Central fetch() layer + google.script.run shim
// =====================================================================

// ─────────────────────────────────────────────────────────────────────
//  LOW-LEVEL FETCH WRAPPER
// ─────────────────────────────────────────────────────────────────────
async function apiCall(action, payload) {
  const body = buildBody(action, payload);

  const response = await fetch(CONFIG.WEB_APP_URL, {
    method:  'POST',
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
  if (Array.isArray(payload)) {
    return { action, args: payload };
  }
  if (typeof payload === 'object') {
    return { action, ...payload };
  }
  return { action, value: payload };
}


// ─────────────────────────────────────────────────────────────────────
//  google.script.run  COMPATIBILITY SHIM
//
//  FIX: withSuccessHandler / withFailureHandler now return `proxy`
//  instead of `chain`, so chaining .someFunction() after them works.
// ─────────────────────────────────────────────────────────────────────
const google = {
  script: {

    get run() {
      let _onSuccess = () => {};
      let _onFailure = (err) => console.error('[api.js] Unhandled failure:', err);

      const chain = {
        withSuccessHandler(fn) {
          if (typeof fn === 'function') _onSuccess = fn;
          return proxy;   // ← return proxy, not chain
        },
        withFailureHandler(fn) {
          if (typeof fn === 'function') _onFailure = fn;
          return proxy;   // ← return proxy, not chain
        },
      };

      const proxy = new Proxy(chain, {
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

            apiCall(prop, payload)
              .then(onSuccess)
              .catch(onFailure);
          };
        },
      });

      return proxy;
    },

  },
};


// ─────────────────────────────────────────────────────────────────────
//  DEBUG HELPER  (flip to true to log every request in console)
// ─────────────────────────────────────────────────────────────────────
const API_DEBUG = false;

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
