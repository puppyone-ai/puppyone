'use client'

import { useState, useEffect } from 'react'
import type { ProjectInfo } from '../lib/projectsApi'
import { ProjectManageDialog } from './ProjectManageDialog'
import { TableManageDialog } from './TableManageDialog'

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
}

type SectionId = 'contexts' | 'mcp' | 'try'

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
}: ProjectsSidebarProps) {
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [tableDialogOpen, setTableDialogOpen] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [editingTableId, setEditingTableId] = useState<string | null>(null)
  const [deleteMode, setDeleteMode] = useState<'project' | 'table' | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'project' | 'table'; id: string; projectId?: string } | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<SectionId>>(new Set(['contexts', 'mcp', 'try']))

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
    <aside className="sidebar">
      <style jsx>{`
        .sidebar {
          width: 240px;
          height: 100vh;
          display: flex;
          flex-direction: column;
          background: #202020;
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
          border-right: 1px solid #404040;
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          height: 44px;
          border-bottom: 1px solid #404040;
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

        .content {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 8px 0;
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
          border-radius: 6px;
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
          padding: 12px 16px;
          border-top: 1px solid #404040;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .env-badge {
          font-size: 11px;
          color: #808080;
          padding: 4px 8px;
          background: #2A2A2A;
          border-radius: 4px;
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
        <div className="header-brand">
          <img src="/puppybase.svg" alt="PuppyContext" width={18} height={18} />
          <span className="header-title">PuppyContext</span>
        </div>
      </div>

      {/* Content */}
      <div className="content">
        
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
                className={`nav-item ${activeView === 'test' ? 'active' : ''}`}
                disabled
              >
                <span className="nav-icon">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M4 2v3L7 8l3-3V2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M7 8v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    <circle cx="7" cy="12" r="1" fill="currentColor"/>
                  </svg>
                </span>
                <span className="nav-label">Playground</span>
                <span className="nav-soon">Soon</span>
              </button>
              
              <button 
                className={`nav-item ${activeView === 'logs' ? 'active' : ''}`}
                disabled
              >
                <span className="nav-icon">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 3h10M2 7h7M2 11h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                </span>
                <span className="nav-label">Logs</span>
                <span className="nav-soon">Soon</span>
              </button>
              
              <button 
                className={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
                disabled
              >
                <span className="nav-icon">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.76 2.76l1.41 1.41M9.83 9.83l1.41 1.41M2.76 11.24l1.41-1.41M9.83 4.17l1.41-1.41" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                </span>
                <span className="nav-label">Settings</span>
                <span className="nav-soon">Soon</span>
              </button>
            </div>
          )}
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
    </aside>
  )
}
