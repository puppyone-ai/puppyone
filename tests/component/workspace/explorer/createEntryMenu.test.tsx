/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopCreateEntryMenu,
  DesktopNodeActionMenu,
  type DesktopCreateEntryDraft,
  type DesktopNodeActionMenuDraft,
} from "../../../../src/features/data-workspace/nodeActions";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("create entry menu", () => {
  it("marks the Sidebar launcher menu as a full-width floating surface that can open upward", () => {
    const draft = createDraft();
    draft.anchor = {
      ...draft.anchor,
      top: 700,
      bottom: 730,
      right: 284,
      width: 264,
      height: 30,
      placement: "auto-end",
    };
    const container = render(
      <DesktopCreateEntryMenu
        draft={draft}
        mainEntries={["markdown", "csv"]}
        submenuItemKinds={[]}
        onCancel={vi.fn()}
        onSelectKind={vi.fn()}
      />,
    );

    const menu = container.querySelector<HTMLElement>(".desktop-create-entry-menu");
    expect(menu?.dataset.sidebarLauncher).toBe("true");
    expect(menu?.id).toBe("desktop-sidebar-create-menu");
    expect(menu?.style.getPropertyValue("--node-action-menu-width")).toBe("264px");
    expect(Number.parseFloat(menu?.style.getPropertyValue("--node-action-menu-top") ?? ""))
      .toBeLessThan(draft.anchor.top);
  });

  it("renders the draggable submenu node at its configured main-menu position", () => {
    const onSelectKind = vi.fn();
    const container = render(
      <DesktopCreateEntryMenu
        draft={createDraft()}
        mainEntries={["html", "customFiles", "markdown", "csv"]}
        submenuItemKinds={["app", "contextMap", "slides"]}
        onCancel={vi.fn()}
        onSelectKind={onSelectKind}
      />,
    );
    const menu = container.querySelector<HTMLElement>(".desktop-create-entry-menu");
    expect(menu).not.toBeNull();
    expect(readDirectMenuRows(menu)).toEqual([
      "Folder",
      "divider",
      "HTML file",
      "Custom files",
      "Markdown file",
      "CSV file",
    ]);

    expect(container.textContent).not.toContain("Paste");
    expect(container.textContent).not.toContain("Text file");
    expect(container.textContent).not.toContain("JSON file");
    const customMenuWrap = container.querySelector<HTMLElement>(".desktop-create-entry-submenu-wrap");
    const customMenuTrigger = container.querySelector<HTMLButtonElement>(".desktop-create-entry-submenu-trigger");
    expect(customMenuWrap?.dataset.open).toBe("false");
    expect(Array.from(
      container.querySelectorAll(".desktop-create-entry-submenu .desktop-menu-item-label"),
      (label) => label.textContent?.trim(),
    )).toEqual(["PuppyOne app", "Context Map", "Slides"]);

    act(() => customMenuTrigger?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    expect(customMenuWrap?.dataset.open).toBe("true");

    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "CSV file")?.click());
    expect(onSelectKind).toHaveBeenCalledWith("csv");

    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Context Map")?.click());
    expect(onSelectKind).toHaveBeenCalledWith("contextMap");
  });

  it("keeps configured custom types in the submenu without adding hidden defaults", () => {
    const container = render(
      <DesktopCreateEntryMenu
        draft={createDraft()}
        mainEntries={["markdown", "customFiles"]}
        submenuItemKinds={["json"]}
        onCancel={vi.fn()}
        onSelectKind={vi.fn()}
      />,
    );

    expect(readDirectMenuRows(container.querySelector(".desktop-create-entry-menu"))).toEqual([
      "Folder",
      "divider",
      "Markdown file",
      "Custom files",
    ]);
    expect(container.querySelector(
      ".desktop-create-entry-submenu .desktop-menu-item-label",
    )?.textContent?.trim())
      .toBe("JSON file");
    expect(container.textContent).not.toContain("CSV file");
    expect(container.textContent).not.toContain("HTML file");
  });

  it("opens the Custom files submenu away from the nearest viewport edge", () => {
    const draft = createDraft();
    draft.anchor = {
      ...draft.anchor,
      left: 980,
      right: 1004,
    };
    const container = render(
      <DesktopCreateEntryMenu
        draft={draft}
        mainEntries={["markdown", "customFiles"]}
        submenuItemKinds={["contextMap"]}
        onCancel={vi.fn()}
        onSelectKind={vi.fn()}
      />,
    );

    expect(container.querySelector<HTMLElement>(".desktop-create-entry-submenu-wrap")
      ?.dataset.submenuSide).toBe("start");
  });

  it("opens Custom files from focus and returns to its trigger with ArrowLeft", () => {
    const container = render(
      <DesktopCreateEntryMenu
        draft={createDraft()}
        mainEntries={["markdown", "customFiles"]}
        submenuItemKinds={["contextMap"]}
        onCancel={vi.fn()}
        onSelectKind={vi.fn()}
      />,
    );
    const wrap = container.querySelector<HTMLElement>(".desktop-create-entry-submenu-wrap");
    const trigger = container.querySelector<HTMLButtonElement>(".desktop-create-entry-submenu-trigger");
    const customItem = container.querySelector<HTMLButtonElement>(
      ".desktop-create-entry-submenu .desktop-menu-item",
    );

    act(() => trigger?.focus());
    expect(wrap?.dataset.open).toBe("true");

    act(() => {
      customItem?.focus();
      customItem?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(wrap?.dataset.open).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("does not render a divider when Folder is the only configured item", () => {
    const container = render(
      <DesktopCreateEntryMenu
        draft={createDraft()}
        mainEntries={[]}
        submenuItemKinds={[]}
        onCancel={vi.fn()}
        onSelectKind={vi.fn()}
      />,
    );

    expect(container.querySelectorAll(".desktop-menu-separator")).toHaveLength(0);
    expect(container.querySelector(".desktop-create-entry-menu")?.textContent?.trim()).toBe("Folder");
  });

  it("keeps paste available in the folder action menu", () => {
    const container = render(
      <DesktopNodeActionMenu
        draft={nodeActionDraft()}
        canPaste
        onChange={vi.fn()}
        onCancel={vi.fn()}
        onCopy={vi.fn()}
        onCut={vi.fn()}
        onPaste={vi.fn()}
        onDuplicate={vi.fn()}
        onCreateInside={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onOpenInDefaultApp={vi.fn()}
        onRevealInFinder={vi.fn()}
      />,
    );

    const labels = Array.from(
      container.querySelectorAll("button"),
      (button) => button.textContent?.trim() ?? "",
    );
    expect(labels.some((label) => label.startsWith("Paste into folder"))).toBe(true);
    const menu = container.querySelector<HTMLElement>(".desktop-node-action-menu");
    expect(menu?.classList.contains("desktop-sidebar-action-menu")).toBe(true);
    expect(menu?.dataset.menuTone).toBe("quiet");
    expect(menu?.dataset.menuElevation).toBe("compact");
    expect(menu?.dataset.menuTypographySurface).toBe("left-sidebar");
  });
});

function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(element)));
  return container;
}

function readDirectMenuRows(menu: Element | null): Array<string | undefined> {
  return Array.from(menu?.children ?? [], (child) => {
    if (child.classList.contains("desktop-menu-separator")) return "divider";
    return child.querySelector(".desktop-menu-item-label")
      ?.textContent
      ?.trim();
  });
}

function createDraft(): DesktopCreateEntryDraft {
  return {
    parentPath: null,
    anchor: {
      left: 20,
      top: 20,
      right: 44,
      bottom: 44,
      width: 24,
      height: 24,
    },
    error: null,
    creatingKind: null,
    selectedKind: null,
    name: "",
  };
}

function nodeActionDraft(): DesktopNodeActionMenuDraft {
  const node = {
    id: "folder-1",
    name: "Documents",
    path: "Documents",
    type: "folder",
  } as const;
  return {
    node,
    nodes: [node],
    anchor: {
      left: 20,
      top: 20,
      right: 44,
      bottom: 44,
      width: 24,
      height: 24,
    },
    mode: "actions",
    renameNameValue: "Documents",
    renameExtensionValue: "",
    renameFocus: "name",
    error: null,
    operation: null,
  };
}
