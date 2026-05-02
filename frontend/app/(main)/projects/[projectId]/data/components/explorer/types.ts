import type { CSSProperties, MouseEvent } from 'react';
import type { ContentType } from '../views/GridView';
import type { SyncEndpointInfo as DataSyncEndpointInfo } from '../../DataLayoutContext';

export type SyncEndpointInfo = DataSyncEndpointInfo;
export type ExplorerCreateMenuAction = 'create' | 'access';

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
  // Open the per-folder access-provider menu, anchored at the
  // event's currentTarget, with `folderPath` stashed as the target
  // that gets pre-bound on the panel after the user picks a
  // provider from the menu.  Two surfaces invoke it:
  //   - per-folder row plug button (hover-revealed, next to +)
  //     → passes that row's own folder id, so the user creates
  //     for that exact folder without navigating first
  //   - the Root row's hover plug button → passes '' (project
  //     root scope)
  // The flow is: plug click → access-only menu of
  // providers/agents/endpoints → user picks one → panel opens
  // already-selected on that provider's config view, with the
  // folder pre-bound as the target chip.  Avoids the "open empty
  // panel + drag folder from sidebar" anti-pattern entirely.
  onCreateSync?: (event: MouseEvent<Element>, folderPath: string) => void;
  onOpenAccess?: (endpoints: readonly SyncEndpointInfo[], nodeId: string) => void;
  endpointByNodeId?: ReadonlyMap<string, readonly SyncEndpointInfo[]>;
  activeSyncNodeId?: string | null;
  highlightNodeId?: string | null;
  highlightVariant?: 'default' | 'access-point';
  createMenuOpenForId?: string | null;
  createMenuOpenAction?: ExplorerCreateMenuAction | null;
  className?: string;
  style?: CSSProperties;
}
