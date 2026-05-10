'use client';

import React, { memo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import type { ProjectInfo } from '../lib/projectsApi';
import type { OrganizationInfo } from '../lib/organizationsApi';
import { getProjectHistory } from '../lib/contentTreeApi';
import { SidebarLayout, type NavItem } from './sidebar/SidebarLayout';

type AppSidebarProps = {
  projects: ProjectInfo[];
  activeBaseId: string;
  activeView?: string;
  userInitial: string;
  userAvatarUrl?: string;
  environmentLabel?: string;
  isCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
  currentOrg?: OrganizationInfo | null;
  onOpenGuide?: () => void;
};

export const AppSidebar = memo(function AppSidebar({
  projects,
  activeBaseId,
  activeView = 'projects',
  userInitial,
  userAvatarUrl,
  environmentLabel,
  isCollapsed = false,
  onCollapsedChange,
  sidebarWidth,
  onSidebarWidthChange,
  currentOrg,
  onOpenGuide,
}: AppSidebarProps) {
  const router = useRouter();
  const t = useTranslations('nav');

  const activeProject = activeBaseId
    ? projects.find(p => p.id === activeBaseId)
    : null;

  const projectOptions = projects.map((p) => ({
    id: p.id,
    name: p.name,
  }));

  // Lightweight stats for the footer chip — `limit=1` keeps payload
  // small while `total` still reflects the real commit count.
  // Cached for 60s to avoid refetching every render.
  const { data: history } = useSWR(
    activeProject ? ['sidebar-stats', activeProject.id] : null,
    () => getProjectHistory(activeProject!.id, 1),
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  );

  const projectStats = activeProject
    ? {
        shortId: activeProject.id.slice(0, 8),
        commitCount: history?.total,
      }
    : undefined;

  if (activeProject) {
    const projectNavItems: NavItem[] = [
      {
        id: 'data',
        label: t('context'),
        icon: (
          <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
            <path d='M4 7c0-1.1.9-2 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z' />
          </svg>
        ),
      },
      {
        id: 'access',
        // Chain-link glyph — diagonal / 45°-rotated variant of the
        // Lucide `link` icon. The earlier horizontal version only
        // filled ~20×10 of the 24-grid which made the strokes read as
        // thin and the icon as "too wide" next to its siblings (folder
        // / clock / monitor / gear all fill ~18×18). The rotated path
        // shares the same square footprint as those four, so the rail
        // reads as one consistent family. Kept in sync with `ChainIcon`
        // in `AccessPointsHeaderButton.tsx` so both surfaces (sidebar
        // and Data page header chip) draw the same mark.
        label: t('access'),
        icon: (
          <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
            <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' />
            <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' />
          </svg>
        ),
      },
      {
        id: 'history',
        label: t('history'),
        icon: (
          <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
            <circle cx='12' cy='12' r='9' />
            <polyline points='12 6 12 12 16 14' />
          </svg>
        ),
      },
      {
        id: 'monitor',
        label: t('monitor'),
        icon: (
          // Logs glyph — three iterations on this:
          //   v1 ECG line          → wrong semantic (looked like
          //                          live metrics, not events).
          //   v2 list-with-bullets → right semantic but bare horizontal
          //                          lines felt thin next to the other
          //                          four nav glyphs (folder · lock ·
          //                          clock · gear), which are all
          //                          `closed outline + interior detail`.
          //   v3 rect + lines      → right visual weight but the bullets
          //                          went away, so the icon read as a
          //                          generic document rather than a
          //                          bulleted log feed.
          //
          // This is v4: the closed-outline grammar of v3 (a 3–21
          // rounded rect, same footprint as the History clock and
          // Settings gear) wrapped around the bullet+line grammar of
          // v2. Visual weight matches the family; semantic stays as
          // "stream of bulleted log entries". Last entry is shorter so
          // the list reads as "trailing off into the live tail".
          <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
            <rect x='3' y='4' width='18' height='16' rx='2' />
            <line x1='7' y1='9' x2='7.01' y2='9' />
            <line x1='10' y1='9' x2='17' y2='9' />
            <line x1='7' y1='13' x2='7.01' y2='13' />
            <line x1='10' y1='13' x2='17' y2='13' />
            <line x1='7' y1='17' x2='7.01' y2='17' />
            <line x1='10' y1='17' x2='14' y2='17' />
          </svg>
        ),
      },
      {
        id: 'integrations',
        label: t('integrations'),
        icon: (
          // Linked-rings glyph — two interlocked rings reading as
          // "this project is bound to an external system." Same square
          // footprint (24-grid, ~18×18 visible) as the surrounding
          // history-clock / monitor-rect / settings-gear icons so the
          // rail keeps a single consistent family.
          <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
            <circle cx='8.5' cy='12' r='5' />
            <circle cx='15.5' cy='12' r='5' />
          </svg>
        ),
      },
      // HIDDEN: Toolkit nav item temporarily disabled
      // {
      //   id: 'toolkit',
      //   label: 'Toolkit',
      //   icon: (
      //     <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
      //       <path d='M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' />
      //     </svg>
      //   ),
      // },
      {
        id: 'settings',
        label: t('settings'),
        icon: (
          <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
            <circle cx='12' cy='12' r='3' />
            <path d='M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z' />
          </svg>
        ),
      },
    ];

    return (
      <SidebarLayout
        title={activeProject.name}
        context="project"
        currentProjectId={activeProject.id}
        projects={projectOptions}
        onSelectProject={(projectId) => router.push(`/projects/${projectId}`)}
        onHoverProject={(projectId) => {
          router.prefetch(`/projects/${projectId}/data`);
        }}
        onGoHome={() => router.push('/home')}
        activeView={activeView}
        navItems={projectNavItems}
        onNavigate={(viewId) => {
          if (viewId === 'projects') {
            router.push(`/projects/${activeProject.id}/data`);
          } else if (viewId === 'data') {
            router.push(`/projects/${activeProject.id}/data`);
          } else if (viewId === 'access') {
            router.push(`/projects/${activeProject.id}/access`);
          } else if (viewId === 'history') {
            router.push(`/projects/${activeProject.id}/history`);
          } else if (viewId === 'monitor') {
            router.push(`/projects/${activeProject.id}/monitor`);
          } else if (viewId === 'integrations') {
            router.push(`/projects/${activeProject.id}/integrations`);
          } else if (viewId === 'toolkit') {
            router.push(`/projects/${activeProject.id}/toolkit`);
          } else if (viewId === 'settings') {
            router.push(`/projects/${activeProject.id}/settings`);
          }
        }}
        onHoverNavItem={(viewId) => {
          const id = activeProject.id;
          const pathMap: Record<string, string> = {
            data: `/projects/${id}/data`,
            access: `/projects/${id}/access`,
            history: `/projects/${id}/history`,
            monitor: `/projects/${id}/monitor`,
            integrations: `/projects/${id}/integrations`,
            toolkit: `/projects/${id}/toolkit`,
            settings: `/projects/${id}/settings`,
          };
          if (pathMap[viewId]) router.prefetch(pathMap[viewId]);
        }}
        onBack={() => router.push('/projects')}
        userInitial={userInitial}
        userAvatarUrl={userAvatarUrl}
        environmentLabel={environmentLabel}
        isCollapsed={isCollapsed}
        onCollapsedChange={onCollapsedChange}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={onSidebarWidthChange}
        onOpenGuide={onOpenGuide}
        projectStats={projectStats}
      />
    );
  }

  const globalNavItems: NavItem[] = [
    {
      id: 'home',
      label: t('home'),
      icon: (
        <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
          <path d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' />
          <polyline points='3.27 6.96 12 12.01 20.73 6.96' />
          <line x1='12' y1='22.08' x2='12' y2='12' />
        </svg>
      ),
      badge: projects.length,
    },
    {
      id: 'team',
      label: t('team'),
      icon: (
        <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
          <path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' />
          <circle cx='9' cy='7' r='4' />
          <path d='M23 21v-2a4 4 0 0 0-3-3.87' />
          <path d='M16 3.13a4 4 0 0 1 0 7.75' />
        </svg>
      ),
    },
    {
      id: 'billing',
      label: t('billing'),
      icon: (
        <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
          <rect x='1' y='4' width='22' height='16' rx='2' ry='2' />
          <line x1='1' y1='10' x2='23' y2='10' />
        </svg>
      ),
    },
  ];

  return (
    <SidebarLayout
      title={currentOrg?.name ?? 'puppyone'}
      context="global"
      currentProjectId={null}
      projects={projectOptions}
      onSelectProject={(projectId) => router.push(`/projects/${projectId}`)}
      onGoHome={() => router.push('/home')}
      activeView={activeView}
      navItems={globalNavItems}
      onNavigate={(viewId) => {
        if (viewId === 'home') {
          router.push('/home');
        } else if (viewId === 'tools') {
          router.push('/tools-and-server/tools-list');
        } else if (viewId === 'team') {
          router.push('/team');
        } else if (viewId === 'billing') {
          router.push('/billing');
        }
      }}
      userInitial={userInitial}
      userAvatarUrl={userAvatarUrl}
      environmentLabel={environmentLabel}
      isCollapsed={isCollapsed}
      onCollapsedChange={onCollapsedChange}
      sidebarWidth={sidebarWidth}
      onSidebarWidthChange={onSidebarWidthChange}
      onOpenGuide={onOpenGuide}
    />
  );
});
