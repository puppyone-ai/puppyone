'use client';

import React from 'react';
import { ProjectCard, NewProjectCard, PROJECT_CARD_WIDTH } from './ProjectCard';
import type { ProjectInfo } from '@/lib/projectsApi';

/* ── DashboardView ── */

export interface DashboardViewProps {
  projects: ProjectInfo[];
  loading?: boolean;
  onProjectClick: (projectId: string) => void;
  onCreateClick: () => void;
}

export function DashboardView({
  projects,
  loading,
  onProjectClick,
  onCreateClick,
}: DashboardViewProps) {
  if (loading) {
    return (
      <div className='flex-1 flex flex-col items-center justify-center gap-4 p-8'>
        <div
          className='w-10 h-10 rounded-full animate-spin'
          style={{
            border: '3px solid rgba(255, 255, 255, 0.1)',
            borderTopColor: '#fff',
          }}
        />
        <span className='text-sm text-[rgba(255,255,255,0.5)]'>Loading...</span>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className='flex-1 flex flex-col items-center justify-center p-8'>
        <div 
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            maxWidth: 400
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 24 }}>🐕</div>
          <h1 className='text-2xl font-semibold text-[#eee] tracking-tight mb-3'>
            Create your first project
          </h1>
          <p className='text-[15px] text-[#888] mb-8 leading-relaxed'>
            A project is a context space where you connect data sources and give AI agents access. Pick a template to start, or begin blank.
          </p>
          <button
            onClick={onCreateClick}
            style={{
              padding: '12px 24px',
              background: '#EDEDED',
              color: '#0a0a0a',
              border: 'none',
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 4px 12px rgba(255,255,255,0.1)'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#fff';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = '#EDEDED';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            New Project
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='flex-1 p-8 overflow-y-auto flex flex-col'>
      <div className='w-full max-w-5xl mx-auto'>
        {/* Header */}
        <div className='mb-10'>
          <h1 className='text-2xl font-semibold text-[#eee] tracking-tight'>
            Projects
          </h1>
          <p className='text-sm text-[#555] mt-1.5'>
            {projects.length} project{projects.length !== 1 ? 's' : ''} in your workspace
          </p>
        </div>

        {/* Projects Grid */}
        <div
          className='grid gap-14'
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${PROJECT_CARD_WIDTH}px, 1fr))`,
          }}
        >
          <NewProjectCard onClick={onCreateClick} />
          {projects.map(project => (
            <ProjectCard
              key={project.id}
              project={project}
              onClick={() => onProjectClick(project.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
