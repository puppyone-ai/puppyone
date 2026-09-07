import {
  memo,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { X } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { WorkbenchSplitDropEdge } from "@puppyone/shared-ui";
import { DesktopMenuIconButton } from "../../../../components/DesktopMenu";
import type { WorkbenchTabMoveDragController } from "./interactions/useWorkbenchTabMoveDrag";
import { useWorkbenchDerivedDragClickSuppression } from "./interactions/useWorkbenchDerivedDragClickSuppression";
import type { AuxiliaryWorkbenchHeaderItem } from "./AuxiliaryWorkbenchHeader.types";
import { AuxiliaryWorkbenchStatus } from "./AuxiliaryWorkbenchStatus";

type AuxiliaryWorkbenchTabProps = Readonly<{
  active: boolean;
  compact: boolean;
  inlineStart: number;
  index: number;
  item: AuxiliaryWorkbenchHeaderItem;
  onActivate: (itemId: string) => void;
  onClose: (itemId: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => void;
  onMoveByKeyboard?: (itemId: string, edge: WorkbenchSplitDropEdge) => void;
  panelId: (itemId: string) => string;
  tabId: (itemId: string) => string;
  tabMove: WorkbenchTabMoveDragController;
  visibleInGroup: boolean;
  width: number;
}>;

export const AuxiliaryWorkbenchTab = memo(function AuxiliaryWorkbenchTab({
  active,
  compact,
  inlineStart,
  index,
  item,
  onActivate,
  onClose,
  onKeyDown,
  onMoveByKeyboard,
  panelId,
  tabId,
  tabMove,
  visibleInGroup,
  width,
}: AuxiliaryWorkbenchTabProps) {
  const { t } = useLocalization();
  const { consumeSuppressedClick, suppressDerivedDragClick } =
    useWorkbenchDerivedDragClickSuppression();

  return (
    <div
      className={`desktop-terminal-tab ${active ? "is-active" : ""} ${visibleInGroup && !active ? "is-visible-group" : ""} ${compact ? "is-compact" : ""}`}
      data-item-kind={item.kind}
      data-status={item.snapshot.status}
      data-terminal-tab-group-index={index}
      data-terminal-tab-session-id={item.id}
      data-visible-group={visibleInGroup ? "true" : undefined}
      role="presentation"
      style={{
        "--desktop-terminal-tab-inline-start": `${inlineStart}px`,
        "--desktop-terminal-tab-resolved-width": `${width}px`,
      } as CSSProperties}
    >
      <button
        id={tabId(item.id)}
        type="button"
        className="desktop-terminal-tab-select"
        role="tab"
        aria-controls={panelId(item.id)}
        aria-label={item.snapshot.accessibleLabel}
        aria-selected={active}
        aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
        tabIndex={active ? 0 : -1}
        title={item.snapshot.accessibleLabel}
        onClick={(event) => {
          if (consumeSuppressedClick()) {
            event.preventDefault();
            return;
          }
          onActivate(item.id);
        }}
        onKeyDown={(event) => {
          const edge = moveEdgeFromKeyboard(event);
          if (edge && onMoveByKeyboard) {
            event.preventDefault();
            event.stopPropagation();
            onMoveByKeyboard(item.id, edge);
            return;
          }
          onKeyDown(event, index);
        }}
        onPointerDown={(event) => tabMove.start(
          event,
          { kind: "tab", sessionId: item.id },
          item.snapshot.title,
        )}
        onPointerMove={tabMove.move}
        onPointerUp={(event) => {
          if (event.button === 0 && tabMove.end(event) === "drag") {
            suppressDerivedDragClick();
          }
        }}
        onPointerCancel={tabMove.cancel}
        onLostPointerCapture={tabMove.lostCapture}
      >
        <AuxiliaryWorkbenchStatus className="desktop-terminal-tab-status" item={item} />
        <span className="desktop-terminal-tab-title">{item.snapshot.title}</span>
      </button>
      <DesktopMenuIconButton
        className="desktop-terminal-tab-close"
        label={t("terminal.closeSession", { title: item.snapshot.title })}
        icon={<X size={12} strokeWidth={1.8} aria-hidden="true" />}
        onClick={() => onClose(item.id)}
      />
    </div>
  );
});

function moveEdgeFromKeyboard(
  event: ReactKeyboardEvent<HTMLButtonElement>,
): WorkbenchSplitDropEdge | null {
  if (!event.altKey || !event.shiftKey) return null;
  if (event.key === "ArrowLeft") return "left";
  if (event.key === "ArrowRight") return "right";
  if (event.key === "ArrowUp") return "top";
  if (event.key === "ArrowDown") return "bottom";
  return null;
}
