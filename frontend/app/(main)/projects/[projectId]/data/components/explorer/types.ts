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
  // Open the right-side sync_create panel with the given folder
  // path pre-filled as the target resource.  Two surfaces invoke
  // it:
  //   - sidebar header "Connect" button → passes the user's
  //     current navigation focus (or '' for project root) so the
  //     panel lands targeting wherever the user is right now
  //   - per-folder row plug button (hover-revealed, next to + and
  //     the action menu) → passes that row's own folder id, so
  //     the user doesn't have to navigate into a folder before
  //     creating an AP for it
  // Either entry collapses what used to be a 4-step flow ("toolbar
  // Create Access → drag the folder from the sidebar → click
  // Create") into one targeted click.
  onCreateSync?: (folderPath: string) => void;
  activeSyncNodeId?: string | null;
  highlightNodeId?: string | null;
  createMenuOpenForId?: string | null;
  className?: string;
  style?: CSSProperties;
}
