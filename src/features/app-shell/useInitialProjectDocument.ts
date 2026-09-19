import { useEffect, useRef } from "react";
import { getFileSemanticKind, qualifyDataResourcePath, type DataNode, type WorkspaceFolder } from "@puppyone/shared-ui";
import type { ProjectInitializationReceipt } from "../../types/electron";

/** Consumes a committed open intent; this hook never creates or repairs files. */
export function useInitialProjectDocument({ receipt, folders, openDocument, consume, onError }: {
  receipt: ProjectInitializationReceipt | null;
  folders: readonly WorkspaceFolder[];
  openDocument: (path: string, node: DataNode) => void | Promise<void>;
  consume: (operationId: string) => void;
  onError: (message: string) => void;
}) {
  const consumed = useRef<string | null>(null);
  useEffect(() => {
    if (!receipt || consumed.current === receipt.operationId) return;
    const folder = folders.find((candidate) => candidate.workspace.path === receipt.path);
    if (!folder) return;
    consumed.current = receipt.operationId;
    consume(receipt.operationId);
    if (!receipt.initialOpenPath) return;
    const resourcePath = qualifyDataResourcePath(folder.uri, receipt.initialOpenPath);
    const node: DataNode = {
      id: resourcePath,
      name: receipt.initialOpenPath.split("/").at(-1)!,
      path: resourcePath,
      type: getFileSemanticKind(receipt.initialOpenPath, "file"),
      resourceUri: resourcePath,
      workspaceFolderId: folder.id,
    };
    const reportError = (error: unknown) => {
      onError(error instanceof Error ? error.message : String(error));
    };
    try {
      void Promise.resolve(openDocument(resourcePath, node)).catch(reportError);
    } catch (error) {
      reportError(error);
    }
  }, [consume, folders, onError, openDocument, receipt]);
}
