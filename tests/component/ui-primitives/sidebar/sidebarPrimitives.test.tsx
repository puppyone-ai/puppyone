/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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

  it("turns the same pane-edge handle into a minimal collapsed-edge activator", () => {
    const onCollapsedActivate = vi.fn();
    const container = render(
      <SidebarResizeHandle
        collapsedEdgeSide="inline-start"
        label="Expand project sidebar"
        orientation="vertical"
        paneEdge
        onCollapsedActivate={onCollapsedActivate}
      />,
    );
    const handle = container.querySelector<HTMLElement>('[role="button"]');

    expect(handle?.classList.contains("po-collapsed-pane-edge-handle")).toBe(true);
    expect(handle?.getAttribute("aria-orientation")).toBeNull();
    expect(handle?.querySelector("polyline")?.getAttribute("points")).toBe("1,1 7,7 1,13");

    act(() => handle?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "Enter",
    })));

    expect(onCollapsedActivate).toHaveBeenCalledOnce();
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
});

function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}
