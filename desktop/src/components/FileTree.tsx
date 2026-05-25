import { ChevronRight } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { FileGlyphIcon } from "../../cloud-source/frontend/lib/fileIcons";
import type { FileNode } from "../lib/localFiles";

type FileTreeProps = {
  nodes: FileNode[];
  activePath: string | null;
  rootLabel?: string;
  onSelectNode: (node: FileNode | null) => void;
};

export function FileTree({ nodes, activePath, rootLabel = "Workspace", onSelectNode }: FileTreeProps) {
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
      <button
        className={`tree-row root ${rootActive ? "active" : ""}`}
        type="button"
        onClick={() => onSelectNode(null)}
      >
        <span className="tree-chevron-spacer" />
        <span className="tree-icon folder">
          <FileGlyphIcon name={rootLabel} type="folder" size={15} />
        </span>
        <span className="tree-label">{rootLabel}</span>
      </button>

      {nodes.map((node, index) => (
        <TreeNodeRow
          key={node.path}
          node={node}
          depth={1}
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
  node: FileNode;
  depth: number;
  isLast: boolean;
  expanded: Set<string>;
  activePath: string | null;
  onToggleFolder: (path: string) => void;
  onSelectNode: (node: FileNode) => void;
}) {
  const isFolder = node.type === "folder";
  const isExpanded = isFolder && expanded.has(node.path);
  const active = activePath === node.path;

  return (
    <>
      <button
        className={`tree-row ${active ? "active" : ""} ${node.status ? `status-${node.status}` : ""}`}
        type="button"
        onClick={() => onSelectNode(node)}
        style={{ "--depth": depth } as CSSProperties}
      >
        <span
          className={`tree-elbow ${isLast ? "last" : ""}`}
          aria-hidden
        />
        {isFolder ? (
          <span
            className={`tree-chevron ${isExpanded ? "expanded" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFolder(node.path);
            }}
          >
            <ChevronRight size={13} />
          </span>
        ) : (
          <span className="tree-chevron-spacer" />
        )}
        <span className={`tree-icon ${node.type}`}>
          <FileGlyphIcon name={node.name} type={node.type} size={15} />
        </span>
        <span className="tree-label">{node.name}</span>
        {node.status && node.status !== "clean" && (
          <span className={`tree-status ${node.status}`}>{shortStatus(node.status)}</span>
        )}
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

function shortStatus(status: NonNullable<FileNode["status"]>) {
  if (status === "modified") return "M";
  if (status === "created") return "A";
  if (status === "deleted") return "D";
  if (status === "moved") return "R";
  return "";
}

function collectFolderPaths(nodes: FileNode[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.type === "folder" ? [node.path] : []),
    ...(node.children ? collectFolderPaths(node.children) : []),
  ]);
}
