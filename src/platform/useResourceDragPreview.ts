import { useSyncExternalStore } from "react";
import { resourceDragPreviewStore } from "./resourceDragPreviewStore";

/** All targets in one renderer share the same presentation of the native session. */
export function useResourceDragPreview() {
  return useSyncExternalStore(resourceDragPreviewStore.subscribe, resourceDragPreviewStore.getSnapshot, () => null);
}
