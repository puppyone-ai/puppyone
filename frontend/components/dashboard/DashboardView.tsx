'use client';

import React from 'react';
import { ProjectCard, NewProjectCard, PROJECT_CARD_WIDTH, PROJECT_CARD_HEIGHT } from './ProjectCard';
import type { ProjectInfo } from '@/lib/projectsApi';

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

  return (
    <div className='flex-1 p-8 overflow-y-auto flex justify-center'>
      <div className='w-full max-w-5xl'>
        {/* Header */}
        <div className='mb-10'>
          <h1 className='text-2xl font-semibold text-[#eee] tracking-tight'>
            Projects
          </h1>
          <p className='text-sm text-[#555] mt-1.5'>
            {projects.length} project{projects.length !== 1 ? 's' : ''} in your workspace
          </p>
        </div>

        {/* Grid */}
        <div
          className='grid gap-5'
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${PROJECT_CARD_WIDTH}px, 1fr))`,
            gridAutoRows: PROJECT_CARD_HEIGHT,
          }}
        >
          {projects.map(project => (
            <ProjectCard
              key={project.id}
              project={project}
              onClick={() => onProjectClick(project.id)}
            />
          ))}
          <NewProjectCard onClick={onCreateClick} />
        </div>
      </div>
    </div>
  );
}
