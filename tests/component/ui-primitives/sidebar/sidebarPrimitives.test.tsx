/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CollapsiblePaneFrame,
  SidebarIconButton,
  SidebarList,
  SidebarResizeHandle,
  SidebarRoot,
  SidebarRow,
  SidebarScrollArea,
  VirtualSidebarList,
  shouldVirtualizeSidebarList,
} from "@puppyone/shared-ui";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("Sidebar primitives", () => {
  it("owns the frame, viewport, stable content plane, and edge handle as one structure", () => {
    const container = render(
      <CollapsiblePaneFrame
        as="div"
        collapsed
        contentWidth={320}
        side="inline-start"
        viewportClassName="test-viewport"
        contentClassName="test-content"
        resizeHandleProps={{
          label: "Resize test pane",
          orientation: "vertical",
        }}
      >
        <nav>Projects</nav>
      </CollapsiblePaneFrame>,
    );

    const frame = container.querySelector<HTMLElement>(".po-collapsible-pane-frame");
    const viewport = frame?.querySelector<HTMLElement>(":scope > .po-collapsible-pane-viewport");
    const content = viewport?.querySelector<HTMLElement>(":scope > .po-collapsible-pane-content");
    const handle = frame?.querySelector<HTMLElement>(":scope > .po-pane-edge-resize-handle");

    expect(frame?.getAttribute("data-pane-side")).toBe("inline-start");
    expect(frame?.getAttribute("data-pane-collapsed")).toBe("true");
    expect(frame?.getAttribute("data-pane-content-visible")).toBe("false");
    expect(frame?.style.getPropertyValue("--po-collapsible-pane-content-width")).toBe("320px");
    expect(viewport?.classList.contains("test-viewport")).toBe(true);
    expect(content?.classList.contains("test-content")).toBe(true);
    expect(content?.getAttribute("aria-hidden")).toBe("true");
    expect(content?.hasAttribute("inert")).toBe(true);
    expect(handle?.parentElement).toBe(frame);
  });

  it("keeps content fixed and visible until the shared frame-width transition settles", () => {
    let setCollapsed: ((collapsed: boolean) => void) | null = null;

    function Harness() {
      const [collapsed, updateCollapsed] = React.useState(false);
      setCollapsed = updateCollapsed;
      return (
        <CollapsiblePaneFrame
          as="div"
          collapsed={collapsed}
          contentWidth={320}
          frameWidth={collapsed ? 0 : 320}
          side="inline-start"
        >
          {({ contentExpanded, contentVisible }) => (
            <nav
              data-content-expanded={contentExpanded ? "true" : "false"}
              data-content-visible={contentVisible ? "true" : "false"}
            >
              Projects
            </nav>
          )}
        </CollapsiblePaneFrame>
      );
    }

    const container = render(<Harness />);
    const frame = requireElement(container, ".po-collapsible-pane-frame");
    const content = requireElement(container, ".po-collapsible-pane-content");
    const contentPlane = content.firstElementChild as HTMLElement;
    expect(frame.style.getPropertyValue("--po-collapsible-pane-frame-width")).toBe("320px");

    act(() => setCollapsed?.(true));
    expect(frame.dataset.panePresentation).toBe("collapsing");
    expect(frame.style.getPropertyValue("--po-collapsible-pane-frame-width")).toBe("0px");
    expect(content.getAttribute("aria-hidden")).toBeNull();
    expect(contentPlane.dataset.contentExpanded).toBe("true");

    // Reversing a partly completed transition must not flash the content off.
    act(() => setCollapsed?.(false));
    expect(frame.dataset.panePresentation).toBe("expanding");
    expect(content.getAttribute("aria-hidden")).toBeNull();
    expect(contentPlane.dataset.contentVisible).toBe("true");

    act(() => setCollapsed?.(true));
    expect(frame.dataset.panePresentation).toBe("collapsing");
    expect(content.getAttribute("aria-hidden")).toBeNull();

    act(() => frame.dispatchEvent(transitionEvent("transitionend", "width")));
    expect(frame.dataset.panePresentation).toBe("collapsed");
    expect(content.getAttribute("aria-hidden")).toBe("true");
    expect(content.hasAttribute("inert")).toBe(true);
    expect(contentPlane.dataset.contentExpanded).toBe("false");

    act(() => setCollapsed?.(false));
    expect(frame.dataset.panePresentation).toBe("expanding");
    expect(content.getAttribute("aria-hidden")).toBeNull();
    expect(contentPlane.dataset.contentExpanded).toBe("true");
  });

  it("provides one semantic row and icon-action contract", () => {
    const container = render(
      <SidebarRoot aria-label="Project navigation">
        <SidebarScrollArea>
          <SidebarList>
            <SidebarRow active icon={<span>F</span>} label="Files" meta="12" />
            <SidebarIconButton label="Refresh files" icon={<span>R</span>} />
          </SidebarList>
        </SidebarScrollArea>
      </SidebarRoot>,
    );

    const activeRow = container.querySelector<HTMLButtonElement>(".po-sidebar-row");
    expect(activeRow?.getAttribute("aria-current")).toBe("page");
    expect(activeRow?.textContent).toContain("Files");
    expect(container.querySelector('[aria-label="Refresh files"]')).not.toBeNull();
    expect(container.querySelector(".desktop-tool-sidebar")).toBeNull();
  });

  it("normalizes keyboard resize intents and exposes separator bounds", () => {
    const onKeyboardResize = vi.fn();
    const container = render(
      <SidebarResizeHandle
        label="Resize project sidebar"
        orientation="vertical"
        paneEdge
        min={220}
        max={520}
        value={320}
        onKeyboardResize={onKeyboardResize}
      />,
    );
    const handle = container.querySelector<HTMLElement>('[role="separator"]');
    expect(handle?.getAttribute("aria-valuenow")).toBe("320");
    expect(handle?.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle?.classList.contains("po-pane-edge-resize-handle")).toBe(true);

    act(() => handle?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    act(() => handle?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    act(() => handle?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true })));

    expect(onKeyboardResize).toHaveBeenNthCalledWith(1, "increase", false);
    expect(onKeyboardResize).toHaveBeenNthCalledWith(2, "minimum", false);
    expect(onKeyboardResize).toHaveBeenNthCalledWith(3, "decrease", true);
  });

  it("keeps the collapsed pane edge as a resize-only separator", () => {
    const onKeyboardResize = vi.fn();
    const container = render(
      <SidebarResizeHandle
        collapsedEdgeSide="inline-start"
        label="Resize project sidebar"
        orientation="vertical"
        paneEdge
        min={56}
        max={360}
        value={56}
        onKeyboardResize={onKeyboardResize}
      />,
    );
    const handle = container.querySelector<HTMLElement>('[role="separator"]');

    expect(handle?.classList.contains("po-collapsed-pane-edge-handle")).toBe(true);
    expect(handle?.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle?.getAttribute("aria-valuenow")).toBe("56");
    expect(handle?.querySelector(".po-collapsed-pane-edge-glyph")).toBeNull();

    act(() => handle?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "ArrowRight",
    })));

    expect(onKeyboardResize).toHaveBeenCalledExactlyOnceWith("increase", false);
  });

  it("caps mounted rows for scalable lists while keeping native list semantics", () => {
    const items = Array.from({ length: 1_000 }, (_, index) => ({ id: `row-${index}`, label: `Row ${index}` }));
    expect(shouldVirtualizeSidebarList(items.length)).toBe(true);
    const container = render(
      <VirtualSidebarList
        ariaLabel="Large project list"
        items={items}
        rowSize={28}
        maxMountedRows={120}
        getKey={(item) => item.id}
        renderRow={(item) => <button type="button">{item.label}</button>}
      />,
    );

    expect(container.querySelector('ol[aria-label="Large project list"]')).not.toBeNull();
    const mountedRows = container.querySelectorAll("li.po-sidebar-virtual-row");
    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThanOrEqual(120);
    expect(mountedRows.length).toBeLessThan(items.length);
  });

  it("supports variable row geometry without changing list semantics", () => {
    const items = [
      { id: "date", label: "Today", size: 36 },
      { id: "commit", label: "Commit", size: 94 },
    ];
    const container = render(
      <VirtualSidebarList
        ariaLabel="Variable project history"
        items={items}
        rowSize={(item) => item.size}
        getKey={(item) => item.id}
        renderRow={(item) => <button type="button">{item.label}</button>}
      />,
    );

    const rows = container.querySelectorAll<HTMLElement>("li.po-sidebar-virtual-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.style.getPropertyValue("--po-sidebar-virtual-row-size")).toBe("36px");
    expect(rows[1]?.style.getPropertyValue("--po-sidebar-virtual-row-size")).toBe("94px");
  });
});

function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

function requireElement(container: ParentNode, selector: string) {
  const element = container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function transitionEvent(type: string, propertyName: string) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: propertyName });
  return event;
}
