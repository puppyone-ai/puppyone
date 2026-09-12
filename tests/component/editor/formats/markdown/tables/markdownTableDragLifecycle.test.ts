/**
 * @vitest-environment happy-dom
 */
import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownTableDragLayer } from "../../../../../../packages/shared-ui/src/editor/markdown/features/table/tableDragLayer";
import { testT } from "../../../../../support/react/localization";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Markdown table drag lifecycle", () => {
  it("removes document and owner listeners when a widget is disposed mid-drag", () => {
    const wrapper = document.createElement("div");
    const surface = document.createElement("div");
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const headerCell = document.createElement("th");
    headerCell.textContent = "Name";
    headerRow.appendChild(headerCell);
    thead.appendChild(headerRow);
    const tbody = document.createElement("tbody");
    const bodyRow = document.createElement("tr");
    const bodyCell = document.createElement("td");
    bodyCell.textContent = "PuppyOne";
    bodyRow.appendChild(bodyCell);
    tbody.appendChild(bodyRow);
    table.append(thead, tbody);
    surface.appendChild(table);
    wrapper.appendChild(surface);
    document.body.appendChild(wrapper);

    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const removeTableListener = vi.spyOn(table, "removeEventListener");
    const removeWrapperListener = vi.spyOn(wrapper, "removeEventListener");
    const stopDragAutoScroll = vi.fn();
    const dragLayer = createMarkdownTableDragLayer({
      alignments: [null],
      columnCount: 1,
      columnLayout: null,
      inlineViewport: {
        dispose: vi.fn(),
        revealColumn: vi.fn(),
        stopDragAutoScroll,
        updateDragAutoScroll: vi.fn(),
      },
      rows: [
        { header: true, cells: [{ from: 0, to: 4, text: "Name" }] },
        { header: false, cells: [{ from: 5, to: 13, text: "PuppyOne" }] },
      ],
      getTableRange: () => ({ from: 0, to: 13 }),
      table,
      view: {
        state: {
          readOnly: false,
          facet: () => ({
            direction: "ltr",
            formatNumber: (value: number | bigint) => String(value),
            locale: "en",
            t: testT,
          }),
        },
      } as unknown as EditorView,
      wrapper,
    });
    surface.appendChild(dragLayer.element);

    headerCell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    const columnHandle = dragLayer.element.querySelector<HTMLButtonElement>(".cm-md-table-column-handle");
    expect(columnHandle).not.toBeNull();
    Object.defineProperties(columnHandle!, {
      hasPointerCapture: { value: () => false },
      setPointerCapture: { value: vi.fn() },
    });
    columnHandle!.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 7,
    }));

    dragLayer.dispose();
    dragLayer.dispose();

    expect(removeDocumentListener.mock.calls.some(([type, , capture]) => (
      type === "keydown" && capture === true
    ))).toBe(true);
    expect(removeTableListener).toHaveBeenCalledWith("pointerover", expect.any(Function));
    expect(removeWrapperListener).toHaveBeenCalledWith("pointerleave", expect.any(Function));
    expect(wrapper.classList.contains("is-table-dragging")).toBe(false);
    expect(stopDragAutoScroll).toHaveBeenCalledOnce();
  });
});
