'use client';

import { useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { ItemContextMenu } from './ExplorerRowMenus';
import type { ExplorerSidebarProps, ExplorerCreateMenuAction, SyncEndpointInfo } from './types';

type RowActionButtonVariant = 'default' | 'createActive' | 'accessActive';

function rowActionButtonClass(variant: RowActionButtonVariant) {
  const base =
    'flex h-[22px] w-[22px] items-center justify-center rounded border border-transparent p-0 transition-colors';

  if (variant === 'createActive') {
    return `${base} bg-[rgba(255,255,255,0.1)] text-[#ddd]`;
  }

  if (variant === 'accessActive') {
    return `${base} bg-[rgba(34,211,238,0.1)] text-[#67e8f9] hover:bg-[rgba(34,211,238,0.16)] hover:text-[#a5f3fc]`;
  }

  return `${base} bg-transparent text-[#999] hover:bg-[rgba(255,255,255,0.1)] hover:text-[#ddd]`;
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function RowActionButton({
  title,
  ariaLabel,
  active,
  variant,
  onClick,
  children,
}: {
  title: string;
  ariaLabel: string;
  active?: boolean;
  variant: RowActionButtonVariant;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active || undefined}
      onClick={onClick}
      className={rowActionButtonClass(variant)}
    >
      {children}
    </button>
  );
}

export function ExplorerRowActions({
  nodeId,
  createParentId,
  accessPath,
  isFolder,
  endpoints,
  openMenuAction,
  isSynced,
  itemName,
  onCreate,
  onCreateSync,
  onOpenAccess,
  onRename,
  onDelete,
}: {
  nodeId: string;
  createParentId: string | null;
  accessPath: string;
  isFolder: boolean;
  endpoints: readonly SyncEndpointInfo[];
  openMenuAction?: ExplorerCreateMenuAction | null;
  isSynced?: boolean;
  itemName: string;
  onCreate?: ExplorerSidebarProps['onCreate'];
  onCreateSync?: ExplorerSidebarProps['onCreateSync'];
  onOpenAccess?: ExplorerSidebarProps['onOpenAccess'];
  onRename?: ExplorerSidebarProps['onRename'];
  onDelete?: ExplorerSidebarProps['onDelete'];
}) {
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [isAccessControlActive, setIsAccessControlActive] = useState(false);

  const isCreateMenuOpen = openMenuAction === 'create';
  const isAccessMenuOpen = openMenuAction === 'access';
  const endpointCount = endpoints.length;
  const hasAccessPoint = endpointCount > 0;
  const integrationLabel = endpointCount === 1 ? 'integration' : 'integrations';
  const suppressPeerActions = isAccessControlActive || isAccessMenuOpen;
  const peerVisibility = suppressPeerActions ? 'invisible' : 'invisible group-hover/row:visible';
  const accessVisibility = hasAccessPoint || isAccessMenuOpen ? 'visible' : 'invisible group-hover/row:visible';
  const accessActive = hasAccessPoint || isAccessMenuOpen;

  if (!onCreate && !onCreateSync && !onRename && !onDelete) return null;

  return (
    <div className="ml-auto flex flex-shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      {isFolder && onCreate && (
        <div className={isCreateMenuOpen ? 'visible' : peerVisibility}>
          <RowActionButton
            title="New item"
            ariaLabel="New item"
            active={isCreateMenuOpen}
            variant={isCreateMenuOpen ? 'createActive' : 'default'}
            onClick={(e) => {
              e.stopPropagation();
              onCreate(e, createParentId);
            }}
          >
            <PlusIcon />
          </RowActionButton>
        </div>
      )}

      {(onRename || onDelete) && (
        <div className={isContextMenuOpen ? 'visible' : peerVisibility}>
          <ItemContextMenu
            itemId={nodeId}
            itemName={itemName}
            isSynced={isSynced}
            onRename={onRename}
            onDelete={onDelete}
            onOpenChange={setIsContextMenuOpen}
          />
        </div>
      )}

      {isFolder && onCreateSync && (
        <div
          className={accessVisibility}
          onMouseEnter={() => setIsAccessControlActive(true)}
          onMouseLeave={() => setIsAccessControlActive(false)}
          onFocus={() => setIsAccessControlActive(true)}
          onBlur={() => setIsAccessControlActive(false)}
        >
          <RowActionButton
            title={
              hasAccessPoint
                ? `${endpointCount} ${integrationLabel} on this folder`
                : 'Add integration to this folder'
            }
            ariaLabel="Add integration to this folder"
            active={accessActive}
            variant={accessActive ? 'accessActive' : 'default'}
            onClick={(e) => {
              e.stopPropagation();
              if (hasAccessPoint && onOpenAccess) {
                onOpenAccess(endpoints, accessPath);
                return;
              }
              onCreateSync(e, accessPath);
            }}
          >
            <LinkIcon />
          </RowActionButton>
        </div>
      )}
    </div>
  );
}
