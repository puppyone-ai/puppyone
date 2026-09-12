/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";

import { closeActiveMarkdownTableMenu } from "../../../../../../packages/shared-ui/src/editor/markdown/features/table/tableMenuState";

import { createTableView, source, makeHandleCaptureSafe } from "../../../../../support/editor/markdown/tableInteractions";

describe("Markdown table EditorView interactions", () => {

  it("moves a column through the cell context menu", () => {
    const view = createTableView();
    const firstHeader = view.dom.querySelector<HTMLElement>(
      '.cm-md-table-cell-content[data-md-table-row="0"][data-md-table-column="0"]',
    );
    firstHeader?.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 40,
    }));
    const moveRight = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".cm-md-table-context-menu button"),
    ).find((button) => button.textContent?.includes("Move column right"));
    expect(moveRight).not.toBeUndefined();
    expect(() => moveRight?.click()).not.toThrow();
    expect(source(view).split("\n")[0]).toMatch(/^\| B\s+\| A\s+\| C\s+\|$/);
  });

  it("carries the resolved editor theme into the document-level table menu", () => {
    const view = createTableView();
    view.dom.style.setProperty("--po-menu-bg", "rgb(17, 19, 23)");
    view.dom.style.setProperty("--po-menu-border", "rgb(47, 51, 59)");
    view.dom.style.setProperty("--po-text", "rgb(241, 245, 249)");
    view.dom.style.setProperty("color-scheme", "dark");
    const firstHeader = view.dom.querySelector<HTMLElement>(
      '.cm-md-table-cell-content[data-md-table-row="0"][data-md-table-column="0"]',
    );

    firstHeader?.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 40,
    }));

    const menu = document.querySelector<HTMLElement>(".cm-md-table-context-menu");
    expect(menu).not.toBeNull();
    expect(menu?.parentElement).toBe(document.body);
    expect(menu?.style.getPropertyValue("--po-menu-bg")).toBe("rgb(17, 19, 23)");
    expect(menu?.style.getPropertyValue("--po-menu-border")).toBe("rgb(47, 51, 59)");
    expect(menu?.style.getPropertyValue("--po-text")).toBe("rgb(241, 245, 249)");
    expect(menu?.style.getPropertyValue("color-scheme")).toBe("dark");
  });

  it("prefers the host's theme-aware overlay root", () => {
    const overlayRoot = document.createElement("div");
    overlayRoot.dataset.poOverlayRoot = "true";
    document.body.appendChild(overlayRoot);
    const view = createTableView();
    const firstHeader = view.dom.querySelector<HTMLElement>(
      '.cm-md-table-cell-content[data-md-table-row="0"][data-md-table-column="0"]',
    );

    firstHeader?.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 40,
    }));

    expect(document.querySelector(".cm-md-table-context-menu")?.parentElement).toBe(overlayRoot);
  });

  it("provides roving menu focus, typeahead, and Escape focus restoration", () => {
    const view = createTableView();
    const firstBodyCell = view.dom.querySelector<HTMLElement>(
      '.cm-md-table-cell-content[data-md-table-row="1"][data-md-table-column="0"]',
    )!;
    firstBodyCell.focus();

    firstBodyCell.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 0,
      clientY: 0,
    }));

    const menu = document.querySelector<HTMLElement>(".cm-md-table-context-menu")!;
    expect((document.activeElement as HTMLElement | null)?.textContent).toContain("Insert row above");
    expect(firstBodyCell.dataset.mdTableEditing).toBe("true");

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowDown",
    }));
    expect((document.activeElement as HTMLElement | null)?.textContent).toContain("Insert row below");

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "End",
    }));
    expect((document.activeElement as HTMLElement | null)?.textContent).toContain("Delete table");

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "d",
    }));
    expect((document.activeElement as HTMLElement | null)?.textContent).toContain("Duplicate row");

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    }));
    expect(menu.isConnected).toBe(false);
    expect(document.activeElement).toBe(firstBodyCell);
    expect(firstBodyCell.dataset.mdTableEditing).toBe("true");
  });

  it("closes on focus exit without leaving an unfocused cell edit session", async () => {
    const view = createTableView();
    const firstBodyCell = view.dom.querySelector<HTMLElement>(
      '.cm-md-table-cell-content[data-md-table-row="1"][data-md-table-column="0"]',
    )!;
    const outsideButton = document.createElement("button");
    document.body.appendChild(outsideButton);
    firstBodyCell.focus();
    firstBodyCell.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 30,
      clientY: 30,
    }));

    outsideButton.focus();
    await Promise.resolve();

    expect(document.querySelector(".cm-md-table-context-menu")).toBeNull();
    expect(document.activeElement).toBe(outsideButton);
    expect(firstBodyCell.dataset.mdTableEditing).toBeUndefined();
  });

  it("highlights a handle's source column from pointer-down until its menu closes", () => {
    const view = createTableView();
    const table = view.dom.querySelector<HTMLTableElement>(".cm-md-table-widget")!;
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
    const sourceCells = Array.from(table.rows).map((row) => row.cells[1]!);

    headers[1]?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    const handle = view.dom.querySelector<HTMLElement>(".cm-md-table-column-handle")!;
    makeHandleCaptureSafe(handle);
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 21,
    }));

    expect(sourceCells.every((cell) => cell.classList.contains("cm-md-table-drag-source"))).toBe(true);

    handle.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId: 21,
    }));

    expect(document.querySelector(".cm-md-table-context-menu")).not.toBeNull();
    expect(handle.classList.contains("is-menu-active")).toBe(true);
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(handle.getAttribute("aria-controls")).toBe(
      document.querySelector<HTMLElement>(".cm-md-table-context-menu")?.id,
    );
    expect(sourceCells.every((cell) => cell.classList.contains("cm-md-table-drag-source"))).toBe(true);
    const defaultAlignment = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".cm-md-table-context-menu button"),
    ).find((button) => button.textContent?.includes("Default alignment"));
    const alignLeft = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".cm-md-table-context-menu button"),
    ).find((button) => button.textContent?.includes("Align left"));
    expect(defaultAlignment?.getAttribute("role")).toBe("menuitemradio");
    expect(defaultAlignment?.getAttribute("aria-checked")).toBe("true");
    expect(alignLeft?.getAttribute("aria-checked")).toBe("false");
    expect(Array.from(
      document.querySelectorAll<HTMLButtonElement>(".cm-md-table-context-menu button"),
    ).some((button) => button.textContent?.includes("Auto fit column"))).toBe(true);
    expect(Array.from(
      document.querySelectorAll<HTMLButtonElement>(".cm-md-table-context-menu button"),
    ).some((button) => button.textContent?.includes("Fit columns to viewport"))).toBe(true);
    expect(Array.from(
      document.querySelectorAll<HTMLButtonElement>(".cm-md-table-context-menu button"),
    ).some((button) => button.textContent?.includes("Reset column widths"))).toBe(true);

    closeActiveMarkdownTableMenu();
    expect(handle.classList.contains("is-menu-active")).toBe(false);
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    expect(handle.hasAttribute("aria-controls")).toBe(false);
    expect(sourceCells.some((cell) => cell.classList.contains("cm-md-table-drag-source"))).toBe(false);
  });
});
