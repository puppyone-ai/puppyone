// Receive the existing Web login form's isolated Supabase credential through
// a top-level POST navigation. No CORS bridge, token URL or replacement UI.
export function createBrowserSessionReceiver({ state, webOrigin, onSession }) {
  let consumed = false;
  return async function receive(request, response, callbackUrl) {
    const base = new URL(callbackUrl);
    if (request.method !== "POST" || request.headers.host !== base.host
      || request.headers.origin !== webOrigin
      || request.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded")
      return reject(response, 400);
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 16_384) return reject(response, 413);
    }
    const form = new URLSearchParams(body);
    const token = form.get("refresh_token");
    if (form.getAll("state").length !== 1 || form.get("state") !== state
      || form.getAll("refresh_token").length !== 1 || !token || token.length > 8192)
      return reject(response, 400);
    if (consumed) return reject(response, 409);
    consumed = true;
    return { session: await onSession(token) };
  };
}

function reject(response, status) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'" });
  response.end("Sign-in request could not be verified. Start sign-in again from Puppyone.");
  return { handled: true };
}
