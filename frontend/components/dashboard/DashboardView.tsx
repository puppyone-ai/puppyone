'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import {
  NewProjectCard,
  ProjectCard,
  PROJECT_CARD_GAP,
  PROJECT_CARD_MIN_WIDTH,
} from './ProjectCard';
import { PageLoading } from '@/components/loading';
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
      <div className='flex-1'>
        <PageLoading variant='fill' label={tc('loading')} />
      </div>
    );
  }

  if (projects.length === 0) {
    return <EmptyDashboard onCreateClick={onCreateClick} />;
  }

  return (
    <div className='flex-1 p-8 overflow-y-auto flex flex-col'>
      <div className='w-full max-w-[900px] mx-auto'>
        <div className='mb-10'>
          <h1 className='text-2xl font-semibold text-[#eee] tracking-tight'>
            {t('title')}
          </h1>
          <p className='text-sm text-[#555] mt-1.5'>
            {t('subtitle', { count: projects.length })}
          </p>
        </div>

        <div
          className='grid'
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${PROJECT_CARD_MIN_WIDTH}px, 1fr))`,
            gap: PROJECT_CARD_GAP,
            justifyItems: 'center',
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

function EmptyDashboard({ onCreateClick }: Readonly<{ onCreateClick: () => void }>) {
  const t = useTranslations('home');
  return (
    <div className='flex-1 flex flex-col items-center justify-center px-8 py-12'>
      <div style={{ textAlign: 'center', marginBottom: 36, maxWidth: 520 }}>
        <p style={{ fontSize: 13, color: '#777', margin: 0, lineHeight: 1.6 }}>
          {t('emptyDescription')}
        </p>
      </div>
      <div className='w-full flex justify-center'>
        <NewProjectCard onClick={onCreateClick} />
      </div>
    </div>
  );
}
