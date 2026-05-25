'use client';

import { useState, useCallback, type MouseEvent } from 'react';
import { useTreeDir } from '@/lib/hooks/useData';
import { Dots, PageLoading } from './loading';
import { ActionButton } from './ui/ActionButton';
import { DialogBody, DialogFooter, DialogHeader, DialogRoot, DialogSurface } from './ui/Dialog';

interface MoveToDialogProps {
  isOpen: boolean;
  projectId: string;
  nodeId: string;
  nodeName: string;
  nodeMutPath?: string;
  onConfirm: (targetFolderId: string | null) => void;
  onClose: () => void;
}

function FolderTreeItem({
  id,
  name,
  depth,
  projectId,
  excludeId,
  excludeMutPath,
  selectedId,
  onSelect,
}: {
  id: string;
  name: string;
  depth: number;
  projectId: string;
  excludeId: string;
  excludeMutPath?: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selectedId === id;

  const { nodes: children, isLoading } = useTreeDir(
    expanded ? projectId : '',
    expanded ? id : undefined,
  );

  const childFolders = children.filter((n) => {
    if (n.type !== 'folder') return false;
    if (n.id === excludeId) return false;
    if (excludeMutPath && n.mut_path?.startsWith(excludeMutPath + '/')) return false;
    return true;
  });

  const handleClick = useCallback(() => {
    onSelect(id);
    if (!expanded) setExpanded(true);
  }, [id, expanded, onSelect]);

  const handleToggle = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  }, []);

  return (
    <div>
      <div
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 32,
          paddingLeft: 12 + depth * 20,
          paddingRight: 12,
          cursor: 'pointer',
          borderRadius: 6,
          background: isSelected ? 'var(--po-selected)' : 'transparent',
          color: isSelected ? 'var(--po-accent-text)' : 'var(--po-text-muted)',
          fontSize: 13,
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => {
          if (!isSelected)
            (e.currentTarget as HTMLElement).style.background =
              'var(--po-border-subtle)';
        }}
        onMouseLeave={(e) => {
          if (!isSelected)
            (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
      >
        <button
          onClick={handleToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 16,
            height: 16,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--po-text-subtle)',
            padding: 0,
            flexShrink: 0,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            style={{
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s',
            }}
          >
            <path
              d="M9 6L15 12L9 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z"
            fill="var(--po-accent)"
            fillOpacity="0.45"
          />
        </svg>
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
      </div>

      {expanded && (
        <div>
          {isLoading && childFolders.length === 0 && (
            <div
              style={{
                paddingLeft: 32 + depth * 20,
                height: 28,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Dots size="xs" />
            </div>
          )}
          {childFolders.map((child) => (
            <FolderTreeItem
              key={child.id}
              id={child.id}
              name={child.name}
              depth={depth + 1}
              projectId={projectId}
              excludeId={excludeId}
              excludeMutPath={excludeMutPath}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
          {!isLoading && childFolders.length === 0 && (
            <div
              style={{
                paddingLeft: 32 + depth * 20,
                color: 'var(--po-text-disabled)',
                fontSize: 12,
                fontStyle: 'italic',
                height: 28,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              No subfolders
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MoveToDialog({
  isOpen,
  projectId,
  nodeId,
  nodeName,
  nodeMutPath,
  onConfirm,
  onClose,
}: MoveToDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const isRootSelected = selectedFolderId === null;

  const { nodes: rootNodes, isLoading: rootLoading } = useTreeDir(
    isOpen ? projectId : '',
    isOpen ? null : undefined,
  );

  const rootFolders = rootNodes.filter((n) => {
    if (n.type !== 'folder') return false;
    if (n.id === nodeId) return false;
    if (nodeMutPath && n.mut_path?.startsWith(nodeMutPath + '/')) return false;
    return true;
  });

  const handleSelect = useCallback((id: string | null) => {
    setSelectedFolderId(id);
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(selectedFolderId);
  }, [selectedFolderId, onConfirm]);

  if (!isOpen) return null;

  const displayName =
    nodeName.length > 30 ? nodeName.slice(0, 28) + '...' : nodeName;

  return (
    <DialogRoot onClose={onClose}>
      <DialogSurface width={380} maxHeight="70vh">
        <DialogHeader
          title={<>Move &ldquo;{displayName}&rdquo;</>}
          description="Select a destination folder"
          onClose={onClose}
        />

        <DialogBody style={{ padding: '8px 8px', minHeight: 200, maxHeight: 400 }}>
          {/* Root option */}
          <div
            onClick={() => handleSelect(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 32,
              paddingLeft: 12,
              paddingRight: 12,
              cursor: 'pointer',
              borderRadius: 6,
              background: isRootSelected
                ? 'var(--po-selected)'
                : 'transparent',
              color: isRootSelected ? 'var(--po-accent-text)' : 'var(--po-text-muted)',
              fontSize: 13,
              fontWeight: 500,
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => {
              if (!isRootSelected)
                (e.currentTarget as HTMLElement).style.background =
                  'var(--po-border-subtle)';
            }}
            onMouseLeave={(e) => {
              if (!isRootSelected)
                (e.currentTarget as HTMLElement).style.background =
                  'transparent';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
                stroke="var(--po-accent)"
                strokeWidth="1.5"
                fill="var(--po-accent)"
                fillOpacity="0.15"
              />
              <polyline
                points="9 22 9 12 15 12 15 22"
                stroke="var(--po-accent)"
                strokeWidth="1.5"
              />
            </svg>
            <span>Project Root</span>
          </div>

          {/* Divider */}
          <div
            style={{
              height: 1,
              background: 'var(--po-border-subtle)',
              margin: '6px 12px',
            }}
          />

          {/* Folder tree */}
          {rootLoading && rootFolders.length === 0 ? (
            <div
              style={{
                height: 96,
                display: 'flex',
              }}
            >
              <PageLoading variant="fill" label="Loading folders" />
            </div>
          ) : rootFolders.length === 0 ? (
            <div
              style={{
                padding: '12px 16px',
                color: 'var(--po-text-disabled)',
                fontSize: 13,
                fontStyle: 'italic',
              }}
            >
              No folders in this project
            </div>
          ) : (
            rootFolders.map((folder) => (
              <FolderTreeItem
                key={folder.id}
                id={folder.id}
                name={folder.name}
                depth={0}
                projectId={projectId}
                excludeId={nodeId}
                excludeMutPath={nodeMutPath}
                selectedId={selectedFolderId}
                onSelect={handleSelect}
              />
            ))
          )}
        </DialogBody>

        <DialogFooter style={{ padding: '12px 20px 16px', gap: 8 }}>
          <ActionButton
            onClick={onClose}
          >
            Cancel
          </ActionButton>
          <ActionButton
            onClick={handleConfirm}
            variant='primary'
          >
            Move Here
          </ActionButton>
        </DialogFooter>
      </DialogSurface>
    </DialogRoot>
  );
}
