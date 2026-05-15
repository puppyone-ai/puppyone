'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  useAllTools,
  useMcpInstances,
  refreshToolsAndMcp,
} from '@/lib/hooks/useData';
import { createMcpV2 } from '@/lib/mcpApi';
import { Dots } from '@/components/loading';
import { CHROME_LABEL_TYPOGRAPHY, FONT_SANS } from '@/lib/uiTypography';

const MIN_WIDTH = 180;
const MAX_WIDTH = 320;
const DEFAULT_WIDTH = MIN_WIDTH;
const COLLAPSED_WIDTH = 45;

export default function ToolsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Data fetching
  const { tools, isLoading: toolsLoading } = useAllTools();
  const {
    instances,
    isLoading: instancesLoading,
    refresh: refreshInstances,
  } = useMcpInstances();
  const loading = toolsLoading || instancesLoading;

  // Layout state
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Create Server Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newServerUrl, setNewServerUrl] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Handle resize
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

  const handleCreateServer = async () => {
    if (!newServerUrl.trim()) return;
    setIsCreating(true);
    try {
      const newMcp = await createMcpV2({ name: newServerUrl });
      await refreshInstances();
      setShowCreateModal(false);
      setNewServerUrl('');
      router.push(`/tools-and-server/servers/${newMcp.api_key}`);
    } catch (error) {
      console.error('Failed to create server:', error);
      alert('Failed to connect to MCP Server');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--po-panel)', // Main content area - darker than bars (var(--po-panel-raised))
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
          border: '1px solid var(--po-border)',
          background: 'var(--po-canvas)',
          overflow: 'hidden',
        }}
      >
        {/* --- Tools Sidebar --- */}
        <aside
          ref={sidebarRef}
          style={{
            width: isCollapsed ? COLLAPSED_WIDTH : sidebarWidth,
            borderRight: '1px solid var(--po-border)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--po-control)',
            fontFamily: FONT_SANS,
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
              borderBottom: '1px solid var(--po-border)',
              boxSizing: 'border-box',
            }}
          >
            {isCollapsed ? (
              <button
                onClick={() => setIsCollapsed(false)}
                title='Expand sidebar'
                style={{
                  width: 30,
                  height: 30,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 5,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--po-text-subtle)',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--po-border)';
                  e.currentTarget.style.color = 'var(--po-text-muted)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--po-text-subtle)';
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
                    ...CHROME_LABEL_TYPOGRAPHY,
                    color: 'var(--po-text)',
                  }}
                >
                  Tools & MCP
                </span>
                <button
                  onClick={() => setIsCollapsed(true)}
                  title='Collapse sidebar'
                  style={{
                    width: 30,
                    height: 30,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 5,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--po-text-subtle)',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'var(--po-border)';
                    e.currentTarget.style.color = 'var(--po-text-muted)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--po-text-subtle)';
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

          {/* Content */}
          {!isCollapsed ? (
            <div style={{ flex: 1, overflowY: 'auto', paddingTop: 12 }}>
              {/* HIDDEN: Tools List nav item temporarily disabled */}

              {/* Servers Section */}
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px solid var(--po-border-strong)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 12px',
                    height: 32,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--po-text-subtle)',
                    }}
                  >
                    Deployed Servers
                  </span>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 30,
                      height: 30,
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      color: 'var(--po-text-subtle)',
                      transition: 'all 0.15s',
                    }}
                    title='New Server'
                    onMouseEnter={e => {
                      e.currentTarget.style.background =
                        'var(--po-active)';
                      e.currentTarget.style.color = 'var(--po-text)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--po-text-subtle)';
                    }}
                  >
                    <svg width='14' height='14' viewBox='0 0 10 10' fill='none'>
                      <path
                        d='M5 1v8M1 5h8'
                        stroke='currentColor'
                        strokeWidth='1.3'
                        strokeLinecap='round'
                      />
                    </svg>
                  </button>
                </div>
                <div
                  style={{
                    padding: '2px 8px 4px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  {instances.map(mcp => (
                    <NavItem
                      key={mcp.api_key}
                      href={`/tools-and-server/servers/${mcp.api_key}`}
                      active={pathname?.startsWith(
                        `/tools-and-server/servers/${mcp.api_key}`
                      )}
                      label={mcp.name || 'Unnamed'}
                      isServer
                      status={mcp.status}
                    />
                  ))}

                  {instances.length === 0 && (
                    <button
                      onClick={() => setShowCreateModal(true)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        height: 32,
                        padding: '0 4px 0 6px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 5,
                        cursor: 'pointer',
                        width: '100%',
                        textAlign: 'left',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e =>
                        (e.currentTarget.style.background = 'var(--po-hover)')
                      }
                      onMouseLeave={e =>
                        (e.currentTarget.style.background = 'transparent')
                      }
                    >
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 16,
                          height: 16,
                          color: 'var(--po-text-subtle)',
                        }}
                      >
                        <svg
                          width='14'
                          height='14'
                          viewBox='0 0 14 14'
                          fill='none'
                        >
                          <path
                            d='M7 3v8M3 7h8'
                            stroke='currentColor'
                            strokeWidth='1.2'
                            strokeLinecap='round'
                          />
                        </svg>
                      </span>
                      <span style={{ fontSize: 16, color: 'var(--po-text-subtle)' }}>
                        New Server
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            // Collapsed Navigation
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
              {/* HIDDEN: Tools List collapsed nav item temporarily disabled */}
              {instances.map(mcp => (
                <CollapsedNavItem
                  key={mcp.api_key}
                  href={`/tools-and-server/servers/${mcp.api_key}`}
                  active={pathname?.startsWith(
                    `/tools-and-server/servers/${mcp.api_key}`
                  )}
                  title={mcp.name || 'Unnamed Server'}
                  status={mcp.status}
                  icon={
                    <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                      <path
                        d='M7 1L12.2 4v6L7 13L1.8 10V4L7 1z'
                        stroke='currentColor'
                        strokeWidth='1.2'
                        strokeLinejoin='round'
                        fill='none'
                      />
                      <circle cx='7' cy='7' r='1.5' fill='currentColor' />
                      <path
                        d='M7 5.5V3.5M5.7 8L4 9.5M8.3 8L10 9.5'
                        stroke='currentColor'
                        strokeWidth='1.2'
                        strokeLinecap='round'
                      />
                    </svg>
                  }
                />
              ))}
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
                  ? 'var(--po-active)'
                  : 'transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                if (!isResizing)
                  e.currentTarget.style.background = 'var(--po-active)';
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
            background: 'var(--po-canvas)',
          }}
        >
          {children}
        </section>
      </div>

      {/* --- Create Server Modal --- */}
      {showCreateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--po-backdrop)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
          }}
        >
          <div
            style={{
              background: 'var(--po-panel-raised)',
              border: '1px solid var(--po-border-strong)',
              borderRadius: 10,
              padding: 24,
              width: 400,
              maxWidth: '90%',
              boxShadow: '0 10px 40px var(--po-shadow)',
            }}
          >
            <h3
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--po-text)',
                marginBottom: 16,
              }}
            >
              Add MCP Server
            </h3>
            <input
              type='url'
              placeholder='Enter MCP Server URL (SSE)'
              value={newServerUrl}
              onChange={e => setNewServerUrl(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                background: 'var(--po-inset)',
                border: '1px solid var(--po-border-strong)',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 16,
                color: 'var(--po-text)',
                outline: 'none',
                marginBottom: 16,
              }}
            />
            <div
              style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}
            >
              <button
                onClick={() => setShowCreateModal(false)}
                style={{
                  height: 30,
                  padding: '0 16px',
                  borderRadius: 6,
                  background: 'transparent',
                  color: 'var(--po-text-subtle)',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateServer}
                disabled={isCreating || !newServerUrl.trim()}
                style={{
                  height: 30,
                  padding: '0 16px',
                  borderRadius: 6,
                  background: 'var(--po-accent)',
                  color: 'var(--po-text-inverse)',
                  border: 'none',
                  cursor: isCreating ? 'not-allowed' : 'pointer',
                  opacity: isCreating ? 0.7 : 1,
                  fontSize: 13,
                  fontWeight: 500,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {isCreating && <Dots size='xs' />}
                {isCreating ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Sub Components ---

function NavItem({ active, href, label, count, isServer, status }: any) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 32,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 4px 0 6px',
        borderRadius: 6,
        cursor: 'pointer',
        background: active || hovered ? 'var(--po-hover)' : 'transparent',
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
          position: 'relative',
        }}
      >
        {isServer ? (
          <>
            <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
              <path
                d='M7 1L12.2 4v6L7 13L1.8 10V4L7 1z'
                stroke={active ? 'var(--po-accent)' : hovered ? 'var(--po-text-muted)' : 'var(--po-text-subtle)'}
                strokeWidth='1.2'
                strokeLinejoin='round'
                fill='none'
              />
              <circle
                cx='7'
                cy='7'
                r='1.5'
                fill={active ? 'var(--po-accent)' : hovered ? 'var(--po-text-muted)' : 'var(--po-text-subtle)'}
              />
              <path
                d='M7 5.5V3.5M5.7 8L4 9.5M8.3 8L10 9.5'
                stroke={active ? 'var(--po-accent)' : hovered ? 'var(--po-text-muted)' : 'var(--po-text-subtle)'}
                strokeWidth='1.2'
                strokeLinecap='round'
              />
            </svg>
            {status !== undefined && (
              <div
                style={{
                  position: 'absolute',
                  bottom: -1,
                  right: -1,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: status ? 'var(--po-success)' : 'var(--po-text-disabled)',
                  border: '1.5px solid var(--po-overlay)',
                }}
              />
            )}
          </>
        ) : (
          <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
            <path
              d='M8.5 3.5a1 1 0 0 0 0 1l1 1a1 1 0 0 0 1 0l2.5-2.5a4 4 0 0 1-5.3 5.3L4 12a1.4 1.4 0 0 1-2-2l3.7-3.7a4 4 0 0 1 5.3-5.3L8.5 3.5z'
              stroke={active ? 'var(--po-text)' : hovered ? 'var(--po-text-muted)' : 'var(--po-text-subtle)'}
              strokeWidth='1.2'
              strokeLinejoin='round'
            />
          </svg>
        )}
      </span>

      {/* Label */}
      <span
        style={{
          flex: 1,
          fontSize: 16,
          fontWeight: 500,
          color: active ? 'var(--po-text-inverse)' : hovered ? 'var(--po-text)' : 'var(--po-text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          transition: 'color 0.15s',
        }}
      >
        {label}
      </span>

      {/* Count Badge */}
      {count !== undefined && count > 0 && (
        <span
          style={{
            fontSize: 10,
            color: 'var(--po-text-subtle)',
            padding: '2px 6px',
            background: 'var(--po-control)',
            borderRadius: 4,
            flexShrink: 0,
          }}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

function CollapsedNavItem({ active, href, title, icon, status }: any) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={href}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 30,
        height: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: active
          ? 'color-mix(in srgb, var(--po-accent) 15%, transparent)'
          : hovered
            ? 'var(--po-border)'
            : 'transparent',
        borderRadius: 5,
        cursor: 'pointer',
        color: active ? 'var(--po-accent)' : hovered ? 'var(--po-text)' : 'var(--po-text-subtle)',
        transition: 'all 0.15s',
        position: 'relative',
        textDecoration: 'none',
      }}
    >
      {icon}
      {status !== undefined && (
        <div
          style={{
            position: 'absolute',
            bottom: 3,
            right: 3,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: status ? 'var(--po-success)' : 'var(--po-text-disabled)',
            border: '1.5px solid var(--po-overlay)',
          }}
        />
      )}
    </Link>
  );
}
