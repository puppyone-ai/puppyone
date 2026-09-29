import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isKnownDesktopReturnUrl } from "../../../shared/desktop/return-to-app-link.mjs";
import { PAGE_COPY, resolveCallbackLocale } from "./loopback-callback-copy.mjs";

const CALLBACK_PATH = "/auth/callback";
const MAX_CALLBACK_URL_LENGTH = 8 * 1024;
const RETURN_ACTION_TTL_MS = 10 * 60 * 1000;
// Matches puppyone-cloud/frontend/public/puppyone-logo.svg. Keep the final
// callback self-contained: the one-time listener closes before assets can load.
const BRAND_MARK = `<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<rect width="128" height="128" rx="32" fill="#1C1D1F"/>
<path d="M82.7344 34.5305L88.541 40.3372L88.6025 40.8528L93.6025 82.8528L93.668 83.4026L82.916 99.5305H43.3105L32.5586 83.4026L32.624 82.8528L37.624 40.8528L37.6855 40.3372L43.4922 34.5305H82.7344Z" fill="#FFA73D" stroke="#1C1D1F" stroke-width="3"/>
<path d="M64.1126 77.0313L64.1123 80.6603C64.1122 82.1813 63.4955 83.6478 62.3924 84.7508L61.5204 85.6226C60.6063 86.5366 59.4119 87.1469 58.1137 87.3632L57.3184 87.4958C55.3137 87.8299 53.2747 87.1918 51.875 85.7921L50.113 84.0302" stroke="#1C1D1F" stroke-width="3"/>
<path d="M64.1113 76.031L64.1113 80.6874C64.1113 82.192 64.7147 83.6344 65.7968 84.7165L66.7347 85.6544C67.6293 86.549 68.7998 87.1458 70.0774 87.3587L70.8829 87.4929C72.8997 87.8291 74.9668 87.1755 76.3909 85.7515L78.1113 84.031" stroke="#1C1D1F" stroke-width="3"/>
<path d="M76.4941 52.0305L68.4941 58.0305L76.6128 63.5305" stroke="#1C1D1F" stroke-width="3"/>
<path d="M50.4941 52.0305L58.4941 58.0305L50.4941 64.0305" stroke="#1C1D1F" stroke-width="3"/>
<path d="M102.696 32.7872L106.206 63.588L92.2957 65.1728L88.7864 34.3721L102.696 32.7872Z" fill="#FFA73D" stroke="#1C1D1F" stroke-width="4"/>
<path d="M37.2059 34.3713L33.6966 65.172L19.7866 63.5872L23.2959 32.7864L37.2059 34.3713Z" fill="#FFA73D" stroke="#1C1D1F" stroke-width="4"/>
<rect x="55.1133" y="69.0305" width="17" height="8" fill="#1C1D1F"/>
<rect x="61.1133" y="71.0305" width="6" height="1" fill="white"/>
</svg>`;
export async function startLoopbackCallbackServer({
  onCallback,
  isExpectedCallback,
  onReturnToApp = null,
  returnAppUrl = null,
  getLocale = null,
  host = "127.0.0.1",
  appPath = null,
  logger = console,
} = {}) {
  if (typeof onCallback !== "function") {
    throw new TypeError("Loopback callback onCallback is required.");
  }
  if (typeof isExpectedCallback !== "function") {
    throw new TypeError("Loopback callback isExpectedCallback is required.");
  }
  if (returnAppUrl !== null && !isKnownDesktopReturnUrl(returnAppUrl)) {
    throw new TypeError("Loopback callback returnAppUrl is not a PuppyOne Desktop launch URL.");
  }

  let handled = false;
  let redirectUri = null;
  let returnEnabled = false;
  let returnTimer = null;
  const returnPath = `/auth/return/${crypto.randomBytes(24).toString("base64url")}`;
  const geistFont = loadGeistFont(appPath, logger);
  const server = http.createServer(async (request, response) => {
    let appLocale = null;
    try { appLocale = getLocale?.(); } catch { /* Browser language remains the fallback. */ }
    const locale = resolveCallbackLocale(appLocale, request.headers["accept-language"]);
    if (typeof request.url !== "string" || request.url.length > MAX_CALLBACK_URL_LENGTH) {
      respond(response, 404, "unrecognized", locale, geistFont);
      return;
    }
    if (!redirectUri) {
      respond(response, 503, "notReady", locale, geistFont);
      return;
    }

    if (returnEnabled && request.method === "POST" && request.url === returnPath) {
      response.once("finish", () => {
        try {
          Promise.resolve(onReturnToApp?.()).catch((error) => logger.warn?.("Unable to reveal PuppyOne Desktop.", error));
        } catch (error) {
          logger.warn?.("Unable to reveal PuppyOne Desktop.", error);
        }
      });
      response.writeHead(204, { "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'", Connection: "close" });
      response.end();
      return;
    }
    if (request.method !== "GET") {
      respond(response, 404, "unrecognized", locale, geistFont);
      return;
    }

    const callbackUrl = new URL(request.url, redirectUri);
    const serializedCallbackUrl = callbackUrl.toString();
    if (callbackUrl.pathname !== CALLBACK_PATH || handled) {
      respond(response, handled ? 409 : 404, handled ? "alreadyUsed" : "unrecognized", locale, geistFont);
      return;
    }
    if (!isExpectedCallback(serializedCallbackUrl)) {
      respond(response, 400, "stateMismatch", locale, geistFont);
      return;
    }

    handled = true;
    try {
      const session = await onCallback(serializedCallbackUrl);
      if (session && typeof onReturnToApp === "function") {
        returnEnabled = true;
        returnTimer = setTimeout(() => void close().catch(() => undefined), RETURN_ACTION_TTL_MS);
        returnTimer.unref?.();
      }
      respond(
        response,
        session ? 200 : 400,
        session ? "success" : "failed",
        locale,
        geistFont,
        returnEnabled ? returnPath : null,
        returnEnabled ? returnAppUrl : null,
      );
      if (!returnEnabled) void close().catch(() => undefined);
    } catch (error) {
      logger.warn?.("PuppyOne loopback callback failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
      respond(response, 500, "failed", locale, geistFont);
      void close().catch(() => undefined);
    }
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host, port: 0, exclusive: true });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await close();
    throw new Error("Unable to determine the OAuth loopback callback port.");
  }
  const redirectHost = host.includes(":") ? `[${host}]` : host;
  redirectUri = `http://${redirectHost}:${address.port}${CALLBACK_PATH}`;
  server.unref?.();

  async function close() {
    if (returnTimer) clearTimeout(returnTimer);
    returnTimer = null;
    if (!server.listening) return;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return {
    redirectUri,
    close,
  };
}

function loadGeistFont(appPath, logger) {
  if (!appPath) return null;
  for (const root of ["dist", "public"]) {
    try {
      return fs.readFileSync(path.join(appPath, root, "fonts", "geist", "Geist-Variable.woff2")).toString("base64");
    } catch {
      // Development uses public/ before the first renderer build creates dist/.
    }
  }
  logger.warn?.("PuppyOne login result font could not be loaded.");
  return null;
}

function respond(response, status, result, locale, geistFont, returnPath = null, returnAppUrl = null) {
  const success = result === "success";
  const copy = PAGE_COPY[locale];
  const [title, description, nextStep] = copy[result];
  const scriptNonce = returnPath && returnAppUrl ? crypto.randomBytes(16).toString("base64") : null;
  const body = `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(title)} · PuppyOne Desktop</title>
  <style>
    ${geistFont ? `@font-face { font-family: "Geist Sans"; src: url(data:font/woff2;base64,${geistFont}) format("woff2"); font-style: normal; font-weight: 100 900; font-display: swap; }` : ""}
    :root { color-scheme: light; --po-inset: #e7e3db; --po-text: #292723; --po-text-inverse: #fffefa; --po-text-muted: #68645c; --po-text-subtle: #928c83; --po-success: #168145; --po-danger: #dc2626; }
    * { box-sizing: border-box; }
    html { min-height: 100%; }
    body { min-height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--po-inset); color: var(--po-text); font-family: "Geist Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
    main { width: min(100%, 380px); padding: 24px; text-align: center; }
    .brand { display: block; width: 48px; height: 48px; margin: 0 auto 16px; opacity: .95; }
    .brand svg { display: block; width: 100%; height: 100%; }
    h1 { margin: 0 0 32px; font-size: 24px; font-weight: 600; line-height: 32px; }
    .description { margin: 0; padding: 8px 12px; border-radius: 8px; color: var(${success ? "--po-success" : "--po-danger"}); background: color-mix(in srgb, var(${success ? "--po-success" : "--po-danger"}) 10%, transparent); font-size: 14px; line-height: 20px; }
    .return-form { margin-top: 24px; }
    .return-button { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 40px; padding: 8px 16px; border: 0; border-radius: 6px; background: var(--po-text); color: var(--po-text-inverse); font: inherit; font-size: 14px; font-weight: 600; line-height: 20px; cursor: pointer; }
    .return-button:hover { opacity: .9; }
    .return-button:focus-visible { outline: 3px solid var(--po-success); outline-offset: 3px; }
    .return-fallback { margin: 12px 0 0; font-size: 12px; line-height: 18px; }
    .return-fallback a { color: var(--po-text-muted); }
    .next-step { margin: ${returnPath ? "16px" : "24px"} 0 0; color: var(--po-text-subtle); font-size: 12px; line-height: 18px; }
    @media (prefers-color-scheme: dark) {
      :root { color-scheme: dark; --po-inset: #0d0d0d; --po-text: #fafafa; --po-text-inverse: #0a0a0a; --po-text-muted: #a1a1aa; --po-text-subtle: #71717a; --po-success: #34d399; --po-danger: #f87171; }
    }
  </style>
</head>
<body>
  <main role="${success ? "status" : "alert"}">
    <div class="brand">${BRAND_MARK}</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="description">${escapeHtml(description)}</p>
    ${returnPath ? `<form class="return-form" method="post" action="${escapeHtml(returnPath)}" target="puppyone-return-frame"><button class="return-button" type="submit">${escapeHtml(copy.returnButton)}</button></form>` : ""}
    ${scriptNonce ? `<p class="return-fallback" hidden><a href="${escapeHtml(returnAppUrl)}">${escapeHtml(copy.openAppManually)}</a></p>` : ""}
    <p class="next-step">${escapeHtml(nextStep)}</p>
  </main>
  ${returnPath ? `<iframe name="puppyone-return-frame" title="" hidden></iframe>` : ""}
  ${scriptNonce ? `<script nonce="${scriptNonce}">
    const form = document.querySelector(".return-form");
    const fallback = document.querySelector(".return-fallback");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      try {
        const response = await fetch(form.action, { method: "POST", cache: "no-store", signal: controller.signal });
        if (response.ok) return;
      } catch {
        // The Desktop listener has stopped; the system URL can restart the app.
      } finally {
        clearTimeout(timeout);
      }
      fallback.hidden = false;
      fallback.querySelector("a").click();
    });
  </script>` : ""}
</body>
</html>`;
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; font-src data:; form-action 'self'; frame-src 'self'${scriptNonce ? `; script-src 'nonce-${scriptNonce}'; connect-src 'self'` : ""}`,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Connection: "close",
  });
  response.end(body);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
