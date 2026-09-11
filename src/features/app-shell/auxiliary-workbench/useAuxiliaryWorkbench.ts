import { useMemo, useSyncExternalStore } from "react";
import {
  canInsertAuxiliaryWorkbenchItem, canMergeAuxiliaryWorkbenchGroup, canMoveAuxiliaryWorkbenchGroup,
  canSplitAuxiliaryWorkbenchItem, getActiveAuxiliaryWorkbenchGroup, getActiveAuxiliaryWorkbenchItemId,
  getOrderedAuxiliaryWorkbenchItems, getPresentedAuxiliaryWorkbenchItemIds,
  type WorkbenchSplitDropEdge,
} from "@puppyone/shared-ui";
import type { ProjectWorkbenchStore } from "./ProjectWorkbenchStore";

export function useAuxiliaryWorkbench(store: ProjectWorkbenchStore) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const topologyView = useMemo(() => {
    const topology = snapshot.topology;
    const dispatch = store.dispatch;
    return {
      items: getOrderedAuxiliaryWorkbenchItems(topology), groups: topology.groups, root: topology.root,
      activeGroup: getActiveAuxiliaryWorkbenchGroup(topology), activeItemId: getActiveAuxiliaryWorkbenchItemId(topology),
      presentedItemIds: getPresentedAuxiliaryWorkbenchItemIds(topology),
      activateItem: (itemId: string) => dispatch({ type: "activate", itemId }),
      removeItem: store.removeItem,
      itemCanSplit: (item: string, group: string) => canSplitAuxiliaryWorkbenchItem(topology, item, group),
      itemCanInsert: (item: string, group: string, index: number) => canInsertAuxiliaryWorkbenchItem(topology, item, group, index),
      groupCanMerge: (source: string, target: string, index: number) => canMergeAuxiliaryWorkbenchGroup(topology, source, target, index),
      groupCanMove: (source: string, target: string) => canMoveAuxiliaryWorkbenchGroup(topology, source, target),
      splitItem: (sourceItemId: string, targetGroupId: string, edge: WorkbenchSplitDropEdge) => dispatch({ type: "split-item", sourceItemId, targetGroupId, edge, groupId: crypto.randomUUID(), splitId: crypto.randomUUID() }),
      mergeItem: (sourceItemId: string, targetGroupId: string, targetIndex: number) => dispatch({ type: "merge-item", sourceItemId, targetGroupId, targetIndex }),
      moveGroup: (sourceGroupId: string, targetGroupId: string, edge: WorkbenchSplitDropEdge) => dispatch({ type: "move-group", sourceGroupId, targetGroupId, edge, splitId: crypto.randomUUID() }),
      mergeGroup: (sourceGroupId: string, targetGroupId: string, targetIndex: number) => dispatch({ type: "merge-group", sourceGroupId, targetGroupId, targetIndex }),
      resizeSplit: (splitId: string, ratio: number) => dispatch({ type: "resize-split", splitId, ratio }),
    };
  }, [snapshot.topology, store]);
  return useMemo(() => ({ ...snapshot, ...topologyView }), [snapshot, topologyView]);
}
