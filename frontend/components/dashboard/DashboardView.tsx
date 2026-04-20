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
        <div className="flex flex-col items-center text-center">
          <button
            onClick={onCreateClick}
            className="w-24 h-24 mb-6 rounded-xl border-2 border-dashed border-[#333] hover:border-[#666] bg-transparent hover:bg-[#1a1a1a] transition-all flex items-center justify-center group cursor-pointer"
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#666] group-hover:text-[#eee] transition-colors">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              <line x1="12" y1="11" x2="12" y2="17"></line>
              <line x1="9" y1="14" x2="15" y2="14"></line>
            </svg>
          </button>
          <h2 className="text-lg font-medium text-[#eee] mb-2">Project is empty</h2>
          <p className="text-sm text-[#888]">Click the folder above to create a new project.</p>
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
