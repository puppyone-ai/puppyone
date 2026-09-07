import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocalization } from "@puppyone/localization/react";
import type { WorkbenchSplitDropEdge, WorkbenchSplitMinimumSize } from "@puppyone/shared-ui";
import type { AuxiliaryWorkbenchContribution } from "./types";
import { LAUNCHER_ITEM_KIND, type ProjectWorkbenchStore } from "./ProjectWorkbenchStore";
import { useAuxiliaryWorkbench } from "./useAuxiliaryWorkbench";
import { useAuxiliaryWorkbenchCloseCoordinator } from "./useAuxiliaryWorkbenchCloseCoordinator";
import { AuxiliaryWorkbenchCloseDialog } from "./AuxiliaryWorkbenchCloseDialog";
import { AuxiliaryWorkbenchViewport } from "./layout/AuxiliaryWorkbenchViewport";
import { AuxiliaryWorkbenchCreationFailure } from "./layout/AuxiliaryWorkbenchCreationFailure";
import { usePersistentWorkbenchItemHosts } from "./layout/usePersistentWorkbenchItemHosts";
import { useWorkbenchTabMoveDrag } from "./layout/interactions/useWorkbenchTabMoveDrag";
import { canPlaceWorkbenchSplit } from "./layout/workbenchSplitConstraints";

export type WorkbenchLauncherContext = { groupId: string | null; itemId: string | null; presented: boolean };
export function AuxiliaryWorkbenchPanel({ store, contributions, active, renderLauncher, onRetryProjectClose }: {
  store: ProjectWorkbenchStore;
  contributions: readonly AuxiliaryWorkbenchContribution[];
  active: boolean;
  onRetryProjectClose?: () => void;
  renderLauncher(context: WorkbenchLauncherContext): ReactNode;
}) {
  const { t } = useLocalization();
  const panel = useRef<HTMLElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  store.configure(contributions);
  const workbench = useAuxiliaryWorkbench(store);
  const byKind = useMemo(() => new Map(contributions.map((entry) => [entry.kind, entry])), [contributions]);
  const itemIds = useMemo(() => workbench.items.map((item) => item.id), [workbench.items]);
  const hosts = usePersistentWorkbenchItemHosts(itemIds);
  const headerItems = workbench.items.flatMap((item) => {
    const contribution = byKind.get(item.kind);
    const snapshot = workbench.snapshots.get(item.id) ?? contribution?.initialSnapshot;
    return snapshot ? [{ id: item.id, kind: item.kind, snapshot, statusIcon: contribution?.renderStatus?.({ project: store, item, snapshot }) }] : [];
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
    return (item && snapshot && contribution?.getMinimumSize?.({ item, snapshot, project: store }))
      || contribution?.minimumSize || { width: 280, height: 260 };
  }, [byKind, store, workbench.items, workbench.snapshots]);
  const maximum = (values: readonly WorkbenchSplitMinimumSize[]) => values.reduce((result, value) => ({ width: Math.max(result.width, value.width), height: Math.max(result.height, value.height) }), { width: 280, height: 260 });
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
  return <section ref={panel} className="desktop-terminal-panel" data-project-generation={store.context.generation} aria-label={t("terminal.title")}>
    <div className={`desktop-terminal-body ${workbench.items.length === 0 ? "is-empty" : ""}`}>
      {workbench.closing && <div className="desktop-terminal-workbench-create-failure" role="status">
        <span>{t(workbench.closeFailures.length ? "workspace.projectSessions.closeFailed" : "workspace.projectSessions.closing")}</span>
        {workbench.closeFailures.length > 0 && onRetryProjectClose && <button type="button" className="desktop-terminal-workbench-create-retry" onClick={onRetryProjectClose}>{t("workspace.projectSessions.retryClose")}</button>}
      </div>}
      {workbench.creationFailure && <AuxiliaryWorkbenchCreationFailure failure={workbench.creationFailure} onDismiss={store.dismissCreationFailure} onRetry={() => { void store.retryCreation(); }} />}
      {closeCoordinator.failure && <div className="desktop-terminal-workbench-create-failure" role="alert" title={closeCoordinator.failure.detail}>
        <span>{t("workspace.projectSessions.sessionCloseFailed")}</span>
        <button type="button" className="desktop-terminal-workbench-create-retry" onClick={() => { void closeCoordinator.requestClose(closeCoordinator.failure!.itemId); }}>{t("common.action.retry")}</button>
        <button type="button" className="desktop-terminal-workbench-create-retry" onClick={closeCoordinator.dismissFailure}>{t("common.action.close")}</button>
      </div>}
      {workbench.items.length === 0 ? renderLauncher({ groupId: null, itemId: null, presented }) : workbench.root && <AuxiliaryWorkbenchViewport
        activeGroupId={workbench.activeGroup?.id ?? null} dropIntent={itemMove.dropIntent} groups={workbench.groups} headerItems={headerItems} hosts={hosts} root={workbench.root} itemMove={itemMove}
        getLeafMinimum={(id) => maximum(workbench.groups.find((group) => group.id === id)?.itemIds.map(itemMinimum) ?? [])}
        onActivateItem={workbench.activateItem} onCloseItem={(id) => { void closeCoordinator.requestClose(id); }}
        onCreateItem={(group) => store.createLauncher(group, t("terminal.new"))} onResizeSplit={workbench.resizeSplit}
        onMoveByKeyboard={(id, group, edge) => { const target = panel.current?.querySelector<HTMLElement>(`[data-terminal-content-drop-group-id="${group}"]`); if (target && canDrop(id, group, edge, target)) workbench.splitItem(id, group, edge); }}
      />}
      {workbench.items.map((item) => {
        const contribution = byKind.get(item.kind);
        const itemPresented = presented && workbench.presentedItemIds.includes(item.id);
        return createPortal(<div className="desktop-terminal-session-host-content desktop-terminal-contribution-host" data-item-kind={item.kind} aria-hidden={!itemPresented}
          onPointerDownCapture={() => workbench.activateItem(item.id)} onFocusCapture={() => { setFocused(item.id); workbench.activateItem(item.id); }}>
          {item.kind === LAUNCHER_ITEM_KIND ? renderLauncher({ groupId: workbench.groups.find((group) => group.itemIds.includes(item.id))?.id ?? null, itemId: item.id, presented: itemPresented }) : contribution?.renderItem({
            item, project: store, peerSnapshots: workbench.snapshots, onPresentationChange: (snapshot) => store.updateSnapshot(item.id, snapshot),
            presentation: { sidebarVisible: active, presented: itemPresented, commandTarget: itemPresented && workbench.activeItemId === item.id, domFocused: itemPresented && focused === item.id },
          })}
        </div>, hosts.get(item.id)!, item.id);
      })}
    </div>
    {closeCoordinator.pending && <AuxiliaryWorkbenchCloseDialog pending={closeCoordinator.pending} committing={closeCoordinator.committing} onDismiss={closeCoordinator.dismiss} onConfirm={() => { void closeCoordinator.confirm(); }} />}
  </section>;
}
