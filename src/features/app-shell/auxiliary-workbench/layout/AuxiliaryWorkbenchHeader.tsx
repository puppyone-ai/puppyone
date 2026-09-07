import { useMemo, type CSSProperties } from "react";
import { Plus } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { WorkbenchSplitDropEdge } from "@puppyone/shared-ui";
import { DesktopMenuIconButton } from "../../../../components/DesktopMenu";
import { WORKBENCH_SESSION_HEADER_METRICS } from "./workbenchSessionHeaderLayout";
import {
  projectWorkbenchGroupInsertionPreview,
  projectWorkbenchTabInsertionPreview,
  type WorkbenchGroupMergeDropIntent,
  type WorkbenchTabInsertDropIntent,
} from "./workbenchTabMove";
import type { WorkbenchTabMoveDragController } from "./interactions/useWorkbenchTabMoveDrag";
import { workbenchPanelId, workbenchTabId } from "./workbenchSessionHeaderIds";
import { useWorkbenchSessionHeaderController } from "./useWorkbenchSessionHeaderController";
import { useWorkbenchSessionHeaderLayout } from "./useWorkbenchSessionHeaderLayout";
import type { AuxiliaryWorkbenchHeaderItem } from "./AuxiliaryWorkbenchHeader.types";
import { AuxiliaryWorkbenchOverflowMenu } from "./AuxiliaryWorkbenchOverflowMenu";
import { AuxiliaryWorkbenchTab } from "./AuxiliaryWorkbenchTab";
import "../../../desktop-terminal/ui/session-header/terminal-session-header.css";

type AuxiliaryWorkbenchHeaderProps = Readonly<{
  activeItemId: string | null;
  dropInsertion?: WorkbenchTabInsertDropIntent | WorkbenchGroupMergeDropIntent | null;
  groupId: string;
  items: readonly AuxiliaryWorkbenchHeaderItem[];
  onActivate: (itemId: string) => void;
  onClose: (itemId: string) => void;
  onCreate: () => void;
  onMoveByKeyboard?: (itemId: string, edge: WorkbenchSplitDropEdge) => void;
  presentedItemIds?: readonly string[];
  tabMove?: WorkbenchTabMoveDragController;
}>;

export function AuxiliaryWorkbenchHeader({
  activeItemId,
  dropInsertion = null,
  groupId,
  items,
  onActivate,
  onClose,
  onCreate,
  onMoveByKeyboard,
  presentedItemIds = [],
  tabMove = INERT_TAB_MOVE,
}: AuxiliaryWorkbenchHeaderProps) {
  const { t } = useLocalization();
  const itemIds = useMemo(() => items.map(({ id }) => id), [items]);
  const insertionPreview = useMemo(() => {
    if (!dropInsertion) return null;
    return dropInsertion.kind === "merge-group"
      ? projectWorkbenchGroupInsertionPreview(
          itemIds,
          dropInsertion.sourceSessionIds,
          dropInsertion.targetIndex,
        )
      : projectWorkbenchTabInsertionPreview(
          itemIds,
          activeItemId,
          dropInsertion.sourceSessionId,
          dropInsertion.targetIndex,
        );
  }, [activeItemId, dropInsertion, itemIds]);
  const layoutItemIds = insertionPreview?.layoutSessionIds ?? itemIds;
  const layoutActiveItemId = insertionPreview?.layoutActiveSessionId ?? activeItemId;
  const presentedItemIdSet = useMemo(
    () => new Set(presentedItemIds),
    [presentedItemIds],
  );
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const itemIndexById = useMemo(
    () => new Map(itemIds.map((itemId, index) => [itemId, index])),
    [itemIds],
  );
  const { capacityRef, layout } = useWorkbenchSessionHeaderLayout(
    layoutItemIds,
    layoutActiveItemId,
    1,
  );
  const controller = useWorkbenchSessionHeaderController({
    activeSessionId: activeItemId,
    motionEligibleSessionIds: layout.visibleSessionIds,
    onActivate,
    sessionIds: itemIds,
    tabId: workbenchTabId,
  });
  const visibleItems = layout.tabBounds
    .map((bounds) => {
      const item = itemById.get(bounds.sessionId);
      return item ? { bounds, item } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const hiddenItems = layout.hiddenSessionIds
    .map((itemId) => itemById.get(itemId))
    .filter((item): item is AuxiliaryWorkbenchHeaderItem => Boolean(item));
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
        "--desktop-terminal-header-gap": `${WORKBENCH_SESSION_HEADER_METRICS.gap}px`,
        "--desktop-terminal-tab-activation-motion": `${WORKBENCH_SESSION_HEADER_METRICS.activationMotionMs}ms`,
        "--desktop-terminal-tab-control-height": `${WORKBENCH_SESSION_HEADER_METRICS.createControl}px`,
        "--desktop-terminal-tab-width": `${WORKBENCH_SESSION_HEADER_METRICS.fullMaximum}px`,
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
          data-terminal-tab-source-index={dropInsertion && dropInsertion.kind === "insert"
            ? itemIndexById.get(dropInsertion.sourceSessionId)
            : undefined}
        >
          <div
            className="desktop-terminal-tabs"
            role="tablist"
            aria-label={t("terminal.title")}
            style={{
              "--desktop-terminal-tabs-resolved-width": `${layout.tabsWidth}px`,
            } as CSSProperties}
          >
            {insertionSlots.map((slot) => (
              <div
                key={slot.sessionId}
                className="desktop-terminal-tab-drop-slot"
                aria-hidden="true"
                style={{
                  "--desktop-terminal-tab-inline-start": `${slot.inlineStart}px`,
                  "--desktop-terminal-tab-resolved-width": `${slot.width}px`,
                } as CSSProperties}
              />
            ))}
            {visibleItems.map(({ bounds, item }) => (
              <AuxiliaryWorkbenchTab
                key={item.id}
                item={item}
                index={itemIndexById.get(item.id) ?? 0}
                active={item.id === activeItemId}
                compact={item.id !== activeItemId && layout.mode !== "full"}
                inlineStart={bounds.inlineStart}
                width={bounds.width}
                onActivate={controller.activate}
                onClose={onClose}
                onKeyDown={controller.handleKeyDown}
                onMoveByKeyboard={onMoveByKeyboard}
                panelId={workbenchPanelId}
                tabId={workbenchTabId}
                tabMove={tabMove}
                visibleInGroup={presentedItemIdSet.has(item.id)}
              />
            ))}
          </div>
          {hiddenItems.length > 0 && (
            <AuxiliaryWorkbenchOverflowMenu
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

const INERT_TAB_MOVE: WorkbenchTabMoveDragController = Object.freeze({
  dragging: false,
  dropIntent: null,
  start: () => undefined,
  move: () => undefined,
  end: () => "press",
  cancel: () => undefined,
  lostCapture: () => undefined,
});
