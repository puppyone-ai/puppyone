import { useCallback } from "react";
import type { ExplorerTreeProps } from "@puppyone/shared-ui";
import { writeLocalResourceDragData } from "./resourceDragExport";
import type { ResolvedWorkbenchDataResource } from "./workbenchDataPort";

/** One native session carries both OS files and a Main-owned resource identity. */
export function useResourceDragExport(
  resolveResource: (resource: string) => ResolvedWorkbenchDataResource | null,
  onFailure?: (failed: boolean) => void,
) {
  return useCallback<NonNullable<ExplorerTreeProps["onExportNodes"]>>((nodes, event) => {
    onFailure?.(false);
    try {
      writeLocalResourceDragData(nodes, event, resolveResource);
      const startNativeDrag = window.puppyoneDesktop?.startResourceDrag;
      if (window.puppyoneDesktop?.resourceDragSessionSupported && startNativeDrag) {
        // Electron requires cancelling HTML drag at its start. Starting another
        // session at dragleave does not upgrade the active HTML payload.
        event.preventDefault();
        void startNativeDrag({ resources: nodes.map((node) => node.resourceUri ?? node.path) })
          .then((started) => { if (!started) onFailure?.(true); })
          .catch(() => onFailure?.(true));
      }
    } catch {
      event.preventDefault();
      onFailure?.(true);
    }
  }, [onFailure, resolveResource]);
}
