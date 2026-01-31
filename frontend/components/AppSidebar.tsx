'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectInfo } from '../lib/projectsApi';
import { SidebarLayout, type NavItem } from './sidebar/SidebarLayout';

type UtilityNavItem = {
  id: string;
  label: string;
  path: string;
  isAvailable: boolean;
};

type AppSidebarProps = {
  projects: ProjectInfo[];
  activeBaseId: string;
  expandedBaseIds: Set<string>;
  activeTableId: string;
  activeView?: string;
  onBaseClick: (projectId: string) => void;
  onTableClick: (projectId: string, tableId: string) => void;
  utilityNav: UtilityNavItem[];
  onUtilityNavClick: (path: string) => void;
  userInitial: string;
  userAvatarUrl?: string;
  environmentLabel?: string;
  onProjectsChange?: (projects: ProjectInfo[]) => void;
  loading?: boolean;
  isCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
  toolsCount?: number;
};

export function AppSidebar({
  projects,
  activeBaseId,
  // expandedBaseIds,
  activeTableId,
  activeView = 'projects',
  // onBaseClick,
  // onTableClick,
  onUtilityNavClick,
  userInitial,
  userAvatarUrl,
  environmentLabel = 'Local Dev',
  isCollapsed = false,
  onCollapsedChange,
  sidebarWidth,
  onSidebarWidthChange,
  toolsCount = 0,
}: AppSidebarProps) {
  const router = useRouter();

  // 判断是否在 Project Context
  const activeProject = activeBaseId
    ? projects.find(p => p.id === activeBaseId)
    : null;

  // Convert projects to ProjectOption format
  const projectOptions = projects.map((p) => ({
    id: p.id,
    name: p.name,
  }));

  if (activeProject) {
    // Project View Nav Items
    const projectNavItems: NavItem[] = [
      {
        id: 'data', // Maps to Data/Files view
        label: 'Data',
        icon: (
          <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
        ),
      },
      {
        id: 'tools',
        label: 'Agents',
        icon: (
          <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <circle cx="12" cy="5" r="2" />
            <path d="M12 7v4" />
            <line x1="8" y1="16" x2="8" y2="16" />
            <line x1="16" y1="16" x2="16" y2="16" />
          </svg>
        ),
        badge: toolsCount > 0 ? toolsCount : undefined, // Optional: maybe show agent count instead?
      },
      {
        id: 'settings',
        label: 'Settings',
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
        onGoHome={() => router.push('/home')}
        activeView={activeView}
        navItems={projectNavItems}
        onNavigate={(viewId) => {
          if (viewId === 'projects' || viewId === 'data') {
            router.push(`/projects/${activeProject.id}/data`);
          } else if (viewId === 'tools') {
            router.push(`/projects/${activeProject.id}/tools`);
          } else if (viewId === 'settings') {
            router.push(`/projects/${activeProject.id}/settings`);
          }
        }}
        onBack={() => router.push('/projects')}
        userInitial={userInitial}
        userAvatarUrl={userAvatarUrl}
        environmentLabel={environmentLabel}
        isCollapsed={isCollapsed}
        onCollapsedChange={onCollapsedChange}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={onSidebarWidthChange}
      />
    );
  }

  // Global Dashboard View Nav Items
  const globalNavItems: NavItem[] = [
    {
      id: 'home', // Changed ID to home
      label: 'Home', // Changed Label to Home
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
      label: 'Team',
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
      label: 'Billing',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
          <line x1="1" y1="10" x2="23" y2="10"></line>
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'Organization Settings', // Global Settings
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
      title="puppyone"
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
        } else if (viewId === 'settings') {
          router.push('/settings/connect');
        }
        // TODO: Handle Team/Billing routes
      }}
      userInitial={userInitial}
      userAvatarUrl={userAvatarUrl}
      environmentLabel={environmentLabel}
      isCollapsed={isCollapsed}
      onCollapsedChange={onCollapsedChange}
      sidebarWidth={sidebarWidth}
      onSidebarWidthChange={onSidebarWidthChange}
    />
  );
}
