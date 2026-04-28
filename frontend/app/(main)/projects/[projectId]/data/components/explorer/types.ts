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
  // Open the right-side sync_create panel with the user's current
  // navigation context pre-filled as the target resource.  The
  // sidebar surfaces this as a "+ Connect" button next to the
  // file/folder + button, replacing the previous "click Create
  // Access in the toolbar → drag the folder from the sidebar
  // back into the panel" flow.  No-op fallback to nothing if
  // omitted, so the prop stays additive.
  onCreateSync?: () => void;
  activeSyncNodeId?: string | null;
  highlightNodeId?: string | null;
  createMenuOpenForId?: string | null;
  className?: string;
  style?: CSSProperties;
}
