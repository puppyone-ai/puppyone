/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DocumentSurfaceHost,
  DocumentSurfacePending,
  DocumentSurfaceReadinessBoundary,
} from "../../../../packages/shared-ui/src/editor/host/DocumentSurfaceHost";
import { FilePreview } from "../../../../packages/shared-ui/src/editor/host/FilePreview";
import { testT, withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

beforeEach(() => {
  frames = new Map();
  nextFrameId = 1;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("DocumentSurfaceHost", () => {
  it("keeps pending state accessible without rendering visible loading copy", async () => {
    const container = createContainer();
    await act(async () => root?.render(
      <DocumentSurfacePending label="Loading file…" />,
    ));

    const pending = container.querySelector<HTMLElement>(".document-surface-pending");
    expect(pending?.textContent).toBe("");
    expect(pending?.getAttribute("role")).toBe("status");
    expect(pending?.getAttribute("aria-busy")).toBe("true");
    expect(pending?.getAttribute("aria-label")).toBe("Loading file…");
  });

  it("keeps the committed document interactive until the staged document is ready", async () => {
    const ready = new Map<string, () => void>();
    const container = createContainer();

    await renderSurface(container, "a.md", "Document A", ready);
    const originalA = getSurface(container, "a.md");

    await renderSurface(container, "b.pdf", "Document B", ready);

    expect(getSurface(container, "a.md")).toBe(originalA);
    expect(originalA.dataset.surfaceState).toBe("committed");
    expect(originalA.getAttribute("aria-hidden")).toBeNull();
    expect(originalA.inert).toBe(false);
    const stagedB = getSurface(container, "b.pdf");
    expect(stagedB.dataset.surfaceState).toBe("staging");
    expect(stagedB.getAttribute("aria-hidden")).toBe("true");
    expect(stagedB.inert).toBe(true);

    act(() => ready.get("b.pdf")?.());

    expect(container.querySelector('[data-surface-key="a.md"]')).toBeNull();
    expect(getSurface(container, "b.pdf")).toBe(stagedB);
    expect(stagedB.dataset.surfaceState).toBe("committed");
    expect(stagedB.inert).toBe(false);
  });

  it("cannot commit a stale readiness signal after a newer request", async () => {
    const ready = new Map<string, () => void>();
    const container = createContainer();

    await renderSurface(container, "a.md", "Document A", ready);
    await renderSurface(container, "b.png", "Document B", ready);
    const staleReady = ready.get("b.png");
    await renderSurface(container, "c.csv", "Document C", ready);

    expect(container.querySelector('[data-surface-key="b.png"]')).toBeNull();
    act(() => staleReady?.());
    expect(getSurface(container, "a.md").dataset.surfaceState).toBe("committed");
    expect(getSurface(container, "c.csv").dataset.surfaceState).toBe("staging");

    act(() => ready.get("c.csv")?.());
    expect(container.querySelector('[data-surface-key="a.md"]')).toBeNull();
    expect(getSurface(container, "c.csv").dataset.surfaceState).toBe("committed");
  });

  it("commits a visible-first Viewer immediately instead of mounting it in a hidden staging slot", async () => {
    const ready = new Map<string, () => void>();
    const container = createContainer();

    await renderSurface(container, "a.md", "Document A", ready);
    act(() => ready.get("a.md")?.());
    await renderSurface(
      container,
      "report.pdf",
      "PDF document",
      ready,
      "requires-visible",
    );

    expect(container.querySelector('[data-surface-key="a.md"]')).toBeNull();
    const pdfSurface = getSurface(container, "report.pdf");
    expect(pdfSurface.dataset.surfaceState).toBe("committed");
    expect(pdfSurface.dataset.surfacePreparation).toBe("requires-visible");
    expect(pdfSurface.dataset.surfaceReady).toBe("false");
    expect(pdfSurface.getAttribute("aria-hidden")).toBeNull();
    expect(pdfSurface.inert).toBe(false);
    expect(container.querySelector(".document-surface-slot.is-staging")).toBeNull();
    expect(container.querySelector('[data-testid="official-loading-indicator"]')).not.toBeNull();

    act(() => ready.get("report.pdf")?.());
    expect(pdfSurface.dataset.surfaceReady).toBe("true");
    expect(container.querySelector('[data-testid="official-loading-indicator"]')).toBeNull();
  });

  it("updates the current document without remounting or creating a staging slot", async () => {
    const ready = new Map<string, () => void>();
    const container = createContainer();

    await renderSurface(container, "a.md", "First revision", ready);
    const surface = getSurface(container, "a.md");
    await renderSurface(container, "a.md", "Second revision", ready);

    expect(getSurface(container, "a.md")).toBe(surface);
    expect(surface.textContent).toBe("Second revision");
    expect(container.querySelectorAll(".document-surface-slot")).toHaveLength(1);
    expect(container.querySelector(".document-surface-host")?.getAttribute("data-transitioning")).toBe("false");
  });

  it("keeps the empty surface committed while the first selected file is still loading", async () => {
    const container = createContainer();
    await act(async () => root?.render(withTestLocalization(
      <FilePreview
        node={null}
        emptySlot={<div data-testid="neutral-surface" />}
      />,
    )));

    await act(async () => root?.render(withTestLocalization(
      <FilePreview
        node={{
          id: "new.md",
          path: "new.md",
          name: "new.md",
          type: "markdown",
        }}
        loading
      />,
    )));

    const pending = container.querySelector<HTMLElement>(
      `.document-surface-pending[aria-label="${testT("editor.loadingFile")}"]`,
    );
    const loadingSlot = pending?.closest<HTMLElement>(".document-surface-slot");
    const neutralSlot = container
      .querySelector<HTMLElement>('[data-testid="neutral-surface"]')
      ?.closest<HTMLElement>(".document-surface-slot");

    expect(loadingSlot?.dataset.surfaceState).toBe("staging");
    expect(loadingSlot?.getAttribute("aria-hidden")).toBe("true");
    expect(pending?.textContent).toBe("");
    expect(neutralSlot?.dataset.surfaceState).toBe("committed");
  });
});

describe("DocumentSurfaceReadinessBoundary", () => {
  it("accepts an explicit measured projection before paint but never bypasses busy content", async () => {
    const onReady = vi.fn();
    createContainer();
    const render = (busy: boolean) => <DocumentSurfaceReadinessBoundary readinessKey="csv" onReady={onReady}>
      <div data-document-surface-ready="true"><div aria-busy={busy}>measured table</div></div>
    </DocumentSurfaceReadinessBoundary>;
    await act(async () => root?.render(render(true)));
    await flushFrames();
    expect(onReady).not.toHaveBeenCalled();
    await act(async () => root?.render(render(false)));
    await flushOneFrame();
    expect(onReady).toHaveBeenCalledTimes(1);
    await flushFrames();
    expect(onReady).toHaveBeenCalledTimes(1);
  });
  it("does not starve handoff when a ready viewer reasserts its idle state", async () => {
    const onReady = vi.fn();
    const container = createContainer();
    await act(async () => root?.render(
      <DocumentSurfaceReadinessBoundary readinessKey="markdown" onReady={onReady}>
        <div aria-busy="false">ready editor</div>
      </DocumentSurfaceReadinessBoundary>,
    ));
    const editor = container.querySelector("[aria-busy]")!;
    for (let frame = 0; frame < 3; frame++) {
      await act(async () => {
        editor.setAttribute("aria-busy", "false");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await flushOneFrame();
    }
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("waits for aria-busy to clear and for two stable animation frames", async () => {
    const onReady = vi.fn();
    const container = createContainer();
    const render = (busy: boolean) => (
      <DocumentSurfaceReadinessBoundary readinessKey="document" onReady={onReady}>
        <div aria-busy={busy}>surface</div>
      </DocumentSurfaceReadinessBoundary>
    );

    await act(async () => root?.render(render(true)));
    await flushFrames();
    expect(onReady).not.toHaveBeenCalled();

    await act(async () => root?.render(render(false)));
    await flushOneFrame();
    expect(onReady).not.toHaveBeenCalled();
    await flushOneFrame();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("surface");
  });
});

function createContainer() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  return container;
}

async function renderSurface(
  container: HTMLElement,
  surfaceKey: string,
  label: string,
  ready: Map<string, () => void>,
  surfacePreparation: "hidden-safe" | "requires-visible" = "hidden-safe",
) {
  await act(async () => root?.render(
    <DocumentSurfaceHost
      surfaceKey={surfaceKey}
      surfacePreparation={surfacePreparation}
      pendingIndicator={<span data-testid="official-loading-indicator" />}
    >
      {({ onSurfaceReady }) => {
        ready.set(surfaceKey, onSurfaceReady);
        return <button type="button">{label}</button>;
      }}
    </DocumentSurfaceHost>,
  ));
  return container;
}

function getSurface(container: HTMLElement, key: string): HTMLDivElement {
  const surface = container.querySelector<HTMLDivElement>(`[data-surface-key="${key}"]`);
  if (!surface) throw new Error(`Surface ${key} was not rendered.`);
  return surface;
}

async function flushOneFrame() {
  const callbacks = Array.from(frames.entries());
  frames.clear();
  await act(async () => {
    for (const [, callback] of callbacks) callback(performance.now());
  });
}

async function flushFrames() {
  while (frames.size > 0) await flushOneFrame();
}
