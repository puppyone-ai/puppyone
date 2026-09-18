import path from "node:path";
import { requireSafeExternalUrl } from "./external-navigation-service.mjs";
import { isEmbeddedPdfFrame, isAllowedPdfResource } from "./embedded-pdf-security.mjs";

export { requireSafeExternalUrl } from "./external-navigation-service.mjs";

export function requireNonEmptyString(value, message) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value.trim();
}

export function requireCloudApiPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    throw new Error("Cloud API path must be a root-relative path.");
  }
  return value;
}

export function classifyWindowNavigation(targetValue, applicationValue) {
  if (
    typeof targetValue !== "string"
    || /[\u0000-\u001f\u007f]/.test(targetValue)
    || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(targetValue)
  ) {
    return { action: "deny" };
  }
  let targetUrl;
  let applicationUrl;
  try {
    targetUrl = new URL(targetValue);
    applicationUrl = new URL(applicationValue);
  } catch {
    return { action: "deny" };
  }

  if (isApplicationNavigation(targetUrl, applicationUrl)) {
    return { action: "allow-application" };
  }

  try {
    return {
      action: "open-external",
      url: requireSafeExternalUrl(targetValue),
    };
  } catch {
    return { action: "deny" };
  }
}

export function installWindowNavigationSecurity({
  webContents,
  applicationUrl,
  externalNavigation,
}) {
  if (!externalNavigation || typeof externalNavigation.openDetached !== "function") {
    throw new TypeError("Window navigation security requires the external navigation service.");
  }

  const handleTopLevelNavigation = (event, targetUrl) => {
    const decision = classifyWindowNavigation(targetUrl, applicationUrl);
    if (decision.action === "allow-application") return;

    event.preventDefault();
    if (decision.action === "open-external") {
      externalNavigation.openDetached(decision.url);
    }
  };

  webContents.on("will-navigate", handleTopLevelNavigation);
  webContents.on("will-redirect", handleTopLevelNavigation);
  webContents.on("will-frame-navigate", (details) => {
    if (!details || details.isMainFrame) return;
    if ((isEmbeddedPdfFrame(details.frame) && !isAllowedPdfResource(details.url))
      || shouldBlockEmbeddedFrameNavigation(details.url, applicationUrl)) {
      details.preventDefault();
    }
  });

  webContents.setWindowOpenHandler(({ url }) => {
    const decision = classifyWindowNavigation(url, applicationUrl);
    if (decision.action === "open-external") {
      externalNavigation.openDetached(decision.url);
    }
    return { action: "deny" };
  });
}

/**
 * Sandboxed app frames need script + origin semantics for normal web tooling.
 * They must therefore never become same-origin with the privileged shell,
 * including after a redirect or an in-frame navigation.
 */
export function shouldBlockEmbeddedFrameNavigation(targetValue, applicationValue) {
  let targetUrl;
  let applicationUrl;
  try {
    targetUrl = new URL(targetValue);
    applicationUrl = new URL(applicationValue);
  } catch {
    return true;
  }

  if (applicationUrl.protocol === "http:" || applicationUrl.protocol === "https:") {
    return targetUrl.origin === applicationUrl.origin;
  }
  if (applicationUrl.protocol === "file:") {
    return targetUrl.protocol === "file:";
  }
  return targetUrl.href === applicationUrl.href;
}

function isApplicationNavigation(targetUrl, applicationUrl) {
  if (applicationUrl.protocol === "http:" || applicationUrl.protocol === "https:") {
    return targetUrl.protocol === applicationUrl.protocol && targetUrl.origin === applicationUrl.origin;
  }

  if (applicationUrl.protocol === "file:") {
    return (
      targetUrl.protocol === "file:" &&
      targetUrl.host === applicationUrl.host &&
      targetUrl.pathname === applicationUrl.pathname &&
      targetUrl.search === applicationUrl.search &&
      targetUrl.username === applicationUrl.username &&
      targetUrl.password === applicationUrl.password
    );
  }

  return targetUrl.href === applicationUrl.href;
}

export function isPotentiallyExecutableFile(filePath, stats) {
  const extension = path.extname(filePath).toLowerCase();
  if ([
    ".apk",
    ".app",
    ".application",
    ".appimage",
    ".bat",
    ".cmd",
    ".com",
    ".command",
    ".cpl",
    ".deb",
    ".desktop",
    ".dmg",
    ".exe",
    ".gadget",
    ".hta",
    ".jar",
    ".js",
    ".jse",
    ".lnk",
    ".msi",
    ".msp",
    ".mst",
    ".pif",
    ".pl",
    ".pkg",
    ".ps1",
    ".py",
    ".pyw",
    ".rb",
    ".reg",
    ".rpm",
    ".run",
    ".scpt",
    ".scr",
    ".sh",
    ".tool",
    ".url",
    ".vbe",
    ".vbs",
    ".workflow",
    ".wsf",
    ".wsh",
  ].includes(extension)) {
    return true;
  }

  return process.platform !== "win32" && Boolean(stats.mode & 0o111);
}

export function normalizeCloudRequestHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key !== "string" || !key.trim()) continue;
    if (value == null) continue;
    normalized[key] = String(value);
  }
  return normalized;
}
