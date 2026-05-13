'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { getNodeTypeConfig, getSyncSource, getSyncSourceIcon, isSyncedType, isFolderType } from '@/lib/nodeTypeConfig';
import { useContentNodes } from '@/lib/hooks/useData';
import { useNodeDrop } from '@/lib/hooks/useNodeDrop';
import {
  resolveDataTransferSnapshot,
  snapshotDataTransfer,
} from '@/lib/dropFiles';
import type { ContentType } from '../views/GridView';
import type { FileImportTarget } from '../../hooks/useFileImport';
import { ensureExpanded, toggleExpanded, useIsExpanded } from './explorerState';
import { ExplorerRowActions } from './ExplorerRowActions';
import type { ExplorerSidebarProps, MillerColumnItem } from './types';
import { Dots } from '@/components/loading';

const FILE_DROP_TARGET_BG = 'rgba(255, 255, 255, 0.11)';
const FILE_DROP_SCOPE_BG = 'rgba(255, 255, 255, 0.04)';
const FILE_DROP_TARGET_BORDER = 'rgba(255, 255, 255, 0.24)';
const FILE_DROP_SCOPE_BORDER = 'rgba(255, 255, 255, 0.12)';

function hasExternalFiles(event: ReactDragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

function getParentFileDropTarget(item: MillerColumnItem): FileImportTarget {
  if (!item.id.includes('/')) return { path: null, name: 'Root' };
  const parentPath = item.id.split('/').slice(0, -1).join('/');
  return {
    path: parentPath,
    name: parentPath.split('/').pop() || 'Root',
  };
}

export const FolderIcon = ({ expanded }: { expanded?: boolean }) => {
  if (expanded) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z" fill="#60a5fa" fillOpacity="0.25" />
        <path d="M 9.5 10 L 23 10 Q 24 10 23.5 11 L 19.5 19 Q 19 20 18 20 L 4.5 20 Q 3.5 20 4 19 L 8 11 Q 8.5 10 9.5 10 Z" fill="#60a5fa" fillOpacity="0.55" />
      </svg>
    );
  }

  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z" fill="#60a5fa" fillOpacity="0.45" />
    </svg>
  );
};

type SidebarFileKind =
  | 'json'
  | 'markdown'
  | 'html'
  | 'pdf'
  | 'image'
  | 'audio'
  | 'video'
  | 'spreadsheet'
  | 'archive'
  | 'code'
  | 'text'
  | 'file';

const FILE_KIND_TITLES: Record<SidebarFileKind, string> = {
  json: 'JSON file',
  markdown: 'Markdown file',
  html: 'HTML file',
  pdf: 'PDF file',
  image: 'Image file',
  audio: 'Audio file',
  video: 'Video file',
  spreadsheet: 'Spreadsheet file',
  archive: 'Archive file',
  code: 'Code file',
  text: 'Text file',
  file: 'File',
};

const FILE_ICON_STROKE = '#8a909b';
const FILE_ICON_SOFT = '#5d636f';
const FILE_ICON_FILL = 'rgba(138, 144, 155, 0.10)';

const SETI_FILE_COLORS: Record<SidebarFileKind, string> = {
  json: '#cbcb41',
  markdown: '#9aa2ad',
  html: '#e37933',
  pdf: '#cc3e44',
  image: '#a074c4',
  audio: '#a074c4',
  video: '#519aba',
  spreadsheet: '#8dc149',
  archive: '#cc3e44',
  code: '#519aba',
  text: '#d4d7d6',
  file: '#d4d7d6',
};

const EXTENSION_KIND: Record<string, SidebarFileKind> = {
  json: 'json',
  jsonl: 'json',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  pdf: 'pdf',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  avif: 'image',
  heic: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  flac: 'audio',
  ogg: 'audio',
  opus: 'audio',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  avi: 'video',
  mkv: 'video',
  csv: 'spreadsheet',
  tsv: 'spreadsheet',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  js: 'code',
  jsx: 'code',
  ts: 'code',
  tsx: 'code',
  css: 'code',
  scss: 'code',
  py: 'code',
  rb: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  c: 'code',
  cpp: 'code',
  h: 'code',
  sh: 'code',
  yml: 'code',
  yaml: 'code',
  xml: 'code',
  toml: 'code',
  txt: 'text',
  log: 'text',
};

function getFileExtension(name: string): string | null {
  const match = /\.([^./]{1,12})$/.exec(name.trim());
  return match ? match[1].toLowerCase() : null;
}

function getSidebarFileKind(name: string, type: string): SidebarFileKind {
  const ext = getFileExtension(name);
  if (ext && EXTENSION_KIND[ext]) return EXTENSION_KIND[ext];

  const config = getNodeTypeConfig(type);
  switch (config.iconCategory) {
    case 'json':
      return 'json';
    case 'markdown':
      return 'markdown';
    default:
      break;
  }

  if (type === 'image') return 'image';
  if (type === 'pdf') return 'pdf';
  if (type === 'video') return 'video';
  return 'file';
}

function FileTypeIcon({
  kind,
  size = 16,
}: {
  kind: SidebarFileKind;
  size?: number;
}) {
  const color = SETI_FILE_COLORS[kind];
  const muted = FILE_ICON_SOFT;

  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <title>{FILE_KIND_TITLES[kind]}</title>

      {kind === 'audio' ? (
        <>
          <path d="M2.6 10.9V7.1h2.25L8.7 4.35v9.3L4.85 10.9H2.6Z" fill={color} />
          <path d="M10.8 6.55c1.05 1.1 1.05 2.8 0 3.9" stroke={color} strokeWidth="1.45" strokeLinecap="butt" />
          <path d="M12.95 5.05c1.8 1.95 1.8 5.9 0 7.9" stroke={color} strokeWidth="1.25" strokeLinecap="butt" opacity="0.78" />
        </>
      ) : kind === 'image' ? (
        <>
          <rect x="2.75" y="3.75" width="12.5" height="10.5" rx="1.25" stroke={color} strokeWidth="1.45" />
          <path d="M3.8 12.5 6.35 9.65l2.05 2.1 2.35-3.05 3.35 3.8" stroke={color} strokeWidth="1.45" strokeLinecap="butt" strokeLinejoin="miter" />
          <rect x="10.85" y="5.6" width="2" height="2" rx="0.35" fill={color} />
        </>
      ) : kind === 'video' ? (
        <>
          <rect x="2.9" y="5.1" width="12.2" height="7.8" rx="1.15" stroke={color} strokeWidth="1.45" />
          <path d="M7.9 7.2v3.6L11.3 9 7.9 7.2Z" fill={color} />
        </>
      ) : kind === 'spreadsheet' ? (
        <>
          <rect x="3.1" y="3.1" width="11.8" height="11.8" rx="1.15" stroke={color} strokeWidth="1.35" />
          <path d="M3.35 7.05h11.3M3.35 10.95h11.3M7.05 3.35v11.3M10.95 3.35v11.3" stroke={color} strokeWidth="1.05" opacity="0.82" />
        </>
      ) : kind === 'json' ? (
        <text
          x="9"
          y="12.35"
          textAnchor="middle"
          fontSize="9.5"
          fontWeight="800"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
          fill={color}
        >
          {'{}'}
        </text>
      ) : kind === 'html' ? (
        <>
          <path d="m7.05 5.15-3.5 3.75 3.5 3.75" stroke={color} strokeWidth="1.65" strokeLinecap="butt" strokeLinejoin="miter" />
          <path d="m10.95 5.15 3.5 3.75-3.5 3.75" stroke={color} strokeWidth="1.65" strokeLinecap="butt" strokeLinejoin="miter" />
          <path d="M9.95 4.95 8.05 12.9" stroke={color} strokeWidth="1.35" strokeLinecap="butt" opacity="0.86" />
        </>
      ) : kind === 'code' ? (
        <>
          <path d="m7.2 5.55-3 3.45 3 3.45" stroke={color} strokeWidth="1.55" strokeLinecap="butt" strokeLinejoin="miter" />
          <path d="m10.8 5.55 3 3.45-3 3.45" stroke={color} strokeWidth="1.55" strokeLinecap="butt" strokeLinejoin="miter" />
        </>
      ) : kind === 'pdf' ? (
        <>
          <path d="M5.15 2.75h5.6l2.6 2.65v8.5c0 .5-.4.9-.9.9h-7.3c-.5 0-.9-.4-.9-.9V3.65c0-.5.4-.9.9-.9Z" fill={FILE_ICON_FILL} stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M10.75 2.95v2.45h2.4" stroke={color} strokeWidth="1.05" strokeLinejoin="round" />
          <path d="M5.95 10.1h5.85M5.95 12.15h4.1" stroke={color} strokeWidth="1.15" strokeLinecap="round" />
        </>
      ) : kind === 'markdown' ? (
        <>
          <path d="M5.15 2.75h5.6l2.6 2.65v8.5c0 .5-.4.9-.9.9h-7.3c-.5 0-.9-.4-.9-.9V3.65c0-.5.4-.9.9-.9Z" fill={FILE_ICON_FILL} stroke={color} strokeWidth="1.3" strokeLinejoin="miter" />
          <path d="M10.75 2.95v2.45h2.4" stroke={color} strokeWidth="1.05" strokeLinejoin="miter" />
          <text
            x="8.8"
            y="12.3"
            textAnchor="middle"
            fontSize="7.6"
            fontWeight="780"
            fontFamily="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
            fill={color}
          >
            M
          </text>
        </>
      ) : kind === 'archive' ? (
        <>
          <path d="M4 6.2 6.1 4.2h5.8L14 6.2v6.6c0 .6-.5 1.1-1.1 1.1H5.1c-.6 0-1.1-.5-1.1-1.1V6.2Z" fill={FILE_ICON_FILL} stroke={color} strokeWidth="1.25" strokeLinejoin="round" />
          <path d="M6.2 7.2h5.6M7.3 9.1h3.4M7.3 11h3.4" stroke={color} strokeWidth="1.05" strokeLinecap="round" opacity="0.82" />
        </>
      ) : kind === 'text' ? (
        <>
          <path d="M5.1 2.75h5.65l2.6 2.65v8.5c0 .5-.4.9-.9.9h-7.35c-.5 0-.9-.4-.9-.9V3.65c0-.5.4-.9.9-.9Z" fill={FILE_ICON_FILL} stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M10.75 2.95v2.45h2.4" stroke={muted} strokeWidth="1" strokeLinejoin="round" />
          <path d="M5.85 8.25h5.2M5.85 10.25h5.2M5.85 12.25h3.65" stroke={color} strokeWidth="1.05" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M5.1 2.75h5.65l2.6 2.65v8.5c0 .5-.4.9-.9.9h-7.35c-.5 0-.9-.4-.9-.9V3.65c0-.5.4-.9.9-.9Z" fill={FILE_ICON_FILL} stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M10.75 2.95v2.45h2.4" stroke={muted} strokeWidth="1" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

function FileIcon({
  name,
  type,
  syncSource,
  iconSize,
}: {
  name: string;
  type: string;
  syncSource?: string | null;
  iconSize?: number;
}) {
  const config = getNodeTypeConfig(type);
  const actualSource = syncSource || getSyncSource(type);
  const BadgeIcon = getSyncSourceIcon(actualSource) || config.badgeIcon;
  const size = iconSize ?? 18;

  if (BadgeIcon) return <BadgeIcon size={size} />;

  return <FileTypeIcon kind={getSidebarFileKind(name, type)} size={size} />;
}

function getSyncDirectionArrow(
  type: string,
  direction: 'inbound' | 'outbound' | 'bidirectional' = 'inbound',
): string | null {
  if (!isSyncedType(type)) return null;
  if (direction === 'bidirectional') return ' ⇄';
  if (direction === 'outbound') return ' ←';
  return ' →';
}

function getTypeExtension(type: string): string | null {
  const config = getNodeTypeConfig(type);

  switch (config.iconCategory) {
    case 'json':
      return '.json';
    case 'markdown':
      return '.md';
    default:
      return null;
  }
}

function hasFileExtension(name: string): boolean {
  return /\.\w{1,10}$/.test(name);
}

interface ExplorerTreeRowProps {
  item: MillerColumnItem;
  depth: number;
  // True when this row is the LAST among its siblings at this
  // depth.  Drives the L-shape elbow:
  //   ─ last  → vertical stops at the hook level (closing ╰─).
  //   ─ !last → vertical runs full row height so it visually
  //             merges with the next sibling's elbow below.
  // Also gates the ancestor continuation line drawn by THIS
  // row's children-wrapper: only non-last rows thread their
  // column down through their subtree.
  isLastSibling: boolean;
  projectId: string;
  activeId: string | null;
  onNavigate: (item: MillerColumnItem) => void;
  onCreate?: ExplorerSidebarProps['onCreate'];
  onCreateSync?: ExplorerSidebarProps['onCreateSync'];
  onOpenAccess?: ExplorerSidebarProps['onOpenAccess'];
  endpointByNodeId?: ExplorerSidebarProps['endpointByNodeId'];
  onRename?: ExplorerSidebarProps['onRename'];
  onDelete?: ExplorerSidebarProps['onDelete'];
  onDownload?: ExplorerSidebarProps['onDownload'];
  onFilesDrop?: ExplorerSidebarProps['onFilesDrop'];
  onMoveNode?: ExplorerSidebarProps['onMoveNode'];
  activeSyncNodeId?: string | null;
  highlightNodeId?: string | null;
  highlightVariant?: ExplorerSidebarProps['highlightVariant'];
  createMenuOpenForId?: string | null;
  createMenuOpenAction?: ExplorerSidebarProps['createMenuOpenAction'];
  activeFileDropTargetPath?: string | null;
  onFileDragTarget?: (target: FileImportTarget | null) => void;
}

export const ExplorerTreeRow = memo(function ExplorerTreeRow({
  item,
  depth,
  isLastSibling,
  projectId,
  activeId,
  onNavigate,
  onCreate,
  onCreateSync,
  onOpenAccess,
  endpointByNodeId,
  onRename,
  onDelete,
  onDownload,
  onFilesDrop,
  onMoveNode,
  activeSyncNodeId,
  highlightNodeId,
  highlightVariant = 'default',
  createMenuOpenForId,
  createMenuOpenAction,
  activeFileDropTargetPath,
  onFileDragTarget,
}: ExplorerTreeRowProps) {
  const isFolder = isFolderType(item.type);
  const isSynced = item.is_synced;
  const expanded = useIsExpanded(item.id) && isFolder;
  const rowRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const isHighlighted = highlightNodeId === item.id;
  const openMenuAction = createMenuOpenForId === item.id ? createMenuOpenAction ?? null : null;
  const isAnyCreateMenuOpen = openMenuAction !== null;
  const endpoints = endpointByNodeId?.get(item.id) ?? [];

  const { isDropTarget, dropHandlers } = useNodeDrop({
    targetFolderId: item.id,
    onMoveNode,
    disabled: !isFolder,
  });
  const fileDropTarget = isFolder
    ? { path: item.id, name: item.name }
    : getParentFileDropTarget(item);

  useEffect(() => {
    if (isHighlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isHighlighted]);

  const { nodes: children, isLoading: loading } = useContentNodes(
    expanded ? projectId : '',
    expanded ? item.id : undefined,
  );

  const handleClick = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      if (isFolder) ensureExpanded(item.id);
      onNavigate(item);
    },
    [isFolder, item, onNavigate],
  );

  const handleToggleExpand = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      toggleExpanded(item.id);
    },
    [item.id],
  );

  const isActive = activeId === item.id;
  const isSyncActive = activeSyncNodeId === item.id;
  const isRowActive = isActive || isSyncActive;
  const rowPaddingLeft = 8 + depth * 16;
  const childTextPadding = rowPaddingLeft + 22;
  const isAccessPointHighlight = isHighlighted && highlightVariant === 'access-point';
  const isFileDropTarget = isFolder && activeFileDropTargetPath === item.id;
  const isInsideActiveFileDropScope =
    !!activeFileDropTargetPath && item.id.startsWith(`${activeFileDropTargetPath}/`);
  const hasSpecialBg = isDropTarget || isFileDropTarget || isInsideActiveFileDropScope || isHighlighted || isRowActive || isAnyCreateMenuOpen;
  const staticBg = isDropTarget || isFileDropTarget
    ? FILE_DROP_TARGET_BG
    : isInsideActiveFileDropScope
      ? FILE_DROP_SCOPE_BG
    : isHighlighted
      ? isAccessPointHighlight
        ? 'rgba(52, 211, 153, 0.14)'
        : 'rgba(59, 130, 246, 0.15)'
      : isRowActive || isAnyCreateMenuOpen
        // Translucent overlay rather than opaque #2a2a2a — the
        // earlier opaque colour was almost identical to the tree
        // line (#27272a vs #2a2a2a, a 3-unit-per-channel delta) AND
        // it covered the parent's continuation line that runs
        // through the row, so a selected leaf looked visually
        // disconnected from its sibling chain. An rgba overlay keeps
        // the lines showing through naturally and stays consistent
        // with every other "special" state (hover, drop target,
        // search highlight) which all already use rgba.
        ? 'rgba(255,255,255,0.085)'
        : 'transparent';
  const staticColor = isDropTarget || isFileDropTarget
    ? '#f4f4f5'
    : isAccessPointHighlight
      ? '#d1fae5'
    : isRowActive || isAnyCreateMenuOpen
      ? '#fff'
      : '#a1a1aa';
  const isSoftHovered = isHovered && !hasSpecialBg;
  const rowBackground = isSoftHovered ? 'rgba(255,255,255,0.045)' : staticBg;
  const rowColor = isSoftHovered ? '#d4d4d8' : staticColor;

  const childItems: MillerColumnItem[] = useMemo(
    () =>
      children.map((node) => ({
        id: node.id,
        name: node.name,
        type: node.type as ContentType,
        is_synced: node.is_synced,
        sync_source: node.sync_source,
        last_synced_at: node.last_synced_at,
      })),
    [children],
  );

  const hasActions = !!(onCreate || onCreateSync || onRename || onDelete || onDownload);

  const activateFileDropTarget = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasExternalFiles(event)) return false;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    onFileDragTarget?.(fileDropTarget);
    return true;
  }, [fileDropTarget, onFileDragTarget]);

  const handleExternalFileDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasExternalFiles(event)) return false;
    event.preventDefault();
    event.stopPropagation();

    // Snapshot synchronously — see lib/dropFiles.ts. Reading
    // ``dataTransfer.files`` directly would treat a dropped folder
    // as a single 0-byte "file" and silently lose every real file
    // inside.
    const snapshot = snapshotDataTransfer(event.nativeEvent);
    void resolveDataTransferSnapshot(snapshot).then((files) => {
      if (files.length > 0) {
        onFilesDrop?.(files, fileDropTarget);
      }
    });
    onFileDragTarget?.(null);
    return true;
  }, [fileDropTarget, onFileDragTarget, onFilesDrop]);

  return (
    <div>
      <div
        ref={rowRef}
        data-menu-host="true"
        className="group/row"
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            'application/x-puppyone-node',
            JSON.stringify({
              id: item.id,
              name: item.name,
              type: item.type,
              parentId: item.id.includes('/') ? item.id.split('/').slice(0, -1).join('/') : null,
            }),
          );
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnter={(e) => {
          if (!activateFileDropTarget(e)) dropHandlers.onDragEnter(e);
        }}
        onDragOver={(e) => {
          if (!activateFileDropTarget(e)) dropHandlers.onDragOver(e);
        }}
        onDragLeave={(e) => {
          dropHandlers.onDragLeave(e);
        }}
        onDrop={(e) => {
          if (!handleExternalFileDrop(e)) dropHandlers.onDrop(e);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          margin: '1px 6px',
          height: 30,
          boxSizing: 'border-box',
          borderRadius: 6,
          background: rowBackground,
          color: rowColor,
          fontSize: 13,
          userSelect: 'none',
          transition: 'background 0.1s, color 0.1s',
          boxShadow: isDropTarget || isFileDropTarget
            ? `inset 0 0 0 1px ${FILE_DROP_TARGET_BORDER}`
            : isInsideActiveFileDropScope
              ? `inset 1px 0 0 0 ${FILE_DROP_SCOPE_BORDER}`
            : isAccessPointHighlight
              ? 'inset 2px 0 0 0 rgba(52, 211, 153, 0.9)'
              : 'none',
          cursor: 'pointer',
          position: 'relative',
        }}
      >
        {/* Tree-line elbow for THIS depth.  Same visual grammar as
            the home page's `TreeRows`, just sized for the sidebar's
            tighter 16px-per-level indent (vs home's 20px):

              ─ vertical stub at row-local x = depth*16 (one indent
                step left of the icon).
              ─ horizontal hook 8px to the icon's left edge.
              ─ vertical stops at y=15 (hook level) when this is the
                last sibling — that's the closing ╰─ shape.  Otherwise
                it spans the full row height so it visually merges
                with the next sibling's elbow below.

            `<rect>` not `<line>`: stroke-1 lines paint a center stroke
            that straddles two pixels, which subpixel-misaligns with
            the integer-bound continuation `<div>` drawn in the
            children-wrapper below — looks crisp on retina with rect.

            Ancestor continuation lines are NOT drawn here.  Each
            ancestor's children-wrapper draws its own (see {expanded}
            block), which is what makes the tree visually CLOSE at
            the right depth (last sibling = no continuation through
            subtree) instead of the old behavior where every per-depth
            line ran full row height regardless of whether the
            ancestor still had siblings below. */}
        {depth > 0 && (
          <svg
            width={depth * 16 + 8}
            height={30}
            viewBox={`0 0 ${depth * 16 + 8} 30`}
            shapeRendering="crispEdges"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              pointerEvents: 'none',
              zIndex: 0,
            }}
          >
            <rect
              x={depth * 16}
              y={0}
              width={1}
              height={isLastSibling ? 15 : 30}
              fill="#27272a"
            />
            <rect
              x={depth * 16}
              y={15}
              width={8}
              height={1}
              fill="#27272a"
            />
          </svg>
        )}

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: '100%',
            boxSizing: 'border-box',
            paddingLeft: rowPaddingLeft,
            paddingRight: 6,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <div
            onClick={isFolder ? handleToggleExpand : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
              width: 18,
              height: 18,
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            {isFolder ? (
              <>
                <div className="flex items-center justify-center group-hover/row:hidden">
                  <FolderIcon expanded={expanded} />
                </div>
                <div className="hidden items-center justify-center group-hover/row:flex" style={{ width: 18, height: 18, borderRadius: 3 }}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    style={{
                      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s ease',
                    }}
                  >
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </>
            ) : (() => {
              const arrow = getSyncDirectionArrow(item.type);

              if (arrow) {
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                    <FileIcon name={item.name} type={item.type} syncSource={item.sync_source} iconSize={10} />
                    <span style={{ color: '#71717a', fontSize: 7, lineHeight: 1 }}>{arrow}</span>
                  </div>
                );
              }

              return <FileIcon name={item.name} type={item.type} syncSource={item.sync_source} />;
            })()}
          </div>

          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {item.name}
            {!isFolder && !hasFileExtension(item.name) && (() => {
              const ext = getTypeExtension(item.type);
              return ext ? <span style={{ color: '#525252', fontSize: 11 }}>{ext}</span> : null;
            })()}
          </span>

          {hasActions && (
            <ExplorerRowActions
              nodeId={item.id}
              createParentId={item.id}
              accessPath={item.id}
              isFolder={isFolder}
              endpoints={endpoints}
              openMenuAction={openMenuAction}
              isSynced={isSynced}
              itemName={item.name}
              onCreate={onCreate}
              onCreateSync={onCreateSync}
              onOpenAccess={onOpenAccess}
              onRename={onRename}
              onDelete={onDelete}
              onDownload={onDownload}
            />
          )}
        </div>
      </div>

      {expanded && (
        // `position: relative` so the continuation line below can
        // absolute-position itself against the wrapper's full
        // height, threading my elbow column down through every
        // descendant row (and their sub-subtree wrappers).
        <div style={{ position: 'relative' }}>
          {/* Continuation line — the structural complement to the
              per-row elbow above.  When *I* am not the last sibling,
              my elbow column needs to keep going down through my
              entire subtree so the next sibling's elbow visually
              connects.  Drawn at MY depth's column in OUTER coords:
              the row's 6px left margin + row-local elbow x (depth*16)
              = 6 + depth*16.  The wrapper has no margin so wrapper-x
              == outer-x, no further offset needed.

              Skipped when last sibling so the tree visually CLOSES
              at the right depth instead of running every line off
              the bottom of the subtree.

              Also drawn when there are NO real children (loading /
              empty placeholder): the parent's "more siblings below"
              signal still needs to thread through whatever the
              wrapper renders, otherwise an expanded-but-empty
              parent would visually break the sibling chain. */}
          {depth > 0 && !isLastSibling && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: 6 + depth * 16,
                top: 0,
                bottom: 0,
                width: 1,
                background: '#27272a',
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />
          )}
          {loading && children.length === 0 ? (
            <div style={{ paddingLeft: childTextPadding, paddingTop: 4, paddingBottom: 4 }}>
              <Dots size="xs" />
            </div>
          ) : childItems.length > 0 ? (
            childItems.map((child, idx) => (
              <ExplorerTreeRow
                key={child.id}
                item={child}
                depth={depth + 1}
                isLastSibling={idx === childItems.length - 1}
                projectId={projectId}
                activeId={activeId}
                onNavigate={onNavigate}
                onCreate={onCreate}
                onCreateSync={onCreateSync}
                onOpenAccess={onOpenAccess}
                endpointByNodeId={endpointByNodeId}
                onRename={onRename}
                onDelete={onDelete}
                onDownload={onDownload}
              onFilesDrop={onFilesDrop}
                onMoveNode={onMoveNode}
                activeSyncNodeId={activeSyncNodeId}
                highlightNodeId={highlightNodeId}
                highlightVariant={highlightVariant}
                createMenuOpenForId={createMenuOpenForId}
                createMenuOpenAction={createMenuOpenAction}
                activeFileDropTargetPath={activeFileDropTargetPath}
                onFileDragTarget={onFileDragTarget}
              />
            ))
          ) : !loading ? (
            <div
              style={{
                paddingLeft: childTextPadding,
                paddingTop: 4,
                paddingBottom: 4,
                color: '#666',
                fontSize: 12,
                fontStyle: 'italic',
              }}
            >
              Empty
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});
