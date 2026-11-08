/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { AuxiliaryPanelHost } from "../../../../src/features/app-shell/auxiliary/AuxiliaryPanelHost";
import { withTestLocalization } from "../../../support/react/localization";
import { ControlledAuxiliaryPanel, mockAnimationFrames, mountRoot, pointerEvent, render, requireHandle, root, setUpPaneResize, transitionEvent } from "../../../support/workbench/paneResizeHarness";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
setUpPaneResize();

describe("desktop side-pane resize: the right sidebar", () => {
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
    mountRoot(container);

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
