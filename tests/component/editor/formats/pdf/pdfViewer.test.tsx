/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EditorPaneMenuContributionProvider,
  type EditorPaneMenuContribution,
} from "../../../../../packages/shared-ui/src/editor/editorPaneMenuContribution";
import { PdfViewer, PDF_ATTACHMENT_TIMEOUT_MS, configureChromiumPdfViewerUrl } from "../../../../../packages/shared-ui/src/editor/viewers/pdf/PdfViewer";
import { withTestLocalization } from "../../../../support/react/localization";
import type { Window as HappyWindow } from "happy-dom";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const url = (id: string) => `puppyone-local://file/${id}/file-preview/report.pdf`;
const good = () => new Response(null, { headers: { "content-type": "application/pdf", "content-length": "1024" } });
let root: Root | null;
let container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

beforeEach(() => {
  (window as unknown as HappyWindow).happyDOM.settings.disableIframePageLoading = true;
  const report = window.console.error.bind(window.console);
  vi.spyOn(window.console, "error").mockImplementation((error, ...args) => {
    // happy-dom has no Chromium MIME handler. Its intentionally disabled frame
    // fetch is not the transport under test; all other React errors stay visible.
    if (error instanceof Error && error.message.includes("Iframe page loading is disabled")) return;
    report(error, ...args);
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  fetcher = vi.fn(async () => good()); vi.stubGlobal("fetch", fetcher);
  frames = new Map(); nextFrame = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
});
afterEach(() => {
  act(() => root?.unmount()); root = null;
  document.body.innerHTML = "";
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const surface = () => container.querySelector<HTMLElement>(".pdf-preview-surface");
const iframe = () => container.querySelector<HTMLIFrameElement>("iframe");
async function render(id = "A", workspaceId = "one", loading = false,
  onContributionChange?: (contribution: EditorPaneMenuContribution | null) => void) {
  const viewer = <PdfViewer
    document={{ path: "report.pdf", name: "report.pdf", type: "pdf" }} workspaceId={workspaceId}
    fileUrl={url(id)} fileUrlLoading={loading} fileUrlError={null} />;
  await act(async () => root?.render(withTestLocalization(onContributionChange
    ? <EditorPaneMenuContributionProvider onContributionChange={onContributionChange}>
        {viewer}
      </EditorPaneMenuContributionProvider>
    : viewer)));
}
async function load(frame = iframe()!) { await act(async () => frame.dispatchEvent(new Event("load"))); }
function paint() { act(() => { for (const callback of [...frames.values()]) callback(performance.now()); frames.clear(); }); }

describe("DOM-owned PDF transport and attachment lifecycle", () => {
  it("preserves PDF URL parameters without exposing filesystem paths", () => {
    expect(configureChromiumPdfViewerUrl(url("A"))).toBe(url("A") + "#toolbar=0&navpanes=0");
    expect(configureChromiumPdfViewerUrl(url("A") + "#page=3")).toContain("#page=3&toolbar=0");
  });

  it("keeps PDF actions out of the Viewer and contributes reload to pane chrome", async () => {
    const contributions: Array<EditorPaneMenuContribution | null> = [];
    await render("A", "one", false, (next) => { contributions.push(next); });
    const contribution = contributions.find((next): next is EditorPaneMenuContribution => next !== null);

    expect(container.querySelector(".pdf-preview-actions")).toBeNull();
    expect(container.querySelector(".pdf-preview-shell > button")).toBeNull();
    expect(contribution?.documentId).toBe("report.pdf");
    expect(contribution?.viewItems).toHaveLength(1);
    expect(contribution?.viewItems[0]).toMatchObject({
      kind: "command",
      id: "pdf-reload",
      label: "Reload page",
      disabled: false,
    });

    const firstFrame = iframe();
    const reload = contribution?.viewItems[0];
    if (reload?.kind !== "command") throw new Error("Missing PDF reload command");
    await act(async () => reload.run());
    expect(iframe()).not.toBe(firstFrame);
  });

  it("admits before attaching, rechecks after load, and never claims PDF parse success", async () => {
    await render();
    expect(surface()?.contains(iframe())).toBe(true);
    expect(surface()?.dataset.previewState).toBe("loading");
    expect(fetcher).toHaveBeenCalledWith(url("A"), expect.objectContaining({ method: "HEAD", redirect: "error", credentials: "omit" }));
    await load();
    expect(surface()?.dataset.documentSurfaceReady).toBeUndefined();
    paint();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(surface()?.dataset.previewState).toBe("embedded");
    expect(surface()?.dataset.pdfParseState).toBe("unknown");
    expect(surface()?.dataset.documentSurfaceReady).toBe("true");
    expect(surface()?.getAttribute("aria-busy")).toBe("false");
    expect(iframe()?.hasAttribute("sandbox")).toBe(false); // MIME plugin requires this.
  });

  it.each([403, 404, 413, 415])("rejects transport status %i instead of displaying a ready error page", async status => {
    fetcher.mockResolvedValue(new Response(null, { status }));
    await render();
    expect(iframe()).toBeNull();
    expect(container.querySelector("[role=alert]")).not.toBeNull();
    expect(container.querySelector("[data-document-surface-ready=true]")).toBeNull();
  });

  it.each([
    { "content-type": "text/html", "content-length": "10" },
    { "content-type": "application/pdf" },
    { "content-type": "application/pdf", "content-length": "0" },
    { "content-type": "application/pdf", "content-length": "536870913" },
  ])("fails closed for MIME or budget violations %j", async headers => {
    fetcher.mockResolvedValue(new Response(null, { headers: headers as Record<string, string> }));
    await render();
    expect(iframe()).toBeNull();
    expect(container.querySelector("[role=alert]")).not.toBeNull();
  });

  it("does not trust a load after the capability was revoked during navigation", async () => {
    await render();
    fetcher.mockResolvedValue(new Response(null, { status: 403 }));
    await load(); paint();
    expect(iframe()).toBeNull();
    expect(container.querySelector("[data-pdf-failure=resource]")).not.toBeNull();
  });

  it.each(["checking", "loading"])("times out a hung %s phase and supports a fresh manual attempt", async phase => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    if (phase === "checking") fetcher.mockImplementation(() => new Promise(() => {}));
    await render();
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    await act(async () => vi.advanceTimersByTime(PDF_ATTACHMENT_TIMEOUT_MS));
    expect(signal.aborted).toBe(true);
    expect(iframe()).toBeNull();
    expect(container.querySelector("[data-pdf-failure=timeout]")).not.toBeNull();
    fetcher.mockImplementation(async () => good());
    await act(async () => container.querySelector<HTMLButtonElement>("[role=alert] button")!.click());
    expect(iframe()).not.toBeNull();
    await load(); paint();
    expect(surface()?.dataset.previewState).toBe("embedded");
    act(() => root?.unmount()); root = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retires pending requests even when a URL returns in A→B→A", async () => {
    let resolveFirst!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve; }));
    await render("A");
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    await render("B"); await render("A");
    expect(signal.aborted).toBe(true);
    await act(async () => resolveFirst(new Response(null, { status: 403 })));
    expect(surface()?.dataset.previewState).toBe("loading");
    expect(container.querySelector("[role=alert]")).toBeNull();
    await load(); paint();
    expect(surface()?.dataset.previewState).toBe("embedded");
  });

  it("invalidates late paint callbacks on project identity changes, pending input, and unmount", async () => {
    await render(); const first = iframe()!;
    await load(); const stale = frames.get(nextFrame)!;
    await render("A", "two");
    expect(iframe()).not.toBe(first);
    act(() => stale(performance.now()));
    expect(surface()?.dataset.previewState).toBe("loading");
    await render("A", "two", true);
    expect(first.isConnected).toBe(false);
    expect(iframe()).toBeNull();
    await render("B", "two"); await load();
    const pending = frames.get(nextFrame)!;
    const signal = fetcher.mock.calls.at(-1)![1].signal as AbortSignal;
    act(() => root?.unmount()); root = null;
    act(() => pending(performance.now()));
    expect(signal.aborted).toBe(true);
    expect(frames.size).toBe(0);
    expect(iframe()).toBeNull();
  });
});
