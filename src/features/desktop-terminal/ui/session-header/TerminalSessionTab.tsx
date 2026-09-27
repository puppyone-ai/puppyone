import {
  memo,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { X } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopMenuIconButton } from "../../../../components/DesktopMenu";
import { TerminalSessionHeaderStatus } from "./TerminalSessionHeaderStatus";
import type { WorkbenchSplitDropEdge } from "@puppyone/shared-ui";
import type { TerminalTabMoveDragController } from "../../interactions/useTerminalTabMoveDrag";
import { useTerminalDerivedDragClickSuppression } from "../../interactions/useTerminalDerivedDragClickSuppression";
import type { TerminalSessionHeaderItem } from "./types";

type TerminalSessionTabProps = {
  active: boolean;
  compact: boolean;
  inlineStart: number;
  index: number;
  item: TerminalSessionHeaderItem;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => void;
  onMoveByKeyboard?: (sessionId: string, edge: WorkbenchSplitDropEdge) => void;
  panelId: (sessionId: string) => string;
  tabId: (sessionId: string) => string;
  tabMove: TerminalTabMoveDragController;
  visibleInGroup: boolean;
  width: number;
};

export const TerminalSessionTab = memo(function TerminalSessionTab({
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
}: TerminalSessionTabProps) {
  const { t } = useLocalization();
  const { presentation, runtime, session } = item;
  const {
    consumeSuppressedClick,
    suppressDerivedDragClick,
  } = useTerminalDerivedDragClickSuppression();

  return (
    <div
      className={`desktop-terminal-tab ${active ? "is-active" : ""} ${visibleInGroup && !active ? "is-visible-group" : ""} ${compact ? "is-compact" : ""}`}
      data-status={session.status}
      data-terminal-tab-group-index={index}
      data-terminal-tab-session-id={session.id}
      data-visible-group={visibleInGroup ? "true" : undefined}
      role="presentation"
      style={{
        "--desktop-terminal-tab-inline-start": `${inlineStart}px`,
        "--desktop-terminal-tab-resolved-width": `${width}px`,
      } as CSSProperties}
    >
      <button
        id={tabId(session.id)}
        type="button"
        className="desktop-terminal-tab-select"
        role="option"
        aria-controls={panelId(session.id)}
        aria-label={presentation.accessibleLabel}
        aria-selected={active}
        aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
        tabIndex={active ? 0 : -1}
        data-tooltip={presentation.accessibleLabel}
        onClick={(event) => {
          if (consumeSuppressedClick()) {
            event.preventDefault();
            return;
          }
          onActivate(session.id);
        }}
        onKeyDown={(event) => {
          const edge = terminalMoveEdgeFromKeyboard(event);
          if (edge && onMoveByKeyboard) {
            event.preventDefault();
            event.stopPropagation();
            onMoveByKeyboard(session.id, edge);
            return;
          }
          onKeyDown(event, index);
        }}
        onPointerDown={(event) => tabMove.start(
          event,
          { kind: "tab", sessionId: session.id },
          presentation.pathLabel,
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
        <TerminalSessionHeaderStatus
          className="desktop-terminal-tab-status"
          runtime={runtime}
          session={session}
        />
        <span className="desktop-terminal-tab-title">{presentation.pathLabel}</span>
      </button>
      <DesktopMenuIconButton
        className="desktop-terminal-tab-close"
        label={t("terminal.closeSession", { title: presentation.sessionTitle })}
        icon={<X size={12} strokeWidth={1.8} aria-hidden="true" />}
        onClick={() => onClose(session.id)}
      />
    </div>
  );
});

function terminalMoveEdgeFromKeyboard(
  event: ReactKeyboardEvent<HTMLButtonElement>,
): WorkbenchSplitDropEdge | null {
  if (!event.altKey || !event.shiftKey) return null;
  if (event.key === "ArrowLeft") return "left";
  if (event.key === "ArrowRight") return "right";
  if (event.key === "ArrowUp") return "top";
  if (event.key === "ArrowDown") return "bottom";
  return null;
}
