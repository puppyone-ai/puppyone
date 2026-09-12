/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataPort } from "../packages/shared-ui/src/core/types";
import { DataWorkspace } from "../packages/shared-ui/src/data/DataWorkspace";
import { DesktopCloudShell } from "../src/components/DesktopCloudShell";
import { AuxiliaryPanelHost } from "../src/features/app-shell/auxiliary/AuxiliaryPanelHost";
import { withTestLocalization } from "./testLocalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  document.body.className = "";
  vi.restoreAllMocks();
});

describe("desktop side-pane resize interactions", () => {
  it.each(["pointercancel", "blur", "pagehide", "lostpointercapture", "Escape", "unmount"])(
    "cancels a live width preview on %s without persisting it", async (reason) => {
      const flushFrames = mockAnimationFrames();
      const onWidthChange = vi.fn();
      const onResizeActiveChange = vi.fn();
      const container = await renderWorkspace({ onCollapsedChange: vi.fn(), onWidthChange, onResizeActiveChange });
      const handle = requireHandle(container, ".data-explorer-resizer");
      const content = requireHandle(container, ".data-content");
      act(() => {
        handle.dispatchEvent(pointerEvent("pointerdown", 320, 80));
        window.dispatchEvent(pointerEvent("pointermove", 420, 80));
      });
      act(flushFrames);
      expect(content.style.getPropertyValue("--data-explorer-width")).toBe("420px");
      act(() => {
        if (reason === "unmount") { root?.unmount(); root = null; }
        else if (reason === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        else if (reason === "pointercancel") window.dispatchEvent(pointerEvent(reason, 420, 80));
        else if (reason === "lostpointercapture") handle.dispatchEvent(pointerEvent(reason, 420, 80));
        else window.dispatchEvent(new Event(reason));
      });
      act(flushFrames);
      if (reason !== "unmount") expect(content.style.getPropertyValue("--data-explorer-width")).toBe("320px");
      expect(onWidthChange).not.toHaveBeenCalled();
      expect(onResizeActiveChange.mock.calls).toEqual([[true], [false]]);
      expect(document.body.classList.contains("data-explorer-resizing")).toBe(false);
    },
  );

  it("does not reopen a collapsed edge after Escape and a late pointer release", () => {
    const onOpenChange = vi.fn();
    const container = render(withTestLocalization(
      <AuxiliaryPanelHost open={false} resizable width={0} onOpenChange={onOpenChange} onWidthChange={vi.fn()}>
        <div>Terminal</div>
      </AuxiliaryPanelHost>,
    ));
    const handle = requireHandle(container, ".desktop-right-sidebar-resizer");
    act(() => handle.dispatchEvent(pointerEvent("pointerdown", 500, 81)));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    act(() => window.dispatchEvent(pointerEvent("pointerup", 500, 81)));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("collapses the explorer after pulling half a minimum width past its minimum", async () => {
    const onCollapsedChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = await renderWorkspace({ onCollapsedChange, onWidthChange });
    const handle = requireHandle(container, ".data-explorer-resizer");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 320, 1));
      window.dispatchEvent(pointerEvent("pointermove", 120, 1));
      window.dispatchEvent(pointerEvent("pointerup", 120, 1));
    });

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(onWidthChange).not.toHaveBeenCalledWith(expect.any(Number));
  });

  it("follows the pointer down to the explorer minimum, then holds while collapse is armed", async () => {
    const flushFrames = mockAnimationFrames();
    const onCollapsedChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = await renderWorkspace({ onCollapsedChange, onWidthChange });
    const handle = requireHandle(container, ".data-explorer-resizer");
    const content = requireHandle(container, ".data-content");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 320, 2));
      window.dispatchEvent(pointerEvent("pointermove", 250, 2));
    });
    act(flushFrames);

    expect(content.style.getPropertyValue("--data-explorer-width")).toBe("250px");
    expect(onWidthChange).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", 250, 2));
    });
    expect(onWidthChange).toHaveBeenLastCalledWith(250);

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 320, 2));
      window.dispatchEvent(pointerEvent("pointermove", 200, 2));
    });
    act(flushFrames);

    expect(content.style.getPropertyValue("--data-explorer-width")).toBe("240px");
    expect(onWidthChange).not.toHaveBeenCalledWith(240);
    expect(onCollapsedChange).not.toHaveBeenCalledWith(true);

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", 200, 2));
    });
    expect(onWidthChange).toHaveBeenLastCalledWith(240);
  });

  it("coalesces rapid explorer previews into one committed preference width", async () => {
    let scheduledFrame: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      scheduledFrame = callback;
      return 1;
    });
    const onWidthChange = vi.fn();
    const container = await renderWorkspace({
      onCollapsedChange: vi.fn(),
      onWidthChange,
    });
    const handle = requireHandle(container, ".data-explorer-resizer");
    const content = requireHandle(container, ".data-content");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 320, 14));
      window.dispatchEvent(pointerEvent("pointermove", 360, 14));
      window.dispatchEvent(pointerEvent("pointermove", 420, 14));
      window.dispatchEvent(pointerEvent("pointermove", 480, 14));
    });

    expect(content.style.getPropertyValue("--data-explorer-width")).toBe("320px");
    expect(onWidthChange).not.toHaveBeenCalled();

    act(() => {
      const frame = scheduledFrame as FrameRequestCallback | null;
      if (!frame) throw new Error("Explorer resize frame was not scheduled.");
      frame(0);
    });

    expect(content.style.getPropertyValue("--data-explorer-width")).toBe("480px");
    expect(onWidthChange).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", 480, 14));
    });

    expect(onWidthChange).toHaveBeenCalledExactlyOnceWith(480);
  });

  it("keeps explorer resize values inside the expanded range before snapping", async () => {
    const onCollapsedChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = await renderWorkspace({ onCollapsedChange, onWidthChange });
    const handle = requireHandle(container, ".data-explorer-resizer");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 320, 3));
      window.dispatchEvent(pointerEvent("pointermove", 500, 3));
      window.dispatchEvent(pointerEvent("pointerup", 500, 3));
    });

    expect(onCollapsedChange).not.toHaveBeenCalledWith(true);
    expect(onWidthChange).toHaveBeenLastCalledWith(500);
  });

  it("publishes the complete resize gesture without marking it as an occluding overlay", async () => {
    const onResizeActiveChange = vi.fn();
    const container = await renderWorkspace({
      onCollapsedChange: vi.fn(),
      onResizeActiveChange,
      onWidthChange: vi.fn(),
    });
    const handle = requireHandle(container, ".data-explorer-resizer");
    expect(handle.dataset.nativeSurfaceOccluder).toBeUndefined();

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 320, 13));
    });
    expect(handle.dataset.nativeSurfaceOccluder).toBeUndefined();
    expect(onResizeActiveChange).toHaveBeenLastCalledWith(true);

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", 360, 13));
    });
    expect(handle.dataset.nativeSurfaceOccluder).toBeUndefined();
    expect(onResizeActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("removes the explorer resize handle after collapse so Header owns expansion", async () => {
    const container = await renderWorkspace({
      explorerCollapsed: true,
      onCollapsedChange: vi.fn(),
      onWidthChange: vi.fn(),
    });

    expect(container.querySelector(".data-explorer-resizer")).toBeNull();
  });

  it("previews the expanded Project sidebar width and commits it at gesture end", () => {
    const flushFrames = mockAnimationFrames();
    const onWidthChange = vi.fn();
    const container = render(withTestLocalization(
      <DesktopCloudShell
        leadingRail={<nav>Projects</nav>}
        leadingRailWidth={220}
        leadingRailMinWidth={160}
        leadingRailMaxWidth={360}
        leftSidebarPresent={false}
        resizableLeadingRail
        onLeadingRailWidthChange={onWidthChange}
      >
        <div>Editor</div>
      </DesktopCloudShell>,
    ));
    const handle = requireHandle(container, ".desktop-project-switcher-resizer");
    const shell = requireHandle(container, ".desktop-shell");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 220, 15));
      window.dispatchEvent(pointerEvent("pointermove", 300, 15));
    });
    act(flushFrames);

    expect(shell.style.getPropertyValue("--desktop-shell-leading-rail-width")).toBe("300px");
    expect(onWidthChange).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", 300, 15));
    });
    act(flushFrames);

    expect(onWidthChange).toHaveBeenCalledExactlyOnceWith(300);
  });

  it("collapses the Project sidebar by pulling past the same half-minimum threshold", () => {
    const flushFrames = mockAnimationFrames();
    const onCollapsedChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = render(withTestLocalization(
      <DesktopCloudShell
        leadingRail={<nav>Projects</nav>}
        leadingRailWidth={220}
        leadingRailMinWidth={160}
        leadingRailMaxWidth={360}
        leadingRailCollapsedWidth={48}
        leadingRailCollapseThreshold={80}
        leftSidebarPresent={false}
        resizableLeadingRail
        onLeadingRailCollapsedChange={onCollapsedChange}
        onLeadingRailWidthChange={onWidthChange}
      >
        <div>Editor</div>
      </DesktopCloudShell>,
    ));
    const handle = requireHandle(container, ".desktop-project-switcher-resizer");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 220, 16));
      window.dispatchEvent(pointerEvent("pointermove", 81, 16));
    });
    expect(onCollapsedChange).not.toHaveBeenCalledWith(true);

    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", 80, 16));
      window.dispatchEvent(pointerEvent("pointerup", 80, 16));
    });
    act(flushFrames);

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(onWidthChange).not.toHaveBeenCalled();
  });

  it("expands the compact Project rail from its resize edge by click or drag", () => {
    const onCollapsedChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = render(withTestLocalization(
      <DesktopCloudShell
        leadingRail={<nav>Projects</nav>}
        leadingRailWidth={220}
        leadingRailMinWidth={160}
        leadingRailMaxWidth={360}
        leadingRailCollapsed
        leadingRailCollapsedWidth={48}
        leadingRailCollapseThreshold={80}
        leftSidebarPresent={false}
        resizableLeadingRail
        onLeadingRailCollapsedChange={onCollapsedChange}
        onLeadingRailWidthChange={onWidthChange}
      >
        <div>Editor</div>
      </DesktopCloudShell>,
    ));
    const handle = requireHandle(container, ".desktop-project-switcher-resizer");
    const shell = requireHandle(container, ".desktop-shell");

    expect(handle.getAttribute("role")).toBe("button");
    expect(handle.classList.contains("po-collapsed-pane-edge-handle--inline-start")).toBe(true);
    expect(shell.style.getPropertyValue("--desktop-shell-leading-rail-width")).toBe("48px");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 48, 17));
      window.dispatchEvent(pointerEvent("pointerup", 48, 17));
    });
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);

    onCollapsedChange.mockClear();
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 48, 18));
      window.dispatchEvent(pointerEvent("pointermove", 140, 18));
      window.dispatchEvent(pointerEvent("pointerup", 140, 18));
    });
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
    expect(onWidthChange).toHaveBeenLastCalledWith(160);
  });

  it("collapses the right sidebar after pulling half a minimum width past its minimum", () => {
    const onOpenChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = render(withTestLocalization(
      <AuxiliaryPanelHost
        collapseThreshold={210}
        maxWidth={900}
        minWidth={420}
        open
        resizable
        width={700}
        onOpenChange={onOpenChange}
        onWidthChange={onWidthChange}
      >
        <div>Terminal</div>
      </AuxiliaryPanelHost>,
    ));
    const handle = requireHandle(container, ".desktop-right-sidebar-resizer");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 0, 5));
      window.dispatchEvent(pointerEvent("pointermove", 490, 5));
      window.dispatchEvent(pointerEvent("pointerup", 490, 5));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);

    act(() => handle.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "Home",
    })));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("previews the right-sidebar width pointer-synchronously and commits it at gesture end", () => {
    const flushFrames = mockAnimationFrames();
    const onWidthChange = vi.fn();
    const container = render(withTestLocalization(
      <AuxiliaryPanelHost
        collapseThreshold={210}
        maxWidth={900}
        minWidth={420}
        open
        resizable
        width={420}
        onOpenChange={vi.fn()}
        onWidthChange={onWidthChange}
      >
        <div>Terminal</div>
      </AuxiliaryPanelHost>,
    ));
    const handle = requireHandle(container, ".desktop-right-sidebar-resizer");
    const panel = requireHandle(container, ".desktop-right-sidebar");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 0, 8));
      window.dispatchEvent(pointerEvent("pointermove", -300, 8));
    });
    act(flushFrames);

    expect(panel.style.getPropertyValue("--desktop-right-sidebar-width")).toBe("720px");
    expect(onWidthChange).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", -300, 8));
    });
    act(flushFrames);

    expect(onWidthChange).toHaveBeenCalledExactlyOnceWith(720);
  });

  it("follows the pointer down to the right-sidebar minimum, then holds while collapse is armed", () => {
    const flushFrames = mockAnimationFrames();
    const onOpenChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = render(withTestLocalization(
      <AuxiliaryPanelHost
        collapseThreshold={210}
        maxWidth={900}
        minWidth={420}
        open
        resizable
        width={700}
        onOpenChange={onOpenChange}
        onWidthChange={onWidthChange}
      >
        <div>Terminal</div>
      </AuxiliaryPanelHost>,
    ));
    const handle = requireHandle(container, ".desktop-right-sidebar-resizer");
    const panel = requireHandle(container, ".desktop-right-sidebar");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 0, 6));
      window.dispatchEvent(pointerEvent("pointermove", 200, 6));
    });
    act(flushFrames);

    expect(panel.style.getPropertyValue("--desktop-right-sidebar-width")).toBe("500px");
    expect(onWidthChange).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", 200, 6));
    });
    act(flushFrames);

    expect(onWidthChange).toHaveBeenCalledExactlyOnceWith(500);

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 0, 6));
      window.dispatchEvent(pointerEvent("pointermove", 300, 6));
    });
    act(flushFrames);

    expect(panel.style.getPropertyValue("--desktop-right-sidebar-width")).toBe("420px");
    expect(onWidthChange).toHaveBeenCalledExactlyOnceWith(500);
    expect(onOpenChange).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", 300, 6));
    });
    act(flushFrames);

    expect(onWidthChange).toHaveBeenLastCalledWith(420);
    expect(onWidthChange).toHaveBeenCalledTimes(2);
  });

  it("reveals a closed right sidebar immediately while dragging out and snaps back below half width", () => {
    const onOpenChange = vi.fn();
    const container = render(withTestLocalization(
      <AuxiliaryPanelHost
        collapseThreshold={210}
        maxWidth={900}
        minWidth={420}
        open={false}
        resizable
        width={0}
        onOpenChange={onOpenChange}
        onWidthChange={vi.fn()}
      >
        <div>Terminal</div>
      </AuxiliaryPanelHost>,
    ));
    const handle = requireHandle(container, ".desktop-right-sidebar-resizer");
    const panelInner = requireHandle(container, ".desktop-right-sidebar-inner");

    expect(handle.classList.contains("po-collapsed-pane-edge-handle--inline-end")).toBe(true);
    expect(panelInner.hasAttribute("inert")).toBe(true);

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 0, 7));
      window.dispatchEvent(pointerEvent("pointermove", -20, 7));
      window.dispatchEvent(pointerEvent("pointerup", -20, 7));
    });

    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it("keeps the auxiliary content at its expanded width while the outer track collapses", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <AuxiliaryPanelHost
        expandedWidth={560}
        maxWidth={900}
        minWidth={320}
        open
        width={560}
      >
        <div>Text that must never reflow during collapse</div>
      </AuxiliaryPanelHost>,
    )));

    const panel = requireHandle(container, ".desktop-right-sidebar");
    expect(panel.style.getPropertyValue("--desktop-right-sidebar-width")).toBe("560px");

    act(() => root?.render(withTestLocalization(
      <AuxiliaryPanelHost
        expandedWidth={560}
        maxWidth={900}
        minWidth={320}
        open={false}
        width={0}
      >
        <div>Text that must never reflow during collapse</div>
      </AuxiliaryPanelHost>,
    )));

    expect(panel.style.getPropertyValue("--desktop-right-sidebar-width")).toBe("560px");
    expect(container.querySelector(".desktop-right-sidebar-viewport .desktop-right-sidebar-inner")).not.toBeNull();
  });
});

async function renderWorkspace({
  explorerCollapsed = false,
  onCollapsedChange,
  onResizeActiveChange,
  onWidthChange,
}: {
  explorerCollapsed?: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onResizeActiveChange?: (active: boolean) => void;
  onWidthChange: (width: number) => void;
}) {
  const dataPort: DataPort = {
    listChildren: vi.fn(async () => []),
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(withTestLocalization(
      <DataWorkspace
        collapsedExplorerWidth={0}
        dataPort={dataPort}
        enableMarkdownLinkContentIndexing={false}
        explorerCollapsed={explorerCollapsed}
        explorerCollapseThreshold={120}
        explorerWidth={320}
        maxExplorerWidth={900}
        minExplorerWidth={240}
        resizableExplorer
        showHeader={false}
        workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
        onExplorerCollapsedChange={onCollapsedChange}
        onExplorerResizeActiveChange={onResizeActiveChange}
        onExplorerWidthChange={onWidthChange}
      />,
    ));
    await Promise.resolve();
  });
  return container;
}

function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

function requireHandle(container: HTMLElement, selector: string) {
  const handle = container.querySelector<HTMLElement>(selector);
  if (!handle) throw new Error(`Missing resize handle: ${selector}`);
  return handle;
}

function pointerEvent(type: string, clientX: number, pointerId: number) {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    clientX,
    pointerId,
  });
}

function mockAnimationFrames() {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++id, callback); return id; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(frame => { frames.delete(frame); });
  return () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  };
}
