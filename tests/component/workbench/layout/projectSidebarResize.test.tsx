/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectShell } from "../../../../src/components/ProjectShell";
import { withTestLocalization } from "../../../support/react/localization";
import { mockAnimationFrames, pointerEvent, render, requireHandle, setUpPaneResize } from "../../../support/workbench/paneResizeHarness";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
setUpPaneResize();

describe("desktop side-pane resize: the Project sidebar and rail", () => {
  it("previews the expanded Project sidebar width and commits it at gesture end", () => {
    const flushFrames = mockAnimationFrames();
    const onWidthChange = vi.fn();
    const container = render(withTestLocalization(
      <ProjectShell
        leadingRail={<nav>Projects</nav>}
        leadingRailWidth={220}
        leadingRailMinWidth={160}
        leadingRailMaxWidth={360}
        leftSidebarPresent={false}
        resizableLeadingRail
        onLeadingRailWidthChange={onWidthChange}
      >
        <div>Editor</div>
      </ProjectShell>,
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
      <ProjectShell
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
      </ProjectShell>,
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
      <ProjectShell
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
      </ProjectShell>,
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

  it("keeps a click on the compact Project resize edge inert", () => {
    const onCollapsedChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = render(withTestLocalization(
      <ProjectShell
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
      </ProjectShell>,
    ));
    const handle = requireHandle(container, ".desktop-project-switcher-resizer");
    const shell = requireHandle(container, ".desktop-shell");

    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.classList.contains("po-collapsed-pane-edge-handle--inline-start")).toBe(true);
    expect(handle.querySelector(".po-collapsed-pane-edge-glyph")).toBeNull();
    expect(shell.style.getPropertyValue("--desktop-shell-leading-rail-width")).toBe("56px");
    expect(requireHandle(container, ".desktop-shell-leading-rail").style.getPropertyValue("--po-collapsible-pane-content-width")).toBe("220px");

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 56, 17));
      window.dispatchEvent(pointerEvent("pointerup", 56, 17));
    });
    expect(onCollapsedChange).not.toHaveBeenCalled();
    expect(onWidthChange).not.toHaveBeenCalled();
  });

  it("renders the Workspace rail from local expansion preview before committing it", () => {
    const flushFrames = mockAnimationFrames();
    const onCollapsedChange = vi.fn();
    const onWidthChange = vi.fn();
    const container = render(withTestLocalization(
      <ProjectShell
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
      </ProjectShell>,
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
      <ProjectShell
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
      </ProjectShell>,
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
});
