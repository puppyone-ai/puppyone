/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from "vitest";

import { closeActiveMarkdownTableMenu } from "../../../../../../packages/shared-ui/src/editor/markdown/features/table/tableMenuState";

import { createTableView, source, makeHandleCaptureSafe, mockRect, rect } from "../../../../../support/editor/markdown/tableInteractions";

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

  it("clamps viewport edges using the final layout size rather than the entry-animation rect", () => {
    const view = createTableView();
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(222);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(177);
    view.dom.querySelector<HTMLElement>("tbody .cm-md-table-cell-content")!
      .dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: window.innerWidth - 1, clientY: window.innerHeight - 1,
      }));
    const menu = document.querySelector<HTMLElement>(".cm-md-table-context-menu")!;
    expect(menu.style.left).toBe(`${window.innerWidth - 222 - 8}px`);
    expect(menu.style.top).toBe(`${window.innerHeight - 177 - 8}px`);
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
    const iconButtons = Array.from(menu.querySelectorAll<HTMLButtonElement>(".desktop-menu-item.is-icon"));
    expect(iconButtons.length).toBeGreaterThan(0);
    expect(iconButtons.every((button) => button.querySelector(".po-editable-table-menu-icon"))).toBe(true);
    expect(iconButtons.every((button) => Boolean(button.getAttribute("aria-label")))).toBe(true);
    expect(menu.dataset.tooltipDisabled).toBe("true");
    expect(menu.querySelector("[data-tooltip], [title]")).toBeNull();
    expect(view.dom.querySelector("[data-tooltip], [title]")).toBeNull();
    expect(menu.querySelectorAll(".desktop-menu-section-list.is-icon-toolbar").length).toBeGreaterThan(0);
    expect((document.activeElement as HTMLElement | null)?.textContent).toContain("Insert row above");
    expect(firstBodyCell.dataset.mdTableEditing).toBe("true");

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    }));
    expect((document.activeElement as HTMLElement | null)?.textContent).toContain("Insert row below");

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowDown",
    }));
    expect((document.activeElement as HTMLElement | null)?.textContent).toContain("Duplicate row");

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

  it.each([
    ["---", "Align left"],
    [":---", "Align left"],
    [":---:", "Align center"],
    ["---:", "Align right"],
  ])("reflects %s in exactly three alignment choices without editing on open", (delimiter, expected) => {
    const original = `| A | B |\n| ${delimiter} | --- |\n| one | two |`;
    const view = createTableView(original);
    view.dom.querySelector<HTMLElement>("thead .cm-md-table-cell-content")!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const menu = document.querySelector<HTMLElement>(".cm-md-table-context-menu")!;
    const choices = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    expect(choices.map((button) => button.getAttribute("aria-label")))
      .toEqual(["Align left", "Align center", "Align right"]);
    expect(choices.filter((button) => button.getAttribute("aria-checked") === "true")
      .map((button) => button.getAttribute("aria-label"))).toEqual([expected]);
    expect(source(view)).toBe(original);
    choices[1]!.click();
    expect(source(view).split("\n")[1]).toMatch(/^\|\s*:--+:\s*\|/);
    expect(document.querySelector(".cm-md-table-context-menu")).toBeNull();
  });

  it.each([
    ["Align left", /^\|\s*:--+\s*\|/],
    ["Align center", /^\|\s*:--+:\s*\|/],
    ["Align right", /^\|\s*--+:\s*\|/],
  ])("applies %s through the remaining alignment buttons", (label, delimiterPattern) => {
    const view = createTableView();
    view.dom.querySelector<HTMLElement>("thead .cm-md-table-cell-content")!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const choices = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    choices.find((button) => button.getAttribute("aria-label") === label)!.click();
    expect(source(view).split("\n")[1]).toMatch(delimiterPattern);
    expect(document.querySelector(".cm-md-table-context-menu")).toBeNull();
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

  it("opens a row handle's horizontal toolbar below the visible grip", () => {
    const view = createTableView();
    view.dom.querySelector<HTMLElement>("tbody td")!
      .dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    const handle = view.dom.querySelector<HTMLElement>(".cm-md-table-row-handle")!;
    const visual = handle.querySelector<HTMLElement>(".cm-md-table-drag-handle-visual")!;
    makeHandleCaptureSafe(handle);
    mockRect(visual, rect(92, 134, 14, 22));

    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, button: 0, clientX: 99, clientY: 145, pointerId: 20,
    }));
    handle.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, button: 0, clientX: 99, clientY: 145, pointerId: 20,
    }));

    const menu = document.querySelector<HTMLElement>(".cm-md-table-context-menu")!;
    expect(menu.style.left).toBe("92px");
    expect(menu.style.top).toBe("160px");
    expect(menu.querySelectorAll("button")).toHaveLength(6);
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
    expect(handle.classList.contains("is-pressed")).toBe(true);
    expect(handle.classList.contains("is-dragging")).toBe(false);

    handle.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId: 21,
    }));

    expect(document.querySelector(".cm-md-table-context-menu")).not.toBeNull();
    expect(handle.classList.contains("is-menu-active")).toBe(true);
    expect(handle.classList.contains("is-pressed")).toBe(false);
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(handle.getAttribute("aria-controls")).toBe(
      document.querySelector<HTMLElement>(".cm-md-table-context-menu")?.id,
    );
    expect(sourceCells.every((cell) => cell.classList.contains("cm-md-table-drag-source"))).toBe(true);
    const menu = document.querySelector<HTMLElement>(".cm-md-table-context-menu")!;
    expect(menu.querySelector(".desktop-menu-section-label")).toBeNull();
    expect(Array.from(menu.querySelectorAll('[role="group"]'), (group) => group.getAttribute("aria-label")))
      .toEqual(["Columns", "Alignment"]);
    expect(menu.querySelectorAll("button")).toHaveLength(8);
    expect(Array.from(menu.querySelectorAll('[role="menuitemradio"]'), (button) => ({
      label: button.getAttribute("aria-label"), checked: button.getAttribute("aria-checked"),
    }))).toEqual([
      { label: "Align left", checked: "true" },
      { label: "Align center", checked: "false" },
      { label: "Align right", checked: "false" },
    ]);
    expect(menu.textContent).not.toMatch(/Default alignment|Auto fit column|Fit columns to viewport|Reset column widths/);

    closeActiveMarkdownTableMenu();
    expect(handle.classList.contains("is-menu-active")).toBe(false);
    expect(handle.classList.contains("is-pressed")).toBe(false);
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    expect(handle.hasAttribute("aria-controls")).toBe(false);
    expect(sourceCells.some((cell) => cell.classList.contains("cm-md-table-drag-source"))).toBe(false);
  });
});
