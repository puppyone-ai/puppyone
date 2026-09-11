import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
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

export function useDataNodeActions({
  dataPort: rawDataPort,
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
      selectedKind: null,
      name: "",
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

  const selectCreateEntryKind = useCallback((kind: DesktopCreateEntryKind) => {
    if (!createEntryDraft) return;
    setCreateEntryDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        selectedKind: kind,
        name: defaultCreateName(kind, t),
        error: null,
      };
    });
  }, [createEntryDraft, t]);

  const createEntryFromMenu = useCallback(async () => {
    if (
      !workspace ||
      !dataPort ||
      !createEntryDraft ||
      createEntryDraft.creatingKind ||
      !createEntryDraft.selectedKind
    ) return;

    const kind = createEntryDraft.selectedKind;
    if (kind === "slides") {
      if (!dataPort.instantiateTemplate) return;
    } else if (!dataPort.createFolder || !dataPort.createFile) {
      return;
    }
    let requestedName: string;
    try {
      requestedName = normalizeCreateEntryName(kind, createEntryDraft.name);
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
      setActiveExplorerNode((current) => (
        current?.path === previousPath
          ? { ...current, name: nextName, path: nextPath }
          : current?.path.startsWith(`${previousPath}/`)
            ? { ...current, path: remapActivePathAfterRename(current.path, previousPath, nextPath) ?? current.path }
            : current
      ));
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

  const deleteNodeFromMenu = useCallback(async () => {
    if (!dataPort?.deleteNode || !nodeActionMenu || nodeActionMenu.operation) return;

    const nodes = collapseNestedNodes(nodeActionMenu.nodes);
    if (nodes.length === 0) return;
    const confirmed = window.confirm(nodes.length === 1
      ? t("workspace.node.confirmDeleteOne", { name: bidiIsolate(nodes[0].name) })
      : t("workspace.node.confirmDeleteMany", { count: nodes.length }));
    if (!confirmed) return;

    setNodeActionMenu((current) => current ? { ...current, operation: "delete", error: null } : current);
    const deletedNodes: DataNode[] = [];
    const failures: Array<{ name: string; message: string }> = [];
    for (const node of nodes) {
      try {
        await dataPort.deleteNode(node.path);
        deletedNodes.push(node);
        await onResourceDeleted?.(node.path);
      } catch (error) {
        failures.push({
          name: node.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (deletedNodes.length > 0) {
      setActiveExplorerNode((current) => (
        deletedNodes.some((node) => current?.path === node.path || current?.path.startsWith(`${node.path}/`)) ? null : current
      ));
      onWorkspaceContentChanged();
      onLocalWorkspaceContentChanged();
    }

    if (failures.length === 0) {
      setNodeActionMenu(null);
    } else {
      setNodeActionMenu((current) => current ? {
        ...current,
        operation: null,
        error: deletedNodes.length > 0
          ? {
              code: "delete-partial",
              deletedCount: deletedNodes.length,
              failedCount: failures.length,
              detail: `${failures[0]?.name ?? ""}: ${failures[0]?.message ?? ""}`,
            }
          : {
              code: "operation-failed",
              detail: `${failures[0]?.name ?? ""}: ${failures[0]?.message ?? ""}`,
            },
      } : current);
    }
  }, [
    dataPort,
    nodeActionMenu,
    onLocalWorkspaceContentChanged,
    onWorkspaceContentChanged,
    onResourceDeleted,
    setActiveExplorerNode,
    t,
  ]);

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
    selectCreateEntryKind,
    createEntryFromMenu,
    renameNodeFromMenu,
    deleteNodeFromMenu,
    revealNodeInFinderFromMenu,
    openNodeInDefaultAppFromMenu,
  };
}

function normalizeCreateEntryAnchor(anchor: DesktopCreateEntryAnchorInput) {
  return "toJSON" in anchor ? rectToCreateEntryAnchor(anchor) : anchor;
}
