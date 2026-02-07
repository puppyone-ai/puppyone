'use client';

import React from 'react';
import { ProjectCard, PROJECT_CARD_HEIGHT, PROJECT_CARD_WIDTH } from './ProjectCard';
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
        <div>
          <h1 className='text-xl font-semibold text-[#eee] tracking-tight'>
            Organization Overview
          </h1>
          <p className='text-sm text-[#666] mt-1'>
            Manage your projects and workspaces
          </p>
        </div>

        <button
          onClick={onCreateClick}
          className='flex items-center gap-2 rounded-md bg-white text-black px-3 py-1.5 text-xs font-medium hover:bg-gray-200 transition-all'
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

      {/* Grid: 每张卡片固定最大宽高，大屏时多行排列而非被拉宽 */}
      <div
        className='grid gap-4'
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${PROJECT_CARD_WIDTH}px, ${PROJECT_CARD_WIDTH}px))`,
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
      </div>
    </div>
  );
}
