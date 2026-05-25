'use client';

import { ResizableSidebarColumn } from '@/components/sidebar/ResizableSidebarColumn';
import { ExplorerSidebar } from './ExplorerSidebar';
import type { ExplorerSidebarProps } from './types';

type DataExplorerPaneProps = Omit<
  ExplorerSidebarProps,
  | 'currentPath'
  | 'activeNodeId'
  | 'activeSyncNodeId'
  | 'highlightNodeId'
  | 'highlightVariant'
  | 'style'
> & {
  folderBreadcrumbs: { id: string; name: string }[];
  activeNodeId?: string;
  activeSyncNodeId?: string | null;
  highlightNodeId?: string | null;
  hoverHighlightNodeId?: string | null;
};

export function DataExplorerPane({
  folderBreadcrumbs,
  activeNodeId,
  activeSyncNodeId,
  highlightNodeId,
  hoverHighlightNodeId,
  ...sidebarProps
}: DataExplorerPaneProps) {
  return (
    <ResizableSidebarColumn
      storageKey="explorer-sidebar:data"
      defaultWidth={220}
      minWidth={220}
      maxWidth={480}
      style={{
        borderRight: '1px solid var(--po-divider)',
        background: 'var(--po-canvas)',
      }}
    >
      <ExplorerSidebar
        {...sidebarProps}
        currentPath={folderBreadcrumbs.map((f) => ({ id: f.id, name: f.name }))}
        activeNodeId={activeNodeId}
        activeSyncNodeId={activeSyncNodeId}
        highlightNodeId={hoverHighlightNodeId || highlightNodeId}
        highlightVariant={hoverHighlightNodeId !== null ? 'access-point' : 'default'}
        style={{ flex: 1, width: '100%', background: 'transparent', minHeight: 0 }}
      />
    </ResizableSidebarColumn>
  );
}
