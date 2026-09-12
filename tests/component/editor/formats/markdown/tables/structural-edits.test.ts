/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";

import { TABLE_SOURCE, createTableView, source, nextAnimationFrame } from "../../../../../support/editor/markdown/tableInteractions";

describe("Markdown table EditorView interactions", () => {

  it("adds rows and columns and restores logical focus after the view update", async () => {
    const view = createTableView();
    const addRow = view.dom.querySelector<HTMLButtonElement>(".cm-md-table-add-row");
    expect(addRow).not.toBeNull();
    const addRowVisual = addRow?.querySelector<HTMLElement>(".cm-md-table-structure-button-visual");
    expect(addRowVisual).not.toBeNull();
    expect(addRowVisual?.textContent).toBe("");
    expect(addRowVisual?.classList.contains("po-editable-table-structure-button-visual")).toBe(true);
    expect(addRowVisual?.getAttribute("aria-hidden")).toBe("true");
    expect(() => addRow?.click()).not.toThrow();
    expect(source(view).split("\n")).toHaveLength(5);
    await nextAnimationFrame();
    expect((document.activeElement as HTMLElement | null)?.dataset.mdTableRow).toBe("3");
    expect((document.activeElement as HTMLElement | null)?.dataset.mdTableColumn).toBe("0");

    const addColumn = view.dom.querySelector<HTMLButtonElement>(".cm-md-table-add-column");
    expect(addColumn).not.toBeNull();
    expect(() => addColumn?.click()).not.toThrow();
    expect(source(view).split("\n")[0]?.match(/\|/g)).toHaveLength(5);
    await nextAnimationFrame();
    expect((document.activeElement as HTMLElement | null)?.dataset.mdTableRow).toBe("0");
    expect((document.activeElement as HTMLElement | null)?.dataset.mdTableColumn).toBe("3");
  });

  it("targets the current table range after an earlier edit outside its projection patch", () => {
    const prefix = [
      "Top",
      "",
      "Paragraph one",
      "Paragraph two",
      "Paragraph three",
      "",
    ].join("\n");
    const view = createTableView(`${prefix}${TABLE_SOURCE}\nOutro`);
    const tableBeforeEdit = view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap");
    if (!tableBeforeEdit) throw new Error("Table did not mount before the edit");

    view.dispatch({
      changes: {
        from: view.state.doc.line(2).to,
        insert: "\nInserted before the table",
      },
    });

    const tableAfterEdit = view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap");
    expect(tableAfterEdit).toBe(tableBeforeEdit);
    tableAfterEdit?.querySelector<HTMLButtonElement>(".cm-md-table-add-row")?.click();

    expect(source(view)).toContain("Paragraph two");
    expect(source(view)).toMatch(/\| four \| five \| six\s+\|\n\|\s+\|\s+\|\s+\|\nOutro/);
  });

  it("commits a cell to the current table range after an earlier mapped edit", () => {
    const prefix = [
      "Top",
      "",
      "Paragraph one",
      "Paragraph two",
      "Paragraph three",
      "",
    ].join("\n");
    const view = createTableView(`${prefix}${TABLE_SOURCE}\nOutro`);
    const tableBeforeEdit = view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap");
    if (!tableBeforeEdit) throw new Error("Table did not mount before the edit");

    view.dispatch({
      changes: {
        from: view.state.doc.line(2).to,
        insert: "\nInserted before the table",
      },
    });

    const tableAfterEdit = view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap");
    expect(tableAfterEdit).toBe(tableBeforeEdit);
    const firstBodyCell = tableAfterEdit?.querySelector<HTMLElement>(
      '.cm-md-table-cell-content[data-md-table-row="1"][data-md-table-column="0"]',
    );
    if (!firstBodyCell) throw new Error("Editable table cell did not mount");
    firstBodyCell.focus();
    firstBodyCell.textContent = "updated";
    firstBodyCell.dispatchEvent(new InputEvent("input", { bubbles: true }));
    firstBodyCell.blur();

    expect(source(view)).toContain("Paragraph two");
    expect(source(view)).toContain("| updated | two | three |");
  });
});
