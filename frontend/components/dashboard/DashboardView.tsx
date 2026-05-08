'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ProjectCard, NewProjectCard, PROJECT_CARD_WIDTH } from './ProjectCard';
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

        {/*
          Project grid — `auto-fit, minmax(210px, 1fr)` packs as many
          columns as fit at the floor width of 210px, then stretches
          each one equally to fill the row. Combined with cards that
          drop their hard `maxWidth` cap (see `ProjectCard.tsx`), this
          gives us:

            - cards always FILL the row (no dead space on the right)
            - card width === grid column width, so the visible gap
              between two cards equals exactly the `gap` value below
            - same `gap` on both axes ⇒ row gap == column gap
            - `aspect-square` on the card keeps each tile a perfect
              square no matter how the column width recomputes

          Layout for the 900px container:
            3 cols × ~279px + 2 × 32 = 900px ✓ (perfect fill)
          For narrower screens (or split-pane sidebar mode):
            900 → 700 → 500 the grid drops to 2 columns automatically
            via auto-fit; below 480 it collapses to 1 column.

          History of this code's churn (kept as a teaching trail):
            v1 — `auto-fill, minmax(210, 1fr)` + card maxWidth = 210.
                 Columns stretched, cards stayed pinned. Result: large
                 horizontal whitespace inside each column made the
                 visible card-to-card gap ~3× the vertical row gap.
            v2 — `auto-fill, 210px` (fixed column) + card maxWidth = 210.
                 Fixed gap was now uniform on both axes, but the
                 leftover 206px of the 900 container sat dead on the
                 right of the grid — the "right side is empty" issue.
            v3 (this) — `auto-fit, minmax(210, 1fr)` + DROP card maxWidth.
                 Columns stretch, cards stretch with them. Uniform gap,
                 no dead space, responsive collapse on narrow screens.
        */}
        <div
          className='grid'
          style={{
            gridTemplateColumns: `repeat(auto-fit, minmax(${PROJECT_CARD_WIDTH}px, 1fr))`,
            gap: 32,
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
      <NewProjectCard onClick={onCreateClick} />
    </div>
  );
}
