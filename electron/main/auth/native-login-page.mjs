// Same-origin system-browser form. Secrets travel in a bounded POST body to
// Main, then directly to Supabase; no cloud handoff or browser token storage.
export function createNativeLoginPage({ state, providers, webOrigin, onAction }) {
  let busy = false;
  return async function handle(request, response, callbackUrl) {
    const base = new URL(callbackUrl);
    const url = new URL(request.url, base);
    if (url.pathname !== "/auth/login") return null;
    if (!validOrigin(request, url, base)) return reply(response, 400, "Invalid login request.");
    if (request.method === "GET") return showLogin(url, response, { state, providers, webOrigin, onAction });
    if (!validFormRequest(request, base)) return reply(response, 400, "Invalid login request.");
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) return reply(response, 413, "Login request is too large.");
    }
    const form = new URLSearchParams(body);
    if (form.getAll("state").length !== 1 || form.get("state") !== state) return reply(response, 400, "Sign-in request expired.");
    if (busy) return reply(response, 409, "Sign-in is already in progress.");
    const action = form.get("action");
    if (!["password", "signup", "verify", "resend"].includes(action) || !providers.includes("email")) return reply(response, 400, "Sign-in method is unavailable.");
    busy = true;
    try {
      const result = await onAction(action, { email: form.get("email") ?? "", password: form.get("password") ?? "", token: form.get("token") ?? "" });
      if (result.session) return { handled: true, session: result.session };
      render(response, { state, providers, webOrigin, verifyEmail: form.get("email"), message: "Check your email for a verification code." });
    } catch (error) {
      render(response, { state, providers, webOrigin, verifyEmail: ["verify", "resend"].includes(action) ? form.get("email") : null,
        error: error?.status === 429 ? "Too many attempts. Please try again later." : "Unable to sign in. Check your details or try again." });
    } finally { busy = false; }
    return { handled: true };
  };
}

function validFormRequest(request, base) {
  return request.method === "POST" && request.headers.origin === base.origin
    && request.headers["content-type"]?.split(";")[0] === "application/x-www-form-urlencoded";
}
function reply(response, status, message) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'" }); response.end(message);
  return { handled: true };
}
function escape(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function render(response, { state, providers, webOrigin, verifyEmail, error, message }) {
  const hidden = `<input type="hidden" name="state" value="${escape(state)}">`;
  const button = (value, label) => `<button name="action" value="${value}" type="submit">${label}</button>`;
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Sign in · Puppyone</title><style>
  :root{color-scheme:light dark;font-family:system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:light-dark(#e7e3db,#0d0d0d);color:light-dark(#292723,#fafafa)}main{width:min(100%,400px);padding:28px}h1{text-align:center;font-size:24px}form{display:grid;gap:12px;margin:18px 0}button,input{font:inherit;padding:12px;border-radius:7px;border:1px solid #8886;width:100%}button{cursor:pointer}.provider{display:block;padding:12px;border:1px solid #8886;border-radius:7px;text-align:center;text-decoration:none}label{display:grid;gap:6px;font-size:14px}a{color:inherit}.note{font-size:13px;opacity:.7}.error{color:light-dark(#b42318,#ff938a)}
  </style></head><body><main><h1>Sign in to Puppyone</h1>
  ${error ? `<p role="alert" class="error">${escape(error)}</p>` : ""}${message ? `<p role="status">${escape(message)}</p>` : ""}
  ${providers.filter(p => p !== "email").map(p => `<p><a class="provider" href="/auth/login?${escape(new URLSearchParams({ state, provider: p }))}">Continue with ${p === "google" ? "Google" : "GitHub"}</a></p>`).join("")}
  ${emailForm({ providers, verifyEmail, hidden, button, webOrigin })}
  ${providers.length ? "" : '<p role="alert">No sign-in methods are enabled for this environment.</p>'}
  <p class="note">This sign-in connects your Puppyone Desktop app.</p></main></body></html>`;
  // no-referrer makes browser form POST Origin null; preserve same-origin CSRF
  // verification while withholding the login URL from external destinations.
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Referrer-Policy": "same-origin", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", Connection: "close" });
  response.end(body);
}

function emailForm({ providers, verifyEmail, hidden, button, webOrigin }) {
  if (!providers.includes("email")) return "";
  if (verifyEmail) return `<form method="post" action="/auth/login">${hidden}<input type="hidden" name="email" value="${escape(verifyEmail)}"><label>Verification code<input name="token" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required></label>${button("verify", "Verify and sign in")}</form><form method="post" action="/auth/login">${hidden}<input type="hidden" name="email" value="${escape(verifyEmail)}">${button("resend", "Resend code")}</form>`;
  return `<form method="post" action="/auth/login">${hidden}<label>Email<input type="email" name="email" autocomplete="username" maxlength="254" required></label><label>Password<input type="password" name="password" autocomplete="current-password" minlength="6" maxlength="4096" required></label>${button("password", "Sign in with email")}${button("signup", "Create an account")}</form><p class="note"><a href="${escape(new URL('/login', webOrigin).toString())}" target="_blank" rel="noopener noreferrer">Manage your account or reset your password</a></p>`;
}

async function showLogin(url, response, { state, providers, webOrigin, onAction }) {
  if (url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state) return reply(response, 400, "Sign-in request expired.");
  const provider = url.searchParams.get("provider");
  if (provider) {
    if (!providers.includes(provider) || !["google", "github"].includes(provider)) return reply(response, 400, "Sign-in method is unavailable.");
    try {
      const result = await onAction(provider, {});
      response.writeHead(303, { Location: result.redirect, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }); response.end();
    } catch { return reply(response, 400, "Sign-in request expired."); }
    return { handled: true };
  }
  render(response, { state, providers, webOrigin });
  return { handled: true };
}

function validOrigin(request, url, base) { return request.headers.host === base.host && url.origin === base.origin; }
