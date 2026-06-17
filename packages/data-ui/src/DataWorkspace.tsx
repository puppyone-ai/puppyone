import { Link2, MoreVertical, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DataCapabilities, DataNode, DataPort, Workspace } from "@puppyone/data-core";
import { defaultDataCapabilities } from "@puppyone/data-core";
import { ExplorerTree } from "./ExplorerTree";
import { FilePreview } from "./FilePreview";
import { ProjectsHeader } from "./ProjectsHeader";

export type DataWorkspaceProps = {
  workspace: Workspace;
  dataPort: DataPort;
  capabilities?: DataCapabilities;
};

const ROOT_FOLDER_KEY = "__puppyone_workspace_root__";

export function DataWorkspace({ workspace, dataPort, capabilities }: DataWorkspaceProps) {
  const resolvedCapabilities = { ...defaultDataCapabilities, ...capabilities };
  const [tree, setTree] = useState<DataNode[]>([]);
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
    setActivePath(null);
    setTree([]);
    setLoadError(null);
    setLoadingPath(ROOT_FOLDER_KEY);
  }, [workspace.path, dataPort]);

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

  const activeNode = useMemo(() => findDataNode(tree, activePath), [activePath, tree]);
  const currentFolderPath = activeNode?.type === "folder" ? activeNode.path : getParentPath(activePath);
  const selectedFile = activeNode?.type !== "folder" ? activeNode : null;
  const pathSegments = buildBreadcrumb(workspace.name, currentFolderPath, selectedFile?.name)
    .map((label) => ({ label }));
  const rootLoading = loadingPath === ROOT_FOLDER_KEY;

  const selectNode = (node: DataNode | null) => {
    setActivePath(node?.path ?? null);
    if (!node || node.type === "folder") {
      void loadFolder(node?.path ?? null);
    }
  };

  return (
    <section className="data-workspace">
      <ProjectsHeader pathSegments={pathSegments} />

      <div className="data-content">
        <aside className="explorer-column">
          <div className="desktop-explorer-toolbar">
            <span>Root</span>
            <div className="desktop-explorer-actions">
              {resolvedCapabilities.create && (
                <button type="button" aria-label="Create">
                  <Plus size={15} />
                </button>
              )}
              <button type="button" aria-label="More">
                <MoreVertical size={15} />
              </button>
              {resolvedCapabilities.accessPoints && (
                <button type="button" aria-label="Access">
                  <Link2 size={15} />
                </button>
              )}
            </div>
          </div>
          <ExplorerTree
            nodes={tree}
            activePath={activePath}
            rootLabel={workspace.name}
            showRoot={false}
            onSelectNode={selectNode}
          />
          {rootLoading && <div className="folder-state compact">Loading workspace...</div>}
          {loadError && <div className="folder-state error compact">{loadError}</div>}
        </aside>

        <main className="browser-column desktop-editor-panel">
          <FilePreview node={selectedFile} />
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
