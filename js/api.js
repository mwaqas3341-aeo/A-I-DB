// =====================================================================
//  API.JS  —  fetch() wrapper + google.script.run compatibility shim
// =====================================================================

// ── Fetch wrapper ────────────────────────────────────────────────────
async function apiCall(action, payload) {
  const body = buildBody(action, payload);
  const response = await fetch(CONFIG.WEB_APP_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body:    JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Network error ${response.status}`);
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { throw new Error('Non-JSON response: ' + text.slice(0, 120)); }
}

function buildBody(action, payload) {
  if (payload === undefined || payload === null) return { action };
  if (Array.isArray(payload))   return { action, args: payload };
  if (typeof payload === 'object') return { action, ...payload };
  return { action, value: payload };
}

// ── google.script.run shim ───────────────────────────────────────────
// FIX 1: google object was missing its closing brace
// FIX 2: script: block was closed with }; instead of },
// FIX 3: debug block was outside the google object
const google = {
  script: {
    get run() {
      let _onSuccess = () => {};
      let _onFailure = (err) => console.error('[api.js]', err);

      const handler = new Proxy(
        {
          withSuccessHandler(fn) {
            if (typeof fn === 'function') _onSuccess = fn;
            return handler;
          },
          withFailureHandler(fn) {
            if (typeof fn === 'function') _onFailure = fn;
            return handler;
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
                : args.length === 1 ? args[0] : args;
              apiCall(prop, payload).then(onSuccess).catch(onFailure);
            };
          },
        }
      );

      return handler;
    },        // ← closes get run()
  },          // ← closes script:
};            // ← closes google  (this was the missing brace causing the crash)
