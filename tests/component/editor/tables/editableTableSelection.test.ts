/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { createEditableTableSelection } from "../../../../packages/shared-ui/src/editor/table/editableTableSelection";

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });
function mount() {
  const surface = document.createElement("div");
  surface.innerHTML = "<table><tbody><tr><td>First</td></tr></tbody></table>";
  document.body.append(surface);
  const table = surface.querySelector("table")!;
  const selection = createEditableTableSelection(surface, table);
  cleanups.push(selection.dispose);
  return { surface, table, selection, outline: surface.querySelector<HTMLElement>(".po-editable-table-selection-outline")! };
}
// Mutation observers deliver asynchronously, as they do on virtual-window commits.
const mutations = () => new Promise(resolve => setTimeout(resolve, 0));

describe("editable table structural-selection lifecycle", () => {
  it("tracks semantic targets through DOM replacement, disappearance and remount", async () => {
    const { table, selection, outline } = mount();
    const original = table.rows[0];
    selection.show("row", () => table.rows[0] ?? null);
    expect(outline.hidden).toBe(false);
    table.tBodies[0].innerHTML = "<tr><td>Replacement</td></tr>";
    await mutations();
    expect(original.classList.contains("po-editable-table-selection-target")).toBe(false);
    expect(table.rows[0].classList.contains("po-editable-table-selection-target")).toBe(true);
    table.tBodies[0].replaceChildren();
    await mutations();
    expect(outline.hidden).toBe(true);
    table.tBodies[0].innerHTML = "<tr><td>Remounted</td></tr>";
    await mutations();
    expect(outline.hidden).toBe(false);
  });

  it("keeps independent tables isolated and clearing selection releases the target", () => {
    const first = mount(), second = mount();
    first.selection.show("column", () => first.table.rows[0].cells[0]);
    second.selection.show("row", () => second.table.rows[0]);
    first.selection.clear();
    expect(first.outline.hidden).toBe(true);
    expect(first.table.querySelector(".po-editable-table-selection-target")).toBeNull();
    expect(second.outline.hidden).toBe(false);
    expect(second.outline.dataset.axis).toBe("row");
  });

  it("disconnects on disposal and cannot resurrect an overlay", async () => {
    const { table, surface, selection } = mount();
    const cell = table.rows[0].cells[0];
    selection.show("column", () => cell);
    selection.dispose();
    selection.dispose();
    selection.show("column", () => cell);
    table.tBodies[0].innerHTML = "<tr><td>After disposal</td></tr>";
    await mutations();
    expect(cell.classList.contains("po-editable-table-selection-target")).toBe(false);
    expect(surface.querySelector(".po-editable-table-selection-outline")).toBeNull();
    expect(table.querySelector(".po-editable-table-selection-target")).toBeNull();
  });
});
