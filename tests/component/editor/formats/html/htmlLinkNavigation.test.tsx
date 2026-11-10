/** @vitest-environment happy-dom */
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentNavigationPort, type DocumentNavigationPort } from "../../../../../src/shared-ui/editor/navigation/documentNavigation";
import { allowHtmlNavigationScript, resolveHtmlNavigationHref, useHtmlLinkNavigation } from "../../../../../src/shared-ui/editor/viewers/html/htmlLinkNavigation";
import { buildHtmlPreviewDocument, getHtmlPreviewPolicy } from "../../../../../src/shared-ui/editor/viewers/html/HtmlPreviewFrame";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let activation: PropertyDescriptor | undefined;
beforeEach(() => {
  activation = Object.getOwnPropertyDescriptor(navigator, "userActivation");
  Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: true } });
});
afterEach(() => {
  act(() => root?.unmount()); root = null; document.body.replaceChildren();
  if (activation) Object.defineProperty(navigator, "userActivation", activation);
  else Reflect.deleteProperty(navigator, "userActivation");
});

describe("HTML link destinations", () => {
  it.each([
    ["notes.md", null, "./notes.md"],
    ["notes%20%E4%B8%AD.md", null, "./notes 中.md"],
    ["../other.html#section", null, "../other.html#section"],
    ["other.html", "../pages/", "../pages/other.html"],
    ["other.html", "../pages/index.html", "../pages/other.html"],
    ["/notes.md", "pages/", "/notes.md"],
    ["other.html?q=1#section", "https://example.test/docs/", "https://example.test/docs/other.html?q=1#section"],
    ["//example.test/docs", null, "https://example.test/docs"],
    ["//example.test/docs", "http://example.test/", "http://example.test/docs"],
    ["guide.html", "//example.test/docs/", "https://example.test/docs/guide.html"],
    ["mailto:person@example.test", null, "mailto:person@example.test"],
  ])("resolves %s with author base %s", (href, base, expected) => {
    expect(resolveHtmlNavigationHref(href, base)).toBe(expected);
  });
  it.each(["#section", "", "//", "a\n.md", "%2fetc/passwd", "a%5cb.md", "%00.md", "%broken"])("rejects malformed or frame-local input %s", (href) => {
    expect(resolveHtmlNavigationHref(href, null)).toBeNull();
  });
  it("authorizes only fixed UI scripts without enabling authored inline scripts", () => {
    const csp = "default-src 'none'; script-src 'nonce-author'; connect-src 'none'";
    expect(allowHtmlNavigationScript(csp, "host-nonce")).toBe("default-src 'none'; script-src 'nonce-author' 'nonce-host-nonce'; connect-src 'none'");
    expect(allowHtmlNavigationScript("default-src 'none'", "host-nonce")).toBe("default-src 'none'; script-src 'nonce-host-nonce'");
    expect(allowHtmlNavigationScript("script-src 'unsafe-inline' https:; connect-src 'none'", "host-nonce"))
      .toBe("script-src 'unsafe-inline' https:; connect-src 'none'");
    expect(allowHtmlNavigationScript("script-src 'unsafe-inline'; script-src-elem 'none'", "host-nonce"))
      .toBe("script-src 'unsafe-inline'; script-src-elem 'nonce-host-nonce'");
  });
  it("preserves author CSP and base semantics in a disposable projection", () => {
    const source = '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'; connect-src \'none\'"><base href="https://example.test/docs/"><a href="other.html">Open</a>';
    const projected = buildHtmlPreviewDocument(source, "puppyone-local://file/token/page.html", getHtmlPreviewPolicy("safe", true), "host-nonce");
    expect(projected).toContain("nonce-host-nonce");
    expect(projected).toContain('nonce="host-nonce"');
    expect(projected).toContain("connect-src 'none'");
    expect(projected).toContain('href="https://example.test/docs/"');
    expect(source).toContain("script-src 'none'");
  });
});

function Broker({ navigation, failure, offline = false, generation = "first" }: {
  navigation: DocumentNavigationPort; failure: (reason: string) => void; offline?: boolean; generation?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  useHtmlLinkNavigation({ frame, channel: "session", generation, path: "pages/page.html", sourceBase: null, navigation, offline, onFailure: failure });
  return <iframe key={generation} ref={frame} />;
}
async function mount() {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const external = vi.fn(), files = vi.fn(), failure = vi.fn();
  const navigation = createDocumentNavigationPort({ openExternalUrl: external, openWorkspaceCandidates: files,
    resolveWorkspaceReference: (_source, target) => ({ exists: target !== "./missing.md", ambiguous: false, path: target === "./missing.md" ? null : "pages/note.md" }) });
  await act(async () => root!.render(<Broker navigation={navigation} failure={failure} />));
  const send = async (href: string, source = host.querySelector("iframe")!.contentWindow, channel = "session") => {
    await act(async () => { window.dispatchEvent(new MessageEvent("message", { source, data: { type: "puppyone-html-link", channel, href } })); });
  };
  return { host, navigation, external, files, failure, send };
}

describe("HTML navigation capability", () => {
  it("uses the host's existing external and workspace routes", async () => {
    const h = await mount(); await h.send("https://example.test/docs"); await h.send("note.md");
    expect(h.external).toHaveBeenCalledExactlyOnceWith("https://example.test/docs");
    expect(h.files).toHaveBeenCalledExactlyOnceWith(["pages/note.md"]);
    expect(h.failure).not.toHaveBeenCalled();
  });
  it("rejects another frame, stale sessions and messages without user activation", async () => {
    const h = await mount(); const other = document.createElement("iframe"); document.body.append(other);
    await h.send("https://example.test/", other.contentWindow);
    await h.send("https://example.test/", undefined, "old-session");
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: false } });
    await h.send("https://example.test/");
    expect(h.external).not.toHaveBeenCalled(); expect(h.failure).not.toHaveBeenCalled();
  });
  it.each(["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "https://user:password@example.test/"])("never hands %s to the OS", async (href) => {
    const h = await mount(); await h.send(href);
    expect(h.external).not.toHaveBeenCalled(); expect(h.files).not.toHaveBeenCalled();
    expect(h.failure).toHaveBeenCalledExactlyOnceWith("unavailable");
  });
  it("reports missing files and external-opening failures", async () => {
    const h = await mount(); await h.send("missing.md");
    expect(h.failure).toHaveBeenCalledWith("missing");
    h.external.mockRejectedValueOnce(new Error("OS failed")); await h.send("https://example.test/");
    expect(h.failure).toHaveBeenLastCalledWith("failed");
  });
  it("keeps folder-authorized pages offline", async () => {
    const h = await mount();
    await act(async () => root!.render(<Broker navigation={h.navigation} failure={h.failure} offline />));
    await h.send("https://example.test/");
    expect(h.external).not.toHaveBeenCalled(); expect(h.failure).toHaveBeenCalledWith("offline");
  });
  it("reports a host resolution error without navigating the frame", async () => {
    const h = await mount();
    const navigation = createDocumentNavigationPort({ resolveWorkspaceReference: () => { throw new Error("Resolution failed"); } });
    await act(async () => root!.render(<Broker navigation={navigation} failure={h.failure} />));
    await h.send("note.md");
    expect(h.failure).toHaveBeenCalledExactlyOnceWith("failed");
    expect(h.external).not.toHaveBeenCalled(); expect(h.files).not.toHaveBeenCalled();
  });
  it("does not show a late opening error in a replacement document", async () => {
    const h = await mount(); let reject!: (error: Error) => void;
    h.external.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    await h.send("https://example.test/");
    await act(async () => root!.render(<Broker navigation={h.navigation} failure={h.failure} generation="replacement" />));
    await act(async () => reject(new Error("Old request failed")));
    expect(h.failure).not.toHaveBeenCalled();
  });
});
