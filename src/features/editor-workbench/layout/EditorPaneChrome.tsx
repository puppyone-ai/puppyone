import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useLocalization } from "@puppyone/localization";
import { Tooltip, OverflowDots } from "@puppyone/shared-ui";
import type {
  EditorFindCommand,
  EditorPaneLayoutLeaf,
  EditorPaneMenuContribution,
  EditorPaneSplitOptions,
  EditorSplitDirection,
} from "@puppyone/shared-ui";
import type { PaneMoveDragController } from "../drag-and-drop/usePaneMoveDrag";
import { EditorPaneActionsMenu } from "./EditorPaneActionsMenu";

export type EditorPaneChromeProps = Readonly<{
  actionsOpen: boolean;
  editorLabel: string | null;
  findCommand: EditorFindCommand | null;
  menuContribution: EditorPaneMenuContribution | null;
  pane: EditorPaneLayoutLeaf;
  paneCount: number;
  paneMove: PaneMoveDragController;
  paneRef: RefObject<HTMLElement | null>;
  onActionsPaneChange: (paneId: string | null) => void;
  onClose: () => void;
  onOpenExternal: (() => void | Promise<void>) | null;
  onSplit: (
    direction: EditorSplitDirection,
    placement: NonNullable<EditorPaneSplitOptions["placement"]>,
  ) => void;
}>;

/**
 * Pane-owned interaction chrome. The document runtime never owns menu or drag
 * state, and the floating menu is rendered outside the pane clipping tree.
 */
export function EditorPaneChrome({
  actionsOpen,
  editorLabel,
  findCommand,
  menuContribution,
  pane,
  paneCount,
  paneMove,
  paneRef,
  onActionsPaneChange,
  onClose,
  onOpenExternal,
  onSplit,
}: EditorPaneChromeProps) {
  const { t } = useLocalization();
  const handleRef = useRef<HTMLButtonElement>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);
  const canMovePane = paneCount > 1;
  const showPaneHandle = Boolean(editorLabel) || canMovePane;
  const handleLabel = canMovePane
    ? t("editor.panes.dragToMove")
    : editorLabel
      ? t("editor.panes.actionsFor", { name: editorLabel })
      : t("editor.panes.actions");
  const closeMenu = useCallback(
    () => onActionsPaneChange(null),
    [onActionsPaneChange],
  );
  const toggleMenu = useCallback(
    () => onActionsPaneChange(actionsOpen ? null : pane.id),
    [actionsOpen, onActionsPaneChange, pane.id],
  );

  const clearClickSuppression = useCallback(() => {
    suppressClickRef.current = false;
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = null;
    }
  }, []);

  const suppressDerivedDragClick = useCallback(() => {
    clearClickSuppression();
    suppressClickRef.current = true;
    // The browser-generated click follows pointerup in the same interaction
    // cycle. Expire at the next task so a missing click can never poison a
    // later, intentional menu press.
    suppressClickTimerRef.current = window.setTimeout(clearClickSuppression, 0);
  }, [clearClickSuppression]);

  useEffect(() => clearClickSuppression, [clearClickSuppression]);

  if (!showPaneHandle) return null;

  return (
    <>
      <div className="desktop-editor-pane-handle-shell">
        <Tooltip content={handleLabel}><button
          ref={handleRef}
          className="desktop-editor-pane-handle"
          type="button"
          aria-label={handleLabel}
          aria-haspopup="menu"
          aria-expanded={actionsOpen}
          onPointerEnter={() => {
            if (canMovePane && paneRef.current) paneMove.prepare(paneRef.current, pane.id);
          }}
          onClick={() => {
            if (suppressClickRef.current) {
              clearClickSuppression();
              return;
            }
            toggleMenu();
          }}
          onPointerDown={(event) => {
            if (event.button === 0 && canMovePane) paneMove.start(event, pane);
          }}
          onPointerMove={paneMove.move}
          onPointerUp={(event) => {
            if (event.button !== 0) return;
            if (canMovePane && paneMove.end(event) === "drag") {
              suppressDerivedDragClick();
            }
          }}
          onPointerCancel={paneMove.cancel}
          onLostPointerCapture={paneMove.lostCapture}
                                       >
          <OverflowDots />
        </button></Tooltip>
      </div>
      <EditorPaneActionsMenu
        anchorRef={handleRef}
        editorLabel={editorLabel}
        findCommand={findCommand}
        menuContribution={menuContribution}
        open={actionsOpen}
        onCloseMenu={closeMenu}
        onClosePane={onClose}
        onOpenExternal={onOpenExternal}
        onSplit={onSplit}
      />
    </>
  );
}
