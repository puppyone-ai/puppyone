'use client'

import type { CSSProperties } from 'react'
import { McpBar } from './McpBar'

type ProjectsHeaderProps = {
  pathSegments: string[]
  projectId: string | null
  currentTreePath: string | null
}

export function ProjectsHeader({ pathSegments, projectId, currentTreePath }: ProjectsHeaderProps) {
  return (
    <header style={headerStyle}>
      <div style={pathWrapperStyle}>
        <span style={pathLabelStyle}>Path</span>
        <span style={pathValueStyle}>{pathSegments.join(' / ')}</span>
      </div>
      <div style={headerRightStyle}>
        {projectId && <McpBar projectId={projectId} currentTreePath={currentTreePath} />}
      </div>
    </header>
  )
}

const headerStyle: CSSProperties = {
  height: 56,
  padding: '0 28px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid rgba(46,46,46,0.7)',
  background: 'rgba(10,10,12,0.78)',
  backdropFilter: 'blur(12px)',
  position: 'relative',
  zIndex: 10,
}

const pathWrapperStyle: CSSProperties = {
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
  fontSize: 12,
  color: '#EDEDED',
  letterSpacing: 0.4,
}

const headerRightStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
}


