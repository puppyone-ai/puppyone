import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withEditorDocumentOperations, type DataNode, type DataPort, type Workspace } from "@puppyone/shared-ui";
import {
  collapseNestedNodes,
  createFileClipboardState,
  isValidPasteTarget,
  type FileClipboardState,
} from "./fileClipboard";
import { executeFileClipboardPaste, executeFileDuplicate } from "./fileTransfer";
import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";

type FileOperationMode = "copy" | "cut" | "move" | "duplicate";

export type FileOperationNotice = Readonly<
  | { tone: "info"; code: "selected"; mode: Extract<FileOperationMode, "copy" | "cut">; count: number }
  | { tone: "error"; code: "invalid-target" }
  | { tone: "info"; code: "in-progress"; mode: Exclude<FileOperationMode, "cut">; count: number }
  | {
      tone: "error";
      code: "partial";
      mode: Exclude<FileOperationMode, "cut">;
      completedCount: number;
      failedCount: number;
      detail: string;
    }
  | { tone: "error"; code: "failed"; detail: string }
  | {
      tone: "info";
      code: "completed";
      mode: Exclude<FileOperationMode, "cut">;
      count: number;
      targetFolderPath?: string | null;
    }
>;

export type FileClipboardOperation = "paste" | "duplicate" | null;

type ActiveFileClipboardOperation = {
  kind: Exclude<FileClipboardOperation, null>;
  generation: number;
  workspaceKey: string;
};

export type FileClipboardController = {
  clipboard: FileClipboardState | null;
  cutPaths: ReadonlySet<string>;
  operation: FileClipboardOperation;
  notice: FileOperationNotice | null;
  canCopy: boolean;
  canCut: boolean;
  canDuplicate: boolean;
  copyNodes: (nodes: readonly DataNode[]) => void;
  cutNodes: (nodes: readonly DataNode[]) => void;
  pasteNodes: (targetFolderPath: string | null) => Promise<void>;
  duplicateNodes: (nodes: readonly DataNode[]) => Promise<void>;
  canPasteInto: (targetFolderPath: string | null) => boolean;
};

export function useFileClipboard({
  dataPort: rawDataPort,
  onEnterDataView,
  onLocalWorkspaceContentChanged,
  onWorkspaceContentChanged,
  onResourceMoved,
  onActivateNode,
  workspace,
}: {
  dataPort: DataPort | null;
  onEnterDataView: () => void;
  onLocalWorkspaceContentChanged: () => void;
  onWorkspaceContentChanged: () => void;
  onResourceMoved?: (previousPath: string, nextPath: string) => void | Promise<void>;
  onActivateNode: (node: DataNode) => void;
  workspace: Workspace | null;
}): FileClipboardController {
  const dataPort = useMemo(() => rawDataPort ? withEditorDocumentOperations(rawDataPort) : null, [rawDataPort]);
  const [clipboard, setClipboard] = useState<FileClipboardState | null>(null);
  const [operation, setOperation] = useState<FileClipboardOperation>(null);
  const [notice, setNotice] = useState<FileOperationNotice | null>(null);
  const clipboardRef = useRef<FileClipboardState | null>(null);
  const operationRef = useRef<ActiveFileClipboardOperation | null>(null);
  const generationRef = useRef(0);
  const workspaceKey = workspace ? `${workspace.id}\n${workspace.path}` : "";
  const latestWorkspaceKeyRef = useRef(workspaceKey);
  latestWorkspaceKeyRef.current = workspaceKey;

  const cutPaths = useMemo<ReadonlySet<string>>(() => (
    clipboard?.mode === "cut"
      ? new Set(clipboard.nodes.map((node) => node.path))
      : new Set()
  ), [clipboard]);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    clipboardRef.current = null;
    operationRef.current = null;
    setClipboard(null);
    setOperation(null);
    setNotice(null);
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      operationRef.current = null;
    };
  }, [workspaceKey]);

  useEffect(() => {
    if (!notice || operation !== null) return undefined;
    const timeoutId = window.setTimeout(
      () => setNotice(null),
      notice.tone === "error" ? 6000 : 2600,
    );
    return () => window.clearTimeout(timeoutId);
  }, [notice, operation]);

  const setClipboardFromNodes = useCallback((mode: "copy" | "cut", nodes: readonly DataNode[]) => {
    if (!workspace || !workspaceKey || operationRef.current !== null) return;
    if (mode === "copy" && !dataPort?.copyNode) return;
    if (mode === "cut" && !dataPort?.moveNode) return;

    const nextClipboard = createFileClipboardState(workspaceKey, mode, nodes);
    if (!nextClipboard) return;

    clipboardRef.current = nextClipboard;
    setClipboard(nextClipboard);
    setNotice({
      tone: "info",
      code: "selected",
      mode,
      count: nextClipboard.nodes.length,
    });
    onEnterDataView();
  }, [dataPort, onEnterDataView, workspace, workspaceKey]);

  const copyNodes = useCallback((nodes: readonly DataNode[]) => {
    setClipboardFromNodes("copy", nodes);
  }, [setClipboardFromNodes]);

  const cutNodes = useCallback((nodes: readonly DataNode[]) => {
    setClipboardFromNodes("cut", nodes);
  }, [setClipboardFromNodes]);

  const canPasteInto = useCallback((targetFolderPath: string | null): boolean => {
    if (!clipboard || operation !== null) return false;
    if (clipboard.mode === "copy" && !dataPort?.copyNode) return false;
    if (clipboard.mode === "cut" && !dataPort?.moveNode) return false;
    return isValidPasteTarget(clipboard, { workspaceKey, path: targetFolderPath });
  }, [clipboard, dataPort, operation, workspaceKey]);

  const pasteNodes = useCallback(async (targetFolderPath: string | null) => {
    const activeClipboard = clipboardRef.current;
    if (!workspace || !dataPort || !activeClipboard || operationRef.current !== null) return;
    if (!isValidPasteTarget(activeClipboard, { workspaceKey, path: targetFolderPath })) {
      setNotice({ tone: "error", code: "invalid-target" });
      return;
    }
    if (activeClipboard.mode === "copy" && !dataPort.copyNode) return;
    if (activeClipboard.mode === "cut" && !dataPort.moveNode) return;

    const operationToken: ActiveFileClipboardOperation = {
      kind: "paste",
      generation: generationRef.current,
      workspaceKey,
    };
    operationRef.current = operationToken;
    setOperation("paste");
    setNotice({
      tone: "info",
      code: "in-progress",
      mode: activeClipboard.mode === "copy" ? "copy" : "move",
      count: activeClipboard.nodes.length,
    });
    onEnterDataView();

    try {
      const result = await executeFileClipboardPaste(dataPort, activeClipboard, targetFolderPath);
      if (
        latestWorkspaceKeyRef.current !== operationToken.workspaceKey
        || generationRef.current !== operationToken.generation
        || operationRef.current !== operationToken
      ) return;
      const completedSourcePaths = new Set(result.completedSourcePaths);
      const firstFailure = result.failures[0];

      if (activeClipboard.mode === "cut") {
        for (let index = 0; index < result.completedSourcePaths.length; index += 1) {
          const previousPath = result.completedSourcePaths[index];
          const nextPath = result.destinationPaths[index];
          if (previousPath && nextPath && previousPath !== nextPath) {
            await onResourceMoved?.(previousPath, nextPath);
          }
        }
        const remainingNodes = activeClipboard.nodes.filter((node) => !completedSourcePaths.has(node.path));
        const nextClipboard = remainingNodes.length > 0 ? { ...activeClipboard, nodes: remainingNodes } : null;
        clipboardRef.current = nextClipboard;
        setClipboard(nextClipboard);
      }

      if (result.destinationNodes[0]) onActivateNode(result.destinationNodes[0]);
      if (completedSourcePaths.size > 0 || result.failures.length > 0) {
        onWorkspaceContentChanged();
        onLocalWorkspaceContentChanged();
      }

      const completedCount = completedSourcePaths.size;
      setNotice(result.failures.length > 0 ? {
        tone: "error",
        ...(completedCount > 0 ? {
          code: "partial" as const,
          mode: activeClipboard.mode === "copy" ? "copy" as const : "move" as const,
          completedCount,
          failedCount: result.failures.length,
          detail: formatFailureDetail(firstFailure),
        } : {
          code: "failed" as const,
          detail: formatFailureDetail(firstFailure),
        }),
      } : {
        tone: "info",
        code: "completed",
        mode: activeClipboard.mode === "copy" ? "copy" : "move",
        count: completedCount,
        targetFolderPath,
      });
    } catch (error) {
      if (
        latestWorkspaceKeyRef.current === operationToken.workspaceKey
        && generationRef.current === operationToken.generation
        && operationRef.current === operationToken
      ) {
        setNotice({
          tone: "error",
          code: "failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (
        latestWorkspaceKeyRef.current === operationToken.workspaceKey
        && generationRef.current === operationToken.generation
        && operationRef.current === operationToken
      ) {
        operationRef.current = null;
        setOperation(null);
      }
    }
  }, [
    dataPort,
    onEnterDataView,
    onLocalWorkspaceContentChanged,
    onWorkspaceContentChanged,
    onResourceMoved,
    onActivateNode,
    workspace,
    workspaceKey,
  ]);

  const duplicateNodes = useCallback(async (nodes: readonly DataNode[]) => {
    if (!workspace || !dataPort?.copyNode || operationRef.current !== null) return;
    const sourceNodes = collapseNestedNodes(nodes);
    if (sourceNodes.length === 0) return;

    const operationToken: ActiveFileClipboardOperation = {
      kind: "duplicate",
      generation: generationRef.current,
      workspaceKey,
    };
    operationRef.current = operationToken;
    setOperation("duplicate");
    setNotice({
      tone: "info",
      code: "in-progress",
      mode: "duplicate",
      count: sourceNodes.length,
    });
    onEnterDataView();

    try {
      const result = await executeFileDuplicate(dataPort, sourceNodes);
      if (
        latestWorkspaceKeyRef.current !== operationToken.workspaceKey
        || generationRef.current !== operationToken.generation
        || operationRef.current !== operationToken
      ) return;
      const firstFailure = result.failures[0];

      if (result.destinationNodes[0]) onActivateNode(result.destinationNodes[0]);
      onWorkspaceContentChanged();
      onLocalWorkspaceContentChanged();

      setNotice(result.failures.length > 0 ? {
        tone: "error",
        ...(result.destinationPaths.length > 0 ? {
          code: "partial" as const,
          mode: "duplicate" as const,
          completedCount: result.destinationPaths.length,
          failedCount: result.failures.length,
          detail: formatFailureDetail(firstFailure),
        } : {
          code: "failed" as const,
          detail: formatFailureDetail(firstFailure),
        }),
      } : {
        tone: "info",
        code: "completed",
        mode: "duplicate",
        count: result.destinationPaths.length,
      });
    } finally {
      if (
        latestWorkspaceKeyRef.current === operationToken.workspaceKey
        && generationRef.current === operationToken.generation
        && operationRef.current === operationToken
      ) {
        operationRef.current = null;
        setOperation(null);
      }
    }
  }, [
    dataPort,
    onEnterDataView,
    onLocalWorkspaceContentChanged,
    onWorkspaceContentChanged,
    onActivateNode,
    workspace,
    workspaceKey,
  ]);

  return useMemo<FileClipboardController>(() => ({
    clipboard,
    cutPaths,
    operation,
    notice,
    canCopy: Boolean(dataPort?.copyNode) && operation === null,
    canCut: Boolean(dataPort?.moveNode) && operation === null,
    canDuplicate: Boolean(dataPort?.copyNode) && operation === null,
    copyNodes,
    cutNodes,
    pasteNodes,
    duplicateNodes,
    canPasteInto,
  }), [
    canPasteInto,
    clipboard,
    copyNodes,
    cutNodes,
    cutPaths,
    dataPort,
    duplicateNodes,
    notice,
    operation,
    pasteNodes,
  ]);
}

export function formatFileOperationNotice(
  notice: FileOperationNotice | null,
  t: MessageFormatter,
): string | null {
  if (!notice) return null;
  if (notice.code === "selected") {
    return t(notice.mode === "copy"
      ? "workspace.clipboard.selectedCopy"
      : "workspace.clipboard.selectedCut", { count: notice.count });
  }
  if (notice.code === "invalid-target") return t("workspace.clipboard.invalidTarget");
  if (notice.code === "in-progress") {
    if (notice.mode === "copy") return t("workspace.clipboard.copying", { count: notice.count });
    if (notice.mode === "move") return t("workspace.clipboard.moving", { count: notice.count });
    return t("workspace.clipboard.duplicating", { count: notice.count });
  }
  if (notice.code === "partial") {
    return t(`workspace.clipboard.partial.${notice.mode}`, {
      completed: notice.completedCount,
      failed: notice.failedCount,
      detail: bidiIsolate(notice.detail),
    });
  }
  if (notice.code === "failed") {
    return t("workspace.clipboard.failedDetail", { detail: bidiIsolate(notice.detail) });
  }
  if (notice.mode === "duplicate") {
    return t("workspace.clipboard.completed.duplicate", { count: notice.count });
  }
  const target = formatFolderLabel(notice.targetFolderPath ?? null, t);
  return t(`workspace.clipboard.completed.${notice.mode}`, {
    count: notice.count,
    target,
  });
}

function formatFolderLabel(path: string | null, t: MessageFormatter): string {
  if (!path) return t("workspace.clipboard.workspaceRoot");
  const name = path.split("/").filter(Boolean).at(-1);
  return name ? bidiIsolate(name) : t("workspace.clipboard.workspaceRoot");
}

function formatFailureDetail(failure: { name: string; message: string } | undefined): string {
  return failure ? `${failure.name}: ${failure.message}` : "file-operation-failed";
}
