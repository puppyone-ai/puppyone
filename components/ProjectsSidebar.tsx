'use client'

import type { CSSProperties } from 'react'
import type { ProjectInfo } from '../lib/mock'

type UtilityNavItem = {
  id: string
  label: string
  path: string
  isAvailable: boolean
}

type ProjectsSidebarProps = {
  projects: ProjectInfo[]
  activeBaseId: string
  expandedBaseId: string
  activeTableId: string
  onBaseClick: (projectId: string) => void
  onTableClick: (projectId: string, tableId: string) => void
  utilityNav: UtilityNavItem[]
  onUtilityNavClick: (path: string) => void
  userInitial: string
  environmentLabel?: string
}

export function ProjectsSidebar({
  projects,
  activeBaseId,
  expandedBaseId,
  activeTableId,
  onBaseClick,
  onTableClick,
  utilityNav,
  onUtilityNavClick,
  userInitial,
  environmentLabel = 'Local Dev',
}: ProjectsSidebarProps) {
  const activeProject = projects.find((project) => project.id === activeBaseId) ?? null
  const activeTable = activeProject?.tables.find((table) => table.id === activeTableId) ?? null

  return (
    <aside style={sidebarStyle}>
      <div style={sidebarHeaderStyle}>
        <div style={sidebarHeaderBrandStyle}>
          <img src="/puppybase.svg" alt="PuppyContext" width={18} height={18} />
          <span style={sidebarHeaderBrandTextStyle}>PuppyContext</span>
        </div>
      </div>

      <div style={sidebarListWrapperStyle}>
        <div style={sidebarSectionLabelStyle}>Explorer</div>
        {projects.map((project) => {
          const isActiveBase = project.id === activeBaseId
          const isExpanded = project.id === expandedBaseId
          const arrow = isExpanded ? '▾' : '▸'

          return (
            <div key={project.id} style={projectCardStyle(isActiveBase)}>
              <button
                type="button"
                onClick={() => onBaseClick(project.id)}
                style={projectButtonStyle(isActiveBase)}
              >
                <span style={projectButtonContentStyle}>
                  <span style={projectButtonArrowStyle}>{arrow}</span>
                  <span style={projectIconStyle} />
                  <span>{project.name}</span>
                </span>
                <span style={projectTableBadgeStyle}>{project.tables.length}</span>
              </button>

              {isExpanded && (
                <div style={tablesWrapperStyle}>
                  {project.tables.length ? (
                    project.tables.map((table) => {
                      const isActiveTable = table.id === activeTableId
                      return (
                        <button
                          key={table.id}
                          type="button"
                          onClick={() => onTableClick(project.id, table.id)}
                          style={tableButtonStyle(isActiveTable)}
                        >
                          <span style={tableBulletStyle(isActiveTable)}>{isActiveTable ? '●' : '○'}</span>
                          <span style={tableTextWrapperStyle}>
                            <span style={tableNameStyle(isActiveTable)}>{table.name}</span>
                            <span style={tableMetaStyle(isActiveTable)}>
                              {typeof table.rows === 'number' ? `${table.rows} rows` : 'Structured dataset'}
                            </span>
                          </span>
                        </button>
                      )
                    })
                  ) : (
                    <div style={noTablesStyle}>No tables yet.</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={explorerMetaWrapperStyle}>
        <div style={pathLabelStyle}>Path</div>
        <div style={pathValueStyle}>
          {['Context', activeProject?.name, activeTable?.name].filter(Boolean).join(' / ')}
        </div>
      </div>

      <div style={utilityNavWrapperStyle}>
        {utilityNav.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={!item.isAvailable}
            onClick={() => item.isAvailable && onUtilityNavClick(item.path)}
            style={utilityButtonStyle(item.isAvailable)}
          >
            <span>{item.label}</span>
            {!item.isAvailable && <span style={utilitySoonStyle}>Soon</span>}
          </button>
        ))}
      </div>

      <div style={statusWrapperStyle}>
        <span style={environmentBadgeStyle}>{environmentLabel}</span>
        <div style={userBadgeStyle}>{userInitial}</div>
      </div>
    </aside>
  )
}

const sidebarStyle: CSSProperties = {
  width: 220,
  display: 'flex',
  flexDirection: 'column',
  borderRight: '1px solid rgba(46,46,46,0.85)',
  backgroundColor: '#080808',
}

const sidebarHeaderStyle: CSSProperties = {
  height: 56,
  padding: '0 16px',
  borderBottom: '1px solid rgba(46,46,46,0.85)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}

const sidebarHeaderBrandStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const sidebarHeaderBrandTextStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  letterSpacing: 0.4,
  color: '#EDEDED',
}

const sidebarHeaderSubtitleStyle: CSSProperties = {
  fontSize: 12,
  color: '#8A8F98',
  letterSpacing: 0.6,
  textTransform: 'uppercase',
}

const sidebarListWrapperStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  padding: '14px 12px',
  gap: 8,
  overflowY: 'auto',
}

const sidebarSectionLabelStyle: CSSProperties = {
  fontSize: 11,
  color: '#565C66',
  letterSpacing: 1.1,
  textTransform: 'uppercase',
}

const projectCardStyle = (isActive: boolean): CSSProperties => ({
  borderRadius: 6,
  border: '1px solid rgba(46,46,46,0.7)',
  background: isActive ? 'rgba(14,14,18,0.92)' : 'rgba(8,8,10,0.6)',
  overflow: 'hidden',
  transition: 'border-color 0.2s ease, background 0.2s ease',
})

const projectButtonStyle = (isActive: boolean): CSSProperties => ({
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '8px 12px',
  background: isActive ? 'rgba(138,43,226,0.22)' : 'transparent',
  color: isActive ? '#EDEDED' : '#C7C7CB',
  fontSize: 11,
  letterSpacing: 0.35,
  cursor: 'pointer',
  border: 'none',
  fontFamily: "'JetBrains Mono', SFMono-Regular, Menlo, monospace",
})

const projectButtonContentStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const projectButtonArrowStyle: CSSProperties = {
  color: '#9FA4B1',
  width: 10,
  display: 'inline-flex',
  justifyContent: 'center',
}

const projectIconStyle: CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 3,
  border: '1px solid rgba(138,43,226,0.4)',
  background: 'linear-gradient(135deg, rgba(138,43,226,0.45), rgba(24,24,32,0.9))',
}

const projectTableBadgeStyle: CSSProperties = {
  padding: '0 6px',
  borderRadius: 999,
  border: '1px solid rgba(46,46,46,0.8)',
  background: 'rgba(20,20,24,0.9)',
  fontSize: 10,
  color: '#6F7580',
}

const tablesWrapperStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px 0 8px 26px',
  borderTop: '1px solid rgba(46,46,46,0.65)',
  background: 'rgba(6,6,8,0.92)',
}

const tableButtonStyle = (isActive: boolean): CSSProperties => ({
  textAlign: 'left',
  display: 'grid',
  gridTemplateColumns: '16px 1fr',
  gap: 6,
  padding: '6px 12px 6px 0',
  borderRadius: 4,
  border: '1px solid transparent',
  color: isActive ? '#EDEDED' : '#9FA4B1',
  fontSize: 11,
  letterSpacing: 0.3,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  background: isActive ? 'rgba(48,242,197,0.12)' : 'transparent',
})

const tableBulletStyle = (isActive: boolean): CSSProperties => ({
  color: isActive ? '#48F2C5' : '#636874',
  fontFamily: 'JetBrains Mono, monospace',
})

const tableTextWrapperStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const tableNameStyle = (isActive: boolean): CSSProperties => ({
  fontWeight: isActive ? 600 : 500,
})

const tableMetaStyle = (isActive: boolean): CSSProperties => ({
  fontSize: 10,
  color: isActive ? '#86EFD2' : '#565C66',
})

const noTablesStyle: CSSProperties = {
  fontSize: 10,
  color: '#4C515B',
  letterSpacing: 0.35,
}

const utilityNavWrapperStyle: CSSProperties = {
  marginTop: 'auto',
  padding: '20px 12px 18px',
  borderTop: '1px solid rgba(46,46,46,0.85)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const utilityButtonStyle = (isAvailable: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid rgba(46,46,46,0.85)',
  backgroundColor: 'rgba(10,10,10,0.6)',
  color: isAvailable ? '#EDEDED' : '#4C515B',
  fontSize: 12,
  cursor: isAvailable ? 'pointer' : 'not-allowed',
  opacity: isAvailable ? 1 : 0.5,
  transition: 'border-color 0.2s ease, color 0.2s ease',
})

const utilitySoonStyle: CSSProperties = {
  fontSize: 10,
}

const explorerMetaWrapperStyle: CSSProperties = {
  padding: '16px 16px 12px',
  borderTop: '1px solid rgba(46,46,46,0.65)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const pathLabelStyle: CSSProperties = {
  fontSize: 11,
  color: '#6F7580',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
}

const pathValueStyle: CSSProperties = {
  fontFamily: "'JetBrains Mono', SFMono-Regular, Menlo, monospace",
  fontSize: 11,
  color: '#EDEDED',
  letterSpacing: 0.4,
}

const statusWrapperStyle: CSSProperties = {
  padding: '12px 16px 18px',
  borderTop: '1px solid rgba(46,46,46,0.85)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
}

const environmentBadgeStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 999,
  border: '1px solid rgba(46,46,46,0.85)',
  background: 'rgba(14,14,18,0.85)',
  color: '#8A8F98',
  fontSize: 11,
  letterSpacing: 0.5,
}

const userBadgeStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  border: '1px solid rgba(46,46,46,0.85)',
  display: 'grid',
  placeItems: 'center',
  fontSize: 13,
  color: '#EDEDED',
  background: '#121212',
}


