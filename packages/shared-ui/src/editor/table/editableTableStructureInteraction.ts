import type { EditableTableSelectionAxis } from "./editableTableSelection";

/** Reordering selects the moved structure, independently of its input method.
 * The format transaction owns the destination; cell editing is a separate
 * interaction and must not be requested implicitly by a move command. */
export function getEditableTableMoveAxis(
  operation: Readonly<{ type: string }>,
): EditableTableSelectionAxis | null {
  switch (operation.type) {
    case "move-row-up":
    case "move-row-down":
    case "move-row-to":
      return "row";
    case "move-column-left":
    case "move-column-right":
    case "move-column-to":
      return "column";
    default:
      return null;
  }
}
