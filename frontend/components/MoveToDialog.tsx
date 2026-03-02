'use client';

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useContentNodes } from '@/lib/hooks/useData';

interface MoveToDialogProps {
  isOpen: boolean;
  projectId: string;
  nodeId: string;
  nodeName: string;
  onConfirm: (targetFolderId: string | null) => void;
  onClose: () => void;
}

function FolderTreeItem({
  id,
  name,
  depth,
  projectId,
  excludeId,
  selectedId,
  onSelect,
}: {
  id: string;
  name: string;
  depth: number;
  projectId: string;
  excludeId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selectedId === id;

  const { nodes: children, isLoading } = useContentNodes(
    expanded ? projectId : '',
    expanded ? id : undefined,
  );

  const childFolders = children.filter(
    (n) => n.type === 'folder' && n.id !== excludeId,
  );

  const handleClick = useCallback(() => {
    onSelect(id);
    if (!expanded) setExpanded(true);
  }, [id, expanded, onSelect]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
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
          background: isSelected ? 'rgba(59, 130, 246, 0.18)' : 'transparent',
          color: isSelected ? '#93c5fd' : '#d4d4d8',
          fontSize: 13,
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => {
          if (!isSelected)
            (e.currentTarget as HTMLElement).style.background =
              'rgba(255,255,255,0.06)';
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
            color: '#666',
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
            fill="#60a5fa"
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
                color: '#525252',
                fontSize: 12,
                height: 28,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              Loading...
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
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
          {!isLoading && childFolders.length === 0 && (
            <div
              style={{
                paddingLeft: 32 + depth * 20,
                color: '#525252',
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
  onConfirm,
  onClose,
}: MoveToDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const isRootSelected = selectedFolderId === null;

  const { nodes: rootNodes, isLoading: rootLoading } = useContentNodes(
    isOpen ? projectId : '',
    isOpen ? null : undefined,
  );

  const rootFolders = rootNodes.filter(
    (n) => n.type === 'folder' && n.id !== nodeId,
  );

  const handleSelect = useCallback((id: string | null) => {
    setSelectedFolderId(id);
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(selectedFolderId);
  }, [selectedFolderId, onConfirm]);

  if (!isOpen || typeof document === 'undefined') return null;

  const displayName =
    nodeName.length > 30 ? nodeName.slice(0, 28) + '...' : nodeName;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380,
          maxHeight: '70vh',
          background: '#1a1a1e',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: '#e4e4e7' }}>
            Move &ldquo;{displayName}&rdquo;
          </div>
          <div
            style={{ fontSize: 12, color: '#71717a', marginTop: 4 }}
          >
            Select a destination folder
          </div>
        </div>

        {/* Folder tree */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '8px 8px',
            minHeight: 200,
            maxHeight: 400,
          }}
        >
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
                ? 'rgba(59, 130, 246, 0.18)'
                : 'transparent',
              color: isRootSelected ? '#93c5fd' : '#d4d4d8',
              fontSize: 13,
              fontWeight: 500,
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => {
              if (!isRootSelected)
                (e.currentTarget as HTMLElement).style.background =
                  'rgba(255,255,255,0.06)';
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
                stroke="#a78bfa"
                strokeWidth="1.5"
                fill="#a78bfa"
                fillOpacity="0.15"
              />
              <polyline
                points="9 22 9 12 15 12 15 22"
                stroke="#a78bfa"
                strokeWidth="1.5"
              />
            </svg>
            <span>Project Root</span>
          </div>

          {/* Divider */}
          <div
            style={{
              height: 1,
              background: 'rgba(255,255,255,0.06)',
              margin: '6px 12px',
            }}
          />

          {/* Folder tree */}
          {rootLoading && rootFolders.length === 0 ? (
            <div
              style={{
                padding: '12px 16px',
                color: '#525252',
                fontSize: 13,
              }}
            >
              Loading folders...
            </div>
          ) : rootFolders.length === 0 ? (
            <div
              style={{
                padding: '12px 16px',
                color: '#525252',
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
                selectedId={selectedFolderId}
                onSelect={handleSelect}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px 16px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent',
              color: '#a1a1aa',
              fontSize: 13,
              cursor: 'pointer',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                'rgba(255,255,255,0.06)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            style={{
              padding: '6px 16px',
              borderRadius: 6,
              border: 'none',
              background: '#3b82f6',
              color: '#fff',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = '#2563eb';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = '#3b82f6';
            }}
          >
            Move Here
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
