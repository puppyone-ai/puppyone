/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PdfViewer,
  configureChromiumPdfViewerUrl,
} from "../../../../../packages/shared-ui/src/editor/viewers/pdf/PdfViewer";
import { testT, withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("DOM-embedded Chromium PDF Viewer", () => {
  it("preserves existing PDF open parameters while hiding browser chrome", () => {
    expect(configureChromiumPdfViewerUrl("puppyone-local://file/token/file-preview/report.pdf"))
      .toBe("puppyone-local://file/token/file-preview/report.pdf#toolbar=0&navpanes=0");
    expect(configureChromiumPdfViewerUrl("https://example.com/report.pdf#page=3&zoom=125"))
      .toBe("https://example.com/report.pdf#page=3&zoom=125&toolbar=0&navpanes=0");
  });

  it("keeps the iframe inside its Editor surface and publishes readiness after a paint frame", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const container = mount("data:text/html,PDF-A");
    const shell = requireElement<HTMLElement>(container, ".pdf-preview-shell");
    const iframe = requireElement<HTMLIFrameElement>(container, ".pdf-preview-frame");

    expect(shell.contains(iframe)).toBe(true);
    expect(shell.dataset.previewState).toBe("loading");
    expect(shell.getAttribute("aria-busy")).toBe("true");
    expect(shell.querySelector(".document-surface-pending")?.getAttribute("aria-label"))
      .toBe(testT("editor.preview.loading"));

    act(() => iframe.dispatchEvent(new Event("load")));
    expect(shell.dataset.previewState).toBe("loading");
    act(() => frames.get(1)?.(performance.now()));

    expect(shell.dataset.previewState).toBe("ready");
    expect(shell.getAttribute("aria-busy")).toBe("false");
    expect(shell.dataset.documentSurfaceReady).toBe("true");
    expect(shell.querySelector(".document-surface-pending")).toBeNull();
  });

  it("cannot let a retired PDF load mark its replacement ready and removes the frame on unmount", () => {
    const frames = new Map<number, FrameRequestCallback>();
    const cancelled: number[] = [];
    let nextFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      cancelled.push(id);
      frames.delete(id);
    });
    const container = mount("data:text/html,PDF-A");
    const first = requireElement<HTMLIFrameElement>(container, ".pdf-preview-frame");
    act(() => first.dispatchEvent(new Event("load")));
    const staleFrame = frames.get(1);

    act(() => root?.render(renderViewer("data:text/html,PDF-B")));
    const replacement = requireElement<HTMLIFrameElement>(container, ".pdf-preview-frame");
    const shell = requireElement<HTMLElement>(container, ".pdf-preview-shell");
    expect(replacement).not.toBe(first);
    expect(cancelled).toContain(1);
    act(() => staleFrame?.(performance.now()));
    expect(shell.dataset.previewState).toBe("loading");

    act(() => replacement.dispatchEvent(new Event("load")));
    act(() => frames.get(2)?.(performance.now()));
    expect(shell.dataset.previewState).toBe("ready");

    act(() => root?.unmount());
    root = null;
    expect(container.querySelector("iframe")).toBeNull();
  });
});

function mount(url: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(renderViewer(url)));
  return container;
}

function renderViewer(url: string) {
  return withTestLocalization(
    <PdfViewer
      document={{ path: "report.pdf", name: "report.pdf", type: "pdf" }}
      fileUrl={url}
      fileUrlLoading={false}
      fileUrlError={null}
    />,
  );
}

function requireElement<T extends Element>(container: ParentNode, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
