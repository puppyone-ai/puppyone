const PDF_EXTENSION_ORIGIN = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/";

export function isEmbeddedPdfFrame(frame) {
  try {
    for (let current = frame; current; current = current.parent) {
      if (current.name === "puppyone-pdf-preview" || current.url?.startsWith(PDF_EXTENSION_ORIGIN)) return true;
    }
  } catch {
    // A detached WebFrameMain must not relax a known PDF request's policy.
  }
  return false;
}

export function isAllowedPdfResource(urlValue) {
  try {
    const url = new URL(urlValue);
    if (url.href.startsWith(PDF_EXTENSION_ORIGIN) || url.protocol === "chrome:" || url.protocol === "chrome-untrusted:") return true;
    // Capability authorization, signature and size checks remain in the local
    // protocol. PDF content never gets the AppPreview network allowlist.
    return url.protocol === "puppyone-local:" && url.hostname === "file"
      && !url.username && !url.password && !url.port && !url.search
      && /^\/[^/]+\/file-preview\/[^/]+\.pdf$/i.test(url.pathname);
  } catch { return false; }
}

/** Sole owner of the default session's request hook. Future policies must be
 * composed here: Electron keeps only the last webRequest listener. */
export function installEmbeddedContentSessionSecurity(session, { applicationUrl } = {}) {
  const mayWriteClipboard = (contents, permission, details) => permission === "clipboard-sanitized-write"
    && details?.isMainFrame === true
    && isApplicationDocument(contents?.getURL(), applicationUrl)
    && isApplicationDocument(details.requestingUrl, applicationUrl);
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(mayWriteClipboard(contents, permission, details));
  });
  session.setPermissionCheckHandler((contents, permission, _origin, details) => mayWriteClipboard(contents, permission, details));
  session.webRequest.onBeforeRequest((details, callback) => {
    const pdf = isEmbeddedPdfFrame(details.frame) || details.referrer?.startsWith(PDF_EXTENSION_ORIGIN);
    callback({ cancel: Boolean(pdf && !isAllowedPdfResource(details.url)) });
  });
}

function isApplicationDocument(value, applicationValue) {
  try {
    const requested = new URL(value), application = new URL(applicationValue);
    if (["http:", "https:"].includes(application.protocol)) return requested.origin === application.origin;
    requested.hash = ""; application.hash = "";
    return requested.href === application.href;
  } catch { return false; }
}
