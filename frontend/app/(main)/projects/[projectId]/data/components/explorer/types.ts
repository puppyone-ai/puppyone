import type { CSSProperties, MouseEvent } from 'react';
import type { ContentType } from '../views/GridView';
import type { SyncEndpointInfo as DataSyncEndpointInfo } from '../../DataLayoutContext';

export type SyncEndpointInfo = DataSyncEndpointInfo;

export interface MillerColumnItem {
  id: string;
  name: string;
  type: ContentType;
  is_synced?: boolean;
  sync_source?: string | null;
  sync_url?: string | null;
  last_synced_at?: string | null;
}

export interface ExplorerSidebarProps {
  projectId: string;
  currentPath: { id: string; name: string }[];
  activeNodeId?: string;
  onNavigate: (item: MillerColumnItem) => void;
  onCreate?: (e: MouseEvent<Element>, parentId: string | null) => void;
  onRename?: (id: string, currentName: string) => void;
  onDelete?: (id: string, name: string) => void;
  onMoveNode?: (
    nodeId: string,
    targetFolderId: string | null,
    sourceParentId?: string | null,
  ) => Promise<void>;
  activeSyncNodeId?: string | null;
  highlightNodeId?: string | null;
  createMenuOpenForId?: string | null;
  className?: string;
  style?: CSSProperties;
}
