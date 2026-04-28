'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ProjectCard, NewProjectCard, PROJECT_CARD_WIDTH } from './ProjectCard';
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
  const t = useTranslations('home');
  const tc = useTranslations('common');

  if (loading) {
    return (
      <div className='flex-1 flex flex-col items-center justify-center gap-4 p-8'>
        <div
          className='w-10 h-10 rounded-full animate-spin'
          style={{ border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#fff' }}
        />
        <span className='text-sm text-[rgba(255,255,255,0.5)]'>{tc('loading')}</span>
      </div>
    );
  }

  if (projects.length === 0) {
    return <EmptyDashboard onCreateClick={onCreateClick} />;
  }

  return (
    <div className='flex-1 p-8 overflow-y-auto flex flex-col'>
      <div className='w-full max-w-5xl mx-auto'>
        <div className='mb-10'>
          <h1 className='text-2xl font-semibold text-[#eee] tracking-tight'>
            {t('title')}
          </h1>
          <p className='text-sm text-[#555] mt-1.5'>
            {t('subtitle', { count: projects.length })}
          </p>
        </div>

        <div
          className='grid gap-14'
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${PROJECT_CARD_WIDTH}px, 1fr))` }}
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

function EmptyDashboard({ onCreateClick }: Readonly<{ onCreateClick: () => void }>) {
  const t = useTranslations('home');
  return (
    <div className='flex-1 flex flex-col items-center justify-center px-8 py-12'>
      <div style={{ textAlign: 'center', marginBottom: 36, maxWidth: 520 }}>
        <p style={{ fontSize: 13, color: '#777', margin: 0, lineHeight: 1.6 }}>
          {t('emptyDescription')}
        </p>
      </div>
      <NewProjectCard onClick={onCreateClick} />
    </div>
  );
}
