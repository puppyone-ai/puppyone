'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { ProjectInfo } from '../lib/mock';

type ProjectGridProps = {
  projects: ProjectInfo[];
  onSelect?: (projectId: string) => void;
};

export function ProjectGrid({ projects, onSelect }: ProjectGridProps) {
  const cardStyle: CSSProperties = {
    border: '1px solid var(--po-border)',
    borderRadius: 12,
    background: 'var(--po-panel)',
    padding: 14,
    color: 'var(--po-text)',
    textDecoration: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minHeight: 96,
    cursor: onSelect ? 'pointer' : 'inherit',
  };

  const renderContent = (project: ProjectInfo) => (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src='/puppyone-logo.svg' alt='' width={18} height={18} />
        <div style={{ fontWeight: 600, fontSize: 16 }}>{project.name}</div>
      </div>
      {project.description && (
        <div style={{ fontSize: 12, color: 'var(--po-text-muted)' }}>{project.description}</div>
      )}
      <div style={{ fontSize: 12, color: 'var(--po-success)' }}>
        {project.tables.length} items
      </div>
    </>
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 16,
        padding: 16,
      }}
    >
      {projects.map(project => {
        if (onSelect) {
          return (
            <button
              key={project.id}
              type='button'
              onClick={() => onSelect(project.id)}
              style={cardStyle}
            >
              {renderContent(project)}
            </button>
          );
        }

        return (
          <Link
            key={project.id}
            href={`/projects/${project.id}/data`}
            style={cardStyle}
          >
            {renderContent(project)}
          </Link>
        );
      })}
    </div>
  );
}
