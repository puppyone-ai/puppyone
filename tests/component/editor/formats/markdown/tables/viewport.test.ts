/** @vitest-environment happy-dom */

import { redo, undo } from "@codemirror/commands";
import { describe, expect, it, vi } from "vitest";

import { focusMarkdownTableCell } from "../../../../../../packages/shared-ui/src/editor/markdown/features/table/tableFocus";

import { createTableView, source, nextAnimationFrame, rect, mockRect, mockHorizontalScroller } from "../../../../../support/editor/markdown/tableInteractions";

describe("Markdown table EditorView interactions", () => {

  it("keeps the inline viewport session across a structural Widget replacement", async () => {
    const view = createTableView();
    const firstRoot = view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")!;
    const firstViewport = firstRoot.querySelector<HTMLElement>(".cm-md-table-scrollport")!;
    const firstSessionId = firstRoot.dataset.mdInlineViewportSession;
    const firstColumnLayoutSessionId = firstRoot.dataset.mdTableColumnLayoutSession;
    const firstColumnWidths = Array.from(
      firstRoot.querySelectorAll<HTMLTableColElement>("colgroup col"),
      (column) => column.style.width,
    );
    expect(firstSessionId).toBeTruthy();
    expect(firstColumnLayoutSessionId).toBeTruthy();
    expect(firstRoot.dataset.mdTableInlineViewport).toBe("true");
    expect(firstViewport.dataset.poScrollbar).toBe("hidden");
    expect(firstRoot.querySelector("[data-md-table-scroll-track='true']")).not.toBeNull();
    expect(firstRoot.querySelector("[data-md-table-surface='true']")).not.toBeNull();
    expect(firstRoot.querySelector("[data-md-table-scrollbar-rail='true']")).not.toBeNull();
    mockHorizontalScroller(firstViewport, 240, 720);
    firstViewport.scrollLeft = 180;
    firstViewport.dispatchEvent(new Event("scroll"));
    await nextAnimationFrame();

    view.dom.querySelector<HTMLButtonElement>(".cm-md-table-add-column")?.click();
    await nextAnimationFrame();

    const replacementRoot = view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")!;
    expect(replacementRoot).not.toBe(firstRoot);
    expect(replacementRoot.dataset.mdInlineViewportSession).toBe(firstSessionId);
    expect(replacementRoot.dataset.mdTableColumnLayoutSession).toBe(firstColumnLayoutSessionId);
    expect(Array.from(
      replacementRoot.querySelectorAll<HTMLTableColElement>("colgroup col"),
      (column) => column.style.width,
    ).slice(0, firstColumnWidths.length)).toEqual(firstColumnWidths);

    expect(undo(view)).toBe(true);
    await nextAnimationFrame();
    expect(
      view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")?.dataset.mdInlineViewportSession,
    ).toBe(firstSessionId);
    expect(
      view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")?.dataset.mdTableColumnLayoutSession,
    ).toBe(firstColumnLayoutSessionId);

    expect(redo(view)).toBe(true);
    await nextAnimationFrame();
    expect(
      view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")?.dataset.mdInlineViewportSession,
    ).toBe(firstSessionId);
    expect(
      view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")?.dataset.mdTableColumnLayoutSession,
    ).toBe(firstColumnLayoutSessionId);
  });

  it("syncs a reading-rail scrollbar with the wider table viewport", async () => {
    const view = createTableView();
    const root = view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")!;
    const viewport = root.querySelector<HTMLElement>(".cm-md-table-scrollport")!;
    const scrollbar = root.querySelector<HTMLElement>(".cm-md-table-scrollbar-rail")!;
    const scrollbarContent = scrollbar.querySelector<HTMLElement>(
      ".cm-md-table-scrollbar-content",
    )!;
    const table = root.querySelector<HTMLTableElement>(".cm-md-table-widget")!;
    mockHorizontalScroller(viewport, 500, 1500);
    mockHorizontalScroller(scrollbar, 300, 1300);
    mockRect(root, rect(100, 0, 300, 180));
    mockRect(viewport, rect(40, 0, 900, 160));
    mockRect(scrollbar, rect(100, 160, 300, 12));
    mockRect(table, rect(100, 20, 1400, 120));
    for (const row of Array.from(table.rows)) {
      Array.from(row.cells).forEach((cell, index) => {
        mockRect(cell, rect(100 + index * 100, 20, 100, 32));
      });
    }
    await nextAnimationFrame();

    expect(scrollbar.hidden).toBe(false);
    expect(scrollbarContent.style.inlineSize).toBe("1300px");
    scrollbar.scrollLeft = 420;
    scrollbar.dispatchEvent(new Event("scroll"));
    await nextAnimationFrame();
    expect(viewport.scrollLeft).toBeCloseTo(420, 5);

    viewport.scrollLeft = 730;
    viewport.dispatchEvent(new Event("scroll"));
    await nextAnimationFrame();
    expect(scrollbar.scrollLeft).toBeCloseTo(730, 5);
  });

  it("maps viewport lineage through an unrelated edit before the table", async () => {
    const view = createTableView();
    const firstSessionId = view.dom.querySelector<HTMLElement>(
      ".cm-md-table-widget-wrap",
    )?.dataset.mdInlineViewportSession;

    view.dispatch({ changes: { from: 0, insert: "intro\n" } });
    await vi.waitFor(() => {
      expect(
        view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")?.dataset.mdInlineViewportSession,
      ).toBe(firstSessionId);
    });
  });

  it("keeps viewport lineage when a cell commit replaces the table Widget", async () => {
    const view = createTableView();
    const firstSessionId = view.dom.querySelector<HTMLElement>(
      ".cm-md-table-widget-wrap",
    )?.dataset.mdInlineViewportSession;
    const cell = view.dom.querySelector<HTMLElement>(
      '.cm-md-table-cell-content[data-md-table-row="1"][data-md-table-column="1"]',
    )!;
    cell.focus();
    cell.textContent = "updated value";
    cell.dispatchEvent(new InputEvent("input", { bubbles: true }));
    cell.blur();
    await nextAnimationFrame();

    expect(source(view)).toContain("updated value");
    expect(
      view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")?.dataset.mdInlineViewportSession,
    ).toBe(firstSessionId);
  });

  it("does not leak viewport state into an unrelated replacement table", async () => {
    const view = createTableView();
    const firstViewport = view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")!;
    const firstSessionId = firstViewport.dataset.mdInlineViewportSession;
    const replacement = [
      "| X | Y |",
      "| --- | --- |",
      "| seven | eight |",
    ].join("\n");

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: replacement } });
    await nextAnimationFrame();

    const replacementViewport = view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")!;
    expect(replacementViewport.dataset.mdInlineViewportSession).toBeTruthy();
    expect(replacementViewport.dataset.mdInlineViewportSession).not.toBe(firstSessionId);
    expect(replacementViewport.dataset.mdInlineViewportAnchor).toBe("start");
  });

  it("reveals the focused column without scrolling the outer editor horizontally", async () => {
    const view = createTableView();
    const root = view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")!;
    const viewport = root.querySelector<HTMLElement>(".cm-md-table-scrollport")!;
    const table = root.querySelector<HTMLTableElement>(".cm-md-table-widget")!;
    mockHorizontalScroller(viewport, 250, 500);
    mockRect(viewport, rect(0, 0, 250, 160));
    mockRect(table, rect(80, 20, 300, 120));
    for (const row of Array.from(table.rows)) {
      Array.from(row.cells).forEach((cell, index) => {
        mockRect(cell, rect(80 + index * 100, 20, 100, 32));
      });
    }
    const outerScrollLeft = view.scrollDOM.scrollLeft;

    expect(focusMarkdownTableCell(root, { rowIndex: 0, columnIndex: 2 })).toBe(true);
    await nextAnimationFrame();

    expect(viewport.scrollLeft).toBeGreaterThan(0);
    expect(view.scrollDOM.scrollLeft).toBe(outerScrollLeft);
    expect((document.activeElement as HTMLElement | null)?.dataset.mdTableColumn).toBe("2");
  });
});
