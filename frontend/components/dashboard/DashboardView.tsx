'use client';

import React from 'react';
import { ProjectCard } from './ProjectCard';
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
    <div className='flex-1 p-8 overflow-y-auto'>
      {/* Header Section */}
      <div className='flex items-center justify-between mb-8'>
        <h1 className='text-xl font-semibold text-[#eee] tracking-tight'>
          Organization Overview
        </h1>

        <button
          onClick={onCreateClick}
          className='flex items-center gap-2 rounded-md bg-[#1a1a1a] px-3 py-1.5 text-xs font-medium text-[#888] hover:text-[#eee] hover:bg-[#222] border border-[#333] transition-all'
        >
          <svg
            width='12'
            height='12'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
          >
            <line x1='12' y1='5' x2='12' y2='19'></line>
            <line x1='5' y1='12' x2='19' y2='12'></line>
          </svg>
          New Project
        </button>
      </div>

      {/* Grid Section */}
      <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
        {projects.map(project => (
          <ProjectCard
            key={project.id}
            project={project}
            onClick={() => onProjectClick(project.id)}
          />
        ))}

        {/* Create Card (Minimalist Dashed) */}
        <button
          onClick={onCreateClick}
          className='group flex flex-col items-center justify-center rounded-xl border border-dashed border-[#222] bg-transparent p-5 cursor-pointer hover:border-[#444] hover:bg-[#0a0a0a] transition-all duration-200'
          style={{ aspectRatio: '1.2/1' }}
        >
          <div className='flex h-8 w-8 items-center justify-center rounded-full bg-[#111] text-[#333] group-hover:bg-[#1a1a1a] group-hover:text-[#666] transition-colors mb-2'>
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
            >
              <line x1='12' y1='5' x2='12' y2='19'></line>
              <line x1='5' y1='12' x2='19' y2='12'></line>
            </svg>
          </div>
          <span className='text-xs font-medium text-[#444] group-hover:text-[#666]'>
            New Project
          </span>
        </button>
      </div>
    </div>
  );
}
