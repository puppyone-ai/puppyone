import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import type { DataNode } from "@puppyone/data-core";
import { FileGlyphIcon } from "./fileIcons";

export type ExplorerTreeProps = {
  nodes: DataNode[];
  activePath: string | null;
  loadingPath?: string | null;
  rootLabel?: string;
  showRoot?: boolean;
  onSelectNode: (node: DataNode | null) => void;
  onToggleFolder?: (node: DataNode, expanded: boolean) => void;
};

export function ExplorerTree({
  nodes,
  activePath,
  loadingPath = null,
  rootLabel = "Workspace",
  showRoot = true,
  onSelectNode,
  onToggleFolder,
}: ExplorerTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(collectAncestorFolderPaths(activePath)));
  const lastAutoExpandedPath = useRef(activePath);
  const rootActive = activePath === null;

  useEffect(() => {
    if (lastAutoExpandedPath.current === activePath) return;
    lastAutoExpandedPath.current = activePath;
    if (!activePath) return;
    setExpanded((current) => {
      const next = new Set(current);
      collectAncestorFolderPaths(activePath).forEach((path) => next.add(path));
      return next;
    });
  }, [activePath]);

  const toggleFolder = (node: DataNode, nextExpanded: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (nextExpanded) next.add(node.path);
      else next.delete(node.path);
      return next;
    });
    onToggleFolder?.(node, nextExpanded);
  };

  return (
    <div className="explorer-tree">
      {showRoot && (
        <button
          className={`tree-row root ${rootActive ? "active" : ""}`}
          type="button"
          onClick={() => onSelectNode(null)}
          style={{ "--depth": 0 } as CSSProperties}
        >
          <span className="tree-row-content">
            <span className="tree-label">{rootLabel}</span>
          </span>
        </button>
      )}

      {nodes.map((node, index) => (
        <TreeNodeRow
          key={node.path}
          node={node}
          depth={showRoot ? 1 : 0}
          isLast={index === nodes.length - 1}
          expanded={expanded}
          activePath={activePath}
          loadingPath={loadingPath}
          onToggleFolder={toggleFolder}
          onSelectNode={onSelectNode}
        />
      ))}
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  isLast,
  expanded,
  activePath,
  loadingPath,
  onToggleFolder,
  onSelectNode,
}: {
  node: DataNode;
  depth: number;
  isLast: boolean;
  expanded: Set<string>;
  activePath: string | null;
  loadingPath: string | null;
  onToggleFolder: (node: DataNode, expanded: boolean) => void;
  onSelectNode: (node: DataNode) => void;
}) {
  const isFolder = node.type === "folder";
  const isExpanded = isFolder && expanded.has(node.path);
  const active = activePath === node.path;
  const loading = loadingPath === node.path;
  const children = node.children ?? [];

  const toggleCurrentFolder = () => {
    if (!isFolder) return;
    onToggleFolder(node, !isExpanded);
  };

  return (
    <>
      <button
        className={`tree-row ${isFolder ? "folder" : "file"} ${active ? "active" : ""} ${loading ? "loading" : ""} ${node.status ? `status-${node.status}` : ""}`}
        type="button"
        aria-current={active ? "true" : undefined}
        aria-expanded={isFolder ? isExpanded : undefined}
        aria-busy={loading || undefined}
        onClick={() => {
          if (isFolder) {
            toggleCurrentFolder();
            return;
          }
          onSelectNode(node);
        }}
        style={{ "--depth": depth } as CSSProperties}
      >
        <TreeIndentGuide depth={depth} />
        <span className="tree-row-content">
          <span
            className="tree-icon-slot"
            onClick={(event) => {
              if (!isFolder) return;
              event.stopPropagation();
              toggleCurrentFolder();
            }}
          >
            {isFolder ? (
              <TreeDisclosureMarker expanded={isExpanded} />
            ) : (
              <FileGlyphIcon name={node.name} type={node.type} size={18} />
            )}
          </span>
          <span className="tree-label">{node.name}</span>
          {node.status && node.status !== "clean" && (
            <span className={`tree-status ${node.status}`}>{shortStatus(node.status)}</span>
          )}
          {loading && <span className="tree-loading-dot" aria-hidden />}
        </span>
      </button>

      {isExpanded && (
        <div className="tree-subtree">
          {loading && children.length === 0 && (
            <div className="tree-meta-row" style={{ "--depth": depth + 1 } as CSSProperties}>
              Loading...
            </div>
          )}
          {!loading && children.length === 0 && node.children && (
            <div className="tree-meta-row" style={{ "--depth": depth + 1 } as CSSProperties}>
              Empty folder
            </div>
          )}
          {children.map((child, index) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              isLast={index === children.length - 1}
              expanded={expanded}
              activePath={activePath}
              loadingPath={loadingPath}
              onToggleFolder={onToggleFolder}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </>
  );
}

function TreeDisclosureMarker({
  expanded = false,
  size = 12,
}: {
  expanded?: boolean;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="tree-disclosure-marker"
      style={{
        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
      }}
    >
      <path d="M4 2.5 7.5 6 4 9.5" />
    </svg>
  );
}

function TreeIndentGuide({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  return <span className="tree-indent-guide" aria-hidden />;
}

function shortStatus(status: NonNullable<DataNode["status"]>) {
  if (status === "modified") return "M";
  if (status === "created") return "A";
  if (status === "deleted") return "D";
  if (status === "moved") return "R";
  return "";
}

function collectAncestorFolderPaths(activePath: string | null): string[] {
  if (!activePath) return [];
  const parts = activePath.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}
