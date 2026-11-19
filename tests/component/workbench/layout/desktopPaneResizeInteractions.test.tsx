/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DataPort } from "../../../../src/shared-ui/core/types";
import { DataWorkspace } from "../../../../src/shared-ui/data/DataWorkspace";
import { ProjectShell } from "../../../../src/components/ProjectShell";
import { AuxiliaryPanelHost } from "../../../../src/features/app-shell/auxiliary/AuxiliaryPanelHost";
import { withTestLocalization } from "../../../support/react/localization";
import { ControlledExplorerWorkspace, mockAnimationFrames, mountRoot, pointerEvent, render, renderWorkspace, requireHandle, root, setUpPaneResize, unmountRoot } from "../../../support/workbench/paneResizeHarness";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
setUpPaneResize();

describe("desktop side-pane resize: the Explorer", () => {
  it("lets only the visible retained workspace publish native window constraints", () => {
    const setWindowMinimumWidth = vi.fn(async ({ width }: { width: number }) => ({ applied: true, width }));
    const previous = window.puppyoneDesktop;
    window.puppyoneDesktop = { ...previous, setWindowMinimumWidth } as NonNullable<typeof window.puppyoneDesktop>;
    const shells = (cloudActive: boolean) => withTestLocalization(<>
      <ProjectShell active={!cloudActive} mainPaneMinWidth={300}><div>Local</div></ProjectShell>
      <ProjectShell active={cloudActive} mainPaneMinWidth={600}><div>Cloud</div></ProjectShell>
    </>);
    render(shells(false));
    expect(setWindowMinimumWidth).toHaveBeenCalledTimes(1);
    const localWidth = setWindowMinimumWidth.mock.calls[0];
    act(() => root!.render(shells(true)));
    expect(setWindowMinimumWidth.mock.calls.at(-1)).not.toEqual(localWidth);
    setWindowMinimumWidth.mockClear();
    act(() => root!.render(shells(false)));
    expect(setWindowMinimumWidth.mock.calls.at(-1)).toEqual(localWidth);
    act(() => unmountRoot());
    window.puppyoneDesktop = previous;
  });

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
        if (reason === "unmount") { unmountRoot(); }
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
    mountRoot(container);

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
    mountRoot(container);
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
});
