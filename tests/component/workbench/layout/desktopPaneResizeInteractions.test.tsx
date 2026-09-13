/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataPort } from "../../../../packages/shared-ui/src/core/types";
import { DataWorkspace } from "../../../../packages/shared-ui/src/data/DataWorkspace";
import { DesktopCloudShell } from "../../../../src/components/DesktopCloudShell";
import { AuxiliaryPanelHost } from "../../../../src/features/app-shell/auxiliary/AuxiliaryPanelHost";
import { withTestLocalization } from "../../../support/react/localization";

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

  it("temporarily collapses the explorer at half-minimum and restores it within the same drag", async () => {
    const flushFrames = mockAnimationFrames();
    const onCollapsedChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = await renderWorkspace({ onCollapsedChange, onWidthChange });
    const handle = requireHandle(container, ".data-explorer-resizer");
    const explorerLayout = requireHandle(container, ".data-explorer-layout");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 320, 1));
      window.dispatchEvent(pointerEvent("pointermove", 120, 1));
    });
    act(flushFrames);

    const content = requireHandle(container, ".data-content");
    expect(content.dataset.explorerGesture).toBe("collapse-preview");
    expect(content.dataset.explorerCollapsed).toBe("true");
    expect(content.style.getPropertyValue("--data-explorer-width")).toBe("0px");
    expect(container.querySelector(".data-explorer-layout")).toBe(explorerLayout);
    expect(container.querySelector(".data-explorer-collapsed-fill")).toBeNull();
    expect(onCollapsedChange).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", 180, 1));
    });
    act(flushFrames);

    expect(content.dataset.explorerGesture).toBe("expand-preview");
    expect(content.dataset.explorerCollapsed).toBeUndefined();
    expect(content.style.getPropertyValue("--data-explorer-width")).toBe("240px");
    expect(onCollapsedChange).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", 120, 1));
    });
    act(flushFrames);

    expect(content.dataset.explorerGesture).toBe("collapse-preview");
    expect(content.dataset.explorerCollapsed).toBe("true");
    expect(onCollapsedChange).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", 120, 1));
    });
    act(flushFrames);

    expect(onCollapsedChange.mock.calls).toEqual([[true]]);
    expect(onWidthChange).toHaveBeenCalledExactlyOnceWith(240);
  });

  it("reopens the Explorer at minimum width after collapsing it from a wider width", async () => {
    const flushFrames = mockAnimationFrames();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(withTestLocalization(<ControlledExplorerWorkspace />));
      await Promise.resolve();
    });

    const content = requireHandle(container, ".data-content");
    const handle = requireHandle(container, ".data-explorer-resizer");
    expect(content.style.getPropertyValue("--data-explorer-width")).toBe("480px");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 480, 82));
      window.dispatchEvent(pointerEvent("pointermove", 120, 82));
    });
    act(flushFrames);
    expect(content.dataset.explorerGesture).toBe("collapse-preview");

    act(() => window.dispatchEvent(pointerEvent("pointerup", 120, 82)));
    act(flushFrames);
    expect(content.dataset.explorerCollapsed).toBe("true");
    expect(container.querySelector(".controlled-explorer-width")?.textContent).toBe("240");

    act(() => requireHandle(container, ".controlled-explorer-expand").click());
    expect(content.dataset.explorerCollapsed).toBeUndefined();
    expect(content.style.getPropertyValue("--data-explorer-width")).toBe("240px");
  });

  it("follows the pointer down to the explorer minimum before the collapse threshold", async () => {
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

  it("keeps the Explorer divider on its animated frame and preserves content width during collapse", async () => {
    const flushFrames = mockAnimationFrames();
    const dataPort: DataPort = { listChildren: vi.fn(async () => []) };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const renderExplorer = (collapsed: boolean) => withTestLocalization(
      <DataWorkspace
        collapsedExplorerWidth={0}
        dataPort={dataPort}
        enableMarkdownLinkContentIndexing={false}
        explorerCollapsed={collapsed}
        explorerWidth={320}
        maxExplorerWidth={900}
        minExplorerWidth={240}
        resizableExplorer
        showHeader={false}
        workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
        onExplorerCollapsedChange={vi.fn()}
        onExplorerWidthChange={vi.fn()}
      />,
    );

    await act(async () => {
      root?.render(renderExplorer(false));
      await Promise.resolve();
    });

    const content = requireHandle(container, ".data-content");
    const frame = requireHandle(container, ".explorer-column");
    const handle = requireHandle(container, ".data-explorer-resizer");
    expect(handle.parentElement).toBe(frame);
    expect(frame.querySelector(".data-explorer-viewport > .data-explorer-inner")).not.toBeNull();
    expect(frame.style.getPropertyValue("--po-collapsible-pane-content-width")).toBe("320px");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 320, 31));
      window.dispatchEvent(pointerEvent("pointermove", 270, 31));
    });
    act(flushFrames);

    expect(content.style.getPropertyValue("--data-explorer-width")).toBe("270px");
    expect(frame.style.getPropertyValue("--po-collapsible-pane-content-width")).toBe("320px");

    act(() => window.dispatchEvent(pointerEvent("pointercancel", 270, 31)));
    act(flushFrames);

    await act(async () => {
      root?.render(renderExplorer(true));
      await Promise.resolve();
    });

    expect(content.style.getPropertyValue("--data-explorer-width")).toBe("0px");
    expect(frame.style.getPropertyValue("--po-collapsible-pane-content-width")).toBe("320px");
    expect(requireHandle(container, ".data-explorer-resizer").getAttribute("aria-hidden")).toBe("true");
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

  it("keeps the Project sidebar at minimum width after pointer release", () => {
    const flushFrames = mockAnimationFrames();
    const onCollapsedChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = render(withTestLocalization(
      <DesktopCloudShell
        leadingRail={<nav>Projects</nav>}
        leadingRailWidth={220}
        leadingRailMinWidth={160}
        leadingRailMaxWidth={360}
        leadingRailCollapsedWidth={56}
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

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 220, 15));
      window.dispatchEvent(pointerEvent("pointermove", 160, 15));
    });
    act(flushFrames);
    expect(shell.style.getPropertyValue("--desktop-shell-leading-rail-width")).toBe("160px");

    act(() => window.dispatchEvent(pointerEvent("pointerup", 160, 15)));
    act(flushFrames);

    expect(onWidthChange).toHaveBeenCalledExactlyOnceWith(160);
    expect(onCollapsedChange).not.toHaveBeenCalled();
    expect(shell.style.getPropertyValue("--desktop-shell-leading-rail-width")).toBe("160px");
  });

  it("temporarily collapses the Project sidebar at the shared half-minimum threshold", () => {
    const flushFrames = mockAnimationFrames();
    const onCollapsedChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = render(withTestLocalization(
      <DesktopCloudShell
        leadingRail={<nav>Projects</nav>}
        leadingRailWidth={220}
        leadingRailMinWidth={160}
        leadingRailMaxWidth={360}
        leadingRailCollapsedWidth={56}
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
    });
    act(flushFrames);

    expect(requireHandle(container, ".desktop-shell-leading-rail").dataset.paneGesture).toBe("collapse-preview");
    expect(requireHandle(container, ".desktop-shell-leading-rail").dataset.paneCollapsed).toBe("true");
    expect(requireHandle(container, ".desktop-shell").style.getPropertyValue("--desktop-shell-leading-rail-width")).toBe("56px");
    expect(requireHandle(container, ".desktop-shell-leading-rail").style.getPropertyValue("--po-collapsible-pane-content-width")).toBe("220px");
    expect(onCollapsedChange).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(pointerEvent("pointerup", 80, 16)));
    act(flushFrames);

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(onWidthChange).toHaveBeenCalledExactlyOnceWith(160);
  });

  it("expands the compact Project rail from its resize edge by click", () => {
    const onCollapsedChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = render(withTestLocalization(
      <DesktopCloudShell
        leadingRail={<nav>Projects</nav>}
        leadingRailWidth={220}
        leadingRailMinWidth={160}
        leadingRailMaxWidth={360}
        leadingRailCollapsed
        leadingRailCollapsedWidth={56}
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
    expect(shell.style.getPropertyValue("--desktop-shell-leading-rail-width")).toBe("56px");
    expect(requireHandle(container, ".desktop-shell-leading-rail").style.getPropertyValue("--po-collapsible-pane-content-width")).toBe("220px");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 56, 17));
      window.dispatchEvent(pointerEvent("pointerup", 56, 17));
    });
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
    expect(onWidthChange).not.toHaveBeenCalled();
  });

  it("renders the Workspace rail from local expansion preview before committing it", () => {
    const flushFrames = mockAnimationFrames();
    const onCollapsedChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = render(withTestLocalization(
      <DesktopCloudShell
        renderLeadingRail={({ expanded }) => (
          <nav data-preview-expanded={expanded ? "true" : "false"}>Projects</nav>
        )}
        leadingRailWidth={220}
        leadingRailMinWidth={160}
        leadingRailMaxWidth={360}
        leadingRailCollapsed
        leadingRailCollapsedWidth={56}
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

    expect(container.querySelector("nav")?.dataset.previewExpanded).toBe("false");
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 56, 21));
      window.dispatchEvent(pointerEvent("pointermove", 140, 21));
    });
    act(flushFrames);

    expect(container.querySelector("nav")?.dataset.previewExpanded).toBe("true");
    expect(requireHandle(container, ".desktop-shell-leading-rail").style.getPropertyValue("--po-collapsible-pane-content-width")).toBe("220px");
    expect(onCollapsedChange).not.toHaveBeenCalled();
    expect(onWidthChange).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(pointerEvent("pointerup", 140, 21)));
    act(flushFrames);

    expect(onCollapsedChange.mock.calls).toEqual([[false]]);
    expect(onWidthChange.mock.calls).toEqual([[160]]);
  });

  it("hands a compact Project rail drag to direct resize before pointer release", () => {
    const flushFrames = mockAnimationFrames();
    const onCollapsedChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = render(withTestLocalization(
      <DesktopCloudShell
        leadingRail={<nav>Projects</nav>}
        leadingRailWidth={160}
        leadingRailMinWidth={160}
        leadingRailMaxWidth={360}
        leadingRailCollapsed
        leadingRailCollapsedWidth={56}
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
    const frame = requireHandle(container, ".desktop-shell-leading-rail");
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 56, 23));
      window.dispatchEvent(pointerEvent("pointermove", 80, 23));
    });
    act(flushFrames);
    expect(frame.dataset.paneGesture).toBe("expand-preview");

    for (const width of [160, 224, 288, 240]) {
      act(() => window.dispatchEvent(pointerEvent("pointermove", width, 23)));
      act(flushFrames);
      expect(frame.dataset.paneGesture).toBe("resizing");
      expect(frame.style.getPropertyValue("--po-collapsible-pane-frame-width")).toBe(`${width}px`);
      expect(onWidthChange).not.toHaveBeenCalled();
      expect(onCollapsedChange).not.toHaveBeenCalled();
    }
    act(() => window.dispatchEvent(pointerEvent("pointerup", 240, 23)));
    act(flushFrames);
    expect(onWidthChange.mock.calls).toEqual([[240]]);
    expect(onCollapsedChange.mock.calls).toEqual([[false]]);
    expect(frame.style.getPropertyValue("--po-collapsible-pane-frame-width")).toBe("240px");
  });

  it("temporarily collapses the right sidebar before committing on pointerup", () => {
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

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 0, 5));
      window.dispatchEvent(pointerEvent("pointermove", 490, 5));
    });
    act(flushFrames);

    const panel = requireHandle(container, ".desktop-right-sidebar");
    expect(panel.dataset.paneGesture).toBe("collapse-preview");
    expect(panel.dataset.paneCollapsed).toBe("true");
    expect(panel.classList.contains("is-open")).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(pointerEvent("pointerup", 490, 5)));
    act(flushFrames);

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onWidthChange).toHaveBeenCalledExactlyOnceWith(420);

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

  it("follows the pointer down to the right-sidebar minimum, then previews collapse", () => {
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
    expect(panel.style.getPropertyValue("--desktop-right-sidebar-width")).toBe("500px");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 0, 6));
      window.dispatchEvent(pointerEvent("pointermove", 300, 6));
    });
    act(flushFrames);

    expect(panel.style.getPropertyValue("--desktop-right-sidebar-width")).toBe("420px");
    expect(panel.dataset.paneGesture).toBe("collapse-preview");
    expect(panel.dataset.paneCollapsed).toBe("true");
    expect(panel.classList.contains("is-open")).toBe(false);
    expect(onWidthChange).toHaveBeenCalledExactlyOnceWith(500);
    expect(onOpenChange).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", 300, 6));
    });
    act(flushFrames);

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(onWidthChange.mock.calls).toEqual([[500], [420]]);
  });

  it("reveals a closed right sidebar immediately while dragging out and snaps back below half width", () => {
    const flushFrames = mockAnimationFrames();
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
    const panel = requireHandle(container, ".desktop-right-sidebar");
    const panelInner = requireHandle(container, ".desktop-right-sidebar-inner");

    expect(handle.classList.contains("po-collapsed-pane-edge-handle--inline-end")).toBe(true);
    expect(panel.dataset.panePresentation).toBe("collapsed");
    expect(panelInner.hasAttribute("inert")).toBe(true);

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 0, 7));
      window.dispatchEvent(pointerEvent("pointermove", -20, 7));
    });
    act(flushFrames);

    expect(panel.classList.contains("is-open")).toBe(true);
    expect(panelInner.hasAttribute("inert")).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", -20, 7));
    });
    act(flushFrames);

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(panel.classList.contains("is-open")).toBe(false);
    expect(panel.dataset.panePresentation).toBe("collapsing");
    expect(panelInner.hasAttribute("inert")).toBe(false);
  });

  it("commits one collapse when release jitter retreats inside the shared hysteresis", () => {
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
        <div>Agent</div>
      </AuxiliaryPanelHost>,
    ));
    const handle = requireHandle(container, ".desktop-right-sidebar-resizer");
    const panel = requireHandle(container, ".desktop-right-sidebar");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 0, 19));
      window.dispatchEvent(pointerEvent("pointermove", 490, 19));
    });
    act(flushFrames);

    expect(panel.dataset.paneGesture).toBe("collapse-preview");
    expect(panel.dataset.paneCollapsed).toBe("true");
    expect(panel.classList.contains("is-open")).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(pointerEvent("pointerup", 480, 19)));
    act(flushFrames);

    expect(onOpenChange.mock.calls).toEqual([[false]]);
    expect(onWidthChange.mock.calls).toEqual([[420]]);
  });

  it("cancels a stale drag when a newer external visibility command wins", () => {
    const flushFrames = mockAnimationFrames();
    const onOpenChange = vi.fn();
    const container = render(withTestLocalization(
      <ControlledAuxiliaryPanel onOpenChange={onOpenChange} />,
    ));
    const handle = requireHandle(container, ".desktop-right-sidebar-resizer");
    const close = requireHandle(container, ".external-panel-close");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 0, 20));
      window.dispatchEvent(pointerEvent("pointermove", -100, 20));
    });
    act(flushFrames);

    act(() => close.click());
    act(() => window.dispatchEvent(pointerEvent("pointerup", -100, 20)));
    act(flushFrames);

    expect(onOpenChange.mock.calls).toEqual([[false]]);
    expect(requireHandle(container, ".desktop-right-sidebar").classList.contains("is-open")).toBe(false);
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
        {(presentation) => <div data-content-visible={presentation.contentVisible}>
          Text that must never reflow during collapse
        </div>}
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
        {(presentation) => <div data-content-visible={presentation.contentVisible}>
          Text that must never reflow during collapse
        </div>}
      </AuxiliaryPanelHost>,
    )));

    expect(panel.style.getPropertyValue("--desktop-right-sidebar-width")).toBe("560px");
    expect(container.querySelector(".desktop-right-sidebar-viewport .desktop-right-sidebar-inner")).not.toBeNull();
    expect(container.querySelector("[data-content-visible=true]")).not.toBeNull();

    act(() => panel.dispatchEvent(transitionEvent("transitionend", "width")));

    expect(container.querySelector("[data-content-visible=false]")).not.toBeNull();
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

function ControlledExplorerWorkspace() {
  const [collapsed, setCollapsed] = React.useState(false);
  const [width, setWidth] = React.useState(480);
  const dataPort = React.useMemo<DataPort>(() => ({
    listChildren: vi.fn(async () => []),
  }), []);
  return (
    <>
      <button
        className="controlled-explorer-expand"
        type="button"
        onClick={() => setCollapsed(false)}
      >
        Expand
      </button>
      <output className="controlled-explorer-width">{width}</output>
      <DataWorkspace
        collapsedExplorerWidth={0}
        dataPort={dataPort}
        enableMarkdownLinkContentIndexing={false}
        explorerCollapsed={collapsed}
        explorerCollapseThreshold={120}
        explorerWidth={width}
        maxExplorerWidth={900}
        minExplorerWidth={240}
        resizableExplorer
        showHeader={false}
        workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
        onExplorerCollapsedChange={setCollapsed}
        onExplorerWidthChange={setWidth}
      />
    </>
  );
}

function ControlledAuxiliaryPanel({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = React.useState(true);
  const changeOpen = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    setOpen(nextOpen);
  };
  return (
    <>
      <button className="external-panel-close" type="button" onClick={() => changeOpen(false)}>
        Close
      </button>
      <AuxiliaryPanelHost
        collapseThreshold={210}
        maxWidth={900}
        minWidth={420}
        open={open}
        resizable
        width={700}
        onOpenChange={changeOpen}
        onWidthChange={vi.fn()}
      >
        <div>Agent</div>
      </AuxiliaryPanelHost>
    </>
  );
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

function transitionEvent(type: string, propertyName: string) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: propertyName });
  return event;
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
