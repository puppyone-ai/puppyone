import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  withEditorDocumentOperations,
  getDataResourceName,
  getFileSemanticKind,
  type DataNode,
  type DataPort,
  type Workspace,
} from "@puppyone/shared-ui";
import {
  defaultCreateName,
  formatDesktopExtensionLabel,
  getCreateEntryInitialContent,
  getDesktopNodeExtension,
  getDesktopRenameDraft,
  normalizeCreateEntryName,
  normalizeDesktopExtension,
  normalizeDesktopRenameName,
  rectToCreateEntryAnchor,
  toDesktopNodeActionError,
  uniqueCreateEntryName,
  type DesktopCreateEntryAnchorInput,
  type DesktopCreateEntryDraft,
  type DesktopCreateEntryKind,
  type DesktopNodeActionError,
  type DesktopNodeActionMenuDraft,
} from "./nodeActions";
import {
  getDataParentPath,
  joinDataPath,
  remapActivePathAfterRename,
} from "./explorer";
import { collapseNestedNodes } from "./fileClipboard";
import { useFileClipboard } from "./useFileClipboard";
import { useLocalization } from "@puppyone/localization/react";
import { bidiIsolate } from "@puppyone/localization/core";
import { writeClipboardText } from "../../lib/clipboard";

export function useDataNodeActions({
  dataPort: rawDataPort,
  getPathForCopy,
  onEnterDataView,
  onLocalWorkspaceContentChanged,
  onWorkspaceContentChanged,
  onResourceDeleted,
  onResourceMoved,
  onActivateNode,
  setActiveExplorerNode,
  workspace,
}: {
  dataPort: DataPort | null;
  /** Provider-owned readable path; Resource URIs must not reach the clipboard. */
  getPathForCopy?: (path: string) => string;
  onEnterDataView: () => void;
  onLocalWorkspaceContentChanged: () => void;
  onWorkspaceContentChanged: () => void;
  onResourceDeleted?: (path: string) => void | Promise<void>;
  onResourceMoved?: (previousPath: string, nextPath: string) => void | Promise<void>;
  onActivateNode: (node: DataNode) => void;
  setActiveExplorerNode: Dispatch<SetStateAction<DataNode | null>>;
  workspace: Workspace | null;
}) {
  const { t } = useLocalization();
  const dataPort = useMemo(() => rawDataPort ? withEditorDocumentOperations(rawDataPort) : null, [rawDataPort]);
  const [createEntryDraft, setCreateEntryDraft] = useState<DesktopCreateEntryDraft | null>(null);
  const [nodeActionMenu, setNodeActionMenu] = useState<DesktopNodeActionMenuDraft | null>(null);
  const fileClipboardController = useFileClipboard({
    dataPort,
    onEnterDataView,
    onLocalWorkspaceContentChanged,
    onWorkspaceContentChanged,
    onActivateNode,
    workspace,
    onResourceMoved,
  });

  const [isDeletingNodes, setIsDeletingNodes] = useState(false);
  // Right-click and the keyboard share one in-flight deletion.
  const deleteLockRef = useRef(false);
  const deleteGenerationRef = useRef(0);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const resetDataNodeActions = useCallback(() => {
    setCreateEntryDraft(null);
    setNodeActionMenu(null);
  }, []);

  const openCreateEntryMenu = useCallback((parentPath: string | null, anchorRect: DesktopCreateEntryAnchorInput) => {
    onEnterDataView();
    setNodeActionMenu(null);
    setCreateEntryDraft({
      parentPath,
      anchor: normalizeCreateEntryAnchor(anchorRect),
      error: null,
      creatingKind: null,
    });
  }, [onEnterDataView]);

  const openNodeActionMenu = useCallback((node: DataNode, anchorRect: DOMRect, selectedNodes: readonly DataNode[] = [node]) => {
    const selectedNodeIsInSelection = selectedNodes.some((selectedNode) => selectedNode.path === node.path);
    const nodes = collapseNestedNodes(selectedNodeIsInSelection ? selectedNodes : [node]);
    const primaryNode = nodes.find((selectedNode) => selectedNode.path === node.path) ?? nodes[0] ?? node;
    const renameDraft = getDesktopRenameDraft(primaryNode);
    onEnterDataView();
    setCreateEntryDraft(null);
    setNodeActionMenu({
      launcherPath: node.path,
      node: primaryNode,
      nodes,
      anchor: rectToCreateEntryAnchor(anchorRect),
      mode: "actions",
      renameNameValue: renameDraft.nameValue,
      renameExtensionValue: renameDraft.extensionValue,
      renameFocus: "name",
      error: null,
      operation: null,
    });
  }, [onEnterDataView]);

  /** Creates the chosen kind at once under its default, de-duplicated name, then opens it. */
  const createEntry = useCallback(async (kind: DesktopCreateEntryKind) => {
    if (!workspace || !dataPort || !createEntryDraft || createEntryDraft.creatingKind) return;

    if (kind === "slides") {
      if (!dataPort.instantiateTemplate) return;
    } else if (!dataPort.createFolder || !dataPort.createFile) {
      return;
    }
    let requestedName: string;
    try {
      requestedName = normalizeCreateEntryName(kind, defaultCreateName(kind, t));
    } catch (error) {
      setCreateEntryDraft((current) => current ? {
        ...current,
        error: toDesktopNodeActionError(error),
      } : current);
      return;
    }

    setCreateEntryDraft((current) => current ? { ...current, creatingKind: kind, error: null } : current);
    try {
      let nextPath: string;
      let nextNode: DataNode;
      if (kind === "slides") {
        const result = await dataPort.instantiateTemplate!({
          templateId: "slides.default",
          parentPath: createEntryDraft.parentPath,
          name: requestedName,
        });
        nextPath = result.openPath;
        const name = getDataResourceName(nextPath) || nextPath;
        nextNode = {
          id: nextPath,
          name,
          path: nextPath,
          type: getFileSemanticKind(name, "file"),
        };
      } else {
        const existingChildren = await dataPort.listChildren(createEntryDraft.parentPath).catch(() => []);
        const name = uniqueCreateEntryName(requestedName, new Set(existingChildren.map((node) => node.name)));
        nextPath = joinDataPath(createEntryDraft.parentPath, name);
        if (kind === "folder") {
          await dataPort.createFolder!(nextPath);
          nextNode = { id: nextPath, name, path: nextPath, type: "folder", children: null };
        } else {
          await dataPort.createFile!(nextPath, getCreateEntryInitialContent(kind, {
            csvHeaders: [
              t("workspace.node.csvColumn", { number: 1 }),
              t("workspace.node.csvColumn", { number: 2 }),
              t("workspace.node.csvColumn", { number: 3 }),
            ],
            puppyFlow: {
              title: t("editor.puppyflow.untitledFlow"),
              prompts: [
                t("editor.puppyflow.defaultPrompt.analyze"),
                t("editor.puppyflow.defaultPrompt.apply"),
              ],
            },
          }));
          nextNode = {
            id: nextPath,
            name,
            path: nextPath,
            type: getFileSemanticKind(name, "file"),
          };
        }
      }
      setCreateEntryDraft(null);
      setNodeActionMenu(null);
      onEnterDataView();
      onActivateNode(nextNode);
      onWorkspaceContentChanged();
      onLocalWorkspaceContentChanged();
    } catch (error) {
      setCreateEntryDraft((current) => current ? {
        ...current,
        creatingKind: null,
        error: toDesktopNodeActionError(error),
      } : current);
    }
  }, [
    createEntryDraft,
    dataPort,
    onEnterDataView,
    onLocalWorkspaceContentChanged,
    onWorkspaceContentChanged,
    onActivateNode,
    workspace,
    t,
  ]);

  const renameNodeFromMenu = useCallback(async () => {
    if (!dataPort?.renameNode || !nodeActionMenu || nodeActionMenu.operation || nodeActionMenu.nodes.length !== 1) return;

    let nextName: string;
    try {
      nextName = normalizeDesktopRenameName(nodeActionMenu);
    } catch (error) {
      setNodeActionMenu((current) => current ? {
        ...current,
        error: toDesktopNodeActionError(error),
      } : current);
      return;
    }

    if (nextName === nodeActionMenu.node.name) {
      setNodeActionMenu(null);
      return;
    }

    if (nodeActionMenu.node.type !== "folder") {
      const previousExtension = getDesktopNodeExtension(nodeActionMenu.node.name);
      const nextExtension = getDesktopNodeExtension(nextName);
      if (normalizeDesktopExtension(previousExtension) !== normalizeDesktopExtension(nextExtension)) {
        const confirmed = window.confirm(
          t("workspace.node.confirmTypeChange", {
            previous: formatDesktopExtensionLabel(previousExtension, t),
            next: formatDesktopExtensionLabel(nextExtension, t),
          }),
        );
        if (!confirmed) return;
      }
    }

    setNodeActionMenu((current) => current ? { ...current, operation: "rename", error: null } : current);
    const previousPath = nodeActionMenu.node.path;
    const nextPath = joinDataPath(getDataParentPath(previousPath), nextName);

    try {
      await dataPort.renameNode(previousPath, nextName);
      await onResourceMoved?.(previousPath, nextPath);
      setNodeActionMenu(null);
      setActiveExplorerNode((current) => remapActiveNodeAfterRename(current, previousPath, nextPath, nextName));
      onWorkspaceContentChanged();
      onLocalWorkspaceContentChanged();
    } catch (error) {
      setNodeActionMenu((current) => current ? {
        ...current,
        operation: null,
        error: toDesktopNodeActionError(error),
      } : current);
    }
  }, [
    dataPort,
    nodeActionMenu,
    onLocalWorkspaceContentChanged,
    onWorkspaceContentChanged,
    onResourceMoved,
    setActiveExplorerNode,
    t,
  ]);

  const executeDeleteNodes = useCallback(async (
    nodes: readonly DataNode[],
    anchor: DesktopNodeActionMenuDraft["anchor"],
    source: "menu" | "shortcut",
  ) => {
    if (!workspace || !dataPort?.deleteNode || nodes.length === 0 || deleteLockRef.current) return;
    const targets = collapseNestedNodes([...nodes]);
    // A protected root anywhere in the snapshot cancels the whole request.
    if (targets.length === 0 || targets.some((node) => node.workspaceFolderRoot)) return;

    const workspaceId = workspace.id;
    const generation = ++deleteGenerationRef.current;
    const isCurrent = () => deleteGenerationRef.current === generation && workspaceRef.current?.id === workspaceId;
    deleteLockRef.current = true;
    setIsDeletingNodes(true);
    try {
      const confirmed = window.confirm(targets.length === 1
        ? t("workspace.node.confirmDeleteOne", { name: bidiIsolate(targets[0].name) })
        : t("workspace.node.confirmDeleteMany", { count: targets.length }));
      if (!confirmed) return;
      if (source === "menu") {
        setNodeActionMenu((current) => current ? { ...current, operation: "delete", error: null } : current);
      }

      const deletedNodes: DataNode[] = [];
      const deleteFailures: Array<{ path: string; name: string; message: string }> = [];
      const postFailures: Array<{ path: string; name: string; message: string }> = [];
      for (const node of targets) {
        try {
          await dataPort.deleteNode(node.path);
        } catch (error) {
          deleteFailures.push({ path: node.path, name: node.name, message: describeError(error) });
          continue;
        }
        deletedNodes.push(node);
        // The file is gone at this point. A failure while closing resources or
        // refreshing is post-processing, never a reason to delete it again.
        try {
          await onResourceDeleted?.(node.path);
        } catch (error) {
          postFailures.push({ path: node.path, name: node.name, message: describeError(error) });
        }
      }
      if (!isCurrent()) return;

      if (deletedNodes.length > 0) {
        setActiveExplorerNode((current) => (
          deletedNodes.some((node) => current?.path === node.path || current?.path.startsWith(`${node.path}/`)) ? null : current
        ));
        onWorkspaceContentChanged();
        onLocalWorkspaceContentChanged();
      }

      const failedNodes = targets.filter((node) => deleteFailures.some((failure) => failure.path === node.path));
      const failure = deleteFailures[0] ?? postFailures[0] ?? null;
      if (!failure) {
        if (source === "menu") setNodeActionMenu(null);
        return;
      }
      const error: DesktopNodeActionError = buildDeletionError(
        failure,
        deleteFailures.length,
        deletedNodes.length,
      );

      if (source === "menu") {
        setNodeActionMenu((current) => current ? {
          ...current,
          nodes: failedNodes.length > 0 ? failedNodes : current.nodes,
          operation: null,
          error,
        } : current);
        return;
      }
      // A shortcut has no menu to update: only the failure case opens one, with
      // exactly the paths that can still be retried.
      const displayNode = failedNodes[0] ?? targets[0];
      const renameDraft = getDesktopRenameDraft(displayNode);
      setNodeActionMenu({
        launcherPath: displayNode.path,
        node: displayNode,
        nodes: failedNodes,
        anchor,
        mode: "actions",
        renameNameValue: renameDraft.nameValue,
        renameExtensionValue: renameDraft.extensionValue,
        renameFocus: "name",
        operation: null,
        error,
      });
    } finally {
      deleteLockRef.current = false;
      if (isCurrent()) setIsDeletingNodes(false);
    }
  }, [
    dataPort,
    onLocalWorkspaceContentChanged,
    onWorkspaceContentChanged,
    onResourceDeleted,
    setActiveExplorerNode,
    t,
    workspace,
  ]);

  /** Direct host entry for the file tree's keyboard path; no menu required. */
  const requestDeleteNodes = useCallback(async (nodes: readonly DataNode[], anchorRect: DOMRect) => {
    if (nodeActionMenu || createEntryDraft) return;
    await executeDeleteNodes(nodes, rectToCreateEntryAnchor(anchorRect), "shortcut");
  }, [createEntryDraft, executeDeleteNodes, nodeActionMenu]);

  /** Right-click still goes through the same execution and confirmation. */
  const deleteNodeFromMenu = useCallback(async () => {
    if (!nodeActionMenu || nodeActionMenu.operation) return;
    await executeDeleteNodes(nodeActionMenu.nodes, nodeActionMenu.anchor, "menu");
  }, [executeDeleteNodes, nodeActionMenu]);

  const copyNodePathFromMenu = useCallback(async () => {
    if (!getPathForCopy || !nodeActionMenu || nodeActionMenu.operation) return;

    const pendingDraft: DesktopNodeActionMenuDraft = {
      ...nodeActionMenu, operation: "copy-path", error: null,
    };
    setNodeActionMenu(pendingDraft);
    try {
      await writeClipboardText(getPathForCopy(pendingDraft.node.path));
      setNodeActionMenu((current) => current === pendingDraft ? null : current);
    } catch (error) {
      setNodeActionMenu((current) => current === pendingDraft ? {
        ...current, operation: null, error: toDesktopNodeActionError(error),
      } : current);
    }
  }, [getPathForCopy, nodeActionMenu]);

  const revealNodeInFinderFromMenu = useCallback(async () => {
    if (!dataPort?.revealInFileManager || !nodeActionMenu || nodeActionMenu.operation) return;

    setNodeActionMenu((current) => current ? { ...current, operation: "reveal", error: null } : current);
    try {
      await dataPort.revealInFileManager(nodeActionMenu.node.path);
      setNodeActionMenu(null);
    } catch (error) {
      setNodeActionMenu((current) => current ? {
        ...current,
        operation: null,
        error: toDesktopNodeActionError(error),
      } : current);
    }
  }, [dataPort, nodeActionMenu]);

  const openNodeInDefaultAppFromMenu = useCallback(async () => {
    if (!dataPort?.openExternalFile || !nodeActionMenu || nodeActionMenu.operation) return;
    if (nodeActionMenu.node.type === "folder") return;

    setNodeActionMenu((current) => current ? { ...current, operation: "open", error: null } : current);
    try {
      await dataPort.openExternalFile(nodeActionMenu.node.path);
      setNodeActionMenu(null);
    } catch (error) {
      setNodeActionMenu((current) => current ? {
        ...current,
        operation: null,
        error: toDesktopNodeActionError(error),
      } : current);
    }
  }, [
    dataPort,
    nodeActionMenu,
  ]);

  return {
    createEntryDraft,
    nodeActionMenu,
    fileClipboardController,
    resetDataNodeActions,
    setCreateEntryDraft,
    setNodeActionMenu,
    openCreateEntryMenu,
    openNodeActionMenu,
    createEntry,
    renameNodeFromMenu,
    deleteNodeFromMenu,
    requestDeleteNodes,
    isDeletingNodes,
    copyNodePathFromMenu,
    revealNodeInFinderFromMenu,
    openNodeInDefaultAppFromMenu,
  };
}

function remapActiveNodeAfterRename(
  node: DataNode | null,
  previousPath: string,
  nextPath: string,
  nextName: string,
): DataNode | null {
  if (!node) return node;
  if (node.path === previousPath) return { ...node, name: nextName, path: nextPath };
  if (!node.path.startsWith(`${previousPath}/`)) return node;
  return { ...node, path: remapActivePathAfterRename(node.path, previousPath, nextPath) ?? node.path };
}

function buildDeletionError(
  failure: { name: string; message: string },
  deleteFailureCount: number,
  deletedCount: number,
): DesktopNodeActionError {
  const detail = `${failure.name}: ${failure.message}`;
  if (deleteFailureCount === 0) return { code: "operation-failed", detail };
  if (deletedCount === 0) return { code: "operation-failed", detail };
  return {
    code: "delete-partial",
    deletedCount,
    failedCount: deleteFailureCount,
    detail,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeCreateEntryAnchor(anchor: DesktopCreateEntryAnchorInput) {
  return "toJSON" in anchor ? rectToCreateEntryAnchor(anchor) : anchor;
}
