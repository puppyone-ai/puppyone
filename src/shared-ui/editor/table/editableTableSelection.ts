export type EditableTableSelectionAxis = "row" | "column";

/** Shared structural-selection presentation. Format adapters identify the
 * semantic row/column; native CSS anchors own its geometry, including resize
 * and scroll. No text/model state or independent measurement loop lives here. */
export function createEditableTableSelection(surface: HTMLElement, table: HTMLTableElement) {
  const outline = table.ownerDocument.createElement("div");
  outline.className = "po-editable-table-selection-outline";
  outline.setAttribute("aria-hidden", "true");
  outline.hidden = true;
  surface.append(outline);
  let target: HTMLElement | null = null;
  let resolveTarget: (() => HTMLElement | null) | null = null;
  let disposed = false;

  const refresh = () => {
    if (disposed) return;
    const next = resolveTarget?.() ?? null;
    if (target !== next) {
      target?.classList.remove("po-editable-table-selection-target");
      target = next;
      target?.classList.add("po-editable-table-selection-target");
    }
    outline.hidden = !target || !table.contains(target);
  };
  // Virtual row/column replacement can change the target DOM without changing
  // its semantic identity. Attribute/style updates cannot retrigger this hook.
  const observer = new MutationObserver(refresh);
  observer.observe(table, { childList: true, subtree: true });
  return {
    show(axis: EditableTableSelectionAxis, resolve: () => HTMLElement | null) {
      if (disposed) return;
      outline.dataset.axis = axis;
      resolveTarget = resolve;
      refresh();
    },
    clear() {
      resolveTarget = null;
      refresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      target?.classList.remove("po-editable-table-selection-target");
      target = null;
      resolveTarget = null;
      outline.remove();
    },
  };
}
