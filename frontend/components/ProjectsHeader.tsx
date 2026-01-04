'use client';

import type { CSSProperties } from 'react';
import { useState, useEffect, useRef } from 'react';

export type EditorType = 'treeline-virtual' | 'monaco';

type ProjectsHeaderProps = {
  pathSegments: string[];
  projectId: string | null;
  onProjectsRefresh?: () => void;
  editorType?: EditorType;
  onEditorTypeChange?: (type: EditorType) => void;
  // Agent Dashboard (下拉菜单)
  isAgentPanelOpen?: boolean;
  onAgentPanelOpenChange?: (open: boolean) => void;
  accessPointCount?: number; // 已配置的 Access Points 数量
  // Chat (Global Level)
  isChatOpen?: boolean;
  onChatOpenChange?: (open: boolean) => void;
};

const editorOptions: { id: EditorType; label: string; icon: string }[] = [
  { id: 'treeline-virtual', label: 'Tree', icon: '☷' },
  { id: 'monaco', label: 'Raw', icon: '{ }' },
];

export function ProjectsHeader({
  pathSegments,
  projectId,
  onProjectsRefresh,
  editorType = 'treeline-virtual',
  onEditorTypeChange,
  isAgentPanelOpen = false,
  onAgentPanelOpenChange,
  accessPointCount = 0,
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

  // Close agent panel when clicking outside - REMOVED because it's now a sidebar
  // useEffect(() => {
  //   if (!isAgentPanelOpen) return
  //
  //   const handleClickOutside = (event: MouseEvent) => {
  //     const target = event.target as Node
  //     if (agentPanelRef.current && !agentPanelRef.current.contains(target)) {
  //       onAgentPanelOpenChange?.(false)
  //     }
  //   }
  //
  //   // 使用 setTimeout 确保不会立即触发关闭
  //   const timeoutId = setTimeout(() => {
  //     document.addEventListener('mousedown', handleClickOutside)
  //   }, 0)
  //
  //   return () => {
  //     clearTimeout(timeoutId)
  //     document.removeEventListener('mousedown', handleClickOutside)
  //   }
  // }, [isAgentPanelOpen, onAgentPanelOpenChange])

  return (
    <header style={headerStyle}>
      {/* LEFT SIDE: Context Definition (Breadcrumbs + View Switcher) */}
      <div style={headerLeftStyle}>
        {/* Breadcrumbs */}
        <span style={pathStyle}>{pathSegments.join(' / ')}</span>

        {/* View Switcher - Segmented Control Style */}
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
        {/* Agent Dashboard Button + Dropdown */}
        <div
          ref={agentPanelRef}
          style={{
            position: 'relative',
            ...viewSwitcherContainerStyle,
          }}
        >
          <button
            onClick={() => onAgentPanelOpenChange?.(!isAgentPanelOpen)}
            style={{
              ...viewSwitcherBtnStyle,
              background: isAgentPanelOpen
                ? 'rgba(255,255,255,0.1)'
                : 'transparent',
              color: isAgentPanelOpen ? '#e2e8f0' : '#6b7280',
            }}
            title='Agent Dashboard'
          >
            {/* 小狗爪子 SVG */}
            <svg width='14' height='11' viewBox='0 0 33 26' fill='none'>
              <ellipse
                cx='27.9463'
                cy='11.0849'
                rx='3.45608'
                ry='4.0321'
                transform='rotate(14 27.9463 11.0849)'
                fill='currentColor'
              />
              <ellipse
                cx='11.5129'
                cy='4.75922'
                rx='3.45608'
                ry='4.3201'
                transform='rotate(-8 11.5129 4.75922)'
                fill='currentColor'
              />
              <ellipse
                cx='20.7294'
                cy='4.7593'
                rx='3.45608'
                ry='4.3201'
                transform='rotate(8 20.7294 4.7593)'
                fill='currentColor'
              />
              <ellipse
                cx='4.32887'
                cy='11.0848'
                rx='3.45608'
                ry='4.0321'
                transform='rotate(-14 4.32887 11.0848)'
                fill='currentColor'
              />
              <path
                d='M15.4431 11.5849C15.9709 11.499 16.0109 11.4991 16.5387 11.585C17.4828 11.7388 17.9619 12.099 18.7308 12.656C20.3528 13.8309 20.0223 15.0304 21.4709 16.4048C22.2387 17.1332 23.2473 17.7479 23.9376 18.547C24.7716 19.5125 25.1949 20.2337 25.3076 21.4924C25.4028 22.5548 25.3449 23.2701 24.7596 24.1701C24.1857 25.0527 23.5885 25.4635 22.5675 25.7768C21.6486 26.0587 21.0619 25.8454 20.1014 25.7768C18.4688 25.66 17.6279 24.9515 15.9912 24.9734C14.4592 24.994 13.682 25.655 12.155 25.7768C11.1951 25.8533 10.6077 26.0587 9.68884 25.7768C8.66788 25.4635 8.07066 25.0527 7.49673 24.1701C6.91143 23.2701 6.85388 22.5546 6.94907 21.4922C7.06185 20.2335 7.57596 19.5812 8.31877 18.547C9.01428 17.5786 9.71266 17.2943 10.5109 16.4048C11.7247 15.0521 11.7621 13.7142 13.251 12.656C14.0251 12.1059 14.499 11.7387 15.4431 11.5849Z'
                fill='currentColor'
              />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 500 }}>Tools</span>
          </button>
        </div>

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
  paddingRight: 0, // No right padding, Chat toggle goes to edge
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
  gap: 16,
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
  fontFamily: 'inherit',
};
