import { useCallback, useEffect, useMemo, useState } from "react";
import { GridView, type ContentType } from "../../cloud-source/frontend/app/(main)/projects/[projectId]/data/components/views/GridView";
import { ProjectsHeader } from "../../cloud-source/frontend/components/ProjectsHeader";
import { FileTree } from "./FileTree";
import {
  attachFolderChildren,
  findFileNode,
  hasLoadedFolder,
  loadFolderChildren,
  listFolderChildren,
  type FileNode,
  type Workspace,
} from "../lib/localFiles";

type DataWorkspaceProps = {
  workspace: Workspace;
};

const ROOT_FOLDER_KEY = "__puppyone_workspace_root__";

export function DataWorkspace({ workspace }: DataWorkspaceProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [loadingPath, setLoadingPath] = useState<string | null>(ROOT_FOLDER_KEY);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadFolder = useCallback(
    async (folderPath: string | null, force = false) => {
      if (!force && hasLoadedFolder(tree, folderPath)) return;

      const loadingKey = getLoadingKey(folderPath);
      setLoadingPath(loadingKey);
      setLoadError(null);

      try {
        const children = await loadFolderChildren(workspace.path, folderPath);
        setTree((current) => attachFolderChildren(current, folderPath, children));
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        setLoadingPath((current) => (current === loadingKey ? null : current));
      }
    },
    [tree, workspace.path],
  );

  useEffect(() => {
    setActivePath(null);
    setTree([]);
    setLoadError(null);
    setLoadingPath(ROOT_FOLDER_KEY);
  }, [workspace.path]);

  useEffect(() => {
    let cancelled = false;

    setLoadingPath(ROOT_FOLDER_KEY);
    setLoadError(null);
    loadFolderChildren(workspace.path, null)
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
  }, [workspace.path]);

  const activeNode = useMemo(() => findFileNode(tree, activePath), [activePath, tree]);
  const currentFolderPath = activeNode?.type === "folder" ? activeNode.path : getParentPath(activePath);
  const visibleChildren = useMemo(
    () => listFolderChildren(tree, currentFolderPath),
    [currentFolderPath, tree],
  );
  const selectNode = (node: FileNode | null) => {
    setActivePath(node?.path ?? null);
    if (!node || node.type === "folder") {
      void loadFolder(node?.path ?? null);
    }
  };

  const gridItems = useMemo(
    () =>
      visibleChildren.map((node) => ({
        id: node.path,
        name: node.name,
        type: toCloudContentType(node.type),
        mut_path: `/${node.path}`,
        preview_snippet: node.content ?? node.preview ?? null,
        children_count: node.children?.length ?? null,
        onClick: () => selectNode(node),
      })),
    [visibleChildren, loadFolder],
  );

  const selectedFile = activeNode?.type !== "folder" ? activeNode : null;
  const pathSegments = buildBreadcrumb(workspace.name, currentFolderPath, selectedFile?.name)
    .map((label) => ({ label }));
  const currentFolderLoading = loadingPath === getLoadingKey(currentFolderPath);

  return (
    <section className="data-workspace">
      <ProjectsHeader
        pathSegments={pathSegments}
        projectId={workspace.id}
      />

      <div className="data-content">
        <aside className="explorer-column">
          <FileTree
            nodes={tree}
            activePath={activePath}
            rootLabel={workspace.name}
            onSelectNode={selectNode}
          />
        </aside>

        <main className="browser-column">
          <div className="cloud-grid-host">
            {loadError ? (
              <div className="folder-state error">{loadError}</div>
            ) : !currentFolderLoading && gridItems.length === 0 ? (
              <div className="folder-state">Empty folder</div>
            ) : (
              <GridView
                items={gridItems}
                parentFolderId={currentFolderPath}
                highlightNodeId={activePath}
                loading={currentFolderLoading}
              />
            )}
          </div>
        </main>
      </div>
    </section>
  );
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

function toCloudContentType(type: FileNode["type"]): ContentType {
  return type;
}
