'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useProjects, useOrphanTables } from '@/lib/hooks/useData';
import { getProcessingTableIds } from '@/components/BackgroundTaskNotifier';
import { ProjectManageDialog } from '@/components/ProjectManageDialog';
import { TableManageDialog } from '@/components/TableManageDialog';
import { TableRenameDialog } from '@/components/TableRenameDialog';
import { TableDeleteDialog } from '@/components/TableDeleteDialog';

const MIN_WIDTH = 180;
const MAX_WIDTH = 320;
const DEFAULT_WIDTH = 220;
const COLLAPSED_WIDTH = 45;

export default function ProjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Data fetching
  const { projects, isLoading } = useProjects();
  const { orphanTables } = useOrphanTables();

  // Dialog state - mode: null (closed), 'create', 'edit', 'delete'
  type DialogMode = 'create' | 'edit' | 'delete' | null;
  const [projectDialogMode, setProjectDialogMode] = useState<DialogMode>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [tableDialogMode, setTableDialogMode] = useState<DialogMode>(null);
  const [tableDialogProjectId, setTableDialogProjectId] = useState<
    string | null
  >(null);
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [tableRenameDialogOpen, setTableRenameDialogOpen] = useState(false);
  const [tableDeleteDialogOpen, setTableDeleteDialogOpen] = useState(false);
  const [tableModalProjectId, setTableModalProjectId] = useState<string | null>(
    null
  );
  const [tableModalTableId, setTableModalTableId] = useState<string | null>(
    null
  );
  const [tableContextMenu, setTableContextMenu] = useState<{
    x: number;
    y: number;
    projectId: string;
    tableId: string;
  } | null>(null);
  const [projectContextMenu, setProjectContextMenu] = useState<{
    x: number;
    y: number;
    projectId: string;
  } | null>(null);

  // Allow nested pages to open TableManageDialog without prop-drilling.
  // Example: onboarding empty-state in `projects/[[...slug]]/page.tsx`.
  useEffect(() => {
    const handler = (
      evt: Event & { detail?: { projectId?: string | null } }
    ) => {
      const projectId = evt?.detail?.projectId ?? null;
      setTableDialogProjectId(projectId);
      setEditingTableId(null);
      setTableDialogMode('create');
    };

    window.addEventListener('pc:open-table-dialog', handler as EventListener);
    return () => {
      window.removeEventListener(
        'pc:open-table-dialog',
        handler as EventListener
      );
    };
  }, []);

  // Layout state
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Expanded projects state
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    new Set()
  );

  // Processing tables state
  const [processingTableIds, setProcessingTableIds] = useState<Set<string>>(
    new Set()
  );

  // Parse current route to get active project/table
  const [activeProjectId, activeTableId] = (() => {
    const match = pathname?.match(/^\/projects\/([^\/]+)(?:\/([^\/]+))?/);
    return [match?.[1] || '', match?.[2] || ''];
  })();

  // Auto-expand active project
  useEffect(() => {
    if (activeProjectId) {
      setExpandedProjectIds(prev => {
        const next = new Set(prev);
        next.add(activeProjectId);
        return next;
      });
    }
  }, [activeProjectId]);

  // Monitor processing tables
  useEffect(() => {
    const updateProcessingTables = () => {
      const tableIds = getProcessingTableIds();
      setProcessingTableIds(tableIds);
    };

    updateProcessingTables();
    window.addEventListener('etl-tasks-updated', updateProcessingTables);
    window.addEventListener('storage', updateProcessingTables);
    const interval = setInterval(updateProcessingTables, 3000);

    return () => {
      window.removeEventListener('etl-tasks-updated', updateProcessingTables);
      window.removeEventListener('storage', updateProcessingTables);
      clearInterval(interval);
    };
  }, []);

  const [headerDropdownOpen, setHeaderDropdownOpen] = useState(false);

  // Close context menu on outside click
  useEffect(() => {
    if (!tableContextMenu && !projectContextMenu && !headerDropdownOpen) return;
    const handleClick = () => {
      setTableContextMenu(null);
      setProjectContextMenu(null);
      setHeaderDropdownOpen(false);
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [tableContextMenu, projectContextMenu, headerDropdownOpen]);

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

  const toggleProject = (projectId: string) => {
    setExpandedProjectIds(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const handleTableClick = (projectId: string, tableId: string) => {
    router.push(`/projects/${projectId}/${tableId}`);
  };

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
        {/* --- Projects Sidebar (Hidden for Finder View) --- */}
        <aside
          ref={sidebarRef}
          style={{
            display: 'none', // Finder 模式：隐藏侧边栏
            width: isCollapsed ? COLLAPSED_WIDTH : sidebarWidth,
            borderRight: '1px solid #2a2a2a',
            // display: 'flex',
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
                  Projects
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {/* Split Button Container - group for shared hover state */}
                  <div className='flex items-center rounded-[5px] transition-colors duration-150 hover:bg-[rgba(255,255,255,0.04)]'>
                    {/* Main + Button (New Context) */}
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        // 默认创建裸 Table（不属于任何 Project）
                        setTableDialogProjectId(null);
                        setEditingTableId(null);
                        setTableDialogMode('create');
                      }}
                      title='New Context'
                      style={{
                        width: 28,
                        height: 28,
                        background: 'transparent',
                        border: 'none',
                        borderTopLeftRadius: 5,
                        borderBottomLeftRadius: 5,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#6b7280',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => {
                        // 更明显的 hover
                        e.currentTarget.style.background =
                          'rgba(255,255,255,0.08)';
                        e.currentTarget.style.color = '#EDEDED';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'transparent';
                        // 恢复颜色时，如果父级 hover，保持稍微亮一点的颜色，或者回到默认
                        e.currentTarget.style.color = '#6b7280';
                      }}
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
                        <line x1='12' y1='5' x2='12' y2='19' />
                        <line x1='5' y1='12' x2='19' y2='12' />
                      </svg>
                    </button>

                    {/* Dropdown Arrow - Wrapper for relative positioning */}
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setHeaderDropdownOpen(!headerDropdownOpen);
                        }}
                        title='More creation options'
                        style={{
                          width: 14,
                          height: 28,
                          background: 'transparent',
                          border: 'none',
                          borderTopRightRadius: 5,
                          borderBottomRightRadius: 5,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#6b7280',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => {
                          // 更明显的 hover
                          e.currentTarget.style.background =
                            'rgba(255,255,255,0.08)';
                          e.currentTarget.style.color = '#EDEDED';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = '#6b7280';
                        }}
                      >
                        {/* 缩小下拉箭头尺寸 */}
                        <svg
                          width='8'
                          height='8'
                          viewBox='0 0 12 12'
                          fill='none'
                          stroke='currentColor'
                          strokeWidth='2'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                        >
                          <path d='M2 4L6 8L10 4' />
                        </svg>
                      </button>

                      {/* Dropdown Menu */}
                      {headerDropdownOpen && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0, // 改为左对齐
                            marginTop: 4,
                            background: '#1a1a1e',
                            border: '1px solid #333',
                            borderRadius: 6,
                            padding: 4,
                            zIndex: 50,
                            minWidth: 140,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                            display: 'flex',
                            flexDirection: 'column',
                          }}
                        >
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              setHeaderDropdownOpen(false);
                              // Create Project
                              setEditingProjectId(null);
                              setProjectDialogMode('create');
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '6px 12px',
                              background: 'transparent',
                              border: 'none',
                              borderRadius: 4,
                              cursor: 'pointer',
                              color: '#d4d4d4',
                              fontSize: 13,
                              textAlign: 'left',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background =
                                'rgba(255,255,255,0.05)';
                              e.currentTarget.style.color = '#fff';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = 'transparent';
                              e.currentTarget.style.color = '#d4d4d4';
                            }}
                          >
                            {/* Project Icon - 与 ProjectItem 样式一致，带蓝色背景 */}
                            <span
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 20,
                                height: 20,
                                borderRadius: 4,
                                background: 'rgba(59, 130, 246, 0.15)',
                                color: '#3b82f6',
                                flexShrink: 0,
                              }}
                            >
                              <svg
                                width='12'
                                height='12'
                                viewBox='0 0 14 14'
                                fill='none'
                              >
                                <path
                                  d='M7 0.5L1 3.5V10.5L7 13.5L13 10.5V3.5L7 0.5Z'
                                  stroke='currentColor'
                                  strokeWidth='1.2'
                                  strokeLinejoin='round'
                                />
                                <path
                                  d='M1 3.5L7 6.5L13 3.5'
                                  stroke='currentColor'
                                  strokeWidth='1.2'
                                  strokeLinejoin='round'
                                />
                                <path
                                  d='M7 6.5V13.5'
                                  stroke='currentColor'
                                  strokeWidth='1.2'
                                  strokeLinejoin='round'
                                />
                              </svg>
                            </span>
                            New Project
                          </button>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              setHeaderDropdownOpen(false);
                              // Create Context
                              setTableDialogProjectId(null);
                              setEditingTableId(null);
                              setTableDialogMode('create');
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '6px 12px',
                              background: 'transparent',
                              border: 'none',
                              borderRadius: 4,
                              cursor: 'pointer',
                              color: '#d4d4d4',
                              fontSize: 13,
                              textAlign: 'left',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background =
                                'rgba(255,255,255,0.05)';
                              e.currentTarget.style.color = '#fff';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = 'transparent';
                              e.currentTarget.style.color = '#d4d4d4';
                            }}
                          >
                            {/* Table Icon - 宽度与 Project 图标容器一致以对齐 */}
                            <span
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 20,
                                height: 20,
                                flexShrink: 0,
                              }}
                            >
                              <svg
                                width='14'
                                height='14'
                                viewBox='0 0 14 14'
                                fill='none'
                              >
                                <rect
                                  x='1.5'
                                  y='1.5'
                                  width='11'
                                  height='11'
                                  rx='1.5'
                                  stroke='currentColor'
                                  strokeWidth='1.2'
                                />
                                <line
                                  x1='1.5'
                                  y1='5'
                                  x2='12.5'
                                  y2='5'
                                  stroke='currentColor'
                                  strokeWidth='1.2'
                                />
                                <line
                                  x1='5.5'
                                  y1='5'
                                  x2='5.5'
                                  y2='12.5'
                                  stroke='currentColor'
                                  strokeWidth='1.2'
                                />
                              </svg>
                            </span>
                            New Context
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

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
                      e.currentTarget.style.background =
                        'rgba(255,255,255,0.08)';
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
                </div>
              </>
            )}
          </div>

          {/* Content */}
          {!isCollapsed ? (
            <div style={{ flex: 1, overflowY: 'auto', paddingTop: 12 }}>
              {/* Projects Section */}
              <div style={{ marginBottom: 4 }}>
                <div
                  style={{
                    padding: '2px 8px 4px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  {isLoading ? (
                    // Loading skeleton
                    <div style={{ padding: '8px 6px' }}>
                      {[1, 2, 3].map(i => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            height: 28,
                            marginBottom: 4,
                          }}
                        >
                          <div
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: 4,
                              background: 'rgba(255,255,255,0.06)',
                            }}
                          />
                          <div
                            style={{
                              height: 10,
                              width: `${50 + i * 15}%`,
                              borderRadius: 4,
                              background: 'rgba(255,255,255,0.06)',
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : projects.length === 0 && orphanTables.length === 0 ? (
                    <div
                      style={{
                        padding: '12px 6px',
                        color: '#6D7177',
                        fontSize: 12,
                        textAlign: 'center',
                      }}
                    >
                      No contexts yet
                    </div>
                  ) : (
                    <>
                      {/* Projects */}
                      {projects.map(project => (
                        <ProjectItem
                          key={project.id}
                          project={project}
                          isExpanded={expandedProjectIds.has(project.id)}
                          activeTableId={activeTableId}
                          processingTableIds={processingTableIds}
                          onToggle={() => toggleProject(project.id)}
                          onTableClick={handleTableClick}
                          onCreateTable={() => {
                            setTableDialogProjectId(project.id);
                            setEditingTableId(null);
                            setTableDialogMode('create');
                          }}
                          onProjectContextMenu={e => {
                            e.preventDefault();
                            e.stopPropagation();

                            // Toggle: 如果当前菜单已为此 project 打开，则关闭
                            if (projectContextMenu?.projectId === project.id) {
                              setProjectContextMenu(null);
                              return;
                            }

                            let x = e.clientX;
                            let y = e.clientY;

                            // 如果是点击事件（来自"..."按钮），则相对于按钮定位
                            if (e.type === 'click') {
                              const rect = (
                                e.currentTarget as Element
                              ).getBoundingClientRect();
                              // 菜单在按钮下方，左对齐
                              x = rect.left;
                              y = rect.bottom + 6; // 加一点间距
                            }

                            setProjectContextMenu({
                              x,
                              y,
                              projectId: project.id,
                            });
                          }}
                          onTableContextMenu={(e, tableId) => {
                            if (e.preventDefault) e.preventDefault();
                            if (e.stopPropagation) e.stopPropagation();

                            // Toggle: 如果当前菜单已为此 table 打开，则关闭
                            if (tableContextMenu?.tableId === String(tableId)) {
                              setTableContextMenu(null);
                              return;
                            }

                            setTableContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              projectId: project.id,
                              tableId: String(tableId),
                            });
                          }}
                        />
                      ))}

                      {/* Orphan Tables (不属于任何 Project) */}
                      {orphanTables.length > 0 && (
                        <>
                          {/* Divider */}
                          <div
                            style={{
                              height: 1,
                              background: '#2a2a2a', // 调亮颜色，与 header border 一致
                              margin: '12px 0 8px 0', // 移除左右 margin，实现贯穿
                            }}
                          />

                          {orphanTables.map(table => (
                            <div
                              key={`orphan-${table.id}`}
                              className='group' // 添加 group 类以支持 hover 控制
                              onClick={() => handleTableClick('-', table.id)}
                              onContextMenu={e => {
                                e.preventDefault();
                                e.stopPropagation();

                                let x = e.clientX;
                                let y = e.clientY;

                                // 如果是点击事件（来自"..."按钮），则相对于按钮定位
                                if (e.type === 'click') {
                                  const rect = (
                                    e.currentTarget as Element
                                  ).getBoundingClientRect();
                                  x = rect.left;
                                  y = rect.bottom + 6;
                                }

                                setTableContextMenu({
                                  x,
                                  y,
                                  projectId: '-',
                                  tableId: table.id,
                                });
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                height: 28, // 统一高度
                                padding: '0 4px 0 6px', // 统一 padding
                                borderRadius: 6,
                                cursor: 'pointer',
                                background:
                                  activeTableId === table.id
                                    ? '#2C2C2C' // 统一选中背景色
                                    : 'transparent',
                                transition: 'background 0.15s',
                              }}
                              onMouseEnter={e => {
                                if (activeTableId !== table.id) {
                                  e.currentTarget.style.background = '#2C2C2C'; // 统一 hover 背景色
                                }
                              }}
                              onMouseLeave={e => {
                                if (activeTableId !== table.id) {
                                  e.currentTarget.style.background =
                                    'transparent';
                                }
                              }}
                            >
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
                                  viewBox='0 0 14 14'
                                  fill='none'
                                >
                                  <rect
                                    x='1.5'
                                    y='1.5'
                                    width='11'
                                    height='11'
                                    rx='1.5'
                                    stroke={
                                      activeTableId === table.id
                                        ? '#CDCDCD'
                                        : '#5D6065'
                                    }
                                    strokeWidth='1.2'
                                  />
                                  <line
                                    x1='1.5'
                                    y1='5'
                                    x2='12.5'
                                    y2='5'
                                    stroke={
                                      activeTableId === table.id
                                        ? '#CDCDCD'
                                        : '#5D6065'
                                    }
                                    strokeWidth='1.2'
                                  />
                                  <line
                                    x1='5.5'
                                    y1='5'
                                    x2='5.5'
                                    y2='12.5'
                                    stroke={
                                      activeTableId === table.id
                                        ? '#CDCDCD'
                                        : '#5D6065'
                                    }
                                    strokeWidth='1.2'
                                  />
                                </svg>
                              </span>
                              <span
                                style={{
                                  flex: 1,
                                  fontSize: 13,
                                  fontWeight:
                                    activeTableId === table.id ? 500 : 400,
                                  color:
                                    activeTableId === table.id
                                      ? '#FFFFFF'
                                      : '#9B9B9B',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  transition: 'color 0.15s',
                                }}
                              >
                                {table.name}
                              </span>

                              {/* More Options (...) */}
                              <button
                                type='button'
                                title='More options'
                                onClick={e => {
                                  e.preventDefault();
                                  e.stopPropagation();

                                  // Toggle: 如果当前菜单已为此 table 打开，则关闭
                                  if (tableContextMenu?.tableId === table.id) {
                                    setTableContextMenu(null);
                                    return;
                                  }

                                  const rect = (
                                    e.currentTarget as Element
                                  ).getBoundingClientRect();
                                  setTableContextMenu({
                                    x: rect.left,
                                    y: rect.bottom + 6,
                                    projectId: '-',
                                    tableId: table.id,
                                  });
                                }}
                                style={{
                                  width: 26,
                                  height: 26,
                                  background: 'transparent',
                                  border: 'none',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  display:
                                    activeTableId === table.id
                                      ? 'flex'
                                      : 'none', // 选中时也显示
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#5D6065',
                                  transition: 'all 0.15s',
                                  flexShrink: 0,
                                }}
                                className='group-hover:flex' // 通过 CSS 类控制 hover 显示
                                onMouseEnter={e => {
                                  e.currentTarget.style.background =
                                    'rgba(255,255,255,0.08)';
                                  e.currentTarget.style.color = '#EDEDED';
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.background =
                                    'transparent';
                                  e.currentTarget.style.color = '#5D6065';
                                }}
                              >
                                <svg
                                  width='14'
                                  height='14'
                                  viewBox='0 0 24 24'
                                  fill='none'
                                  stroke='currentColor'
                                  strokeWidth='2'
                                  strokeLinecap='round'
                                  strokeLinejoin='round'
                                >
                                  <circle cx='12' cy='12' r='1' />
                                  <circle cx='19' cy='12' r='1' />
                                  <circle cx='5' cy='12' r='1' />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </>
                      )}
                    </>
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
              {projects.map(project => (
                <CollapsedProjectItem
                  key={project.id}
                  project={project}
                  activeTableId={activeTableId}
                  onTableClick={handleTableClick}
                />
              ))}
              {/* Collapsed orphan tables - 放在最后 */}
              {orphanTables.length > 0 && (
                <>
                  <div
                    style={{
                      width: '100%', // 确保宽度占满
                      height: 1,
                      background: '#2a2a2a', // 调亮颜色
                      margin: '8px 0',
                    }}
                  />
                  {orphanTables.map(table => (
                    <div
                      key={`orphan-${table.id}`}
                      onClick={() => handleTableClick('-', table.id)}
                      title={table.name}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        background:
                          activeTableId === table.id
                            ? 'rgba(255,255,255,0.15)'
                            : 'transparent',
                        color: activeTableId === table.id ? '#fff' : '#6b7280',
                        transition: 'all 0.15s',
                      }}
                    >
                      <svg
                        width='16'
                        height='16'
                        viewBox='0 0 16 16'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='1.3'
                      >
                        <rect x='2' y='2' width='12' height='12' rx='2' />
                        <line x1='2' y1='6' x2='14' y2='6' />
                        <line x1='6' y1='6' x2='6' y2='14' />
                      </svg>
                    </div>
                  ))}
                </>
              )}
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

      {projectDialogMode && (
        <ProjectManageDialog
          mode={projectDialogMode}
          projectId={editingProjectId}
          projects={projects}
          onClose={() => {
            setProjectDialogMode(null);
            setEditingProjectId(null);
          }}
          onModeChange={setProjectDialogMode}
        />
      )}

      {tableDialogMode && (
        <TableManageDialog
          mode={tableDialogMode}
          projectId={tableDialogProjectId}
          tableId={editingTableId}
          projects={projects}
          onClose={() => {
            setTableDialogMode(null);
            setTableDialogProjectId(null);
            setEditingTableId(null);
          }}
          onModeChange={setTableDialogMode}
        />
      )}

      {tableRenameDialogOpen && tableModalProjectId && tableModalTableId && (
        <TableRenameDialog
          projectId={tableModalProjectId}
          tableId={tableModalTableId}
          projects={projects}
          onClose={() => {
            setTableRenameDialogOpen(false);
            setTableModalProjectId(null);
            setTableModalTableId(null);
          }}
        />
      )}

      {tableDeleteDialogOpen && tableModalProjectId && tableModalTableId && (
        <TableDeleteDialog
          projectId={tableModalProjectId}
          tableId={tableModalTableId}
          projects={projects}
          onClose={() => {
            setTableDeleteDialogOpen(false);
            setTableModalProjectId(null);
            setTableModalTableId(null);
          }}
        />
      )}

      {tableContextMenu && (
        <div
          style={{
            position: 'fixed',
            left: tableContextMenu.x,
            top: tableContextMenu.y,
            minWidth: 140,
            background: '#1a1a1e',
            border: '1px solid #333',
            borderRadius: 8,
            padding: 4,
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={e => {
              e.stopPropagation();
              setTableModalProjectId(tableContextMenu.projectId);
              setTableModalTableId(tableContextMenu.tableId);
              setTableRenameDialogOpen(true);
              setTableContextMenu(null);
            }}
            style={{
              width: '100%',
              height: 28,
              padding: '0 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: 4,
              fontSize: 12,
              color: '#d4d4d4',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#d4d4d4';
            }}
          >
            <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
              <path
                d='M10.889 0L14 3.111L7 10.111L3.889 7L10.889 0Z'
                fill='currentColor'
              />
              <path
                d='M3.111 7.778L6.222 10.889L1.556 12.444L3.111 7.778Z'
                fill='currentColor'
              />
            </svg>
            Rename
          </button>

          <div
            style={{
              height: 1,
              background: '#333',
              margin: '4px 0',
            }}
          />

          <button
            onClick={e => {
              e.stopPropagation();
              setTableModalProjectId(tableContextMenu.projectId);
              setTableModalTableId(tableContextMenu.tableId);
              setTableDeleteDialogOpen(true);
              setTableContextMenu(null);
            }}
            style={{
              width: '100%',
              height: 28,
              padding: '0 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: 4,
              fontSize: 12,
              color: '#f87171',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(248, 113, 113, 0.1)';
              e.currentTarget.style.color = '#f87171';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#f87171';
            }}
          >
            <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
              <path
                d='M12 2L2 12'
                stroke='currentColor'
                strokeWidth='1.5'
                strokeLinecap='round'
              />
              <path
                d='M12 12L2 2'
                stroke='currentColor'
                strokeWidth='1.5'
                strokeLinecap='round'
              />
            </svg>
            Delete
          </button>
        </div>
      )}

      {projectContextMenu && (
        <div
          style={{
            position: 'fixed',
            left: projectContextMenu.x,
            top: projectContextMenu.y,
            minWidth: 140,
            background: '#1a1a1e',
            border: '1px solid #333',
            borderRadius: 8,
            padding: 4,
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={e => {
              e.stopPropagation();
              setEditingProjectId(projectContextMenu.projectId);
              setProjectDialogMode('edit');
              setProjectContextMenu(null);
            }}
            style={{
              width: '100%',
              height: 28,
              padding: '0 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: 4,
              fontSize: 12,
              color: '#d4d4d4',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#d4d4d4';
            }}
          >
            <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
              <path
                d='M10.889 0L14 3.111L7 10.111L3.889 7L10.889 0Z'
                fill='currentColor'
              />
              <path
                d='M3.111 7.778L6.222 10.889L1.556 12.444L3.111 7.778Z'
                fill='currentColor'
              />
            </svg>
            Rename
          </button>

          <div
            style={{
              height: 1,
              background: '#333',
              margin: '4px 0',
            }}
          />

          <button
            onClick={e => {
              e.stopPropagation();
              setEditingProjectId(projectContextMenu.projectId);
              setProjectDialogMode('delete');
              setProjectContextMenu(null);
            }}
            style={{
              width: '100%',
              height: 28,
              padding: '0 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: 4,
              fontSize: 12,
              color: '#f87171',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(248, 113, 113, 0.1)';
              e.currentTarget.style.color = '#f87171';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#f87171';
            }}
          >
            <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
              <path
                d='M12 2L2 12'
                stroke='currentColor'
                strokeWidth='1.5'
                strokeLinecap='round'
              />
              <path
                d='M12 12L2 2'
                stroke='currentColor'
                strokeWidth='1.5'
                strokeLinecap='round'
              />
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// --- Sub Components ---

function ProjectItem({
  project,
  isExpanded,
  activeTableId,
  processingTableIds,
  onToggle,
  onTableClick,
  onCreateTable,
  onProjectContextMenu,
  onTableContextMenu,
}: {
  project: any;
  isExpanded: boolean;
  activeTableId: string;
  processingTableIds: Set<string>;
  onToggle: () => void;
  onTableClick: (projectId: string, tableId: string) => void;
  onCreateTable: () => void;
  onProjectContextMenu: (e: React.MouseEvent) => void;
  onTableContextMenu: (e: React.MouseEvent, tableId: string) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div>
      {/* Project Row */}
      <div
        onClick={onToggle}
        onContextMenu={onProjectContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          height: 28,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 4px 0 6px',
          borderRadius: 6,
          cursor: 'pointer',
          background: hovered ? '#2C2C2C' : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        {/* Toggle Icon Container */}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            borderRadius: 4,
            background: 'rgba(59, 130, 246, 0.15)',
            color: '#3b82f6',
            flexShrink: 0,
            transition: 'all 0.15s',
          }}
        >
          {hovered ? (
            // Chevron Icon (hover 时显示)
            <svg
              width='10'
              height='10'
              viewBox='0 0 12 12'
              fill='none'
              style={{
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s',
              }}
            >
              <path
                d='M4.5 2.5L8 6L4.5 9.5'
                stroke='currentColor'
                strokeWidth='1.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
          ) : (
            // Box Icon (默认显示)
            <svg width='12' height='12' viewBox='0 0 14 14' fill='none'>
              {/* Box Icon - Cube Style */}
              <path
                d='M7 0.5L1 3.5V10.5L7 13.5L13 10.5V3.5L7 0.5Z'
                stroke='currentColor'
                strokeWidth='1.2'
                strokeLinejoin='round'
              />
              <path
                d='M1 3.5L7 6.5L13 3.5'
                stroke='currentColor'
                strokeWidth='1.2'
                strokeLinejoin='round'
              />
              <path
                d='M7 6.5V13.5'
                stroke='currentColor'
                strokeWidth='1.2'
                strokeLinejoin='round'
              />
            </svg>
          )}
        </span>

        {/* Name */}
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 500,
            color: hovered ? '#F0EFED' : '#9B9B9B',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            transition: 'color 0.15s',
          }}
        >
          {project.name}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* More Options (...) */}
          <button
            type='button'
            title='More options'
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              onProjectContextMenu(e);
            }}
            style={{
              width: 26, // 调整为与 + 按钮一致
              height: 26, // 调整为与 + 按钮一致
              background: 'transparent',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              display: hovered ? 'flex' : 'none',
              alignItems: 'center',
              justifyContent: 'center',
              color: hovered ? '#9B9B9B' : '#5D6065',
              transition: 'all 0.15s',
              flexShrink: 0,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.color = '#EDEDED';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = hovered ? '#9B9B9B' : '#5D6065';
            }}
          >
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <circle cx='12' cy='12' r='1' />
              <circle cx='19' cy='12' r='1' />
              <circle cx='5' cy='12' r='1' />
            </svg>
          </button>

          {/* + (new context) */}
          <button
            type='button'
            title='New context'
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              onCreateTable();
            }}
            style={{
              width: 26,
              height: 26,
              background: 'transparent',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              display: hovered ? 'flex' : 'none',
              alignItems: 'center',
              justifyContent: 'center',
              color: hovered ? '#9B9B9B' : '#5D6065',
              transition: 'all 0.15s',
              flexShrink: 0,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.color = '#EDEDED';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = hovered ? '#9B9B9B' : '#5D6065';
            }}
          >
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <line x1='12' y1='5' x2='12' y2='19' />
              <line x1='5' y1='12' x2='19' y2='12' />
            </svg>
          </button>
        </div>
      </div>

      {/* Tables */}
      {isExpanded && project.tables && (
        <div style={{ paddingLeft: 12, marginTop: 2 }}>
          {project.tables.map((table: any) => {
            const isProcessing = processingTableIds.has(table.id);
            return (
              <TableItem
                key={table.id}
                table={table}
                projectId={project.id}
                isActive={String(table.id) === String(activeTableId)}
                isProcessing={isProcessing}
                onClick={() => onTableClick(project.id, table.id)}
                onContextMenu={e => {
                  e.preventDefault();
                  e.stopPropagation();

                  let x = e.clientX;
                  let y = e.clientY;

                  // 如果是点击事件（来自"..."按钮），则相对于按钮定位
                  if (e.type === 'click') {
                    const rect = (
                      e.currentTarget as Element
                    ).getBoundingClientRect();
                    x = rect.left;
                    y = rect.bottom + 6;
                  }

                  onTableContextMenu(
                    { ...e, clientX: x, clientY: y } as any,
                    String(table.id)
                  );
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function TableItem({
  table,
  projectId,
  isActive,
  isProcessing,
  onClick,
  onContextMenu,
}: {
  table: any;
  projectId: string;
  isActive: boolean;
  isProcessing: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 4px 0 6px',
        borderRadius: 6,
        cursor: 'pointer',
        background: isActive || hovered ? '#2C2C2C' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      {/* Table Icon or Processing Spinner */}
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
        {isProcessing ? (
          <svg
            width='14'
            height='14'
            viewBox='0 0 14 14'
            fill='none'
            style={{ animation: 'spin 1s linear infinite' }}
          >
            <circle
              cx='7'
              cy='7'
              r='5'
              stroke='#60a5fa'
              strokeWidth='2'
              strokeLinecap='round'
              strokeDasharray='24 8'
            />
          </svg>
        ) : (
          <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
            <rect
              x='1.5'
              y='1.5'
              width='11'
              height='11'
              rx='1.5'
              stroke={isActive ? '#CDCDCD' : hovered ? '#9B9B9B' : '#5D6065'}
              strokeWidth='1.2'
            />
            <line
              x1='1.5'
              y1='5'
              x2='12.5'
              y2='5'
              stroke={isActive ? '#CDCDCD' : hovered ? '#9B9B9B' : '#5D6065'}
              strokeWidth='1.2'
            />
            <line
              x1='5.5'
              y1='5'
              x2='5.5'
              y2='12.5'
              stroke={isActive ? '#CDCDCD' : hovered ? '#9B9B9B' : '#5D6065'}
              strokeWidth='1.2'
            />
          </svg>
        )}
      </span>

      {/* Name */}
      <span
        style={{
          flex: 1,
          fontSize: 13,
          fontWeight: 500,
          color: isProcessing
            ? '#60a5fa'
            : isActive
              ? '#FFFFFF'
              : hovered
                ? '#CDCDCD'
                : '#9B9B9B',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          transition: 'color 0.15s',
        }}
      >
        {table.name}
      </span>

      {/* More Options (...) */}
      <button
        type='button'
        title='More options'
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e);
        }}
        style={{
          width: 26,
          height: 26,
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          display: hovered ? 'flex' : 'none',
          alignItems: 'center',
          justifyContent: 'center',
          color: hovered ? '#9B9B9B' : '#5D6065',
          transition: 'all 0.15s',
          flexShrink: 0,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
          e.currentTarget.style.color = '#EDEDED';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = hovered ? '#9B9B9B' : '#5D6065';
        }}
      >
        <svg
          width='14'
          height='14'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        >
          <circle cx='12' cy='12' r='1' />
          <circle cx='19' cy='12' r='1' />
          <circle cx='5' cy='12' r='1' />
        </svg>
      </button>

      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

function CollapsedProjectItem({
  project,
  activeTableId,
  onTableClick,
}: {
  project: any;
  activeTableId: string;
  onTableClick: (projectId: string, tableId: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const hasActiveTable = project.tables?.some(
    (t: any) => String(t.id) === String(activeTableId)
  );

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Project Icon -> Box Icon */}
      <div
        style={{
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: hasActiveTable
            ? 'rgba(59, 130, 246, 0.15)'
            : hovered
              ? 'rgba(255,255,255,0.08)'
              : 'transparent',
          borderRadius: 5,
          cursor: 'pointer',
          color: hasActiveTable ? '#60a5fa' : hovered ? '#e2e8f0' : '#808080',
          transition: 'all 0.15s',
        }}
      >
        <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
          {/* Box Icon - Cube Style */}
          <path
            d='M7 0.5L1 3.5V10.5L7 13.5L13 10.5V3.5L7 0.5Z'
            stroke='currentColor'
            strokeWidth='1.2'
            strokeLinejoin='round'
          />
          <path
            d='M1 3.5L7 6.5L13 3.5'
            stroke='currentColor'
            strokeWidth='1.2'
            strokeLinejoin='round'
          />
          <path
            d='M7 6.5V13.5'
            stroke='currentColor'
            strokeWidth='1.2'
            strokeLinejoin='round'
          />
        </svg>
      </div>

      {/* Hover Popover */}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            left: '100%',
            top: 0,
            marginLeft: 8,
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 8,
            padding: '8px 0',
            minWidth: 180,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
            zIndex: 100,
          }}
        >
          {/* Project Name */}
          <div
            style={{
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: '#9ca3af',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            <svg width='12' height='12' viewBox='0 0 14 14' fill='none'>
              {/* Box Icon - Cube Style */}
              <path
                d='M7 0.5L1 3.5V10.5L7 13.5L13 10.5V3.5L7 0.5Z'
                stroke='currentColor'
                strokeWidth='1.2'
                strokeLinejoin='round'
              />
              <path
                d='M1 3.5L7 6.5L13 3.5'
                stroke='currentColor'
                strokeWidth='1.2'
                strokeLinejoin='round'
              />
              <path
                d='M7 6.5V13.5'
                stroke='currentColor'
                strokeWidth='1.2'
                strokeLinejoin='round'
              />
            </svg>
            <span>{project.name}</span>
          </div>

          {/* Tables */}
          {project.tables?.map((table: any) => (
            <PopoverTableItem
              key={table.id}
              table={table}
              projectId={project.id}
              isActive={String(table.id) === String(activeTableId)}
              onClick={() => onTableClick(project.id, table.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PopoverTableItem({
  table,
  projectId,
  isActive,
  onClick,
}: {
  table: any;
  projectId: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px 6px 28px',
        color: isActive ? '#60a5fa' : hovered ? '#e2e8f0' : '#808080',
        fontSize: 12,
        background: isActive
          ? 'rgba(59, 130, 246, 0.15)'
          : hovered
            ? 'rgba(255, 255, 255, 0.05)'
            : 'transparent',
        border: 'none',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'all 0.1s',
      }}
    >
      <svg width='12' height='12' viewBox='0 0 14 14' fill='none'>
        <rect
          x='1.5'
          y='1.5'
          width='11'
          height='11'
          rx='1.5'
          stroke='currentColor'
          strokeWidth='1.2'
        />
        <line
          x1='1.5'
          y1='5'
          x2='12.5'
          y2='5'
          stroke='currentColor'
          strokeWidth='1.2'
        />
        <line
          x1='5.5'
          y1='5'
          x2='5.5'
          y2='12.5'
          stroke='currentColor'
          strokeWidth='1.2'
        />
      </svg>
      <span>{table.name}</span>
    </button>
  );
}
