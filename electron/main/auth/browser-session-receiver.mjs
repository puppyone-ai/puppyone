// Receive the existing Web login form's isolated Supabase credential through
// a top-level POST navigation. No CORS bridge, token URL or replacement UI.
//
// Every rejection reports a reason without secrets. A rejection whose form
// carries this attempt's state came from the real login page, so the caller
// fails the sign-in visibly instead of leaving Desktop waiting.
export function createBrowserSessionReceiver({ state, webOrigin, onSession, onRejected = () => {} }) {
  let consumed = false;
  return async function receive(request, response, callbackUrl) {
    const base = new URL(callbackUrl);
    const contentType = request.headers["content-type"]?.split(";")[0];
    let reason = null;
    if (request.method !== "POST") reason = "method";
    else if (request.headers.host !== base.host) reason = "host";
    else if (contentType !== "application/x-www-form-urlencoded") reason = "content-type";
    if (reason) return rejectWith(response, 400, { reason });

    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 16_384) return rejectWith(response, 413, { reason: "size" });
    }
    const form = new URLSearchParams(body);
    const token = form.get("refresh_token");
    const matchedState = form.getAll("state").length === 1 && form.get("state") === state;
    if (!matchedState) return rejectWith(response, 400, { reason: "state" });
    if (request.headers.origin !== webOrigin) {
      return rejectWith(response, 400, { reason: "origin", origin: request.headers.origin ?? null, matchedState });
    }
    if (form.getAll("refresh_token").length !== 1 || !token || token.length > 8192) {
      return rejectWith(response, 400, { reason: "refresh-token", matchedState });
    }
    if (consumed) return rejectWith(response, 409, { reason: "replay" });
    consumed = true;
    return { session: await onSession(token) };
  };

  function rejectWith(response, status, detail) {
    try { onRejected({ matchedState: false, ...detail }); } catch { /* Reporting never changes the response. */ }
    return reject(response, status);
  }
}

function reject(response, status) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'" });
  response.end("Sign-in request could not be verified. Start sign-in again from Puppyone.");
  return { handled: true };
}
