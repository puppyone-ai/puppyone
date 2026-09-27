import http from "node:http";

const CALLBACK_PATH = "/auth/callback";
const MAX_CALLBACK_URL_LENGTH = 8 * 1024;
const PAGE_COPY = {
  en: {
    success: ["Signed in successfully", "PuppyOne Desktop is ready to use.", "Return to the app to continue. You can close this browser tab."],
    unrecognized: ["Sign-in link not recognized", "This page is not part of an active PuppyOne Desktop sign-in.", "Return to the app and start sign-in again."],
    notReady: ["Sign-in is not ready", "PuppyOne Desktop is still preparing the sign-in request.", "Return to the app and try again."],
    alreadyUsed: ["Sign-in link already used", "This sign-in link can only be opened once.", "If you're not signed in, return to the app and try again."],
    stateMismatch: ["Sign-in could not be verified", "This page does not match the sign-in request from PuppyOne Desktop.", "Return to the app and start sign-in again."],
    failed: ["Sign-in did not finish", "PuppyOne Desktop could not complete sign-in.", "Return to the app and try again."],
  },
  zh: {
    success: ["登录成功", "PuppyOne Desktop 已准备就绪。", "返回应用继续使用。你可以关闭这个浏览器标签页。"],
    unrecognized: ["无法识别登录链接", "此页面不属于当前的 PuppyOne Desktop 登录请求。", "请返回应用重新发起登录。"],
    notReady: ["登录尚未准备好", "PuppyOne Desktop 正在准备登录请求。", "请返回应用重试。"],
    alreadyUsed: ["登录链接已使用", "此登录链接只能使用一次。", "如果应用中尚未登录，请返回应用重试。"],
    stateMismatch: ["无法验证登录", "此页面与 PuppyOne Desktop 发起的登录请求不匹配。", "请返回应用重新发起登录。"],
    failed: ["登录未完成", "PuppyOne Desktop 未能完成登录。", "请返回应用重试。"],
  },
};

export async function startLoopbackCallbackServer({
  onCallback,
  isExpectedCallback,
  host = "127.0.0.1",
  logger = console,
} = {}) {
  if (typeof onCallback !== "function") {
    throw new TypeError("Loopback callback onCallback is required.");
  }
  if (typeof isExpectedCallback !== "function") {
    throw new TypeError("Loopback callback isExpectedCallback is required.");
  }

  let handled = false;
  let redirectUri = null;
  const server = http.createServer(async (request, response) => {
    const locale = preferredLocale(request.headers["accept-language"]);
    if (request.method !== "GET" || typeof request.url !== "string" || request.url.length > MAX_CALLBACK_URL_LENGTH) {
      respond(response, 404, "unrecognized", locale);
      return;
    }
    if (!redirectUri) {
      respond(response, 503, "notReady", locale);
      return;
    }

    const callbackUrl = new URL(request.url, redirectUri);
    const serializedCallbackUrl = callbackUrl.toString();
    if (callbackUrl.pathname !== CALLBACK_PATH || handled) {
      respond(response, handled ? 409 : 404, handled ? "alreadyUsed" : "unrecognized", locale);
      return;
    }
    if (!isExpectedCallback(serializedCallbackUrl)) {
      respond(response, 400, "stateMismatch", locale);
      return;
    }

    handled = true;
    // Stop accepting new callbacks immediately, but never wait for close()
    // before exchanging the one-time code: the active browser connection is
    // itself what close() waits for.
    void close().catch((error) => {
      logger.warn?.("PuppyOne loopback callback listener did not close cleanly.", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    try {
      const session = await onCallback(serializedCallbackUrl);
      respond(
        response,
        session ? 200 : 400,
        session ? "success" : "failed",
        locale,
      );
    } catch (error) {
      logger.warn?.("PuppyOne loopback callback failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
      respond(response, 500, "failed", locale);
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
    if (!server.listening) return;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return {
    redirectUri,
    close,
  };
}

function preferredLocale(acceptLanguage) {
  const first = String(acceptLanguage || "").split(",", 1)[0].trim().toLowerCase();
  return first === "zh" || first.startsWith("zh-") ? "zh" : "en";
}

function respond(response, status, result, locale) {
  const success = result === "success";
  const [title, description, nextStep] = PAGE_COPY[locale][result];
  const body = `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(title)} · PuppyOne Desktop</title>
  <style>
    :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: #f6f8f7; color: #192320; }
    main { width: min(100%, 460px); padding: 40px; border: 1px solid #e3e9e5; border-radius: 20px; background: #fff; box-shadow: 0 16px 48px rgba(20, 38, 29, .06); }
    .brand { margin: 0 0 42px; font-size: 15px; font-weight: 700; letter-spacing: -.025em; }
    .brand span { margin-left: 7px; font-weight: 500; color: #6b7771; }
    .icon { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 16px; background: ${success ? "#e7f6ec" : "#fff0eb"}; color: ${success ? "#168345" : "#b74e35"}; font-size: 29px; font-weight: 600; line-height: 1; }
    h1 { margin: 24px 0 10px; font-size: clamp(25px, 5vw, 30px); line-height: 1.2; letter-spacing: -.04em; }
    .description { margin: 0; color: #495850; font-size: 16px; line-height: 1.55; }
    .next-step { margin: 28px 0 0; padding-top: 22px; border-top: 1px solid #e9eeeb; color: #68766f; font-size: 14px; line-height: 1.5; }
    @media (max-width: 480px) { main { padding: 30px 26px; } .brand { margin-bottom: 36px; } }
    @media (prefers-color-scheme: dark) {
      body { background: #131917; color: #f0f5f1; }
      main { background: #1d2521; border-color: #334139; box-shadow: none; }
      .brand span, .next-step { color: #a4b4aa; }
      .description { color: #ccd8d0; }
      .next-step { border-color: #334139; }
      .icon { background: ${success ? "#173b29" : "#482b27"}; color: ${success ? "#82d8a1" : "#f0aa97"}; }
    }
  </style>
</head>
<body>
  <main role="${success ? "status" : "alert"}">
    <p class="brand">puppyone<span>Desktop</span></p>
    <div class="icon" aria-hidden="true">${success ? "✓" : "!"}</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="description">${escapeHtml(description)}</p>
    <p class="next-step">${escapeHtml(nextStep)}</p>
  </main>
</body>
</html>`;
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
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
