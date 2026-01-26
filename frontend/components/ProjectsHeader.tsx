'use client';

import type { CSSProperties } from 'react';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

export type EditorType = 'treeline-virtual' | 'monaco' | 'table';
export type ViewType = 'grid' | 'list' | 'column';

export type BreadcrumbSegment = {
  label: string;
  href?: string;
  icon?: React.ReactNode;
};

type ProjectsHeaderProps = {
  pathSegments: BreadcrumbSegment[];
  projectId: string | null;
  onProjectsRefresh?: () => void;
  // Back navigation
  onBack?: () => void;
  // Editor Props
  editorType?: EditorType;
  onEditorTypeChange?: (type: EditorType) => void;
  showEditorSwitcher?: boolean; // Renamed from showViewSwitcher
  // Browser Props
  viewType?: ViewType;
  onViewTypeChange?: (type: ViewType) => void;

  accessPointCount?: number; // 已配置的 Access Points 数量
  // Chat (Global Level)
  isChatOpen?: boolean;
  onChatOpenChange?: (open: boolean) => void;
};

const editorOptions: {
  id: EditorType;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    id: 'table',
    label: 'Table',
    icon: (
      <svg width='12' height='12' viewBox='0 0 24 24' fill='currentColor'>
        <path d='M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z' />
      </svg>
    ),
  },
  {
    id: 'treeline-virtual',
    label: 'Tree',
    icon: (
      <svg width='12' height='12' viewBox='0 0 24 24' fill='currentColor'>
        <path d='M22 11V3h-7v3H9V3H2v8h7v-3h2v10h4v3h7v-8h-7v3h-2V8h2v3z' />
      </svg>
    ),
  },
  { id: 'monaco', label: 'Raw', icon: '{ }' },
];

const viewOptions: {
  id: ViewType;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    id: 'grid',
    label: 'Grid',
    icon: (
      <svg
        width='12'
        height='12'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
      >
        <rect x='3' y='3' width='7' height='7' />
        <rect x='14' y='3' width='7' height='7' />
        <rect x='14' y='14' width='7' height='7' />
        <rect x='3' y='14' width='7' height='7' />
      </svg>
    ),
  },
  {
    id: 'list',
    label: 'List',
    icon: (
      <svg
        width='12'
        height='12'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
      >
        <line x1='8' y1='6' x2='21' y2='6' />
        <line x1='8' y1='12' x2='21' y2='12' />
        <line x1='8' y1='18' x2='21' y2='18' />
        <line x1='3' y1='6' x2='3.01' y2='6' />
        <line x1='3' y1='12' x2='3.01' y2='12' />
        <line x1='3' y1='18' x2='3.01' y2='18' />
      </svg>
    ),
  },
];

export function ProjectsHeader({
  pathSegments,
  projectId,
  onProjectsRefresh,
  onBack,
  editorType = 'treeline-virtual',
  onEditorTypeChange,
  accessPointCount = 0,
  showEditorSwitcher = false, // Default false, controlled by parent
  viewType,
  onViewTypeChange,
  isChatOpen = false,
  onChatOpenChange,
}: ProjectsHeaderProps) {
  const [showEditorMenu, setShowEditorMenu] = useState(false);
  const agentPanelRef = useRef<HTMLDivElement>(null);

  const currentEditor =
    editorOptions.find(e => e.id === editorType) || editorOptions[0];

  // Close editor menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const editorButton = document.getElementById('editor-switch-button');
      const editorMenu = document.getElementById('editor-menu');

      if (
        editorButton &&
        !editorButton.contains(target) &&
        editorMenu &&
        !editorMenu.contains(target)
      ) {
        setShowEditorMenu(false);
      }
    };

    if (showEditorMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEditorMenu]);

  return (
    <header style={headerStyle}>
      {/* LEFT SIDE: Back Button + Breadcrumbs + View Switcher */}
      <div style={headerLeftStyle}>
        {/* Back Button Container - 与右侧 chat toggle 对称 */}
        {onBack && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              paddingLeft: 8,
              paddingRight: 8,
            }}
          >
            <button
              onClick={onBack}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                background: 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                color: '#666',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                e.currentTarget.style.color = '#eee';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#666';
              }}
              title="Back to Home"
            >
              <svg
                width='16'
                height='16'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <path d='M19 12H5' />
                <path d='M12 19l-7-7 7-7' />
              </svg>
            </button>
          </div>
        )}

        {/* Breadcrumbs */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {pathSegments.map((segment, index) => {
            const isLast = index === pathSegments.length - 1;
            return (
              <div
                key={index}
                style={{ display: 'flex', alignItems: 'center' }}
              >
                {index > 0 && (
                  <span style={{ margin: '0 8px', color: '#444' }}>/</span>
                )}
                {segment.href && !isLast ? (
                  <Link
                    href={segment.href}
                    style={{
                      ...pathStyle,
                      color: '#888',
                      cursor: 'pointer',
                      transition: 'color 0.15s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.color = '#fff';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = '#888';
                    }}
                  >
                    {segment.icon && (
                      <span
                        style={{
                          display: 'flex',
                          color: 'inherit',
                          opacity: 0.8,
                        }}
                      >
                        {segment.icon}
                      </span>
                    )}
                    {segment.label}
                  </Link>
                ) : (
                  <span
                    style={{
                      ...pathStyle,
                      color: isLast ? '#CDCDCD' : '#888',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {segment.icon && (
                      <span
                        style={{
                          display: 'flex',
                          color: 'inherit',
                          opacity: 0.8,
                        }}
                      >
                        {segment.icon}
                      </span>
                    )}
                    {segment.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* View Switcher - Segmented Control Style */}
        {showEditorSwitcher ? (
          <div style={viewSwitcherContainerStyle}>
            {editorOptions.map(option => {
              const isSelected = option.id === editorType;
              return (
                <button
                  key={option.id}
                  onClick={() => onEditorTypeChange?.(option.id)}
                  style={{
                    ...viewSwitcherBtnStyle,
                    background: isSelected
                      ? 'rgba(255,255,255,0.1)'
                      : 'transparent',
                    color: isSelected ? '#e2e8f0' : '#6b7280',
                  }}
                >
                  <span style={{ fontSize: 11 }}>{option.icon}</span>
                  <span style={{ fontSize: 10 }}>{option.label}</span>
                </button>
              );
            })}
          </div>
        ) : viewType && onViewTypeChange ? (
          <div style={viewSwitcherContainerStyle}>
            {viewOptions.map(option => {
              const isSelected = option.id === viewType;
              return (
                <button
                  key={option.id}
                  onClick={() => onViewTypeChange(option.id)}
                  style={{
                    ...viewSwitcherBtnStyle,
                    background: isSelected
                      ? 'rgba(255,255,255,0.1)'
                      : 'transparent',
                    color: isSelected ? '#e2e8f0' : '#6b7280',
                  }}
                >
                  <span style={{ fontSize: 11 }}>{option.icon}</span>
                  <span style={{ fontSize: 10 }}>{option.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* RIGHT SIDE: Context Actions (Sync + Publish) + Chat Toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginLeft: 'auto',
        }}
      >
        {/* Vertical Divider + Chat Toggle - Hidden when chat is open */}
        {!isChatOpen ? (
          <>
            <div
              style={{
                width: 1,
                height: 45,
                background: '#262626',
                marginLeft: 4,
              }}
            />

            {/* Chat Toggle Block - 28x28 to match left sidebar toggle */}

            {/* Chat Toggle - Claude Agent SDK enabled */}
            <div
              onClick={() => onChatOpenChange?.(true)}
              style={{
                width: 28,
                height: 28,
                background: 'transparent',
                borderRadius: 5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s',
                marginRight: 8,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
              }}
              title='Open Chat'
            >
              {/* Sidebar toggle icon - Rectangle like OpenAI, 14px to match left sidebar */}
              <svg
                width='14'
                height='14'
                viewBox='0 0 24 24'
                fill='none'
                stroke='#6b7280'
                strokeWidth='1.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <rect x='3' y='3' width='18' height='18' rx='2' />
                <line x1='15' y1='3' x2='15' y2='21' />
              </svg>
            </div>
          </>
        ) : (
          /* Right padding when chat is open */
          <div style={{ width: 8 }} />
        )}
      </div>
    </header>
  );
}

// Styles
const headerStyle: CSSProperties = {
  height: 45,
  paddingLeft: 16,
  paddingRight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid rgba(46,46,46,0.7)',
  background: 'rgba(10,10,12,0.85)',
  backdropFilter: 'blur(12px)',
  position: 'relative',
  zIndex: 10,
};

const headerLeftStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const pathStyle: CSSProperties = {
  fontFamily:
    "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: 13,
  fontWeight: 500,
  color: '#CDCDCD',
};

const viewSwitcherContainerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  background: 'rgba(255,255,255,0.04)',
  borderRadius: 6,
  padding: 2,
  gap: 2,
};

const viewSwitcherBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  borderRadius: 4,
  border: 'none',
  cursor: 'pointer',
  transition: 'all 0.15s',
  fontFamily:
    "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
};
