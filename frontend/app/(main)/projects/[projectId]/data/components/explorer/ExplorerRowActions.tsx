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
    return `${base} bg-[var(--po-selected)] text-[var(--po-text)]`;
  }

  if (variant === 'accessActive') {
    return `${base} bg-[var(--po-access-active-bg)] text-[var(--po-access-active-text)] hover:bg-[var(--po-access-active-hover)] hover:text-[var(--po-access-active-text)]`;
  }

  return `${base} bg-transparent text-[var(--po-text-subtle)] hover:bg-[var(--po-hover)] hover:text-[var(--po-text)]`;
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
  onDownload,
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
  onDownload?: ExplorerSidebarProps['onDownload'];
}) {
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [isAccessControlActive, setIsAccessControlActive] = useState(false);

  const isCreateMenuOpen = openMenuAction === 'create';
  const isAccessMenuOpen = openMenuAction === 'access';
  // Aggregate "is any popover anchored to this row open?". This is
  // the lock that pins the row's geometry — once any menu is open,
  // we don't let the peer slots collapse just because the mouse
  // wandered off the row, otherwise the popover ends up floating
  // over a partially-empty row and the buttons "teleport" when the
  // user dismisses the menu.
  const isAnyMenuOpen =
    isCreateMenuOpen || isContextMenuOpen || isAccessMenuOpen;
  const endpointCount = endpoints.length;
  const hasAccessPoint = endpointCount > 0;
  const integrationLabel = endpointCount === 1 ? 'integration' : 'integrations';
  const suppressPeerActions = isAccessControlActive || isAccessMenuOpen;

  // Visibility primitives.
  //
  //   • `hidden`     →  `display: none`  → element takes no layout space
  //   • `flex`       →  `display: flex`  → element takes its natural width
  //   • `invisible`  →  `visibility: hidden` → element takes space, hidden visually
  //
  // The earlier version used `invisible` for the rest state, which
  // meant the `+` / `…` / `link` buttons each reserved ~22px of
  // layout even when they weren't drawn — so a 240px sidebar was
  // effectively ~166px after subtracting indent + icon + reserved
  // actions, and that's why "02-vendors" truncated to "02-ve…"
  // while there was visibly empty space to the right.
  //
  // The current rules:
  //
  //   1. Rest state (no row hover, no open menu): `hidden` — peers
  //      take zero layout space, file name gets the full width.
  //   2. Row hover, no menu open: `flex` — peers fade in, name
  //      reflows naturally to make room.
  //   3. Any menu anchored to this row is open: `flex` — peers stay
  //      in their natural slot regardless of mouse position. The
  //      button whose menu is open shows its active variant; the
  //      others stay in default ghost state (visible but not
  //      highlighted) so the row geometry is locked while the user
  //      navigates the popover.
  //   4. Hovering the access button while no menu is open: peers
  //      go `flex invisible` instead of `hidden`, so the name
  //      doesn't expand-then-snap-back as the mouse crosses the
  //      access slot. Skipped when (3) applies.
  const peerVisibility = isAnyMenuOpen
    ? 'flex'
    : suppressPeerActions
      ? 'hidden group-hover/row:flex group-hover/row:invisible'
      : 'hidden group-hover/row:flex';
  const accessVisibility =
    hasAccessPoint || isAnyMenuOpen
      ? 'flex'
      : 'hidden group-hover/row:flex';
  const accessActive = hasAccessPoint || isAccessMenuOpen;

  if (!onCreate && !onCreateSync && !onRename && !onDelete && !onDownload) return null;

  return (
    <div className="ml-auto flex flex-shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      {isFolder && onCreate && (
        <div className={peerVisibility}>
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

      {(onRename || onDelete || onDownload) && (
        <div className={peerVisibility}>
          <ItemContextMenu
            itemId={nodeId}
            itemName={itemName}
            isSynced={isSynced}
            onRename={onRename}
            onDelete={onDelete}
            onDownload={onDownload}
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
