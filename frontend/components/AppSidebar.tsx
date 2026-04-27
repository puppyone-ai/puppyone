'use client';

import React, { memo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ProjectInfo } from '../lib/projectsApi';
import type { OrganizationInfo } from '../lib/organizationsApi';
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

  if (activeProject) {
    const projectNavItems: NavItem[] = [
      {
        id: 'home',
        label: t('home'),
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        ),
      },
      {
        id: 'data',
        label: t('context'),
        groupEnd: true,
        icon: (
          <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
        ),
      },
      {
        id: 'access',
        label: t('access'),
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22v-5" />
            <path d="M9 8V2" />
            <path d="M15 8V2" />
            <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
          </svg>
        ),
      },
      {
        id: 'history',
        label: t('history'),
        icon: (
          <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        ),
      },
      {
        id: 'monitor',
        label: t('monitor'),
        groupEnd: true,
        icon: (
          <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
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
          <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
            <circle cx='12' cy='12' r='3' />
            <path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' />
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
          router.prefetch(`/projects/${projectId}/home`);
          router.prefetch(`/projects/${projectId}/data`);
        }}
        onGoHome={() => router.push('/home')}
        activeView={activeView}
        navItems={projectNavItems}
        onNavigate={(viewId) => {
          if (viewId === 'projects' || viewId === 'home') {
            router.push(`/projects/${activeProject.id}/home`);
          } else if (viewId === 'data') {
            router.push(`/projects/${activeProject.id}/data`);
          } else if (viewId === 'access') {
            router.push(`/projects/${activeProject.id}/access`);
          } else if (viewId === 'history') {
            router.push(`/projects/${activeProject.id}/history`);
          } else if (viewId === 'monitor') {
            router.push(`/projects/${activeProject.id}/monitor`);
          } else if (viewId === 'toolkit') {
            router.push(`/projects/${activeProject.id}/toolkit`);
          } else if (viewId === 'settings') {
            router.push(`/projects/${activeProject.id}/settings`);
          }
        }}
        onHoverNavItem={(viewId) => {
          const id = activeProject.id;
          const pathMap: Record<string, string> = {
            home: `/projects/${id}/home`,
            data: `/projects/${id}/data`,
            access: `/projects/${id}/access`,
            history: `/projects/${id}/history`,
            monitor: `/projects/${id}/monitor`,
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
      />
    );
  }

  const globalNavItems: NavItem[] = [
    {
      id: 'home',
      label: t('home'),
      icon: (
        <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
          <path d='M7 0.5L1 3.5V10.5L7 13.5L13 10.5V3.5L7 0.5Z' stroke='currentColor' strokeWidth='1.2' strokeLinejoin='round' />
          <path d='M1 3.5L7 6.5L13 3.5' stroke='currentColor' strokeWidth='1.2' strokeLinejoin='round' />
          <path d='M7 6.5V13.5' stroke='currentColor' strokeWidth='1.2' strokeLinejoin='round' />
        </svg>
      ),
      badge: projects.length,
    },
    {
      id: 'team',
      label: t('team'),
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
      ),
    },
    {
      id: 'billing',
      label: t('billing'),
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
          <line x1="1" y1="10" x2="23" y2="10"></line>
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
