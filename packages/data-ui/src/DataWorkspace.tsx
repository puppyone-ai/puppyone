import { Link2, MoreVertical, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DataCapabilities, DataNode, DataPort, FileContent, Workspace } from "@puppyone/data-core";
import { defaultDataCapabilities } from "@puppyone/data-core";
import { ExplorerTree } from "./ExplorerTree";
import { FilePreview, type FilePreviewProps } from "./FilePreview";
import { ProjectsHeader } from "./ProjectsHeader";

export type DataWorkspaceState = {
  tree: DataNode[];
  activePath: string | null;
  activeNode: DataNode | null;
  currentFolderPath: string | null;
  selectedFile: DataNode | null;
  loadingPath: string | null;
  loadError: string | null;
  rootLoading: boolean;
  fileContent: FileContent | null;
  fileLoading: boolean;
  fileError: string | null;
};

export type DataWorkspaceSlot = ReactNode | ((state: DataWorkspaceState) => ReactNode);

export type DataWorkspaceProps = {
  workspace: Workspace;
  dataPort: DataPort;
  capabilities?: DataCapabilities;
  activePath?: string | null;
  defaultActivePath?: string | null;
  showHeader?: boolean;
  showExplorerToolbar?: boolean;
  headerSlot?: DataWorkspaceSlot;
  headerActionSlot?: DataWorkspaceSlot;
  explorerToolbarSlot?: DataWorkspaceSlot;
  explorerSlot?: DataWorkspaceSlot;
  explorerFooterSlot?: DataWorkspaceSlot;
  mainSlot?: DataWorkspaceSlot;
  emptySlot?: ReactNode;
  showPreviewHeader?: boolean;
  previewActionSlot?: FilePreviewProps["actionSlot"];
  renderPreviewBody?: FilePreviewProps["renderBody"];
  onActivePathChange?: (path: string | null, node: DataNode | null) => void;
  onCreate?: (folderPath: string | null) => void;
  onMore?: (state: DataWorkspaceState) => void;
  onAccess?: (folderPath: string | null) => void;
  labels?: Partial<{
    root: string;
    loadingWorkspace: string;
  }>;
};

const ROOT_FOLDER_KEY = "__puppyone_workspace_root__";

export function DataWorkspace({
  workspace,
  dataPort,
  capabilities,
  activePath,
  defaultActivePath = null,
  showHeader = true,
  showExplorerToolbar = true,
  headerSlot,
  headerActionSlot,
  explorerToolbarSlot,
  explorerSlot,
  explorerFooterSlot,
  mainSlot,
  emptySlot,
  showPreviewHeader = true,
  previewActionSlot,
  renderPreviewBody,
  onActivePathChange,
  onCreate,
  onMore,
  onAccess,
  labels,
}: DataWorkspaceProps) {
  const resolvedCapabilities = { ...defaultDataCapabilities, ...capabilities };
  const [tree, setTree] = useState<DataNode[]>([]);
  const [internalActivePath, setInternalActivePath] = useState<string | null>(defaultActivePath);
  const [loadingPath, setLoadingPath] = useState<string | null>(ROOT_FOLDER_KEY);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const resolvedActivePath = activePath !== undefined ? activePath : internalActivePath;

  const loadFolder = useCallback(
    async (folderPath: string | null, force = false) => {
      if (!force && hasLoadedFolder(tree, folderPath)) return;

      const loadingKey = getLoadingKey(folderPath);
      setLoadingPath(loadingKey);
      setLoadError(null);

      try {
        const children = await dataPort.listChildren(folderPath);
        setTree((current) => attachFolderChildren(current, folderPath, children));
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        setLoadingPath((current) => (current === loadingKey ? null : current));
      }
    },
    [dataPort, tree],
  );

  useEffect(() => {
    setInternalActivePath(defaultActivePath);
    setTree([]);
    setLoadError(null);
    setFileContent(null);
    setFileError(null);
    setFileLoading(false);
    setLoadingPath(ROOT_FOLDER_KEY);
  }, [workspace.path, dataPort, defaultActivePath]);

  useEffect(() => {
    let cancelled = false;

    setLoadingPath(ROOT_FOLDER_KEY);
    setLoadError(null);
    dataPort.listChildren(null)
      .then((children) => {
        if (!cancelled) setTree(children);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingPath((current) => (current === ROOT_FOLDER_KEY ? null : current));
      });

    return () => {
      cancelled = true;
    };
  }, [workspace.path, dataPort]);

  const activeNode = useMemo(() => findDataNode(tree, resolvedActivePath), [resolvedActivePath, tree]);
  const currentFolderPath = activeNode?.type === "folder" ? activeNode.path : getParentPath(resolvedActivePath);
  const selectedFile = activeNode?.type !== "folder" ? activeNode : null;
  const pathSegments = buildBreadcrumb(workspace.name, currentFolderPath, selectedFile?.name)
    .map((label) => ({ label }));
  const rootLoading = loadingPath === ROOT_FOLDER_KEY;
  const workspaceState: DataWorkspaceState = {
    tree,
    activePath: resolvedActivePath,
    activeNode,
    currentFolderPath,
    selectedFile,
    loadingPath,
    loadError,
    rootLoading,
    fileContent,
    fileLoading,
    fileError,
  };

  useEffect(() => {
    if (!selectedFile) {
      setFileContent(null);
      setFileError(null);
      setFileLoading(false);
      return undefined;
    }

    if (!dataPort.readFile) {
      setFileContent(null);
      setFileError(null);
      setFileLoading(false);
      return undefined;
    }

    let cancelled = false;
    setFileLoading(true);
    setFileError(null);
    dataPort.readFile(selectedFile.path)
      .then((content) => {
        if (!cancelled) setFileContent(content);
      })
      .catch((error) => {
        if (!cancelled) {
          setFileContent(null);
          setFileError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dataPort, selectedFile?.path]);

  const selectNode = (node: DataNode | null) => {
    const nextPath = node?.path ?? null;
    if (activePath === undefined) setInternalActivePath(nextPath);
    onActivePathChange?.(nextPath, node);
    if (!node) {
      void loadFolder(null);
    }
  };

  const toggleFolder = (node: DataNode, expanded: boolean) => {
    if (expanded) void loadFolder(node.path);
  };

  const saveSelectedFile = async (content: string) => {
    if (!selectedFile || !dataPort.writeFile) return;
    await dataPort.writeFile(selectedFile.path, content);
    setFileContent((current) => (
      current
        ? { ...current, content }
        : {
            path: selectedFile.path,
            name: selectedFile.name,
            type: selectedFile.type,
            content,
          }
    ));
    setTree((current) => updateNodeContent(current, selectedFile.path, content));
  };

  return (
    <section className="data-workspace">
      {showHeader && (
        headerSlot ? (
          renderWorkspaceSlot(headerSlot, workspaceState)
        ) : (
          <ProjectsHeader
            pathSegments={pathSegments}
            actionSlot={renderWorkspaceSlot(headerActionSlot, workspaceState)}
          />
        )
      )}

      <div className="data-content">
        <aside className="explorer-column">
          {showExplorerToolbar && (
            explorerToolbarSlot ? (
              renderWorkspaceSlot(explorerToolbarSlot, workspaceState)
            ) : (
              <div className="desktop-explorer-toolbar">
                <span>{labels?.root ?? "Root"}</span>
                <div className="desktop-explorer-actions">
                  {resolvedCapabilities.create && onCreate && (
                    <button type="button" aria-label="Create" onClick={() => onCreate(currentFolderPath)}>
                      <Plus size={15} />
                    </button>
                  )}
                  {onMore && (
                    <button type="button" aria-label="More" onClick={() => onMore(workspaceState)}>
                      <MoreVertical size={15} />
                    </button>
                  )}
                  {resolvedCapabilities.accessPoints && onAccess && (
                    <button type="button" aria-label="Access" onClick={() => onAccess(currentFolderPath)}>
                      <Link2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            )
          )}
          {explorerSlot ? (
            renderWorkspaceSlot(explorerSlot, workspaceState)
          ) : (
            <>
              <ExplorerTree
                nodes={tree}
                activePath={resolvedActivePath}
                loadingPath={loadingPath}
                rootLabel={workspace.name}
                showRoot={false}
                onToggleFolder={toggleFolder}
                onSelectNode={selectNode}
              />
              {rootLoading && <div className="folder-state compact">{labels?.loadingWorkspace ?? "Loading workspace..."}</div>}
              {loadError && <div className="folder-state error compact">{loadError}</div>}
            </>
          )}
          {explorerFooterSlot && (
            <div className="data-explorer-footer">
              {renderWorkspaceSlot(explorerFooterSlot, workspaceState)}
            </div>
          )}
        </aside>

        <main className="browser-column desktop-editor-panel">
          {mainSlot ? (
            renderWorkspaceSlot(mainSlot, workspaceState)
          ) : (
            <FilePreview
              node={selectedFile}
              fileContent={fileContent}
              loading={fileLoading}
              error={fileError}
              showHeader={showPreviewHeader}
              emptySlot={emptySlot}
              actionSlot={previewActionSlot}
              renderBody={renderPreviewBody}
              onSaveContent={dataPort.writeFile ? saveSelectedFile : undefined}
            />
          )}
        </main>
      </div>
    </section>
  );
}

function findDataNode(nodes: DataNode[], path: string | null): DataNode | null {
  if (!path) return null;

  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const child = findDataNode(node.children, path);
      if (child) return child;
    }
  }

  return null;
}

function hasLoadedFolder(nodes: DataNode[], folderPath: string | null): boolean {
  if (!folderPath) return nodes.length > 0;
  const node = findDataNode(nodes, folderPath);
  return node?.type === "folder" && Array.isArray(node.children);
}

function attachFolderChildren(
  nodes: DataNode[],
  folderPath: string | null,
  children: DataNode[],
): DataNode[] {
  if (!folderPath) return children;

  return nodes.map((node) => {
    if (node.path === folderPath) {
      return { ...node, children };
    }
    if (node.children) {
      return {
        ...node,
        children: attachFolderChildren(node.children, folderPath, children),
      };
    }
    return node;
  });
}

function updateNodeContent(nodes: DataNode[], path: string, content: string): DataNode[] {
  return nodes.map((node) => {
    if (node.path === path) {
      return {
        ...node,
        content,
        preview: buildPreview(content),
      };
    }
    if (node.children) {
      return {
        ...node,
        children: updateNodeContent(node.children, path, content),
      };
    }
    return node;
  });
}

function buildPreview(content: string): string | null {
  const preview = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join("\n");
  return preview || null;
}

function getParentPath(path: string | null): string | null {
  if (!path || !path.includes("/")) return null;
  return path.slice(0, path.lastIndexOf("/"));
}

function getLoadingKey(folderPath: string | null): string {
  return folderPath ?? ROOT_FOLDER_KEY;
}

function buildBreadcrumb(workspaceName: string, folderPath: string | null, selectedFile?: string): string[] {
  const parts = [workspaceName];
  if (folderPath) parts.push(...folderPath.split("/"));
  if (selectedFile) parts.push(selectedFile);
  return parts;
}

function renderWorkspaceSlot(slot: DataWorkspaceSlot | undefined, state: DataWorkspaceState): ReactNode {
  if (!slot) return null;
  return typeof slot === "function" ? slot(state) : slot;
}
