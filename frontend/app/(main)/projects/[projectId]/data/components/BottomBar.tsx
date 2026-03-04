'use client';

import React from 'react';
import { getNodeTypeConfig } from '@/lib/nodeTypeConfig';
import type { EditorType, ViewType } from '@/components/ProjectsHeader';
import type { MarkdownViewMode } from '@/components/editors/markdown';

interface BottomBarProps {
  viewType: ViewType;
  setViewType: (v: ViewType) => void;
  editorType: EditorType;
  setEditorType: (e: EditorType) => void;
  markdownViewMode: MarkdownViewMode;
  setMarkdownViewMode: (m: MarkdownViewMode) => void;
  isEditorView: boolean;
  activeNodeType: string;
  activeProject: any;
  currentTableData: any;
  markdownContent: string;
  isVersionHistoryOpen: boolean;
  onOpenVersionHistory: () => void;
}

const toggleGroupStyle: React.CSSProperties = {
  display: 'flex', background: '#141414', borderRadius: 6, padding: 2, gap: 1, border: '1px solid #1f1f1f',
};

function ToggleButton({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, borderRadius: 4, border: 'none',
        background: active ? '#2a2a2a' : 'transparent',
        color: active ? '#fff' : '#525252',
        cursor: 'pointer', transition: 'all 0.15s ease',
      }}
      title={title}
    >
      {children}
    </button>
  );
}

export function BottomBar({
  viewType, setViewType,
  editorType, setEditorType,
  markdownViewMode, setMarkdownViewMode,
  isEditorView, activeNodeType, activeProject,
  currentTableData, markdownContent,
  isVersionHistoryOpen, onOpenVersionHistory,
}: BottomBarProps) {
  const nodeConfig = activeNodeType ? getNodeTypeConfig(activeNodeType) : null;
  const showJsonToggle = isEditorView && activeProject
    && nodeConfig?.renderAs !== 'markdown'
    && activeNodeType !== 'github'
    && !(['file', 'image'].includes(nodeConfig?.renderAs ?? '') && !currentTableData?.data && !markdownContent);
  const showMarkdownToggle = isEditorView && activeProject && nodeConfig?.renderAs === 'markdown';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '4px 8px', flexShrink: 0,
    }}>
      {/* Left: view toggle + editor type toggles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* View type: Explorer / Grid */}
        <div style={toggleGroupStyle}>
          <ToggleButton active={viewType === 'explorer'} onClick={() => setViewType('explorer')} title="Explorer view">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </ToggleButton>
          <ToggleButton active={viewType === 'grid'} onClick={() => setViewType('grid')} title="Grid view">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
            </svg>
          </ToggleButton>
        </div>

        {/* JSON: Table / Raw JSON */}
        {showJsonToggle && (
          <div style={toggleGroupStyle}>
            <ToggleButton active={editorType === 'table'} onClick={() => setEditorType('table')} title="Table view">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </ToggleButton>
            <ToggleButton active={editorType === 'monaco'} onClick={() => setEditorType('monaco')} title="Raw JSON">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 4C5.5 4 4 5 4 7s1.5 2.5 1.5 5S4 17 4 17c0 2 1.5 3 3 3" strokeLinecap="round" />
                <path d="M17 4c1.5 0 3 1 3 3s-1.5 2.5-1.5 5 1.5 5 1.5 5c0 2-1.5 3-3 3" strokeLinecap="round" />
              </svg>
            </ToggleButton>
          </div>
        )}

        {/* Markdown: WYSIWYG / Source */}
        {showMarkdownToggle && (
          <div style={toggleGroupStyle}>
            <ToggleButton active={markdownViewMode === 'wysiwyg'} onClick={() => setMarkdownViewMode('wysiwyg')} title="WYSIWYG">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </ToggleButton>
            <ToggleButton active={markdownViewMode === 'source'} onClick={() => setMarkdownViewMode('source')} title="Source">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </ToggleButton>
          </div>
        )}
      </div>

      {/* Right: version history */}
      <div>
        {isEditorView && !isVersionHistoryOpen && (
          <button
            onClick={onOpenVersionHistory}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 5,
              border: '1px solid transparent', background: 'transparent',
              color: '#3f3f46', fontSize: 11, cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#a1a1aa'; e.currentTarget.style.borderColor = '#27272a'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#3f3f46'; e.currentTarget.style.borderColor = 'transparent'; }}
            title="Version History"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            History
          </button>
        )}
      </div>
    </div>
  );
}
