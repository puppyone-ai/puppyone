'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ProjectInfo } from '../lib/projectsApi';
import { ProjectManageDialog } from './ProjectManageDialog';
import { TableManageDialog } from './TableManageDialog';
import { useAuth } from '../app/supabase/SupabaseAuthProvider';
import { getProcessingTableIds } from './BackgroundTaskNotifier';
import UserMenuPanel from './UserMenuPanel';

type UtilityNavItem = {
  id: string;
  label: string;
  path: string;
  isAvailable: boolean;
};

type ProjectsSidebarProps = {
  projects: ProjectInfo[];
  activeBaseId: string;
  expandedBaseIds: Set<string>;
  activeTableId: string;
  activeView?: string;
  onBaseClick: (projectId: string) => void;
  onTableClick: (projectId: string, tableId: string) => void;
  utilityNav: UtilityNavItem[];
  onUtilityNavClick: (path: string) => void;
  userInitial: string;
  userAvatarUrl?: string;
  environmentLabel?: string;
  onProjectsChange?: (projects: ProjectInfo[]) => void;
  loading?: boolean;
  isCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
  // Tools 数量，用于显示徽章
  toolsCount?: number;
};

type SectionId = 'contexts' | 'connect';

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 240;

export function ProjectsSidebar({
  projects,
  activeBaseId,
  expandedBaseIds,
  activeTableId,
  activeView = 'projects',
  onBaseClick,
  onTableClick,
  utilityNav,
  onUtilityNavClick,
  userInitial,
  userAvatarUrl,
  environmentLabel = 'Local Dev',
  onProjectsChange,
  loading = false,
  isCollapsed = false,
  onCollapsedChange,
  sidebarWidth = DEFAULT_SIDEBAR_WIDTH,
  onSidebarWidthChange,
  toolsCount = 0,
}: ProjectsSidebarProps) {
  // 内部 collapsed 状态（非受控模式时使用）
  const [internalCollapsed, setInternalCollapsed] = useState(false);

  // 如果外部传了 onCollapsedChange，使用受控模式；否则使用内部状态
  const isControlled = onCollapsedChange !== undefined;
  const effectiveCollapsed = isControlled ? isCollapsed : internalCollapsed;
  const handleCollapsedChange = (collapsed: boolean) => {
    if (isControlled) {
      onCollapsedChange?.(collapsed);
    } else {
      setInternalCollapsed(collapsed);
    }
  };

  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<'project' | 'table' | null>(
    null
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: 'project' | 'table';
    id: string;
    projectId?: string;
  } | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<SectionId>>(
    new Set(['contexts', 'connect'])
  );
  const [isResizing, setIsResizing] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  // 追踪正在处理中的 Table
  const [processingTableIds, setProcessingTableIds] = useState<Set<string>>(
    new Set()
  );

  // 监听任务状态变化，更新处理中的 Table 列表
  useEffect(() => {
    const updateProcessingTables = () => {
      // 使用 getProcessingTableIds 获取正在处理中（非终态）的 Table ID
      const tableIds = getProcessingTableIds();
      setProcessingTableIds(tableIds);
    };

    updateProcessingTables();

    window.addEventListener('etl-tasks-updated', updateProcessingTables);
    window.addEventListener('storage', updateProcessingTables);

    // 定期刷新
    const interval = setInterval(updateProcessingTables, 3000);

    return () => {
      window.removeEventListener('etl-tasks-updated', updateProcessingTables);
      window.removeEventListener('storage', updateProcessingTables);
      clearInterval(interval);
    };
  }, []);

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarRef.current) return;
      const newWidth = e.clientX;
      const clampedWidth = Math.min(
        Math.max(newWidth, MIN_SIDEBAR_WIDTH),
        MAX_SIDEBAR_WIDTH
      );
      onSidebarWidthChange?.(clampedWidth);
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
  }, [isResizing, onSidebarWidthChange]);
  const [showCollapsedContextMenu, setShowCollapsedContextMenu] =
    useState(false);

  const toggleSection = (sectionId: SectionId) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => {
      setContextMenu(null);
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu]);

  const handleProjectContextMenu = (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type: 'project',
      id: projectId,
    });
  };

  const handleTableContextMenu = (
    e: React.MouseEvent,
    projectId: string,
    tableId: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type: 'table',
      id: tableId,
      projectId,
    });
  };

  const handleCreateProject = () => {
    setEditingProjectId(null);
    setProjectDialogOpen(true);
    setContextMenu(null);
  };

  const handleEditProject = (projectId: string) => {
    setEditingProjectId(projectId);
    setProjectDialogOpen(true);
    setContextMenu(null);
  };

  const handleCreateTable = (projectId: string) => {
    setEditingTableId(null);
    setEditingProjectId(projectId);
    setTableDialogOpen(true);
    setContextMenu(null);
  };

  const handleEditTable = (projectId: string, tableId: string) => {
    setEditingTableId(tableId);
    setEditingProjectId(projectId);
    setTableDialogOpen(true);
    setContextMenu(null);
  };

  return (
    <aside
      ref={sidebarRef}
      className={`sidebar ${effectiveCollapsed ? 'collapsed' : ''}`}
      style={{ width: effectiveCollapsed ? 45 : sidebarWidth }}
    >
      <style jsx>{`
        .sidebar {
          height: 100vh;
          display: flex;
          flex-direction: column;
          background: #202020;
          font-family:
            'Plus Jakarta Sans',
            -apple-system,
            BlinkMacSystemFont,
            sans-serif;
          border-right: 1px solid #404040;
          transition: ${isResizing ? 'none' : 'width 0.2s ease'};
          position: relative;
          flex-shrink: 0;
        }

        .sidebar.collapsed {
          width: 45px !important;
        }

        .resize-handle {
          position: absolute;
          top: 0;
          right: -2px;
          width: 4px;
          height: 100%;
          cursor: col-resize;
          z-index: 10;
        }

        .resize-handle:hover,
        .resize-handle.active {
          background: rgba(255, 255, 255, 0.1);
        }

        .sidebar.collapsed .resize-handle {
          display: none;
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 9px 0 16px;
          height: 45px;
          border-bottom: 1px solid #404040;
        }

        .sidebar.collapsed .header {
          padding: 0;
          justify-content: center;
        }

        .header-brand {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .header-title {
          font-size: 14px;
          font-weight: 600;
          color: #ededed;
          letter-spacing: 0.3px;
        }

        .collapse-toggle-wrapper {
          width: 28px;
          height: 28px;
          background: transparent;
          border: none;
          color: #6b7280;
          cursor: pointer;
          border-radius: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
        }

        .collapse-toggle-wrapper:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #9ca3af;
        }

        .collapsed-logo-wrapper {
          width: 28px;
          height: 28px;
          cursor: pointer;
          border-radius: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
          position: relative;
        }

        .collapsed-logo-wrapper:hover {
          background: rgba(255, 255, 255, 0.08);
        }

        .collapsed-logo-wrapper .product-logo {
          display: block;
        }

        .collapsed-logo-wrapper .sidebar-toggle-icon {
          display: none;
          color: #9ca3af;
        }

        .collapsed-logo-wrapper:hover .product-logo {
          display: none;
        }

        .collapsed-logo-wrapper:hover .sidebar-toggle-icon {
          display: block;
        }

        .content {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          overflow-x: hidden;
        }

        .content-main {
          flex: 1;
          padding-top: 12px;
        }

        .content-bottom {
          flex-shrink: 0;
          padding-bottom: 8px;
          border-top: 1px solid #333;
          margin-top: 8px;
          padding-top: 8px;
        }

        .sidebar.collapsed .content {
          display: none;
        }

        .collapsed-nav {
          display: none;
          flex: 1;
          flex-direction: column;
          padding: 12px 0;
        }

        .sidebar.collapsed .collapsed-nav {
          display: flex;
        }

        .collapsed-nav-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }

        .collapsed-nav-bottom {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding-top: 8px;
          border-top: 1px solid #333;
          margin-top: 8px;
        }

        .collapsed-nav-btn {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: 5px;
          color: #808080;
          cursor: pointer;
          transition: all 0.15s;
        }

        .collapsed-nav-btn:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #e2e8f0;
        }

        .collapsed-nav-btn.active {
          background: rgba(59, 130, 246, 0.15);
          color: #60a5fa;
        }

        .collapsed-nav-item {
          position: relative;
        }

        .collapsed-nav-popover {
          position: absolute;
          left: 100%;
          top: 0;
          margin-left: 8px;
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 8px;
          padding: 8px 0;
          min-width: 180px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          z-index: 100;
          opacity: 0;
          visibility: hidden;
          transform: translateX(-4px);
          transition: all 0.15s ease;
        }

        .collapsed-nav-item:hover .collapsed-nav-popover {
          opacity: 1;
          visibility: visible;
          transform: translateX(0);
        }

        .popover-section {
          padding: 4px 0;
        }

        .popover-section:not(:last-child) {
          border-bottom: 1px solid #333;
          margin-bottom: 4px;
        }

        .popover-project {
          padding: 6px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          color: #9ca3af;
          font-size: 12px;
          font-weight: 500;
        }

        .popover-table {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px 6px 28px;
          color: #808080;
          font-size: 12px;
          background: transparent;
          border: none;
          width: 100%;
          text-align: left;
          cursor: pointer;
          transition: all 0.1s;
        }

        .popover-table:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #e2e8f0;
        }

        .popover-table.active {
          background: rgba(59, 130, 246, 0.15);
          color: #60a5fa;
        }

        .popover-empty {
          padding: 12px;
          color: #6b7280;
          font-size: 11px;
          text-align: center;
        }

        .collapsed-context-menu-wrapper {
          position: relative;
        }

        .collapsed-context-popover {
          position: absolute;
          left: 100%;
          top: 0;
          margin-left: 8px;
          min-width: 180px;
          max-width: 240px;
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          padding: 6px;
          z-index: 1000;
        }

        .collapsed-context-popover-title {
          font-size: 11px;
          font-weight: 600;
          color: #6d7177;
          padding: 6px 8px 4px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .collapsed-context-folder {
          margin-bottom: 2px;
        }

        .collapsed-context-folder-name {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 8px;
          font-size: 12px;
          color: #9ca3af;
          border-radius: 4px;
        }

        .collapsed-context-folder-name svg {
          flex-shrink: 0;
        }

        .collapsed-context-table {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          padding: 6px 8px 6px 26px;
          background: transparent;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          color: #9ca3af;
          cursor: pointer;
          text-align: left;
          transition: all 0.1s;
        }

        .collapsed-context-table:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #e2e8f0;
        }

        .collapsed-context-table.active {
          background: rgba(59, 130, 246, 0.15);
          color: #60a5fa;
        }

        .collapsed-context-table svg {
          flex-shrink: 0;
        }

        .collapsed-context-empty {
          padding: 12px 8px;
          font-size: 12px;
          color: #6d7177;
          text-align: center;
        }

        .section {
          margin-bottom: 4px;
        }

        .section-header {
          position: relative;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0 12px;
          height: 28px;
          cursor: pointer;
          user-select: none;
        }

        .section-header:hover {
          background: rgba(255, 255, 255, 0.03);
        }

        .section-title {
          font-size: 12px;
          font-weight: 600;
          color: #6d7177;
        }

        .section-chevron {
          width: 10px;
          height: 10px;
          color: #5d6065;
          transition: transform 0.15s;
          flex-shrink: 0;
        }

        .section-chevron.expanded {
          transform: rotate(90deg);
        }

        .section-add-btn {
          margin-left: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          background: transparent;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          color: #5d6065;
          opacity: 0;
          transition: all 0.15s;
        }

        .section-header:hover .section-add-btn {
          opacity: 1;
          color: #9ca3af;
          background: rgba(255, 255, 255, 0.05);
        }

        .section-add-btn:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          color: #ededed !important;
        }

        .section-content {
          display: flex;
          flex-direction: column;
          gap: 1px;
          padding: 2px 8px 4px 8px;
        }

        .projects-list {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .project-item {
          display: flex;
          flex-direction: column;
          border-radius: 8px;
          transition: background 0.2s;
        }

        .project-row {
          display: flex;
          align-items: center;
          height: 28px;
          padding: 0 1px 0 0;
          border-radius: 6px;
          transition: background 0.2s;
        }

        .project-row:hover,
        .project-row.menu-open,
        .project-row.active {
          background: #2c2c2c;
        }

        .project-row.active .project-name {
          color: #ffffff;
        }

        .project-row.active .folder-icon-wrapper {
          background: rgba(59, 130, 246, 0.25);
          color: #60a5fa;
        }

        .project-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 0;
          height: 100%;
          background: transparent;
          border: none;
          cursor: pointer;
        }

        .folder-icon-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 4px;
          background: rgba(59, 130, 246, 0.15);
          color: #3b82f6;
          margin-right: 2px;
          flex-shrink: 0;
        }

        .folder-icon {
          width: 12px;
          height: 12px;
          flex-shrink: 0;
          color: currentColor;
        }

        .project-row:hover .folder-icon-wrapper,
        .project-row.menu-open .folder-icon-wrapper {
          background: rgba(59, 130, 246, 0.25);
          color: #60a5fa;
        }

        .project-name {
          font-size: 13px;
          font-weight: 500;
          color: #9b9b9b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          transition: color 0.2s;
        }

        .project-row:hover .project-name,
        .project-row.menu-open .project-name {
          color: #f0efed;
        }

        .project-chevron {
          width: 10px;
          height: 10px;
          color: #5d6065;
          transition:
            transform 0.15s,
            color 0.15s;
          flex-shrink: 0;
        }

        .project-chevron.expanded {
          transform: rotate(90deg);
        }

        .project-row:hover .project-chevron,
        .project-row.menu-open .project-chevron {
          color: #9b9b9b;
        }

        .project-action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          background: transparent;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          color: #5d6065;
          opacity: 0;
          transition: all 0.15s;
        }

        .project-row:hover .project-action-btn,
        .project-row.menu-open .project-action-btn {
          opacity: 1;
        }

        .project-action-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #ededed;
        }

        .tables-wrapper {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 4px 0 8px 12px;
        }

        .table-wrapper {
          display: flex;
          align-items: center;
          padding: 0 1px 0 0;
          border-radius: 6px;
          transition: background 0.2s;
        }

        .table-wrapper:hover,
        .table-wrapper.menu-open {
          background: #2c2c2c;
        }

        .table-wrapper.active {
          background: #2c2c2c;
        }

        .table-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 1px 0 12px;
          height: 28px;
          flex: 1;
          min-width: 0;
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        }

        .table-more-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          background: transparent;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          color: #5d6065;
          opacity: 0;
          transition: all 0.15s;
          flex-shrink: 0;
        }

        .table-wrapper:hover .table-more-btn,
        .table-wrapper.menu-open .table-more-btn {
          opacity: 1;
        }

        .table-more-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #cdcdcd;
        }

        .table-icon-svg {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          color: #5d6065;
          transition: color 0.2s;
        }

        .table-wrapper:hover .table-icon-svg,
        .table-wrapper.menu-open .table-icon-svg {
          color: #9b9b9b;
        }

        .table-wrapper.active .table-icon-svg {
          color: #cdcdcd;
        }

        .table-processing-indicator {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          animation: sidebar-spin 1s linear infinite;
        }

        @keyframes sidebar-spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        .table-wrapper.processing .table-name {
          color: #60a5fa;
        }

        .table-wrapper.processing:hover .table-name {
          color: #93c5fd;
        }

        .table-name {
          font-size: 13px;
          font-weight: 500;
          color: #9b9b9b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-align: left;
          transition: color 0.2s;
        }

        .table-wrapper:hover .table-name,
        .table-wrapper.menu-open .table-name {
          color: #cdcdcd;
        }

        .table-wrapper.active .table-name {
          color: #ffffff;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px 16px;
          gap: 12px;
        }

        .empty-text {
          font-size: 12px;
          color: #5d6065;
        }

        .empty-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background: #313131;
          border: 1px solid #404040;
          border-radius: 6px;
          color: #cdcdcd;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .empty-btn:hover {
          background: #3e3e41;
          border-color: #505050;
          color: #ffffff;
        }

        .loading {
          display: flex;
          flex-direction: column;
          padding: 8px 0;
          gap: 2px;
        }

        .skeleton-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 0 16px;
          height: 28px; /* 统一高度 28px */
        }

        .skeleton-icon {
          width: 14px;
          height: 14px;
          border-radius: 4px;
          flex-shrink: 0;
          background: rgba(255, 255, 255, 0.06);
          position: relative;
          overflow: hidden;
        }

        .skeleton-text {
          height: 10px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.06);
          position: relative;
          overflow: hidden;
        }

        .skeleton-text::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.15),
            transparent
          );
          transform: translateX(-100%);
          animation: shimmer 1.5s infinite;
        }

        .skeleton-child {
          padding-left: 36px;
        }

        @keyframes shimmer {
          100% {
            transform: translateX(100%);
          }
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 4px 0 6px;
          height: 28px;
          background: transparent;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          transition: background 0.15s;
          width: 100%;
          text-align: left;
          box-sizing: border-box;
        }

        .nav-item:hover:not(:disabled) {
          background: #2c2c2c;
        }

        .nav-item.active {
          background: #2c2c2c;
        }

        .nav-item.active .nav-label {
          color: #ffffff;
        }

        .nav-item:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .nav-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          color: #6d7177;
          transition: color 0.15s;
          flex-shrink: 0;
        }

        .nav-item:hover:not(:disabled) .nav-icon,
        .nav-item.active .nav-icon {
          color: #cdcdcd;
        }

        .nav-label {
          font-size: 13px;
          color: #9b9b9b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .nav-item:hover:not(:disabled) .nav-label {
          color: #f0efed;
        }

        .nav-badge {
          font-size: 10px;
          color: #6d7177;
          padding: 2px 6px;
          background: #2a2a2a;
          border-radius: 4px;
          margin-left: auto;
        }

        .nav-soon {
          font-size: 9px;
          color: #5d6065;
          padding: 2px 5px;
          background: #252525;
          border-radius: 3px;
          margin-left: auto;
        }

        .footer {
          height: 45px;
          padding: 0 16px;
          border-top: 1px solid #333;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }

        .sidebar.collapsed .footer {
          height: 45px;
          padding: 0 12px;
          justify-content: center;
          border-top: 1px solid #333;
        }

        .sidebar.collapsed .env-badge {
          display: none;
        }

        .sidebar.collapsed .user-avatar {
          margin: 0;
        }

        .env-badge {
          height: 28px;
          font-size: 11px;
          color: #808080;
          padding: 0 10px;
          background: #2a2a2a;
          border-radius: 5px;
          display: flex;
          align-items: center;
        }

        .user-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: #3a3a3a;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
          overflow: hidden;
          cursor: pointer;
          transition: all 200ms ease;
        }

        .user-avatar:hover {
          background: #4a4a4a;
          transform: scale(1.05);
          box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.1);
        }

        .user-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: inherit;
          display: block;
        }

        .context-menu {
          position: fixed;
          min-width: 140px;
          background: #1a1a1e;
          border: 1px solid #333;
          border-radius: 8px;
          padding: 4px;
          z-index: 9999;
          display: flex;
          flex-direction: column;
        }

        .context-menu-item {
          width: 100%;
          height: 28px;
          padding: 0 12px;
          background: transparent;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          color: #d4d4d4;
          cursor: pointer;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background 0.1s;
        }

        .context-menu-item:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #ffffff;
        }

        .context-menu-item.danger {
          color: #f87171;
        }

        .context-menu-item.danger:hover {
          background: rgba(248, 113, 113, 0.1);
          color: #f87171;
        }

        .context-menu-divider {
          height: 1px;
          background: #333;
          margin: 4px 0;
        }
      `}</style>

      {/* Header */}
      <div className='header'>
        {effectiveCollapsed ? (
          <div
            className='collapsed-logo-wrapper'
            onClick={() => handleCollapsedChange(false)}
            title='Expand sidebar'
          >
            {/* Product logo - shows by default, hides on hover */}
            <img
              className='product-logo'
              src='/puppybase.svg'
              alt='puppyone'
              width={14}
              height={14}
            />
            {/* Sidebar toggle icon - hidden by default, shows on hover */}
            <svg
              className='sidebar-toggle-icon'
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
          </div>
        ) : (
          <>
            <div className='header-brand'>
              <img src='/puppybase.svg' alt='puppyone' width={14} height={14} />
              <span className='header-title'>puppyone</span>
            </div>
            <div
              className='collapse-toggle-wrapper'
              onClick={() => handleCollapsedChange(true)}
              title='Collapse sidebar'
            >
              {/* Sidebar collapse icon */}
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
            </div>
          </>
        )}
      </div>

      {/* Content */}
      <div className='content'>
        {/* Main Content - Contexts (flex: 1, scrollable) */}
        <div className='content-main'>
          {/* Section: Contexts */}
          <div className='section'>
            <div
              className='section-header'
              onClick={() => toggleSection('contexts')}
            >
              <span className='section-title'>Projects</span>
              <svg
                className={`section-chevron ${expandedSections.has('contexts') ? 'expanded' : ''}`}
                viewBox='0 0 12 12'
                fill='none'
              >
                <path
                  d='M4.5 2.5L8 6L4.5 9.5'
                  stroke='currentColor'
                  strokeWidth='1.2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </svg>
              <button
                className='section-add-btn'
                onClick={e => {
                  e.stopPropagation();
                  handleCreateProject();
                }}
                title='New Project'
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

            {expandedSections.has('contexts') && (
              <div className='section-content'>
                {loading ? (
                  <div className='loading'>
                    {/* 骨架屏：模拟 2 个项目，每个项目有 2 个子项 */}
                    <div className='skeleton-item'>
                      <div className='skeleton-icon' />
                      <div className='skeleton-text' style={{ width: '65%' }} />
                    </div>
                    <div className='skeleton-item skeleton-child'>
                      <div
                        className='skeleton-icon'
                        style={{ width: 14, height: 14 }}
                      />
                      <div className='skeleton-text' style={{ width: '55%' }} />
                    </div>
                    <div className='skeleton-item skeleton-child'>
                      <div
                        className='skeleton-icon'
                        style={{ width: 14, height: 14 }}
                      />
                      <div className='skeleton-text' style={{ width: '70%' }} />
                    </div>
                    <div className='skeleton-item' style={{ marginTop: 4 }}>
                      <div className='skeleton-icon' />
                      <div className='skeleton-text' style={{ width: '50%' }} />
                    </div>
                    <div className='skeleton-item skeleton-child'>
                      <div
                        className='skeleton-icon'
                        style={{ width: 14, height: 14 }}
                      />
                      <div className='skeleton-text' style={{ width: '60%' }} />
                    </div>
                  </div>
                ) : projects.length === 0 ? (
                  <button className='nav-item' onClick={handleCreateProject}>
                    <span className='nav-icon'>
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
                    <span className='nav-label' style={{ color: '#6D7177' }}>
                      New Project
                    </span>
                  </button>
                ) : (
                  <div className='projects-list'>
                    {projects.map(project => {
                      const isExpanded = expandedBaseIds.has(project.id);

                      return (
                        <div key={project.id} className='project-item'>
                          <div
                            className={`project-row ${contextMenu?.type === 'project' && contextMenu.id === project.id ? 'menu-open' : ''}`}
                          >
                            <button
                              className='project-btn'
                              onClick={() => onBaseClick(project.id)}
                            >
                              <div className='folder-icon-wrapper'>
                                <svg
                                  className='folder-icon'
                                  width='14'
                                  height='14'
                                  viewBox='0 0 14 14'
                                  fill='none'
                                >
                                  <path
                                    d='M1 4C1 3.44772 1.44772 3 2 3H5.17157C5.43679 3 5.69114 3.10536 5.87868 3.29289L6.70711 4.12132C6.89464 4.30886 7.149 4.41421 7.41421 4.41421H12C12.5523 4.41421 13 4.86193 13 5.41421V11C13 11.5523 12.5523 12 12 12H2C1.44772 12 1 11.5523 1 11V4Z'
                                    stroke='currentColor'
                                    strokeWidth='1.2'
                                  />
                                </svg>
                              </div>
                              <span className='project-name'>
                                {project.name}
                              </span>
                              <svg
                                className={`project-chevron ${isExpanded ? 'expanded' : ''}`}
                                viewBox='0 0 12 12'
                                fill='none'
                              >
                                <path
                                  d='M4.5 2.5L8 6L4.5 9.5'
                                  stroke='currentColor'
                                  strokeWidth='1.2'
                                  strokeLinecap='round'
                                  strokeLinejoin='round'
                                />
                              </svg>
                            </button>
                            <button
                              className='project-action-btn'
                              onClick={e => {
                                e.stopPropagation();
                                const rect =
                                  e.currentTarget.getBoundingClientRect();
                                setContextMenu({
                                  x: rect.right + 4,
                                  y: rect.top,
                                  type: 'project',
                                  id: project.id,
                                });
                              }}
                              title='More options'
                            >
                              <svg
                                width='16'
                                height='16'
                                viewBox='0 0 14 14'
                                fill='none'
                              >
                                <circle
                                  cx='7'
                                  cy='3'
                                  r='1.3'
                                  fill='currentColor'
                                />
                                <circle
                                  cx='7'
                                  cy='7'
                                  r='1.3'
                                  fill='currentColor'
                                />
                                <circle
                                  cx='7'
                                  cy='11'
                                  r='1.3'
                                  fill='currentColor'
                                />
                              </svg>
                            </button>
                            <button
                              className='project-action-btn'
                              onClick={e => {
                                e.stopPropagation();
                                handleCreateTable(project.id);
                              }}
                              title='New Context'
                            >
                              <svg
                                width='14'
                                height='14'
                                viewBox='0 0 10 10'
                                fill='none'
                              >
                                <path
                                  d='M5 1v8M1 5h8'
                                  stroke='currentColor'
                                  strokeWidth='1.3'
                                  strokeLinecap='round'
                                />
                              </svg>
                            </button>
                          </div>

                          {isExpanded && (
                            <div className='tables-wrapper'>
                              {project.tables.map(table => {
                                const isProcessing = processingTableIds.has(
                                  table.id
                                );
                                return (
                                  <div
                                    key={table.id}
                                    className={`table-wrapper ${String(table.id) === String(activeTableId) ? 'active' : ''} ${contextMenu?.type === 'table' && contextMenu.id === table.id ? 'menu-open' : ''} ${isProcessing ? 'processing' : ''}`}
                                  >
                                    <button
                                      className='table-btn'
                                      onClick={() =>
                                        onTableClick(project.id, table.id)
                                      }
                                    >
                                      {isProcessing ? (
                                        <svg
                                          className='table-processing-indicator'
                                          width='14'
                                          height='14'
                                          viewBox='0 0 14 14'
                                          fill='none'
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
                                        <svg
                                          className='table-icon-svg'
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
                                      )}
                                      <span className='table-name'>
                                        {table.name}
                                      </span>
                                    </button>
                                    <button
                                      className='table-more-btn'
                                      onClick={e => {
                                        e.stopPropagation();
                                        const rect =
                                          e.currentTarget.getBoundingClientRect();
                                        setContextMenu({
                                          x: rect.right + 4,
                                          y: rect.top,
                                          type: 'table',
                                          id: table.id,
                                          projectId: project.id,
                                        });
                                      }}
                                      title='More options'
                                    >
                                      <svg
                                        width='16'
                                        height='16'
                                        viewBox='0 0 14 14'
                                        fill='none'
                                      >
                                        <circle
                                          cx='7'
                                          cy='3'
                                          r='1.3'
                                          fill='currentColor'
                                        />
                                        <circle
                                          cx='7'
                                          cy='7'
                                          r='1.3'
                                          fill='currentColor'
                                        />
                                        <circle
                                          cx='7'
                                          cy='11'
                                          r='1.3'
                                          fill='currentColor'
                                        />
                                      </svg>
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Content - Deploy & Settings */}
        <div className='content-bottom'>
          {/* Section: Deploy */}
          <div className='section'>
            <div
              className='section-header'
              onClick={() => toggleSection('connect')}
            >
              <span className='section-title'>Deploy</span>
              <svg
                className={`section-chevron ${expandedSections.has('connect') ? 'expanded' : ''}`}
                viewBox='0 0 12 12'
                fill='none'
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

            {expandedSections.has('connect') && (
              <div className='section-content'>
                {/* Tools & MCP (Outbound) */}
                <button
                  className={`nav-item ${activeView === 'tools' ? 'active' : ''}`}
                  onClick={() => onUtilityNavClick('tools')}
                >
                  <span className='nav-icon'>
                    {/* External Link / Export style icon */}
                    <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                      <path
                        d='M9 2.5h2.5V5M11.5 2.5L6 8M11 9v2.5a1.5 1.5 0 01-1.5 1.5H3.5A1.5 1.5 0 012 11.5V5.5A1.5 1.5 0 013.5 4H6'
                        stroke='currentColor'
                        strokeWidth='1.2'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                      />
                    </svg>
                  </span>
                  <span className='nav-label'>Tools & MCP</span>
                  {toolsCount > 0 && (
                    <span className='nav-badge'>{toolsCount}</span>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Bottom Actions (Fixed Settings) */}
        <div
          style={{
            padding: '8px 8px 8px 8px',
            borderTop: '1px solid #333',
            flexShrink: 0,
          }}
        >
          <button
            className={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
            onClick={() => onUtilityNavClick('settings')}
          >
            <span className='nav-icon'>
              <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                <path
                  d='M7 1.75C7 1.75 7.6 1.75 7.6 2.65C7.6 3.15 8 3.55 8.5 3.55C9.4 3.55 10 3.2 10 3.2C10 3.2 10.5 3.6 10.9 4.1C11.3 4.6 11.3 4.6 11.3 4.6C11.3 4.6 10.75 5.15 10.75 6.05C10.75 7.35 11.85 7.9 11.85 7.9C11.85 7.9 11.6 8.65 11.35 9.15C11.1 9.65 11.1 9.65 11.1 9.65C11.1 9.65 10.2 9.5 9.3 10.4C8.4 11.3 8.7 12.35 8.7 12.35C8.7 12.35 8.1 12.35 7.5 12.35L6.45 12.35C5.85 12.35 5.25 12.35 5.25 12.35C5.25 12.35 5.55 11.3 4.65 10.4C3.75 9.5 2.85 9.65 2.85 9.65C2.85 9.65 2.85 9.65 2.6 9.15C2.35 8.65 2.1 7.9 2.1 7.9C2.1 7.9 3.2 7.35 3.2 6.05C3.2 5.15 2.65 4.6 2.65 4.6C2.65 4.6 2.65 4.6 3.05 4.1C3.45 3.6 3.95 3.2 3.95 3.2C3.95 3.2 4.55 3.55 5.45 3.55C5.95 3.55 6.35 3.15 6.35 2.65C6.35 1.75 6.95 1.75 6.95 1.75L7 1.75ZM7 5.25C5.9 5.25 5 6.15 5 7.25C5 8.35 5.9 9.25 7 9.25C8.1 9.25 9 8.35 9 7.25C9 6.15 8.1 5.25 7 5.25Z'
                  stroke='currentColor'
                  strokeWidth='1.2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </svg>
            </span>
            <span className='nav-label'>Settings</span>
          </button>
        </div>
      </div>

      {/* Collapsed Navigation - Shows only when sidebar is collapsed */}
      <div className='collapsed-nav'>
        <div className='collapsed-nav-main'>
          {/* Contexts Icon with Hover Popover */}
          <div className='collapsed-nav-item'>
            <button
              className={`collapsed-nav-btn ${activeView === 'projects' ? 'active' : ''}`}
            >
              <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                <path
                  d='M1 4C1 3.44772 1.44772 3 2 3H5.17157C5.43679 3 5.69114 3.10536 5.87868 3.29289L6.70711 4.12132C6.89464 4.30886 7.149 4.41421 7.41421 4.41421H12C12.5523 4.41421 13 4.86193 13 5.41421V11C13 11.5523 12.5523 12 12 12H2C1.44772 12 1 11.5523 1 11V4Z'
                  stroke='currentColor'
                  strokeWidth='1.2'
                />
              </svg>
            </button>

            {/* Popover showing all contexts */}
            <div className='collapsed-nav-popover'>
              {projects.length === 0 ? (
                <div className='popover-empty'>No projects yet</div>
              ) : (
                projects.map(project => (
                  <div key={project.id} className='popover-section'>
                    <div className='popover-project'>
                      <svg
                        width='12'
                        height='12'
                        viewBox='0 0 14 14'
                        fill='none'
                      >
                        <path
                          d='M1 4C1 3.44772 1.44772 3 2 3H5.17157C5.43679 3 5.69114 3.10536 5.87868 3.29289L6.70711 4.12132C6.89464 4.30886 7.149 4.41421 7.41421 4.41421H12C12.5523 4.41421 13 4.86193 13 5.41421V11C13 11.5523 12.5523 12 12 12H2C1.44772 12 1 11.5523 1 11V4Z'
                          stroke='currentColor'
                          strokeWidth='1.2'
                        />
                      </svg>
                      <span>{project.name}</span>
                    </div>
                    {project.tables.map(table => (
                      <button
                        key={table.id}
                        className={`popover-table ${activeTableId === table.id ? 'active' : ''}`}
                        onClick={() => onTableClick(project.id, table.id)}
                      >
                        <svg
                          width='12'
                          height='12'
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
                        <span>{table.name}</span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className='collapsed-nav-bottom'>
          {/* Tools & MCP Icon (Outbound) */}
          <button
            className={`collapsed-nav-btn ${activeView === 'tools' ? 'active' : ''}`}
            onClick={() => onUtilityNavClick('tools')}
            title='Tools & MCP'
          >
            <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
              <path
                d='M9 2.5h2.5V5M11.5 2.5L6 8M11 9v2.5a1.5 1.5 0 01-1.5 1.5H3.5A1.5 1.5 0 012 11.5V5.5A1.5 1.5 0 013.5 4H6'
                stroke='currentColor'
                strokeWidth='1.2'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
          </button>

          {/* Settings Icon */}
          <button
            className={`collapsed-nav-btn ${activeView === 'settings' ? 'active' : ''}`}
            onClick={() => onUtilityNavClick('settings')}
            title='Settings'
          >
            <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
              <path
                d='M7 1.75C7 1.75 7.6 1.75 7.6 2.65C7.6 3.15 8 3.55 8.5 3.55C9.4 3.55 10 3.2 10 3.2C10 3.2 10.5 3.6 10.9 4.1C11.3 4.6 11.3 4.6 11.3 4.6C11.3 4.6 10.75 5.15 10.75 6.05C10.75 7.35 11.85 7.9 11.85 7.9C11.85 7.9 11.6 8.65 11.35 9.15C11.1 9.65 11.1 9.65 11.1 9.65C11.1 9.65 10.2 9.5 9.3 10.4C8.4 11.3 8.7 12.35 8.7 12.35C8.7 12.35 8.1 12.35 7.5 12.35L6.45 12.35C5.85 12.35 5.25 12.35 5.25 12.35C5.25 12.35 5.55 11.3 4.65 10.4C3.75 9.5 2.85 9.65 2.85 9.65C2.85 9.65 2.85 9.65 2.6 9.15C2.35 8.65 2.1 7.9 2.1 7.9C2.1 7.9 3.2 7.35 3.2 6.05C3.2 5.15 2.65 4.6 2.65 4.6C2.65 4.6 2.65 4.6 3.05 4.1C3.45 3.6 3.95 3.2 3.95 3.2C3.95 3.2 4.55 3.55 5.45 3.55C5.95 3.55 6.35 3.15 6.35 2.65C6.35 1.75 6.95 1.75 6.95 1.75L7 1.75ZM7 5.25C5.9 5.25 5 6.15 5 7.25C5 8.35 5.9 9.25 7 9.25C8.1 9.25 9 8.35 9 7.25C9 6.15 8.1 5.25 7 5.25Z'
                stroke='currentColor'
                strokeWidth='1.2'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className='footer'>
        <span className='env-badge'>{environmentLabel}</span>
        <div
          className='user-avatar'
          onClick={() => setUserMenuOpen(true)}
          title='Account settings'
        >
          {userAvatarUrl ? (
            <img
              src={userAvatarUrl}
              alt='User avatar'
              referrerPolicy='no-referrer'
            />
          ) : (
            userInitial
          )}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className='context-menu'
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          {contextMenu.type === 'project' ? (
            <>
              <button
                className='context-menu-item'
                onClick={e => {
                  e.stopPropagation();
                  handleEditProject(contextMenu.id);
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
              <div className='context-menu-divider' />
              <button
                className='context-menu-item danger'
                onClick={e => {
                  e.stopPropagation();
                  setEditingProjectId(contextMenu.id);
                  setDeleteMode('project');
                  setProjectDialogOpen(true);
                  setContextMenu(null);
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
            </>
          ) : (
            <>
              <button
                className='context-menu-item'
                onClick={e => {
                  e.stopPropagation();
                  handleEditTable(contextMenu.projectId!, contextMenu.id);
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
              <div className='context-menu-divider' />
              <button
                className='context-menu-item danger'
                onClick={e => {
                  e.stopPropagation();
                  setEditingProjectId(contextMenu.projectId!);
                  setEditingTableId(contextMenu.id);
                  setDeleteMode('table');
                  setTableDialogOpen(true);
                  setContextMenu(null);
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
            </>
          )}
        </div>
      )}

      {/* Dialogs */}
      {projectDialogOpen && (
        <ProjectManageDialog
          projectId={editingProjectId}
          projects={projects}
          deleteMode={deleteMode === 'project'}
          onClose={() => {
            setProjectDialogOpen(false);
            setEditingProjectId(null);
            setDeleteMode(null);
          }}
          onProjectsChange={onProjectsChange}
        />
      )}

      {tableDialogOpen && editingProjectId && (
        <TableManageDialog
          projectId={editingProjectId}
          tableId={editingTableId}
          projects={projects}
          deleteMode={deleteMode === 'table'}
          onClose={() => {
            setTableDialogOpen(false);
            setEditingTableId(null);
            setEditingProjectId(null);
            setDeleteMode(null);
          }}
          onProjectsChange={onProjectsChange}
        />
      )}

      {/* Resize Handle */}
      {!effectiveCollapsed && (
        <div
          className={`resize-handle ${isResizing ? 'active' : ''}`}
          onMouseDown={handleMouseDown}
        />
      )}

      {/* User Menu Panel */}
      <UserMenuPanel
        isOpen={userMenuOpen}
        onClose={() => setUserMenuOpen(false)}
      />
    </aside>
  );
}
