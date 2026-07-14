'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { LayoutTemplate } from 'lucide-react';
import {
  NewProjectCard,
  ProjectCard,
  ProjectCardSkeleton,
  PROJECT_CARD_GAP,
  PROJECT_CARD_MIN_WIDTH,
} from './ProjectCard';
import { SkeletonBlock } from '@/components/loading';
import { OrganizationPageShell } from '@/components/organization/OrganizationPageShell';
import type { ProjectInfo } from '@/lib/projectsApi';

export interface DashboardViewProps {
  projects: ProjectInfo[];
  loading?: boolean;
  creatingProject?: boolean;
  onProjectClick: (projectId: string) => void;
  onCreateClick: () => void;
  onBrowseTemplates: () => void;
}

export function DashboardView({
  projects,
  loading,
  creatingProject = false,
  onProjectClick,
  onCreateClick,
  onBrowseTemplates,
}: DashboardViewProps) {
  const t = useTranslations('home');
  const tc = useTranslations('common');

  if (loading) {
    return <DashboardLoadingSkeleton label={tc('loading')} />;
  }

  if (projects.length === 0) {
    return (
      <OrganizationPageShell
        title={t('title')}
        actions={<BrowseTemplatesButton onClick={onBrowseTemplates} />}
      >
        <EmptyDashboard
          onCreateClick={onCreateClick}
          creatingProject={creatingProject}
          onBrowseTemplates={onBrowseTemplates}
        />
      </OrganizationPageShell>
    );
  }

  return (
    <OrganizationPageShell
      title={t('title')}
      actions={<BrowseTemplatesButton onClick={onBrowseTemplates} />}
    >
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
        <NewProjectCard
          onClick={onCreateClick}
          loading={creatingProject}
          disabled={creatingProject}
        />
      </div>
    </OrganizationPageShell>
  );
}

export function DashboardLoadingSkeleton({
  label = 'Loading...',
}: Readonly<{ label?: string }>) {
  return (
    <div
      className="flex-1 overflow-y-auto bg-[var(--po-canvas)]"
      aria-busy="true"
      aria-label={label}
    >
      <div className="mx-auto w-full max-w-[900px] px-8 py-8 pb-24">
        <div className="mb-12">
          <SkeletonBlock width={190} height={25} radius={4} />
        </div>
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${PROJECT_CARD_MIN_WIDTH}px, 1fr))`,
            gap: PROJECT_CARD_GAP,
            justifyItems: 'center',
          }}
        >
          {[0, 1, 2].map((index) => (
            <ProjectCardSkeleton key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyDashboard({
  onCreateClick,
  creatingProject,
  onBrowseTemplates,
}: Readonly<{
  onCreateClick: () => void;
  creatingProject: boolean;
  onBrowseTemplates: () => void;
}>) {
  const t = useTranslations('home');
  return (
    <div className='flex min-h-[420px] flex-col items-center justify-center px-8 py-12'>
      <div style={{ textAlign: 'center', marginBottom: 36, maxWidth: 520 }}>
        <p style={{ fontSize: 13, color: 'var(--po-text-muted)', margin: 0, lineHeight: 1.6 }}>
          {t('emptyDescription')}
        </p>
      </div>
      <div className='w-full flex justify-center'>
        <NewProjectCard
          onClick={onCreateClick}
          loading={creatingProject}
          disabled={creatingProject}
        />
      </div>
      <button
        type="button"
        onClick={onBrowseTemplates}
        className="mt-6 text-[12px] font-medium text-[var(--po-accent-text)] hover:underline"
      >
        {t('browseTemplates')}
      </button>
    </div>
  );
}

function BrowseTemplatesButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations('home');
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--po-border)] bg-[var(--po-panel)] px-3 text-[11px] font-medium text-[var(--po-text-muted)] transition-colors hover:border-[var(--po-border-strong)] hover:text-[var(--po-text)]"
    >
      <LayoutTemplate size={14} aria-hidden />
      {t('browseTemplates')}
    </button>
  );
}
