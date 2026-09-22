import { describe, it, expect, vi } from "vitest";
import { installEmbeddedContentSessionSecurity, isAllowedPdfResource } from "../../../../electron/main/embedded-pdf-security.mjs";
import { installWindowNavigationSecurity } from "../../../../electron/main/security.mjs";

const pdf = { name: "puppyone-pdf-preview", url: "puppyone-local://file/token/file-preview/a.pdf" };
describe("DOM PDF security in the shared App session", () => {
  it("denies request and check permissions explicitly, including unnamed frames", () => {
    const session = harness(); installEmbeddedContentSessionSecurity(session);
    const callback = vi.fn(); session.request(null, "media", callback);
    expect(callback).toHaveBeenCalledWith(false); expect(session.check(null, "clipboard-read")).toBe(false);
  });
  it("preserves only the trusted App main frame's clipboard write permission", () => {
    const session = harness(), applicationUrl = "file:///app/index.html";
    installEmbeddedContentSessionSecurity(session, { applicationUrl });
    const contents = { getURL: () => applicationUrl };
    const details = { isMainFrame: true, requestingUrl: applicationUrl };
    expect(session.check(contents, "clipboard-sanitized-write", "file://", details)).toBe(true);
    const callback = vi.fn(); session.request(contents, "clipboard-sanitized-write", callback, details);
    expect(callback).toHaveBeenCalledWith(true);
    for (const untrusted of [{ ...details, isMainFrame: false }, { ...details, requestingUrl: "file:///tmp/attack.html" }, undefined]) {
      expect(session.check(contents, "clipboard-sanitized-write", "file://", untrusted)).toBe(false);
    }
    expect(session.check(contents, "clipboard-read", "file://", details)).toBe(false);
    expect(session.check({ getURL: () => "https://evil.example" }, "clipboard-sanitized-write", "file://", details)).toBe(false);
  });
  it("denies PDF subframe network without preventing AppPreview's network", () => {
    const session = harness(); installEmbeddedContentSessionSecurity(session);
    for (const frame of [pdf, { name: "child", parent: pdf }]) {
      for (const url of ["https://example.com/", "http://127.0.0.1/private", "wss://example.com/", "file:///etc/passwd", "data:text/html,attack"]) {
        const callback = vi.fn(); session.requestHook({ frame, url }, callback);
        expect(callback).toHaveBeenCalledWith({ cancel: true });
      }
      const callback = vi.fn(); session.requestHook({ frame, url: pdf.url }, callback);
      expect(callback).toHaveBeenCalledWith({ cancel: false });
    }
    const callback = vi.fn(); session.requestHook({ frame: { name: "app-preview" }, url: "http://127.0.0.1:4000" }, callback);
    expect(callback).toHaveBeenCalledWith({ cancel: false });
  });
  it("blocks network even with a detached frame when the PDF extension is the referrer", () => {
    const session = harness(); installEmbeddedContentSessionSecurity(session);
    const callback = vi.fn(); session.requestHook({ frame: null, referrer: "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html", url: "https://example.com" }, callback);
    expect(callback).toHaveBeenCalledWith({ cancel: true });
  });
  it("prevents PDF navigating to arbitrary HTML while preserving other iframe navigation", () => {
    const listeners = new Map();
    installWindowNavigationSecurity({ webContents: { on: (event, fn) => listeners.set(event, fn), setWindowOpenHandler() {} },
      applicationUrl: "file:///app/index.html", externalNavigation: { openDetached: vi.fn() } });
    const preventDefault = vi.fn();
    listeners.get("will-frame-navigate")({ isMainFrame: false, frame: pdf, url: "https://example.com", preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(isAllowedPdfResource(pdf.url + "#page=3")).toBe(true);
    for (const url of [pdf.url.replace("a.pdf", "a.html"), pdf.url + "?path=secret", pdf.url.replace("file-preview", "markdown-asset")]) expect(isAllowedPdfResource(url)).toBe(false);
  });
});
function harness() {
  const session = { setPermissionRequestHandler: fn => { session.request = fn; }, setPermissionCheckHandler: fn => { session.check = fn; },
    webRequest: { onBeforeRequest: fn => { session.requestHook = fn; } } };
  return session;
}
