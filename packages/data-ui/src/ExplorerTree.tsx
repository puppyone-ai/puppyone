import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import type { DataNode } from "@puppyone/data-core";
import { FileGlyphIcon } from "./fileIcons";

export type ExplorerTreeProps = {
  nodes: DataNode[];
  activePath: string | null;
  rootLabel?: string;
  showRoot?: boolean;
  onSelectNode: (node: DataNode | null) => void;
};

export function ExplorerTree({
  nodes,
  activePath,
  rootLabel = "Workspace",
  showRoot = true,
  onSelectNode,
}: ExplorerTreeProps) {
  const initialExpanded = useMemo(() => collectFolderPaths(nodes), [nodes]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded));
  const rootActive = activePath === null;

  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      collectFolderPaths(nodes).forEach((path) => next.add(path));
      return next;
    });
  }, [nodes]);

  const toggleFolder = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
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
  onToggleFolder,
  onSelectNode,
}: {
  node: DataNode;
  depth: number;
  isLast: boolean;
  expanded: Set<string>;
  activePath: string | null;
  onToggleFolder: (path: string) => void;
  onSelectNode: (node: DataNode) => void;
}) {
  const isFolder = node.type === "folder";
  const isExpanded = isFolder && expanded.has(node.path);
  const active = activePath === node.path;

  return (
    <>
      <button
        className={`tree-row ${active ? "active" : ""} ${node.status ? `status-${node.status}` : ""}`}
        type="button"
        onClick={() => {
          if (isFolder && !isExpanded) onToggleFolder(node.path);
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
              onToggleFolder(node.path);
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
        </span>
      </button>

      {isExpanded &&
        node.children?.map((child, index) => (
          <TreeNodeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            isLast={index === (node.children?.length ?? 0) - 1}
            expanded={expanded}
            activePath={activePath}
            onToggleFolder={onToggleFolder}
            onSelectNode={onSelectNode}
          />
        ))}
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

function collectFolderPaths(nodes: DataNode[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.type === "folder" && Array.isArray(node.children) ? [node.path] : []),
    ...(node.children ? collectFolderPaths(node.children) : []),
  ]);
}
