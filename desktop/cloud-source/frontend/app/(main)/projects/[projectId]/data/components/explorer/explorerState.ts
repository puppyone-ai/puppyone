'use client';

import { useCallback, useSyncExternalStore } from 'react';

const expandedSet = new Set<string>();
const expandedListeners = new Set<() => void>();

function expandedSubscribe(cb: () => void) {
  expandedListeners.add(cb);
  return () => expandedListeners.delete(cb);
}

function notifyExpanded() {
  expandedListeners.forEach((cb) => cb());
}

export function toggleExpanded(id: string) {
  if (expandedSet.has(id)) {
    expandedSet.delete(id);
  } else {
    expandedSet.add(id);
  }
  notifyExpanded();
}

export function ensureExpanded(id: string) {
  if (!expandedSet.has(id)) {
    expandedSet.add(id);
    notifyExpanded();
  }
}

export function ensureExpandedBatch(ids: string[]) {
  let changed = false;

  for (const id of ids) {
    if (!expandedSet.has(id)) {
      expandedSet.add(id);
      changed = true;
    }
  }

  if (changed) notifyExpanded();
}

export function useIsExpanded(id: string): boolean {
  const getSnapshot = useCallback(() => expandedSet.has(id), [id]);
  return useSyncExternalStore(expandedSubscribe, getSnapshot, getSnapshot);
}

let pendingActiveId: string | null = null;
let pendingVersion = 0;
const pendingListeners = new Set<() => void>();

export function setPendingActiveId(id: string | null) {
  pendingActiveId = id;
  pendingVersion += 1;
  pendingListeners.forEach((cb) => cb());
}

export function usePendingActiveId() {
  useSyncExternalStore(
    (cb) => {
      pendingListeners.add(cb);
      return () => pendingListeners.delete(cb);
    },
    () => pendingVersion,
    () => 0,
  );

  return pendingActiveId;
}
