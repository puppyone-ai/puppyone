import { useEffect, useState } from "react";
import type { DataNode, DataPort, WorkspaceContentChange } from "../core/types";

type Target = Pick<DataNode, "path" | "name">;
const EMPTY: readonly Target[] = [];

/** Filename resolution must not depend on which Explorer folders were opened.
 * Source reads/backlinks retain their separate, bounded indexing lifecycle. */
export function useWorkspaceReferenceTargets(dataPort: DataPort, refreshKey?: WorkspaceContentChange) {
  const [snapshot, setSnapshot] = useState<{
    port: DataPort; refreshKey: WorkspaceContentChange | undefined; targets: readonly Target[];
  } | null>(null);
  useEffect(() => {
    if (!dataPort.listReferenceTargets) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void dataPort.listReferenceTargets!({ signal: controller.signal }).then(targets => {
        if (!controller.signal.aborted) setSnapshot({ port: dataPort, refreshKey, targets });
      }).catch(error => {
        if (!controller.signal.aborted) console.warn("Unable to index workspace reference targets:", error);
      });
    }, 100);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [dataPort, refreshKey]);
  // Refresh atomically. Temporarily dropping a valid filename index would
  // destroy mounted wiki images on every unrelated auto-save notification.
  return snapshot?.port === dataPort ? snapshot.targets : EMPTY;
}
