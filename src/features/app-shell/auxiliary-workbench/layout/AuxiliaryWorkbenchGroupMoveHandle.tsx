import { memo } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { WorkbenchTabMoveDragController } from "./interactions/useWorkbenchTabMoveDrag";
import { useWorkbenchDerivedDragClickSuppression } from "./interactions/useWorkbenchDerivedDragClickSuppression";

export const AuxiliaryWorkbenchGroupMoveHandle = memo(function AuxiliaryWorkbenchGroupMoveHandle({
  groupId,
  itemId,
  itemIds,
  label,
  itemMove,
  onActivate,
}: Readonly<{
  groupId: string;
  itemId: string;
  itemIds: readonly string[];
  label: string;
  itemMove: WorkbenchTabMoveDragController;
  onActivate: (itemId: string) => void;
}>) {
  const { t } = useLocalization();
  const { consumeSuppressedClick, suppressDerivedDragClick } =
    useWorkbenchDerivedDragClickSuppression();
  const accessibleLabel = t("terminal.split.dragHandle", { title: label });

  return (
    <div className="desktop-terminal-pane-handle-shell">
      <button
        type="button"
        className="desktop-terminal-pane-handle"
        aria-label={accessibleLabel}
        title={accessibleLabel}
        onClick={(event) => {
          if (consumeSuppressedClick()) {
            event.preventDefault();
            return;
          }
          onActivate(itemId);
        }}
        onPointerDown={(event) => itemMove.start(
          event,
          { kind: "group", groupId, sessionIds: itemIds },
          label,
        )}
        onPointerMove={itemMove.move}
        onPointerUp={(event) => {
          if (event.button === 0 && itemMove.end(event) === "drag") {
            suppressDerivedDragClick();
          }
        }}
        onPointerCancel={itemMove.cancel}
        onLostPointerCapture={itemMove.lostCapture}
      >
        <i /><i /><i />
      </button>
    </div>
  );
});
