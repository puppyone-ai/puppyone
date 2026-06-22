import { Link2, MoreVertical, Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { DataCapabilities, DataNode, DataPort, FileContent, Workspace } from "../core/types";
import { defaultDataCapabilities } from "../core/types";
import { shouldReadEditorContent } from "../editor/viewerRegistry";
import { ExplorerTree } from "./ExplorerTree";
import { FilePreview, type FilePreviewProps } from "./FilePreview";
import { ProjectsHeader } from "./ProjectsHeader";
import type { EditorSaveMode } from "../editor/PuppyoneEditorHost";
import type { FileIconThemeId } from "../file/fileIcons";

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
  fileUrl: string | null;
  fileUrlLoading: boolean;
  fileUrlError: string | null;
};

type CommittedPreviewDocument = {
  node: DataNode;
  fileContent: FileContent | null;
  fileUrl: string | null;
  fileUrlLoading: boolean;
  fileUrlError: string | null;
  fileError: string | null;
};

export type DataWorkspaceSlot = ReactNode | ((state: DataWorkspaceState) => ReactNode);
export type DataWorkspaceFolderSlot = ReactNode | ((state: DataWorkspaceState, folder: DataNode) => ReactNode);
export type DataWorkspaceNodeSlot = ReactNode | ((state: DataWorkspaceState, node: DataNode) => ReactNode);

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
  collapsedExplorerSlot?: DataWorkspaceSlot;
  explorerRootActionSlot?: DataWorkspaceSlot;
  explorerFolderActionSlot?: DataWorkspaceFolderSlot;
  explorerNodeActionSlot?: DataWorkspaceNodeSlot;
  resizableExplorer?: boolean;
  explorerCollapsed?: boolean;
  explorerWidth?: number;
  defaultExplorerWidth?: number;
  minExplorerWidth?: number;
  maxExplorerWidth?: number;
  collapsedExplorerWidth?: number;
  mainSlot?: DataWorkspaceSlot;
  emptySlot?: ReactNode;
  showPreviewHeader?: boolean;
  hidePreviewSourceView?: boolean;
  fileIconTheme?: FileIconThemeId;
  editorSaveMode?: EditorSaveMode;
  previewActionSlot?: FilePreviewProps["actionSlot"];
  renderPreviewBody?: FilePreviewProps["renderBody"];
  refreshKey?: unknown;
  onExplorerWidthChange?: (width: number) => void;
  onExplorerCollapsedChange?: (collapsed: boolean) => void;
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
const DEFAULT_EXPLORER_WIDTH = 320;
const MIN_EXPLORER_WIDTH = 240;
const MAX_EXPLORER_WIDTH = 520;
const COLLAPSED_EXPLORER_WIDTH = 47;

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
  collapsedExplorerSlot,
  explorerRootActionSlot,
  explorerFolderActionSlot,
  explorerNodeActionSlot,
  resizableExplorer = false,
  explorerCollapsed = false,
  explorerWidth,
  defaultExplorerWidth = DEFAULT_EXPLORER_WIDTH,
  minExplorerWidth = MIN_EXPLORER_WIDTH,
  maxExplorerWidth = MAX_EXPLORER_WIDTH,
  collapsedExplorerWidth = COLLAPSED_EXPLORER_WIDTH,
  mainSlot,
  emptySlot,
  showPreviewHeader = true,
  hidePreviewSourceView = false,
  fileIconTheme = "default",
  editorSaveMode = "manual",
  previewActionSlot,
  renderPreviewBody,
  refreshKey,
  onExplorerWidthChange,
  onExplorerCollapsedChange,
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
  const [fileContentCache, setFileContentCache] = useState<Record<string, FileContent>>({});
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileErrorPath, setFileErrorPath] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileUrlPath, setFileUrlPath] = useState<string | null>(null);
  const [fileUrlLoading, setFileUrlLoading] = useState(false);
  const [fileUrlError, setFileUrlError] = useState<string | null>(null);
  const [committedPreviewDocument, setCommittedPreviewDocument] = useState<CommittedPreviewDocument | null>(null);
  const lastRefreshKeyRef = useRef(refreshKey);
  const [internalExplorerWidth, setInternalExplorerWidth] = useState(() => (
    clampNumber(defaultExplorerWidth, minExplorerWidth, maxExplorerWidth)
  ));
  const resolvedActivePath = activePath !== undefined ? activePath : internalActivePath;
  const expandedExplorerWidth = clampNumber(
    explorerWidth ?? internalExplorerWidth,
    minExplorerWidth,
    maxExplorerWidth,
  );
  const resolvedExplorerWidth = clampNumber(
    explorerCollapsed ? collapsedExplorerWidth : expandedExplorerWidth,
    collapsedExplorerWidth,
    maxExplorerWidth,
  );

  const setExplorerWidth = useCallback(
    (nextWidth: number) => {
      const clampedWidth = clampNumber(nextWidth, minExplorerWidth, maxExplorerWidth);
      if (explorerWidth === undefined) setInternalExplorerWidth(clampedWidth);
      onExplorerWidthChange?.(clampedWidth);
    },
    [explorerWidth, maxExplorerWidth, minExplorerWidth, onExplorerWidthChange],
  );

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
    setFileContentCache({});
    setFileError(null);
    setFileErrorPath(null);
    setFileLoading(false);
    setFileUrl(null);
    setFileUrlPath(null);
    setFileUrlError(null);
    setFileUrlLoading(false);
    setCommittedPreviewDocument(null);
    setLoadingPath(ROOT_FOLDER_KEY);
  }, [workspace.path, dataPort, defaultActivePath]);

  useEffect(() => {
    if (explorerWidth !== undefined) return;
    setInternalExplorerWidth(clampNumber(defaultExplorerWidth, minExplorerWidth, maxExplorerWidth));
  }, [defaultExplorerWidth, explorerWidth, maxExplorerWidth, minExplorerWidth]);

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

  useEffect(() => {
    if (refreshKey === undefined || Object.is(lastRefreshKeyRef.current, refreshKey)) {
      return undefined;
    }

    lastRefreshKeyRef.current = refreshKey;
    const loadedFolderPaths = collectLoadedFolderPaths(tree);
    let cancelled = false;

    setLoadingPath(ROOT_FOLDER_KEY);
    setLoadError(null);

    dataPort.listChildren(null)
      .then(async (rootChildren) => {
        const folderResults = await Promise.all(
          loadedFolderPaths.map(async (folderPath) => ({
            folderPath,
            children: await dataPort.listChildren(folderPath).catch(() => null),
          })),
        );

        if (cancelled) return;

        let nextTree = rootChildren;
        for (const result of folderResults) {
          if (result.children) {
            nextTree = attachFolderChildren(nextTree, result.folderPath, result.children);
          }
        }
        setTree(nextTree);
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
  }, [dataPort, refreshKey, tree]);

  const activeNode = useMemo(() => findDataNode(tree, resolvedActivePath), [resolvedActivePath, tree]);
  const currentFolderPath = activeNode?.type === "folder" ? activeNode.path : getParentPath(resolvedActivePath);
  const selectedFile = activeNode?.type !== "folder" ? activeNode : null;
  const selectedFileNeedsFullContent = Boolean(selectedFile && dataPort.readFile && shouldReadEditorContent(selectedFile));
  const cachedSelectedFileContent = selectedFile ? fileContentCache[selectedFile.path] ?? null : null;
  const selectedFileContent = fileContent?.path === selectedFile?.path ? fileContent : cachedSelectedFileContent;
  const selectedFileError = fileErrorPath === selectedFile?.path ? fileError : null;
  const selectedFileContentPending = Boolean(
    selectedFileNeedsFullContent && selectedFile && !selectedFileContent && !selectedFileError,
  );
  const selectedFileUrl = fileUrlPath === selectedFile?.path ? fileUrl : null;
  const selectedFileUrlLoading = fileUrlPath === selectedFile?.path ? fileUrlLoading : false;
  const selectedFileUrlError = fileUrlPath === selectedFile?.path ? fileUrlError : null;
  const selectedPreviewDocument = useMemo<CommittedPreviewDocument | null>(() => (
    selectedFile
      ? {
          node: selectedFile,
          fileContent: selectedFileContent,
          fileUrl: selectedFileUrl,
          fileUrlLoading: selectedFileUrlLoading,
          fileUrlError: selectedFileUrlError,
          fileError: selectedFileError,
        }
      : null
  ), [selectedFile, selectedFileContent, selectedFileError, selectedFileUrl, selectedFileUrlError, selectedFileUrlLoading]);
  const renderedPreviewDocument = selectedFileContentPending && committedPreviewDocument
    ? committedPreviewDocument
    : selectedPreviewDocument;
  const renderedPreviewIsSelectedFile = renderedPreviewDocument?.node.path === selectedFile?.path;
  const renderedPreviewLoading = renderedPreviewIsSelectedFile
    ? fileLoading || selectedFileContentPending
    : selectedFileContentPending;
  const renderedPreviewError = renderedPreviewIsSelectedFile ? selectedFileError : null;
  const renderedPreviewUrlLoading = renderedPreviewIsSelectedFile
    ? selectedFileUrlLoading
    : renderedPreviewDocument?.fileUrlLoading ?? false;
  const renderedPreviewUrlError = renderedPreviewIsSelectedFile
    ? selectedFileUrlError
    : renderedPreviewDocument?.fileUrlError ?? null;
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
    fileContent: selectedFileContent,
    fileLoading: fileLoading || selectedFileContentPending,
    fileError: selectedFileError,
    fileUrl: selectedFileUrl,
    fileUrlLoading: selectedFileUrlLoading,
    fileUrlError: selectedFileUrlError,
  };

  useEffect(() => {
    if (!selectedPreviewDocument) {
      setCommittedPreviewDocument(null);
      return;
    }

    if (selectedFileContentPending) return;
    setCommittedPreviewDocument(selectedPreviewDocument);
  }, [selectedPreviewDocument, selectedFileContentPending]);

  useEffect(() => {
    if (!selectedFile) {
      setFileContent(null);
      setFileError(null);
      setFileErrorPath(null);
      setFileLoading(false);
      return undefined;
    }

    if (!dataPort.readFile) {
      setFileContent(null);
      setFileError(null);
      setFileErrorPath(null);
      setFileLoading(false);
      return undefined;
    }

    if (!shouldReadEditorContent(selectedFile)) {
      setFileContent(null);
      setFileError(null);
      setFileErrorPath(null);
      setFileLoading(false);
      return undefined;
    }

    let cancelled = false;
    setFileContent(null);
    setFileLoading(true);
    setFileError(null);
    setFileErrorPath(null);
    dataPort.readFile(selectedFile.path)
      .then((content) => {
        if (!cancelled) {
          setFileContent(content);
          setFileContentCache((current) => ({
            ...current,
            [content.path]: content,
          }));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setFileContent(null);
          setFileErrorPath(selectedFile.path);
          setFileError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dataPort, refreshKey, selectedFile?.path]);

  useEffect(() => {
    if (!selectedFile || !dataPort.getFileUrl) {
      setFileUrl(null);
      setFileUrlPath(null);
      setFileUrlError(null);
      setFileUrlLoading(false);
      return undefined;
    }

    let cancelled = false;
    setFileUrl(null);
    setFileUrlPath(selectedFile.path);
    setFileUrlLoading(true);
    setFileUrlError(null);

    Promise.resolve(dataPort.getFileUrl(selectedFile.path))
      .then((url) => {
        if (!cancelled) setFileUrl(url);
      })
      .catch((error) => {
        if (!cancelled) {
          setFileUrl(null);
          setFileUrlPath(selectedFile.path);
          setFileUrlError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setFileUrlLoading(false);
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

  const saveFileContent = async (node: DataNode, content: string) => {
    if (!dataPort.writeFile) return;

    await dataPort.writeFile(node.path, content);

    const existingContent = fileContent?.path === node.path
      ? fileContent
      : fileContentCache[node.path] ?? null;
    const nextContent: FileContent = existingContent
      ? { ...existingContent, content }
      : {
          path: node.path,
          name: node.name,
          type: node.type,
          content,
        };

    setFileContent((current) => (
      current?.path === node.path || selectedFile?.path === node.path
        ? nextContent
        : current
    ));
    setFileContentCache((current) => ({
      ...current,
      [node.path]: nextContent,
    }));
    setCommittedPreviewDocument((current) => (
      current?.node.path === node.path
        ? {
            ...current,
            node: { ...current.node, content },
            fileContent: nextContent,
          }
        : current
    ));
    setTree((current) => updateNodeContent(current, node.path, content));
  };

  const beginExplorerResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!resizableExplorer) return;

      event.preventDefault();
      const startX = event.clientX;
      const startWidth = explorerCollapsed ? minExplorerWidth : expandedExplorerWidth;

      if (explorerCollapsed) {
        onExplorerCollapsedChange?.(false);
      }

      const moveExplorerResize = (moveEvent: PointerEvent) => {
        setExplorerWidth(startWidth + moveEvent.clientX - startX);
      };

      const stopExplorerResize = () => {
        window.removeEventListener("pointermove", moveExplorerResize);
        window.removeEventListener("pointerup", stopExplorerResize);
        document.body.classList.remove("data-sidebar-resizing");
      };

      document.body.classList.add("data-sidebar-resizing");
      window.addEventListener("pointermove", moveExplorerResize);
      window.addEventListener("pointerup", stopExplorerResize);
    },
    [expandedExplorerWidth, explorerCollapsed, minExplorerWidth, onExplorerCollapsedChange, resizableExplorer, setExplorerWidth],
  );

  const nudgeExplorerWidth = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!resizableExplorer) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setExplorerWidth(resolvedExplorerWidth - (event.shiftKey ? 24 : 12));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setExplorerWidth(resolvedExplorerWidth + (event.shiftKey ? 24 : 12));
    } else if (event.key === "Home") {
      event.preventDefault();
      setExplorerWidth(minExplorerWidth);
    } else if (event.key === "End") {
      event.preventDefault();
      setExplorerWidth(maxExplorerWidth);
    }
  };

  const dataContentStyle = resizableExplorer
    ? ({ "--data-explorer-width": `${resolvedExplorerWidth}px` } as CSSProperties)
    : undefined;

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

      <div
        className="data-content"
        data-explorer-collapsed={explorerCollapsed ? "true" : undefined}
        data-resizable-explorer={resizableExplorer ? "true" : undefined}
        style={dataContentStyle}
      >
        <aside className="explorer-column">
          {!explorerCollapsed && (
            <>
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
              <div className="data-explorer-view-frame" data-view-mode={explorerSlot ? "custom" : "files"}>
                {explorerSlot ? (
                  renderWorkspaceSlot(explorerSlot, workspaceState)
                ) : (
                  <ExplorerTree
                    nodes={tree}
                    activePath={resolvedActivePath}
                    loadingPath={loadingPath}
                    rootLoading={rootLoading}
                    rootError={loadError}
                    rootLabel={labels?.root ?? "Root"}
                    showRoot
                    loadingLabel={labels?.loadingWorkspace ?? "Loading workspace..."}
                    onToggleFolder={toggleFolder}
                    onSelectNode={selectNode}
                    fileIconTheme={fileIconTheme}
                    renderRootActions={explorerRootActionSlot ? () => renderWorkspaceSlot(explorerRootActionSlot, workspaceState) : undefined}
                    renderFolderActions={explorerFolderActionSlot ? (folder) => renderWorkspaceFolderSlot(explorerFolderActionSlot, workspaceState, folder) : undefined}
                    renderNodeActions={explorerNodeActionSlot ? (node) => renderWorkspaceNodeSlot(explorerNodeActionSlot, workspaceState, node) : undefined}
                  />
                )}
              </div>
            </>
          )}
          {explorerCollapsed && (
            <div className="data-explorer-collapsed-fill" aria-hidden="true" />
          )}
          {!explorerCollapsed && explorerFooterSlot && (
            <div className="data-explorer-footer">
              {renderWorkspaceSlot(explorerFooterSlot, workspaceState)}
            </div>
          )}
          {resizableExplorer && !explorerCollapsed && (
            <div
              className="data-explorer-resizer"
              role="separator"
              aria-label="Resize sidebar"
              aria-orientation="vertical"
              aria-valuemin={minExplorerWidth}
              aria-valuemax={maxExplorerWidth}
              aria-valuenow={resolvedExplorerWidth}
              tabIndex={0}
              onPointerDown={beginExplorerResize}
              onKeyDown={nudgeExplorerWidth}
            />
          )}
        </aside>

        {explorerCollapsed && collapsedExplorerSlot && (
          <div className="data-explorer-collapsed-slot">
            {renderWorkspaceSlot(collapsedExplorerSlot, workspaceState)}
          </div>
        )}

        <main className="browser-column desktop-editor-panel">
          <div className="data-main-view-frame" data-view-mode={mainSlot ? "custom" : "files"}>
            {mainSlot ? (
              renderWorkspaceSlot(mainSlot, workspaceState)
            ) : (
              <FilePreview
                node={renderedPreviewDocument?.node ?? null}
                fileContent={renderedPreviewDocument?.fileContent ?? null}
                fileUrl={renderedPreviewDocument?.fileUrl ?? null}
                fileUrlLoading={renderedPreviewUrlLoading}
                fileUrlError={renderedPreviewUrlError}
                loading={renderedPreviewLoading}
                error={renderedPreviewError}
                showHeader={showPreviewHeader}
                hideSourceView={hidePreviewSourceView}
                fileIconTheme={fileIconTheme}
                editorSaveMode={editorSaveMode}
                emptySlot={emptySlot}
                actionSlot={previewActionSlot}
                renderBody={renderPreviewBody}
                onSaveContent={dataPort.writeFile && renderedPreviewDocument
                  ? (content) => saveFileContent(renderedPreviewDocument.node, content)
                  : undefined}
              />
            )}
          </div>
        </main>
      </div>
    </section>
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
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

function collectLoadedFolderPaths(nodes: DataNode[]): string[] {
  const paths: string[] = [];

  for (const node of nodes) {
    if (node.type === "folder" && Array.isArray(node.children)) {
      paths.push(node.path);
      paths.push(...collectLoadedFolderPaths(node.children));
    }
  }

  return paths;
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

function renderWorkspaceFolderSlot(
  slot: DataWorkspaceFolderSlot | undefined,
  state: DataWorkspaceState,
  folder: DataNode,
): ReactNode {
  if (!slot) return null;
  return typeof slot === "function" ? slot(state, folder) : slot;
}

function renderWorkspaceNodeSlot(
  slot: DataWorkspaceNodeSlot | undefined,
  state: DataWorkspaceState,
  node: DataNode,
): ReactNode {
  if (!slot) return null;
  return typeof slot === "function" ? slot(state, node) : slot;
}
