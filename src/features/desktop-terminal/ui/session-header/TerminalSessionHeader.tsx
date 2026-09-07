import { useMemo, type CSSProperties } from "react";
import { Plus } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { WorkbenchSplitDropEdge } from "@puppyone/shared-ui";
import { DesktopMenuIconButton } from "../../../../components/DesktopMenu";
import { presentTerminalSessionHeader } from "../../model/terminalSessionHeader";
import { TERMINAL_SESSION_HEADER_METRICS } from "../../model/terminalSessionHeaderLayout";
import type { DesktopTerminalSessionSummary } from "../../model/terminalSessions";
import {
  projectTerminalGroupInsertionPreview,
  projectTerminalTabInsertionPreview,
  type TerminalGroupMergeDropIntent,
  type TerminalTabInsertDropIntent,
} from "../../model/terminalTabMove";
import type { TerminalTabMoveDragController } from "../../interactions/useTerminalTabMoveDrag";
import type { TerminalRuntimeLookup } from "../../runtime/TerminalRuntimeLookup";
import { TerminalSessionOverflowMenu } from "./TerminalSessionOverflowMenu";
import { TerminalSessionTab } from "./TerminalSessionTab";
import { terminalPanelId, terminalTabId } from "./terminalSessionHeaderIds";
import type { TerminalSessionHeaderItem } from "./types";
import { useTerminalSessionHeaderController } from "./useTerminalSessionHeaderController";
import { useTerminalSessionHeaderLayout } from "./useTerminalSessionHeaderLayout";
import "./terminal-session-header.css";

type TerminalSessionHeaderProps = {
  activeSessionId: string | null;
  dropInsertion?: TerminalTabInsertDropIntent | TerminalGroupMergeDropIntent | null;
  groupId?: string;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onCreate: () => void;
  onMoveByKeyboard?: (sessionId: string, edge: WorkbenchSplitDropEdge) => void;
  presentedSessionIds?: readonly string[];
  runtimeRegistry?: Pick<TerminalRuntimeLookup, "require">;
  sessions: readonly DesktopTerminalSessionSummary[];
  tabMove?: TerminalTabMoveDragController;
  workspacePath: string;
};

/**
 * Shared session chrome. Capacity measurement, density projection, navigation,
 * motion, tabs and overflow all terminate at this boundary.
 */
export function TerminalSessionHeader({
  activeSessionId,
  dropInsertion = null,
  groupId = "terminal-group",
  onActivate,
  onClose,
  onCreate,
  onMoveByKeyboard,
  presentedSessionIds = [],
  runtimeRegistry,
  sessions,
  tabMove = INERT_TAB_MOVE,
  workspacePath,
}: TerminalSessionHeaderProps) {
  const { t } = useLocalization();
  const sessionIds = useMemo(() => sessions.map(({ id }) => id), [sessions]);
  const insertionPreview = useMemo(() => {
    if (!dropInsertion) return null;
    return dropInsertion.kind === "merge-group"
      ? projectTerminalGroupInsertionPreview(
          sessionIds,
          dropInsertion.sourceSessionIds,
          dropInsertion.targetIndex,
        )
      : projectTerminalTabInsertionPreview(
          sessionIds,
          activeSessionId,
          dropInsertion.sourceSessionId,
          dropInsertion.targetIndex,
        );
  }, [activeSessionId, dropInsertion, sessionIds]);
  const layoutSessionIds = insertionPreview?.layoutSessionIds ?? sessionIds;
  const layoutActiveSessionId = insertionPreview?.layoutActiveSessionId
    ?? activeSessionId;
  const presentedSessionIdSet = useMemo(
    () => new Set(presentedSessionIds),
    [presentedSessionIds],
  );
  const items = useMemo<TerminalSessionHeaderItem[]>(() => sessions.map((session) => ({
    presentation: presentTerminalSessionHeader(session, workspacePath, t),
    runtime: session.status === "selecting"
      ? null
      : runtimeRegistry?.require(session.id) ?? null,
    session,
  })), [runtimeRegistry, sessions, t, workspacePath]);
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.session.id, item])),
    [items],
  );
  const sessionIndexById = useMemo(
    () => new Map(sessionIds.map((sessionId, index) => [sessionId, index])),
    [sessionIds],
  );
  const { capacityRef, layout } = useTerminalSessionHeaderLayout(
    layoutSessionIds,
    layoutActiveSessionId,
    1,
  );
  const controller = useTerminalSessionHeaderController({
    activeSessionId,
    motionEligibleSessionIds: layout.visibleSessionIds,
    onActivate,
    sessionIds,
    tabId: terminalTabId,
  });
  const visibleItems = layout.tabBounds
    .map((bounds) => {
      const item = itemById.get(bounds.sessionId);
      return item ? { bounds, item } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const hiddenItems = layout.hiddenSessionIds
    .map((sessionId) => itemById.get(sessionId))
    .filter((item): item is TerminalSessionHeaderItem => Boolean(item));
  const insertionSlots = insertionPreview
    ? layout.tabBounds.filter(({ sessionId }) => (
        insertionPreview.placeholderSessionIds.includes(sessionId)
      ))
    : [];

  return (
    <header
      className="desktop-terminal-subheader"
      data-window-no-drag="true"
      style={{
        "--desktop-terminal-header-gap": `${TERMINAL_SESSION_HEADER_METRICS.gap}px`,
        "--desktop-terminal-tab-activation-motion": `${TERMINAL_SESSION_HEADER_METRICS.activationMotionMs}ms`,
        "--desktop-terminal-tab-control-height": `${TERMINAL_SESSION_HEADER_METRICS.createControl}px`,
        "--desktop-terminal-tab-width": `${TERMINAL_SESSION_HEADER_METRICS.fullMaximum}px`,
      } as CSSProperties}
    >
      <div className="desktop-terminal-header-capacity" ref={capacityRef}>
        <div
          className="desktop-terminal-tab-rail"
          data-layout={layout.mode}
          data-activation-motion={controller.activationMotionActive && !tabMove.dragging ? "true" : undefined}
          data-tab-dragging={tabMove.dragging ? "true" : undefined}
          data-tab-insertion={dropInsertion ? "true" : undefined}
          data-tab-insertion-allowed={dropInsertion?.allowed ? "true" : undefined}
          data-terminal-tab-bar-group-id={groupId}
          data-terminal-tab-source-index={dropInsertion
            && dropInsertion.kind === "insert"
            ? sessionIndexById.get(dropInsertion.sourceSessionId)
            : undefined}
        >
          <div
            className="desktop-terminal-tabs"
            role="listbox"
            aria-label={t("terminal.title")}
            style={{
              "--desktop-terminal-tabs-resolved-width": `${layout.tabsWidth}px`,
            } as CSSProperties}
          >
            {insertionSlots.map((insertionSlot) => (
              <div
                key={insertionSlot.sessionId}
                className="desktop-terminal-tab-drop-slot"
                aria-hidden="true"
                style={{
                  "--desktop-terminal-tab-inline-start": `${insertionSlot.inlineStart}px`,
                  "--desktop-terminal-tab-resolved-width": `${insertionSlot.width}px`,
                } as CSSProperties}
              />
            ))}
            {visibleItems.map(({ bounds, item }) => {
              const { session } = item;
              const active = session.id === activeSessionId;
              return (
                <TerminalSessionTab
                  key={session.id}
                  item={item}
                  index={sessionIndexById.get(session.id) ?? 0}
                  active={active}
                  compact={!active && layout.mode !== "full"}
                  inlineStart={bounds.inlineStart}
                  width={bounds.width}
                  onActivate={controller.activate}
                  onClose={onClose}
                  onKeyDown={controller.handleKeyDown}
                  onMoveByKeyboard={onMoveByKeyboard}
                  panelId={terminalPanelId}
                  tabId={terminalTabId}
                  tabMove={tabMove}
                  visibleInGroup={presentedSessionIdSet.has(session.id)}
                />
              );
            })}
          </div>
          {hiddenItems.length > 0 && (
            <TerminalSessionOverflowMenu
              items={hiddenItems}
              onActivate={controller.activate}
              onClose={onClose}
            />
          )}
          <DesktopMenuIconButton
            className="desktop-terminal-new-button"
            label={t("terminal.new")}
            icon={<Plus size={14} strokeWidth={1.9} aria-hidden="true" />}
            onClick={onCreate}
          />
        </div>
      </div>
    </header>
  );
}

const INERT_TAB_MOVE: TerminalTabMoveDragController = Object.freeze({
  dragging: false,
  dropIntent: null,
  start: () => undefined,
  move: () => undefined,
  end: () => "press",
  cancel: () => undefined,
  lostCapture: () => undefined,
});
