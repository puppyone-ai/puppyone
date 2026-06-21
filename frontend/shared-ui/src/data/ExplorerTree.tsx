import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DataNode } from "../core/types";
import { FileGlyphIcon } from "../file/fileIcons";

export type ExplorerTreeProps = {
  nodes: DataNode[];
  activePath: string | null;
  loadingPath?: string | null;
  rootLoading?: boolean;
  rootError?: string | null;
  rootLabel?: string;
  showRoot?: boolean;
  emptyLabel?: string;
  loadingLabel?: string;
  onSelectNode: (node: DataNode | null) => void;
  onToggleFolder?: (node: DataNode, expanded: boolean) => void;
  renderRootActions?: () => ReactNode;
  renderFolderActions?: (node: DataNode) => ReactNode;
  renderNodeActions?: (node: DataNode) => ReactNode;
};

const EXPLORER_TREE_ROW_HEIGHT = 30;
const EXPLORER_TREE_ROW_GAP = 2;
const EXPLORER_TREE_INDENT = 16;
const EXPLORER_TREE_ROW_MARGIN_X = 6;
const EXPLORER_TREE_CONTENT_INSET = 8;
const EXPLORER_TREE_ROW_MARGIN_Y = EXPLORER_TREE_ROW_GAP / 2;
const EXPLORER_TREE_LINE_OVERDRAW = 2;
const EXPLORER_TREE_META_OFFSET = 14;
const ROOT_HEADER_TOP_PADDING = 5;
const SUBTREE_MOTION_MIN_MS = 170;
const SUBTREE_MOTION_MAX_MS = 340;
const SUBTREE_MOTION_PX_FACTOR = 0.28;
const SUBTREE_MOTION_EASE = "cubic-bezier(0.25, 0.1, 0.25, 1)";

export function ExplorerTree({
  nodes,
  activePath,
  loadingPath = null,
  rootLoading = false,
  rootError = null,
  rootLabel = "Root",
  showRoot = true,
  emptyLabel = "Empty folder",
  loadingLabel = "Loading...",
  onSelectNode,
  onToggleFolder,
  renderRootActions,
  renderFolderActions,
  renderNodeActions,
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

  const toggleFolder = useCallback(
    (node: DataNode, nextExpanded: boolean) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (nextExpanded) next.add(node.path);
        else next.delete(node.path);
        return next;
      });
      onToggleFolder?.(node, nextExpanded);
    },
    [onToggleFolder],
  );

  return (
    <div className="explorer-tree-shell">
      {showRoot && (
        <div className="explorer-tree-root-scope">
          <button
            className={`tree-row root ${rootActive ? "active" : ""}`}
            type="button"
            onClick={() => onSelectNode(null)}
            style={{ "--depth": 0 } as CSSProperties}
          >
            <span className="tree-row-content">
              <span className="tree-label">{rootLabel}</span>
              {renderRootActions && (
                <span className="tree-row-actions root-actions" onClick={(event) => event.stopPropagation()}>
                  {renderRootActions()}
                </span>
              )}
            </span>
          </button>
        </div>
      )}

      <div className="explorer-tree-scroll">
        <div className="explorer-tree-list">
          {rootError && nodes.length === 0 ? (
            <ExplorerTreeMetaRow depth={0}>{rootError}</ExplorerTreeMetaRow>
          ) : rootLoading && nodes.length === 0 ? (
            <ExplorerTreeMetaRow depth={0}>{loadingLabel}</ExplorerTreeMetaRow>
          ) : nodes.length === 0 ? (
            <ExplorerTreeMetaRow depth={0}>{emptyLabel}</ExplorerTreeMetaRow>
          ) : (
            nodes.map((node) => (
              <TreeNodeRow
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                activePath={activePath}
                loadingPath={loadingPath}
                emptyLabel={emptyLabel}
                loadingLabel={loadingLabel}
                onToggleFolder={toggleFolder}
                onSelectNode={onSelectNode}
                renderFolderActions={renderFolderActions}
                renderNodeActions={renderNodeActions}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  expanded,
  activePath,
  loadingPath,
  emptyLabel,
  loadingLabel,
  onToggleFolder,
  onSelectNode,
  renderFolderActions,
  renderNodeActions,
}: {
  node: DataNode;
  depth: number;
  expanded: Set<string>;
  activePath: string | null;
  loadingPath: string | null;
  emptyLabel: string;
  loadingLabel: string;
  onToggleFolder: (node: DataNode, expanded: boolean) => void;
  onSelectNode: (node: DataNode) => void;
  renderFolderActions?: (node: DataNode) => ReactNode;
  renderNodeActions?: (node: DataNode) => ReactNode;
}) {
  const isFolder = node.type === "folder";
  const isExpanded = isFolder && expanded.has(node.path);
  const [renderSubtree, setRenderSubtree] = useState(isExpanded);
  const active = activePath === node.path;
  const loading = loadingPath === node.path;
  const children = useMemo(() => node.children ?? [], [node.children]);
  const shouldRenderSubtree = isExpanded || renderSubtree;
  const rowActions = renderNodeActions?.(node) ?? (isFolder ? renderFolderActions?.(node) : null);

  useLayoutEffect(() => {
    if (isExpanded) setRenderSubtree(true);
  }, [isExpanded]);

  const toggleCurrentFolder = useCallback(() => {
    if (!isFolder) return;
    onToggleFolder(node, !isExpanded);
  }, [isExpanded, isFolder, node, onToggleFolder]);

  return (
    <>
      <button
        className={`tree-row ${isFolder ? "folder" : "file"} ${active ? "active" : ""} ${loading ? "loading" : ""} ${node.status ? `status-${node.status}` : ""}`}
        type="button"
        aria-current={active ? "true" : undefined}
        aria-expanded={isFolder ? isExpanded : undefined}
        aria-busy={loading || undefined}
        onClick={(event) => {
          event.stopPropagation();
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
          {rowActions && (
            <span className="tree-row-actions" onClick={(event) => event.stopPropagation()}>
              {rowActions}
            </span>
          )}
        </span>
      </button>

      {shouldRenderSubtree && (
        <ExplorerSubtreeMotion visible={isExpanded} onExited={() => setRenderSubtree(false)}>
          {loading && children.length === 0 && (
            <ExplorerTreeMetaRow depth={depth + 1}>{loadingLabel}</ExplorerTreeMetaRow>
          )}
          {!loading && children.length === 0 && node.children && (
            <ExplorerTreeMetaRow depth={depth + 1}>{emptyLabel}</ExplorerTreeMetaRow>
          )}
          {children.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              activePath={activePath}
              loadingPath={loadingPath}
              emptyLabel={emptyLabel}
              loadingLabel={loadingLabel}
              onToggleFolder={onToggleFolder}
              onSelectNode={onSelectNode}
              renderFolderActions={renderFolderActions}
              renderNodeActions={renderNodeActions}
            />
          ))}
        </ExplorerSubtreeMotion>
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

function ExplorerTreeMetaRow({
  depth,
  children,
}: {
  depth: number;
  children: ReactNode;
}) {
  return (
    <div className="tree-meta-row" style={{ "--depth": depth } as CSSProperties}>
      <TreeIndentGuide depth={depth} />
      <span>{children}</span>
    </div>
  );
}

function getSubtreeMotionDurationMs(fromHeight: number, toHeight: number): number {
  const distance = Math.abs(toHeight - fromHeight);
  return Math.round(
    Math.min(
      SUBTREE_MOTION_MAX_MS,
      Math.max(
        SUBTREE_MOTION_MIN_MS,
        SUBTREE_MOTION_MIN_MS + distance * SUBTREE_MOTION_PX_FACTOR,
      ),
    ),
  );
}

function ExplorerSubtreeMotion({
  visible,
  onExited,
  children,
}: {
  visible: boolean;
  onExited: () => void;
  children: ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const onExitedRef = useRef(onExited);
  const [height, setHeight] = useState<number | "auto">(0);
  const [durationMs, setDurationMs] = useState(SUBTREE_MOTION_MIN_MS);

  const cancelFrame = useCallback(() => {
    if (rafRef.current === null) return;
    window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  useEffect(() => cancelFrame, [cancelFrame]);

  useEffect(() => {
    onExitedRef.current = onExited;
  }, [onExited]);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;

    cancelFrame();

    const currentHeight = wrapper.getBoundingClientRect().height;
    const nextHeight = visible ? content.scrollHeight : 0;

    if (!visible && Math.abs(currentHeight - nextHeight) < 1) {
      setHeight(0);
      onExitedRef.current();
      return;
    }

    setDurationMs(getSubtreeMotionDurationMs(currentHeight, nextHeight));
    setHeight(currentHeight);
    rafRef.current = window.requestAnimationFrame(() => {
      setHeight(nextHeight);
      rafRef.current = null;
    });
  }, [cancelFrame, visible]);

  useEffect(() => {
    if (!visible || height === "auto" || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return undefined;

    let previousHeight = content.scrollHeight;
    const observer = new ResizeObserver(() => {
      const nextHeight = content.scrollHeight;
      if (Math.abs(nextHeight - previousHeight) < 1) return;
      previousHeight = nextHeight;

      cancelFrame();
      const currentHeight = wrapper.getBoundingClientRect().height;
      setDurationMs(getSubtreeMotionDurationMs(currentHeight, nextHeight));
      setHeight(currentHeight);
      rafRef.current = window.requestAnimationFrame(() => {
        setHeight(nextHeight);
        rafRef.current = null;
      });
    });

    observer.observe(content);
    return () => observer.disconnect();
  }, [cancelFrame, height, visible]);

  return (
    <div
      ref={wrapperRef}
      className="tree-subtree-motion"
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.propertyName !== "height") return;
        if (!visible) {
          onExitedRef.current();
          return;
        }
        setHeight("auto");
      }}
      style={{
        "--tree-motion-duration": `${durationMs}ms`,
        "--tree-motion-ease": SUBTREE_MOTION_EASE,
        height: height === "auto" ? "auto" : `${Math.max(0, height)}px`,
      } as CSSProperties}
    >
      <div ref={contentRef} className="tree-subtree-content">
        {children}
      </div>
    </div>
  );
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
