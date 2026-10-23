import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocalization } from "@puppyone/localization/react";
import {
  FloatingNotice,
  FloatingNoticeAction,
  FloatingNoticeStack,
  PulseGridLoader,
  useDismissibleNotice,
  type WorkbenchSplitDropEdge,
  type WorkbenchSplitMinimumSize,
} from "@puppyone/shared-ui";
import type { AuxiliaryWorkbenchCloseContext, AuxiliaryWorkbenchContribution, AuxiliaryWorkbenchItemRenderContext, AuxiliaryWorkbenchItemSnapshot } from "./types";
import { LAUNCHER_ITEM_KIND, type ProjectWorkbenchStore } from "./ProjectWorkbenchStore";
import { useAuxiliaryWorkbench } from "./useAuxiliaryWorkbench";
import { useAuxiliaryWorkbenchCloseCoordinator } from "./useAuxiliaryWorkbenchCloseCoordinator";
import { AuxiliaryWorkbenchCloseDialog } from "./AuxiliaryWorkbenchCloseDialog";
import { AuxiliaryWorkbenchViewport } from "./layout/AuxiliaryWorkbenchViewport";
import { AuxiliaryWorkbenchCreationFailure } from "./layout/AuxiliaryWorkbenchCreationFailure";
import { AuxiliaryWorkbenchRenderBoundary, AuxiliaryWorkbenchStatusBoundary } from "./layout/AuxiliaryWorkbenchRenderBoundary";
import { usePersistentWorkbenchItemHosts } from "./layout/usePersistentWorkbenchItemHosts";
import { useWorkbenchTabMoveDrag } from "./layout/interactions/useWorkbenchTabMoveDrag";
import { canPlaceWorkbenchSplit } from "./layout/workbenchSplitConstraints";

export type WorkbenchLauncherContext = { groupId: string | null; itemId: string | null; presented: boolean };
export function AuxiliaryWorkbenchPanel({ store, contributions, active, renderLauncher, onRetryProjectClose, titlebarTabHost, onReveal }: {
  store: ProjectWorkbenchStore;
  contributions: readonly AuxiliaryWorkbenchContribution[];
  active: boolean;
  titlebarTabHost?: HTMLDivElement | null;
  onReveal?: () => void;
  onRetryProjectClose?: () => void;
  renderLauncher(context: WorkbenchLauncherContext): ReactNode;
}) {
  const { t } = useLocalization();
  const panel = useRef<HTMLElement>(null);
  store.configure(contributions);
  const workbench = useAuxiliaryWorkbench(store);
  const [focusIntent, setFocusIntent] = useState({ itemId: "", revision: 0 });
  const activateAndFocus = useCallback((id: string) => {
    store.dispatch({ type: "activate", itemId: id });
    setFocusIntent((current) => ({ itemId: id, revision: current.revision + 1 }));
    if (titlebarTabHost) onReveal?.();
  }, [store, titlebarTabHost, onReveal]);
  const previousItems = useRef(new Set(workbench.items.map((item) => item.id)));
  useEffect(() => {
    const id = workbench.activeItemId;
    if (active && id && !previousItems.current.has(id)) activateAndFocus(id);
    previousItems.current = new Set(workbench.items.map((item) => item.id));
  }, [active, workbench.items, workbench.activeItemId, activateAndFocus]);
  const byKind = useMemo(() => new Map(contributions.map((entry) => [entry.kind, entry])), [contributions]);
  const itemIds = useMemo(() => workbench.items.map((item) => item.id), [workbench.items]);
  const hosts = usePersistentWorkbenchItemHosts(itemIds);
  const headerItems = workbench.items.flatMap((item) => {
    const contribution = byKind.get(item.kind);
    const snapshot = workbench.snapshots.get(item.id) ?? contribution?.initialSnapshot;
    return snapshot ? [{ id: item.id, headerKey: store.getHeaderKey(item.id), kind: item.kind, snapshot, statusIcon: contribution?.renderStatus &&
      <AuxiliaryWorkbenchStatusBoundary itemId={item.id} resetKey={snapshot}>
        <WorkbenchItemStatus contribution={contribution} context={{ project: store, item, snapshot }} />
      </AuxiliaryWorkbenchStatusBoundary> }] : [];
  });
  const closeCoordinator = useAuxiliaryWorkbenchCloseCoordinator({
    resolveTarget: (id) => {
      const item = workbench.items.find((entry) => entry.id === id);
      const snapshot = workbench.snapshots.get(id) ?? (item && byKind.get(item.kind)?.initialSnapshot);
      if (!item || !snapshot) return null;
      const adapter = item.kind === LAUNCHER_ITEM_KIND
        ? { decide: () => ({ kind: "close" as const }), commit: () => true }
        : byKind.get(item.kind)?.close;
      return adapter ? { context: { item, snapshot, project: store }, adapter } : null;
    },
    onClosed: store.removeItem,
  });
  const itemMinimum = useCallback((id: string): WorkbenchSplitMinimumSize => {
    const item = workbench.items.find((entry) => entry.id === id);
    const contribution = item && byKind.get(item.kind);
    const snapshot = workbench.snapshots.get(id) ?? contribution?.initialSnapshot;
    const fallback = contribution?.minimumSize ?? { width: 280, height: 260 };
    if (!item || !snapshot || !contribution?.getMinimumSize) return fallback;
    try {
      return contribution.getMinimumSize({ item, snapshot, project: store }) || fallback;
    } catch {
      // A feature's optional measurement cannot invalidate the shared split tree.
      console.error("[AuxiliaryWorkbench] minimum size unavailable", { itemId: id });
      return fallback;
    }
  }, [byKind, store, workbench.items, workbench.snapshots]);
  const maximum = (values: readonly WorkbenchSplitMinimumSize[]) => values.length
    ? values.reduce((result, value) => ({ width: Math.max(result.width, value.width), height: Math.max(result.height, value.height) }), { width: 1, height: 1 })
    : { width: 280, height: 260 };
  const canDrop = useCallback((source: string, target: string, edge: WorkbenchSplitDropEdge, element: HTMLElement) => {
    const sourceGroup = workbench.groups.find((group) => group.itemIds.includes(source));
    const targetGroup = workbench.groups.find((group) => group.id === target);
    if (!sourceGroup || !targetGroup || !workbench.itemCanSplit(source, target)) return false;
    if (sourceGroup.id !== target && sourceGroup.itemIds.length === 1) return true;
    return canPlaceWorkbenchSplit(element.getBoundingClientRect(), edge, itemMinimum(source), maximum(targetGroup.itemIds.filter((id) => id !== source).map(itemMinimum)));
  }, [itemMinimum, workbench]);
  const itemMove = useWorkbenchTabMoveDrag({ canDrop, canInsert: workbench.itemCanInsert, canMergeGroup: workbench.groupCanMerge, canMoveGroup: workbench.groupCanMove,
    onInsertSession: workbench.mergeItem, onMergeGroup: workbench.mergeGroup, onMoveGroup: workbench.moveGroup, onMoveSession: workbench.splitItem });
  const presented = active && !workbench.closing;
  let projectCloseNotice: "closing" | "failed" | null = null;
  if (workbench.closing) projectCloseNotice = workbench.closeFailures.length > 0 ? "failed" : "closing";
  const [visibleProjectClose, dismissProjectClose] = useDismissibleNotice(projectCloseNotice);
  return <section ref={panel} className="desktop-terminal-panel" data-project-generation={store.context.generation} aria-label={t("terminal.title")}>
    <div className={`desktop-terminal-body ${workbench.items.length === 0 ? "is-empty" : ""}`}>
      <FloatingNoticeStack placement="top" className="desktop-auxiliary-workbench-notice-stack">
        {visibleProjectClose === "closing" && <FloatingNotice occludesNativeSurfaces
          icon={<PulseGridLoader size="xs" ariaHidden />} onDismiss={dismissProjectClose}>
          {t("workspace.projectSessions.closing")}
        </FloatingNotice>}
        {/* A failed project close leaves the workbench inert; Retry is the only way forward, so it stays. */}
        {projectCloseNotice === "failed" && <FloatingNotice occludesNativeSurfaces tone="danger"
          actions={onRetryProjectClose && <FloatingNoticeAction onClick={onRetryProjectClose}>{t("workspace.projectSessions.retryClose")}</FloatingNoticeAction>}>
          {t("workspace.projectSessions.closeFailed")}
        </FloatingNotice>}
        {workbench.creationFailure && <AuxiliaryWorkbenchCreationFailure failure={workbench.creationFailure} onDismiss={store.dismissCreationFailure} onRetry={() => { void store.retryCreation(); }} />}
        {closeCoordinator.failure && <FloatingNotice occludesNativeSurfaces tone="danger"
          actions={<FloatingNoticeAction onClick={() => { void closeCoordinator.requestClose(closeCoordinator.failure!.itemId); }}>{t("common.action.retry")}</FloatingNoticeAction>}
          onDismiss={closeCoordinator.dismissFailure}>
          {t("workspace.projectSessions.sessionCloseFailed")}
        </FloatingNotice>}
      </FloatingNoticeStack>
      {workbench.items.length === 0 ? <AuxiliaryWorkbenchRenderBoundary key={store.context.generation} itemId="empty-launcher">
        <WorkbenchLauncherContent renderLauncher={renderLauncher} context={{ groupId: null, itemId: null, presented }} />
      </AuxiliaryWorkbenchRenderBoundary> : workbench.root && <AuxiliaryWorkbenchViewport
        activeGroupId={workbench.activeGroup?.id ?? null} dropIntent={itemMove.dropIntent} groups={workbench.groups} headerItems={headerItems} hosts={hosts} root={workbench.root} itemMove={itemMove}
        titlebarTabHost={titlebarTabHost}
        getLeafMinimum={(id) => maximum(workbench.groups.find((group) => group.id === id)?.itemIds.map(itemMinimum) ?? [])}
        onActivateItem={activateAndFocus} onCloseItem={(id) => { void closeCoordinator.requestClose(id); }}
        onCreateItem={(group) => { store.createLauncher(group, t("workspace.workbench.newTab")); if (titlebarTabHost) onReveal?.(); }} onResizeSplit={workbench.resizeSplit}
        onMoveByKeyboard={(id, group, edge) => { const target = panel.current?.querySelector<HTMLElement>(`[data-terminal-content-drop-group-id="${group}"]`); if (target && canDrop(id, group, edge, target)) workbench.splitItem(id, group, edge); }}
      />}
      {workbench.items.map((item) => {
        const contribution = byKind.get(item.kind);
        const itemPresented = presented && workbench.presentedItemIds.includes(item.id);
        return createPortal(<div className="desktop-terminal-session-host-content desktop-terminal-contribution-host" data-item-kind={item.kind} aria-hidden={!itemPresented}
          {...(!itemPresented ? { inert: "" } : {})}
          onPointerDownCapture={() => { if (itemPresented) workbench.activateItem(item.id); }}
          onFocusCapture={() => { if (itemPresented) workbench.activateItem(item.id); }}>
          <AuxiliaryWorkbenchRenderBoundary itemId={item.id}>
            {item.kind === LAUNCHER_ITEM_KIND ? <WorkbenchLauncherContent renderLauncher={renderLauncher} context={{ groupId: workbench.groups.find((group) => group.itemIds.includes(item.id))?.id ?? null, itemId: item.id, presented: itemPresented }} /> : contribution &&
              <WorkbenchItemContent item={item} store={store} contribution={contribution} sidebarVisible={active}
                focusRequest={focusIntent.itemId === item.id ? focusIntent.revision : 0}
                presented={itemPresented} commandTarget={itemPresented && workbench.activeItemId === item.id} />}
          </AuxiliaryWorkbenchRenderBoundary>
        </div>, hosts.get(item.id)!, item.id);
      })}
    </div>
    {closeCoordinator.pending && <AuxiliaryWorkbenchCloseDialog pending={closeCoordinator.pending} committing={closeCoordinator.committing} onDismiss={closeCoordinator.dismiss} onConfirm={() => { void closeCoordinator.confirm(); }} />}
  </section>;
}

// Invoke contribution callbacks below their boundary, rather than during Panel render.
function WorkbenchItemStatus({ contribution, context }: Readonly<{
  contribution: AuxiliaryWorkbenchContribution; context: AuxiliaryWorkbenchCloseContext;
}>) {
  return contribution.renderStatus?.(context);
}

function WorkbenchLauncherContent({ renderLauncher, context }: Readonly<{
  renderLauncher: (context: WorkbenchLauncherContext) => ReactNode; context: WorkbenchLauncherContext;
}>) {
  return renderLauncher(context);
}

const WorkbenchItemContent = memo(function WorkbenchItemContent({ item, store, contribution, sidebarVisible, presented, commandTarget, focusRequest }: {
  item: AuxiliaryWorkbenchItemRenderContext["item"]; store: ProjectWorkbenchStore; contribution: AuxiliaryWorkbenchContribution;
  sidebarVisible: boolean; presented: boolean; commandTarget: boolean;
  focusRequest: number;
}) {
  const presentation = useMemo(() => ({ sidebarVisible, presented, commandTarget }), [sidebarVisible, presented, commandTarget]);
  const onPresentationChange = useCallback((snapshot: AuxiliaryWorkbenchItemSnapshot) => store.updateSnapshot(item.id, snapshot), [item.id, store]);
  return contribution.renderItem({ item, project: store, presentation, onPresentationChange, focusRequest });
});
