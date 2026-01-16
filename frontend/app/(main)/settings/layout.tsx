'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const MIN_WIDTH = 180;
const MAX_WIDTH = 320;
const DEFAULT_WIDTH = 220;
const COLLAPSED_WIDTH = 45;

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Handle resize logic
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isCollapsed) return;
      e.preventDefault();
      setIsResizing(true);
    },
    [isCollapsed]
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarRef.current) return;
      const rect = sidebarRef.current.getBoundingClientRect();
      const newWidth = e.clientX - rect.left;
      const clampedWidth = Math.min(Math.max(newWidth, MIN_WIDTH), MAX_WIDTH);
      setSidebarWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        backgroundColor: '#202020', // 一级 sidebar 的背景色作为整个页面底色
      }}
    >
      {/* --- 右侧浮动容器：包含二级 sidebar + 主内容区 --- */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          margin: 8,
          marginLeft: 0,
          borderRadius: 12,
          border: '1px solid #2a2a2a',
          background: '#0e0e0e',
          overflow: 'hidden',
        }}
      >
        {/* --- Settings Sidebar --- */}
        <aside
          ref={sidebarRef}
          style={{
            width: isCollapsed ? COLLAPSED_WIDTH : sidebarWidth,
            borderRight: '1px solid #2a2a2a',
            display: 'flex',
            flexDirection: 'column',
            background: '#141414',
            fontFamily:
              "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
            boxSizing: 'border-box',
            position: 'relative',
            flexShrink: 0,
            transition: isResizing ? 'none' : 'width 0.2s ease',
          }}
        >
          {/* Header */}
          <div
            style={{
              height: 46,
              minHeight: 46,
              maxHeight: 46,
              display: 'flex',
              alignItems: 'center',
              justifyContent: isCollapsed ? 'center' : 'space-between',
              padding: isCollapsed ? '0' : '0 9px 0 16px',
              borderBottom: '1px solid #2a2a2a',
              boxSizing: 'border-box',
            }}
          >
            {isCollapsed ? (
              <button
                onClick={() => setIsCollapsed(false)}
                title='Expand sidebar'
                style={{
                  width: 28,
                  height: 28,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 5,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#6b7280',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                  e.currentTarget.style.color = '#9ca3af';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#6b7280';
                }}
              >
                <svg
                  width='14'
                  height='14'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='1.5'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                >
                  <rect x='3' y='3' width='18' height='18' rx='2' />
                  <line x1='9' y1='3' x2='9' y2='21' />
                </svg>
              </button>
            ) : (
              <>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#EDEDED',
                    letterSpacing: '0.3px',
                  }}
                >
                  Settings
                </span>
                <button
                  onClick={() => setIsCollapsed(true)}
                  title='Collapse sidebar'
                  style={{
                    width: 28,
                    height: 28,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 5,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#6b7280',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                    e.currentTarget.style.color = '#9ca3af';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#6b7280';
                  }}
                >
                  <svg
                    width='14'
                    height='14'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  >
                    <rect x='3' y='3' width='18' height='18' rx='2' />
                    <line x1='9' y1='3' x2='9' y2='21' />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Expanded Content */}
          {!isCollapsed && (
            <div style={{ flex: 1, overflowY: 'auto', paddingTop: 12 }}>
              <div style={{ marginBottom: 4 }}>
                <div
                  style={{
                    padding: '2px 8px 4px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  <NavItem
                    href='/settings/connect'
                    active={pathname?.startsWith('/settings/connect')}
                    label='Integrations'
                  />
                </div>
              </div>
            </div>
          )}

          {/* Collapsed Navigation */}
          {isCollapsed && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '12px 0',
                gap: 4,
              }}
            >
              <CollapsedNavItem
                href='/settings/connect'
                active={pathname?.startsWith('/settings/connect')}
                title='Import Settings'
                icon={
                  <svg
                    width='14'
                    height='14'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='1.5'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      d='M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z'
                    />
                  </svg>
                }
              />
            </div>
          )}

          {/* Resize Handle */}
          {!isCollapsed && (
            <div
              onMouseDown={handleMouseDown}
              style={{
                position: 'absolute',
                top: 0,
                right: -2,
                width: 4,
                height: '100%',
                cursor: 'col-resize',
                zIndex: 10,
                background: isResizing
                  ? 'rgba(255, 255, 255, 0.1)'
                  : 'transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                if (!isResizing)
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              }}
              onMouseLeave={e => {
                if (!isResizing)
                  e.currentTarget.style.background = 'transparent';
              }}
            />
          )}
        </aside>

        {/* --- Main Content Area --- */}
        <section
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%', // 确保高度传递给子组件
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: '#0a0a0a',
          }}
        >
          {children}
        </section>
      </div>
    </div>
  );
}

// --- Sub Components ---

function NavItem({
  active,
  href,
  label,
}: {
  active?: boolean;
  href: string;
  label: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 4px 0 12px',
        borderRadius: 6,
        cursor: 'pointer',
        background: active || hovered ? '#2C2C2C' : 'transparent',
        border: 'none',
        width: '100%',
        textDecoration: 'none',
        transition: 'background 0.15s',
        boxSizing: 'border-box',
      }}
    >
      {/* Icon */}
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 16,
          height: 16,
          flexShrink: 0,
        }}
      >
        <svg
          width='14'
          height='14'
          viewBox='0 0 24 24'
          fill='none'
          stroke={active ? '#CDCDCD' : hovered ? '#9B9B9B' : '#5D6065'}
          strokeWidth='1.5'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            d='M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z'
          />
        </svg>
      </span>

      {/* Label */}
      <span
        style={{
          flex: 1,
          fontSize: 13,
          fontWeight: 500,
          color: active ? '#FFFFFF' : hovered ? '#F0EFED' : '#9B9B9B',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          transition: 'color 0.15s',
        }}
      >
        {label}
      </span>
    </Link>
  );
}

function CollapsedNavItem({
  active,
  href,
  title,
  icon,
}: {
  active?: boolean;
  href: string;
  title: string;
  icon: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={href}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 28,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: active
          ? 'rgba(59, 130, 246, 0.15)'
          : hovered
            ? 'rgba(255,255,255,0.08)'
            : 'transparent',
        borderRadius: 5,
        cursor: 'pointer',
        color: active ? '#60a5fa' : hovered ? '#e2e8f0' : '#808080',
        transition: 'all 0.15s',
        textDecoration: 'none',
      }}
    >
      {icon}
    </Link>
  );
}
