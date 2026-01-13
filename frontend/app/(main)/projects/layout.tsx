'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useProjects } from '@/lib/hooks/useData';
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

  // Dialog state
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectDialogDeleteMode, setProjectDialogDeleteMode] = useState(false);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [tableDialogProjectId, setTableDialogProjectId] = useState<string | null>(
    null
  );
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [tableRenameDialogOpen, setTableRenameDialogOpen] = useState(false);
  const [tableDeleteDialogOpen, setTableDeleteDialogOpen] = useState(false);
  const [tableModalProjectId, setTableModalProjectId] = useState<string | null>(
    null
  );
  const [tableModalTableId, setTableModalTableId] = useState<string | null>(null);
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

  // Close context menu on outside click
  useEffect(() => {
    if (!tableContextMenu && !projectContextMenu) return;
    const handleClick = () => {
      setTableContextMenu(null);
      setProjectContextMenu(null);
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [tableContextMenu, projectContextMenu]);

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
        {/* --- Projects Sidebar --- */}
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
                  Projects
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      setEditingProjectId(null);
                      setProjectDialogDeleteMode(false);
                      setProjectDialogOpen(true);
                    }}
                    title='New Project'
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
                      width='18'
                      height='18'
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
                  ) : projects.length === 0 ? (
                    <div
                      style={{
                        padding: '12px 6px',
                        color: '#6D7177',
                        fontSize: 12,
                        textAlign: 'center',
                      }}
                    >
                      No projects yet
                    </div>
                  ) : (
                    projects.map(project => (
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
                          setTableDialogOpen(true);
                        }}
                        onProjectContextMenu={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          setProjectContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            projectId: project.id,
                          });
                        }}
                        onTableContextMenu={(e, tableId) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setTableContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            projectId: project.id,
                            tableId: String(tableId),
                          });
                        }}
                      />
                    ))
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

      {projectDialogOpen && (
        <ProjectManageDialog
          projectId={editingProjectId}
          projects={projects}
          deleteMode={projectDialogDeleteMode}
          onClose={() => {
            setProjectDialogOpen(false);
            setEditingProjectId(null);
            setProjectDialogDeleteMode(false);
          }}
        />
      )}

      {tableDialogOpen && tableDialogProjectId && (
        <TableManageDialog
          projectId={tableDialogProjectId}
          tableId={editingTableId}
          projects={projects}
          onClose={() => {
            setTableDialogOpen(false);
            setTableDialogProjectId(null);
            setEditingTableId(null);
          }}
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
              setProjectDialogDeleteMode(false);
              setProjectDialogOpen(true);
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
              setProjectDialogDeleteMode(true);
              setProjectDialogOpen(true);
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
        {/* Folder Icon */}
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
          <svg width='12' height='12' viewBox='0 0 14 14' fill='none'>
            <path
              d='M1 4C1 3.44772 1.44772 3 2 3H5.17157C5.43679 3 5.69114 3.10536 5.87868 3.29289L6.70711 4.12132C6.89464 4.30886 7.149 4.41421 7.41421 4.41421H12C12.5523 4.41421 13 4.86193 13 5.41421V11C13 11.5523 12.5523 12 12 12H2C1.44772 12 1 11.5523 1 11V4Z'
              stroke='currentColor'
              strokeWidth='1.2'
            />
          </svg>
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

          {/* Chevron */}
          <svg
            width='10'
            height='10'
            viewBox='0 0 12 12'
            fill='none'
            style={{
              color: hovered ? '#9B9B9B' : '#5D6065',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s, color 0.15s',
              flexShrink: 0,
            }}
          >
            <path
              d='M4.5 2.5L8 6L4.5 9.5'
              stroke='currentColor'
              strokeWidth='1.2'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
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
                onContextMenu={e => onTableContextMenu(e, String(table.id))}
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
      {/* Project Icon */}
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
          <path
            d='M1 4C1 3.44772 1.44772 3 2 3H5.17157C5.43679 3 5.69114 3.10536 5.87868 3.29289L6.70711 4.12132C6.89464 4.30886 7.149 4.41421 7.41421 4.41421H12C12.5523 4.41421 13 4.86193 13 5.41421V11C13 11.5523 12.5523 12 12 12H2C1.44772 12 1 11.5523 1 11V4Z'
            stroke='currentColor'
            strokeWidth='1.2'
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
              <path
                d='M1 4C1 3.44772 1.44772 3 2 3H5.17157C5.43679 3 5.69114 3.10536 5.87868 3.29289L6.70711 4.12132C6.89464 4.30886 7.149 4.41421 7.41421 4.41421H12C12.5523 4.41421 13 4.86193 13 5.41421V11C13 11.5523 12.5523 12 12 12H2C1.44772 12 1 11.5523 1 11V4Z'
                stroke='currentColor'
                strokeWidth='1.2'
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
