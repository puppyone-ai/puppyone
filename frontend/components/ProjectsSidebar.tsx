'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { ProjectInfo } from '../lib/projectsApi'
import { ProjectManageDialog } from './ProjectManageDialog'
import { TableManageDialog } from './TableManageDialog'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'
import { batchGetETLTaskStatus } from '../lib/etlApi'

// Parsing Tasks Badge Component
function ParsingTasksBadge() {
  const { session } = useAuth()
  const [statusColor, setStatusColor] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return

    const checkStatus = async () => {
      try {
        const pendingTasksStr = localStorage.getItem('etl_pending_tasks')
        if (!pendingTasksStr) {
          setStatusColor(null)
          return
        }

        const pendingTasks = JSON.parse(pendingTasksStr) as Array<{ taskId: number }>
        if (pendingTasks.length === 0) {
          setStatusColor(null)
          return
        }

        const taskIds = pendingTasks.map(t => t.taskId)
        const response = await batchGetETLTaskStatus(taskIds, session.access_token)

        // Determine badge color based on task statuses
        const hasCompleted = response.tasks.some(t => t.status === 'completed')
        const hasFailed = response.tasks.some(t => t.status === 'failed')
        const hasPending = response.tasks.some(t => t.status === 'pending' || t.status === 'mineru_parsing' || t.status === 'llm_processing')

        if (hasFailed) {
          setStatusColor('#EF4444') // Red
        } else if (hasCompleted) {
          setStatusColor('#10B981') // Green
        } else if (hasPending) {
          setStatusColor('#F59E0B') // Yellow
        } else {
          setStatusColor(null)
        }
      } catch (error) {
        console.error('Failed to check task status:', error)
      }
    }

    checkStatus()
    const interval = setInterval(checkStatus, 3000)
    
    return () => clearInterval(interval)
  }, [session])

  if (!statusColor) return null

  return (
    <div style={{
      width: 6,
      height: 6,
      borderRadius: '50%',
      backgroundColor: statusColor,
      marginLeft: 'auto',
      flexShrink: 0,
    }} />
  )
}

type UtilityNavItem = {
  id: string
  label: string
  path: string
  isAvailable: boolean
}

type ProjectsSidebarProps = {
  projects: ProjectInfo[]
  activeBaseId: string
  expandedBaseIds: Set<string>
  activeTableId: string
  activeView?: string
  onBaseClick: (projectId: string) => void
  onTableClick: (projectId: string, tableId: string) => void
  utilityNav: UtilityNavItem[]
  onUtilityNavClick: (path: string) => void
  userInitial: string
  environmentLabel?: string
  onProjectsChange?: (projects: ProjectInfo[]) => void
  loading?: boolean
  isCollapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  sidebarWidth?: number
  onSidebarWidthChange?: (width: number) => void
}

type SectionId = 'contexts' | 'mcp' | 'try'

const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 400
const DEFAULT_SIDEBAR_WIDTH = 240

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
  environmentLabel = 'Local Dev',
  onProjectsChange,
  loading = false,
  isCollapsed = false,
  onCollapsedChange,
  sidebarWidth = DEFAULT_SIDEBAR_WIDTH,
  onSidebarWidthChange,
}: ProjectsSidebarProps) {
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [tableDialogOpen, setTableDialogOpen] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [editingTableId, setEditingTableId] = useState<string | null>(null)
  const [deleteMode, setDeleteMode] = useState<'project' | 'table' | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'project' | 'table'; id: string; projectId?: string } | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<SectionId>>(new Set(['contexts', 'mcp', 'try']))
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarRef.current) return
      const newWidth = e.clientX
      const clampedWidth = Math.min(Math.max(newWidth, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH)
      onSidebarWidthChange?.(clampedWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, onSidebarWidthChange])
  const [showCollapsedContextMenu, setShowCollapsedContextMenu] = useState(false)

  const toggleSection = (sectionId: SectionId) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }

  useEffect(() => {
    if (!contextMenu && !showAddMenu) return
    const handleClick = () => {
      setContextMenu(null)
      setShowAddMenu(false)
    }
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [contextMenu, showAddMenu])

  const handleProjectContextMenu = (e: React.MouseEvent, projectId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'project', id: projectId })
  }

  const handleTableContextMenu = (e: React.MouseEvent, projectId: string, tableId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'table', id: tableId, projectId })
  }

  const handleCreateProject = () => {
    setEditingProjectId(null)
    setProjectDialogOpen(true)
    setContextMenu(null)
  }

  const handleEditProject = (projectId: string) => {
    setEditingProjectId(projectId)
    setProjectDialogOpen(true)
    setContextMenu(null)
  }

  const handleCreateTable = (projectId: string) => {
    setEditingTableId(null)
    setEditingProjectId(projectId)
    setTableDialogOpen(true)
    setContextMenu(null)
  }

  const handleEditTable = (projectId: string, tableId: string) => {
    setEditingTableId(tableId)
    setEditingProjectId(projectId)
    setTableDialogOpen(true)
    setContextMenu(null)
  }

  return (
    <aside 
      ref={sidebarRef}
      className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}
      style={{ width: isCollapsed ? 45 : sidebarWidth }}
    >
      <style jsx>{`
        .sidebar {
          height: 100vh;
          display: flex;
          flex-direction: column;
          background: #202020;
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
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
          color: #EDEDED;
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
          background: rgba(255,255,255,0.08);
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
          background: rgba(255,255,255,0.08);
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
          background: rgba(255,255,255,0.08);
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
          color: #6D7177;
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
          color: #6D7177;
          text-align: center;
        }

        .section {
          margin-bottom: 4px;
        }

        .section-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0 12px;
          height: 28px;
          cursor: pointer;
          user-select: none;
        }

        .section-header:hover {
          background: rgba(255,255,255,0.03);
        }

        .section-title {
          font-size: 12px;
          font-weight: 600;
          color: #6D7177;
        }

        .section-chevron {
          width: 10px;
          height: 10px;
          color: #5D6065;
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
          width: 18px;
          height: 18px;
          background: transparent;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          color: #5D6065;
          opacity: 0;
          transition: opacity 0.15s, background 0.15s, color 0.15s;
        }

        .section-header:hover .section-add-btn {
          opacity: 1;
        }

        .section-add-btn:hover {
          background: #3E3E41;
          color: #FFFFFF;
        }

        .section-content {
          display: flex;
          flex-direction: column;
          gap: 1px;
          padding: 2px 8px 4px 12px;
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
          padding: 0 4px 0 0;
          border-radius: 6px;
          transition: background 0.2s;
        }

        .project-row:hover {
          background: #2C2C2C;
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

        .folder-icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          color: #6D7177;
          transition: color 0.2s;
        }

        .project-row:hover .folder-icon {
          color: #CDCDCD;
        }

        .project-name {
          font-size: 13px;
          font-weight: 500;
          color: #9B9B9B;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          transition: color 0.2s;
        }

        .project-row:hover .project-name {
          color: #F0EFED;
        }

        .project-chevron {
          width: 10px;
          height: 10px;
          color: #5D6065;
          transition: transform 0.15s, color 0.15s;
          flex-shrink: 0;
        }

        .project-chevron.expanded {
          transform: rotate(90deg);
        }

        .project-row:hover .project-chevron {
          color: #9B9B9B;
        }

        .project-add-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          background: transparent;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          color: #5D6065;
          opacity: 0;
          transition: opacity 0.15s, background 0.15s, color 0.15s;
        }

        .project-row:hover .project-add-btn {
          opacity: 1;
        }

        .project-add-btn:hover {
          background: #3E3E41;
          color: #FFFFFF;
        }

        .tables-wrapper {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 4px 0 8px 24px;
        }

        .table-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 4px 0 0;
          height: 28px;
          width: 100%;
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.2s;
        }

        .table-btn:hover {
          background: #2C2C2C;
        }

        .table-btn.active {
          background: #2C2C2C;
        }

        .table-icon-svg {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
          color: #5D6065;
          transition: color 0.2s;
        }

        .table-btn:hover .table-icon-svg {
          color: #9B9B9B;
        }

        .table-btn.active .table-icon-svg {
          color: #CDCDCD;
        }

        .table-name {
          font-size: 13px;
          font-weight: 500;
          color: #9B9B9B;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-align: left;
          transition: color 0.2s;
        }

        .table-btn:hover .table-name {
          color: #CDCDCD;
        }

        .table-btn.active .table-name {
          color: #FFFFFF;
        }

        .add-menu {
          min-width: 140px;
          background: #252525;
          border: 1px solid #404040;
          border-radius: 8px;
          padding: 6px;
          margin-top: 4px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .add-menu-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          color: #CDCDCD;
          font-size: 12px;
          text-align: left;
          transition: background 0.15s;
        }

        .add-menu-item:hover {
          background: #3E3E41;
          color: #FFFFFF;
        }

        .add-menu-item svg {
          flex-shrink: 0;
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
          color: #5D6065;
        }

        .empty-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background: #313131;
          border: 1px solid #404040;
          border-radius: 6px;
          color: #CDCDCD;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .empty-btn:hover {
          background: #3E3E41;
          border-color: #505050;
          color: #FFFFFF;
        }

        .loading {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px;
        }

        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid #404040;
          border-top-color: #8B8B8B;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 4px 0 0;
          height: 28px;
          background: transparent;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          transition: background 0.15s;
          width: 100%;
          text-align: left;
        }

        .nav-item:hover:not(:disabled) {
          background: #2C2C2C;
        }

        .nav-item.active {
          background: #2C2C2C;
        }

        .nav-item.active .nav-label {
          color: #FFFFFF;
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
          color: #6D7177;
          transition: color 0.15s;
          flex-shrink: 0;
        }

        .nav-item:hover:not(:disabled) .nav-icon,
        .nav-item.active .nav-icon {
          color: #CDCDCD;
        }

        .nav-label {
          font-size: 13px;
          color: #9B9B9B;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .nav-item:hover:not(:disabled) .nav-label {
          color: #F0EFED;
        }

        .nav-badge {
          font-size: 10px;
          color: #6D7177;
          padding: 2px 6px;
          background: #2A2A2A;
          border-radius: 4px;
          margin-left: auto;
        }

        .nav-soon {
          font-size: 9px;
          color: #5D6065;
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
          background: #2A2A2A;
          border-radius: 5px;
          display: flex;
          align-items: center;
        }

        .user-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: #3A3A3A;
          color: #FFFFFF;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
        }

        .context-menu {
          position: fixed;
          min-width: 128px;
          background: #252525;
          border: 1px solid #404040;
          border-radius: 8px;
          padding: 8px;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .context-menu-item {
          width: 100%;
          padding: 6px 8px;
          background: transparent;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          color: #CDCDCD;
          cursor: pointer;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background 0.15s;
        }

        .context-menu-item:hover {
          background: #3E3E41;
          color: #FFFFFF;
        }

        .context-menu-item.danger {
          color: #F44336;
        }

        .context-menu-item.danger:hover {
          color: #FF6B64;
        }

        .context-menu-divider {
          height: 1px;
          background: #404040;
          margin: 2px 0;
        }

      `}</style>

      {/* Header */}
      <div className="header">
        {isCollapsed ? (
          <div
            className="collapsed-logo-wrapper"
            onClick={() => onCollapsedChange?.(false)}
            title="Expand sidebar"
          >
            {/* Product logo - shows by default, hides on hover */}
            <img 
              className="product-logo" 
              src="/puppybase.svg" 
              alt="puppyone" 
              width={14} 
              height={14} 
            />
            {/* Sidebar toggle icon - hidden by default, shows on hover */}
            <svg className="sidebar-toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
          </div>
        ) : (
          <>
        <div className="header-brand">
              <img src="/puppybase.svg" alt="puppyone" width={14} height={14} />
          <span className="header-title">puppyone</span>
        </div>
            <div
              className="collapse-toggle-wrapper"
              onClick={() => onCollapsedChange?.(true)}
              title="Collapse sidebar"
            >
              {/* Sidebar collapse icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <line x1="9" y1="3" x2="9" y2="21"/>
              </svg>
            </div>
          </>
        )}
      </div>

      {/* Content */}
      <div className="content">
        {/* Main Content - Contexts (flex: 1, scrollable) */}
        <div className="content-main">
        {/* Section: Contexts */}
        <div className="section">
          <div className="section-header" onClick={() => toggleSection('contexts')}>
            <span className="section-title">Contexts</span>
            <svg className={`section-chevron ${expandedSections.has('contexts') ? 'expanded' : ''}`} viewBox="0 0 12 12" fill="none">
              <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          <button
              className="section-add-btn"
              onClick={(e) => {
                e.stopPropagation()
                setShowAddMenu(!showAddMenu)
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
          </button>
        </div>
          
          {expandedSections.has('contexts') && (
            <div className="section-content">
        {loading ? (
                <div className="loading">
                  <div className="spinner" />
                </div>
              ) : projects.length === 0 ? (
                <button className="nav-item" onClick={handleCreateProject}>
                  <span className="nav-icon">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </span>
                  <span className="nav-label" style={{ color: '#6D7177' }}>Add context...</span>
                </button>
        ) : (
                <div className="projects-list">
                  {projects.map((project) => {
                    const isExpanded = expandedBaseIds.has(project.id)

          return (
                      <div key={project.id} className="project-item">
            <div
                          className="project-row"
              onContextMenu={(e) => handleProjectContextMenu(e, project.id)}
            >
              <button
                            className="project-btn"
                onClick={() => onBaseClick(project.id)}
                          >
                            <svg className="folder-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <path d="M1 4C1 3.44772 1.44772 3 2 3H5.17157C5.43679 3 5.69114 3.10536 5.87868 3.29289L6.70711 4.12132C6.89464 4.30886 7.149 4.41421 7.41421 4.41421H12C12.5523 4.41421 13 4.86193 13 5.41421V11C13 11.5523 12.5523 12 12 12H2C1.44772 12 1 11.5523 1 11V4Z" stroke="currentColor" strokeWidth="1.2"/>
                            </svg>
                            <span className="project-name">{project.name}</span>
                            <svg className={`project-chevron ${isExpanded ? 'expanded' : ''}`} viewBox="0 0 12 12" fill="none">
                              <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                          <button
                            className="project-add-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCreateTable(project.id)
                            }}
                            title="Add table"
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                            </svg>
              </button>
                        </div>

              {isExpanded && (
                          <div className="tables-wrapper">
                            {project.tables.map((table) => (
                        <button
                          key={table.id}
                                className={`table-btn ${activeView === 'projects' && table.id === activeTableId ? 'active' : ''}`}
                          onClick={() => onTableClick(project.id, table.id)}
                          onContextMenu={(e) => handleTableContextMenu(e, project.id, table.id)}
                              >
                                <svg className="table-icon-svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                                  <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                                  <line x1="1.5" y1="5" x2="12.5" y2="5" stroke="currentColor" strokeWidth="1.2"/>
                                  <line x1="5.5" y1="5" x2="5.5" y2="12.5" stroke="currentColor" strokeWidth="1.2"/>
                                </svg>
                                <span className="table-name">{table.name}</span>
                        </button>
                            ))}
                          </div>
                        )}
                      </div>
                      )
                  })}
                </div>
              )}
              
              {/* Add Menu */}
              {showAddMenu && (
                <div className="add-menu" style={{ position: 'relative', left: 0, top: 0 }} onClick={(e) => e.stopPropagation()}>
                      <button
                    className="add-menu-item"
                    onClick={() => {
                      handleCreateProject()
                      setShowAddMenu(false)
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2 4C2 2.89543 2.89543 2 4 2H6.17157C6.70201 2 7.21071 2.21071 7.58579 2.58579L8.41421 3.41421C8.78929 3.78929 9.29799 4 9.82843 4H10C11.1046 4 12 4.89543 12 6V10C12 11.1046 11.1046 12 10 12H4C2.89543 12 2 11.1046 2 10V4Z" stroke="currentColor" strokeWidth="1.2"/>
                    </svg>
                    <span>New Folder</span>
                      </button>
                    <button
                    className="add-menu-item"
                    onClick={() => {
                      if (activeBaseId) {
                        handleCreateTable(activeBaseId)
                      } else if (projects.length > 0) {
                        handleCreateTable(projects[0].id)
                      } else {
                        handleCreateProject()
                      }
                      setShowAddMenu(false)
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                      <line x1="1.5" y1="5" x2="12.5" y2="5" stroke="currentColor" strokeWidth="1.2"/>
                      <line x1="5.5" y1="5" x2="5.5" y2="12.5" stroke="currentColor" strokeWidth="1.2"/>
                    </svg>
                    <span>New Table</span>
                    </button>
                </div>
              )}
            </div>
          )}
        </div>
        </div>

        {/* Bottom Content - MCP & Try (flex-shrink: 0, bottom aligned) */}
        <div className="content-bottom">
        {/* Section: MCP */}
        <div className="section">
          <div className="section-header" onClick={() => toggleSection('mcp')}>
            <span className="section-title">MCP</span>
            <svg className={`section-chevron ${expandedSections.has('mcp') ? 'expanded' : ''}`} viewBox="0 0 12 12" fill="none">
              <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          
          {expandedSections.has('mcp') && (
            <div className="section-content">
              <button 
                className={`nav-item ${activeView === 'mcp' ? 'active' : ''}`}
                onClick={() => onUtilityNavClick('mcp')}
              >
                <span className="nav-icon">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="3" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
                    <circle cx="11" cy="4" r="2" stroke="currentColor" strokeWidth="1.2"/>
                    <circle cx="11" cy="10" r="2" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M5 7h2M9 4.5L7.5 6M9 9.5L7.5 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                </span>
                <span className="nav-label">Instances</span>
              </button>
            </div>
          )}
        </div>

        {/* Section: Try */}
        <div className="section">
          <div className="section-header" onClick={() => toggleSection('try')}>
            <span className="section-title">Try</span>
            <svg className={`section-chevron ${expandedSections.has('try') ? 'expanded' : ''}`} viewBox="0 0 12 12" fill="none">
              <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          
          {expandedSections.has('try') && (
            <div className="section-content">
              <button 
                className={`nav-item ${activeView === 'parsing' ? 'active' : ''}`}
                onClick={() => onUtilityNavClick('parsing')}
              >
                <span className="nav-icon">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 3l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
                <span className="nav-label">Parsing Tasks</span>
                <ParsingTasksBadge />
              </button>
              
              <button 
                className={`nav-item ${activeView === 'etl' ? 'active' : ''}`}
                onClick={() => onUtilityNavClick('etl')}
              >
                <span className="nav-icon">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="1" y="2" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
                    <rect x="9" y="8" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M5 4h2.5a1 1 0 011 1v4a1 1 0 001 1H12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    <path d="M10 8L12 10L10 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
                <span className="nav-label">ETL Strategies</span>
              </button>
              
              <button 
                className={`nav-item ${activeView === 'connect' ? 'active' : ''}`}
                onClick={() => onUtilityNavClick('connect')}
              >
                <span className="nav-icon">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <ellipse cx="7" cy="3.5" rx="5" ry="1.8" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M2 3.5v7c0 1 2.24 1.8 5 1.8s5-.8 5-1.8v-7" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M12 7.3c0 1-2.24 1.8-5 1.8s-5-.8-5-1.8" stroke="currentColor" strokeWidth="1.2"/>
                  </svg>
                </span>
                <span className="nav-label">Connect</span>
              </button>
            </div>
          )}
        </div>
        </div>
      </div>
              
      {/* Collapsed Navigation - Shows only when sidebar is collapsed */}
      <div className="collapsed-nav">
        <div className="collapsed-nav-main">
          {/* Contexts Icon with Hover Popover */}
          <div className="collapsed-nav-item">
              <button 
              className={`collapsed-nav-btn ${activeView === 'projects' ? 'active' : ''}`}
              >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 4C1 3.44772 1.44772 3 2 3H5.17157C5.43679 3 5.69114 3.10536 5.87868 3.29289L6.70711 4.12132C6.89464 4.30886 7.149 4.41421 7.41421 4.41421H12C12.5523 4.41421 13 4.86193 13 5.41421V11C13 11.5523 12.5523 12 12 12H2C1.44772 12 1 11.5523 1 11V4Z" stroke="currentColor" strokeWidth="1.2"/>
                  </svg>
              </button>
              
            {/* Popover showing all contexts */}
            <div className="collapsed-nav-popover">
              {projects.length === 0 ? (
                <div className="popover-empty">No contexts yet</div>
              ) : (
                projects.map((project) => (
                  <div key={project.id} className="popover-section">
                    <div className="popover-project">
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                        <path d="M1 4C1 3.44772 1.44772 3 2 3H5.17157C5.43679 3 5.69114 3.10536 5.87868 3.29289L6.70711 4.12132C6.89464 4.30886 7.149 4.41421 7.41421 4.41421H12C12.5523 4.41421 13 4.86193 13 5.41421V11C13 11.5523 12.5523 12 12 12H2C1.44772 12 1 11.5523 1 11V4Z" stroke="currentColor" strokeWidth="1.2"/>
                      </svg>
                      <span>{project.name}</span>
                    </div>
                    {project.tables.map((table) => (
              <button 
                        key={table.id}
                        className={`popover-table ${activeTableId === table.id ? 'active' : ''}`}
                        onClick={() => onTableClick(project.id, table.id)}
                      >
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                          <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                          <line x1="1.5" y1="5" x2="12.5" y2="5" stroke="currentColor" strokeWidth="1.2"/>
                          <line x1="5.5" y1="5" x2="5.5" y2="12.5" stroke="currentColor" strokeWidth="1.2"/>
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
        
        <div className="collapsed-nav-bottom">
          {/* MCP Icon */}
          <button
            className={`collapsed-nav-btn ${activeView === 'mcp' ? 'active' : ''}`}
            onClick={() => onUtilityNavClick('mcp')}
            title="MCP Instances"
          >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="3" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="11" cy="4" r="2" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="11" cy="10" r="2" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M5 7h2M9 4.5L7.5 6M9 9.5L7.5 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
              </button>
              
          {/* Parsing Tasks Icon */}
          <button
            className={`collapsed-nav-btn ${activeView === 'parsing' ? 'active' : ''}`}
            onClick={() => onUtilityNavClick('parsing')}
            title="Parsing Tasks"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 3l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
              
          {/* ETL Icon */}
              <button 
            className={`collapsed-nav-btn ${activeView === 'etl' ? 'active' : ''}`}
            onClick={() => onUtilityNavClick('etl')}
            title="ETL Strategies"
              >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="2" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="9" y="8" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M5 4h2.5a1 1 0 011 1v4a1 1 0 001 1H12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <path d="M10 8L12 10L10 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
              </button>
        </div>
      </div>

      {/* Footer */}
      <div className="footer">
        <span className="env-badge">{environmentLabel}</span>
        <div className="user-avatar">{userInitial}</div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'project' ? (
            <>
              <button
                className="context-menu-item"
                onClick={(e) => {
                  e.stopPropagation()
                  handleEditProject(contextMenu.id)
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M10.889 0L14 3.111L7 10.111L3.889 7L10.889 0Z" fill="currentColor" />
                  <path d="M3.111 7.778L6.222 10.889L1.556 12.444L3.111 7.778Z" fill="currentColor" />
                </svg>
                Rename
              </button>
              <div className="context-menu-divider" />
              <button
                className="context-menu-item danger"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingProjectId(contextMenu.id)
                  setDeleteMode('project')
                  setProjectDialogOpen(true)
                  setContextMenu(null)
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M12 12L2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                className="context-menu-item"
                onClick={(e) => {
                  e.stopPropagation()
                  handleEditTable(contextMenu.projectId!, contextMenu.id)
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M10.889 0L14 3.111L7 10.111L3.889 7L10.889 0Z" fill="currentColor" />
                  <path d="M3.111 7.778L6.222 10.889L1.556 12.444L3.111 7.778Z" fill="currentColor" />
                </svg>
                Rename
              </button>
              <div className="context-menu-divider" />
              <button
                className="context-menu-item danger"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingProjectId(contextMenu.projectId!)
                  setEditingTableId(contextMenu.id)
                  setDeleteMode('table')
                  setTableDialogOpen(true)
                  setContextMenu(null)
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M12 12L2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
            setProjectDialogOpen(false)
            setEditingProjectId(null)
            setDeleteMode(null)
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
            setTableDialogOpen(false)
            setEditingTableId(null)
            setEditingProjectId(null)
            setDeleteMode(null)
          }}
          onProjectsChange={onProjectsChange}
        />
      )}

      {/* Resize Handle */}
      {!isCollapsed && (
        <div 
          className={`resize-handle ${isResizing ? 'active' : ''}`}
          onMouseDown={handleMouseDown}
        />
      )}
    </aside>
  )
}
