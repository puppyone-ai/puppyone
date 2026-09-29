import { useEffect, useRef } from "react";
import type { DataNode, DataPort, WorkspaceFolder } from "@puppyone/shared-ui";
import {
  resolveWorkspaceEntryDocument,
  type WorkspaceEntryIntent,
} from "./workspaceEntryBootstrap";

/**
 * Runs the one-shot experience shared by create, open, clone, and restore.
 * It never creates or repairs user files: it only selects an existing document
 * after editor-session hydration. Feature discovery remains user-controlled
 * through the contextual Header coachmarks.
 */
export function useWorkspaceEntryBootstrap({
  consume,
  dataPort,
  editorHydrated,
  folders,
  hasOpenEditors,
  intent,
  onError,
  openDocument,
}: {
  consume: (intentId: string) => void;
  dataPort: Pick<DataPort, "listChildren" | "resolveNode"> | null;
  editorHydrated: boolean;
  folders: readonly WorkspaceFolder[];
  hasOpenEditors: boolean;
  intent: WorkspaceEntryIntent | null;
  onError: (message: string) => void;
  openDocument: (path: string, node: DataNode) => void | Promise<void>;
}) {
  const completedIntentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!intent || !dataPort || !editorHydrated || folders.length === 0) return;
    if (completedIntentRef.current === intent.id) return;

    let cancelled = false;
    const complete = () => {
      if (cancelled || completedIntentRef.current === intent.id) return;
      completedIntentRef.current = intent.id;
      consume(intent.id);
    };

    if (!intent.preferredOpenPath && hasOpenEditors) {
      complete();
      return undefined;
    }

    void resolveWorkspaceEntryDocument({ dataPort, folders, intent })
      .then(async (document) => {
        if (cancelled || completedIntentRef.current === intent.id) return;
        if (document) await openDocument(document.path, document);
        complete();
      })
      .catch((error) => {
        if (cancelled || completedIntentRef.current === intent.id) return;
        onError(error instanceof Error ? error.message : String(error));
        complete();
      });

    return () => {
      cancelled = true;
    };
  }, [
    consume,
    dataPort,
    editorHydrated,
    folders,
    hasOpenEditors,
    intent,
    onError,
    openDocument,
  ]);
}
