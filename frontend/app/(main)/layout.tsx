'use client';

import React, { useState, useEffect, useMemo, memo } from 'react';
import { useSelectedLayoutSegments } from 'next/navigation';
import dynamic from 'next/dynamic';
import { AppSidebar } from '@/components/AppSidebar';
import { useProject, useProjects } from '@/lib/hooks/useData';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import { OrganizationProvider, useOrganization } from '@/contexts/OrganizationContext';
import { OnboardingProvider } from '@/contexts/OnboardingContext';
import { getEnvironmentLabel } from '@/lib/env';
import { useOnboarding } from '@/lib/hooks/useOnboarding';
import { ActivityStack } from '@/components/ActivityStack';

// Lazy-loaded — don't affect the initial app shell bundle
const WelcomeModal = dynamic(
  () => import('@/components/onboarding/WelcomeModal').then(m => ({ default: m.WelcomeModal })),
  { ssr: false }
);

// Per-project subroute → nav id. Order matters: the first matching
// segment wins, so place sub-tabs that share a substring with another
// (e.g. ``/settings`` is contained in nothing else here, ``/data`` is
// also the catch-all) appropriately. Kept as a flat table so adding a
// new tab is one line and the cognitive complexity of ``activeView``
// stays inside the linter cap.
const _PROJECT_VIEWS: ReadonlyArray<readonly [string, string]> = [
  ['/toolkit', 'toolkit'],
  ['/history', 'history'],
  ['/access', 'access'],
  ['/monitor', 'monitor'],
  ['/settings', 'settings'],
  ['/data', 'data'],
];

function _resolveActiveView(segments: readonly string[]): string {
  const [section, , projectView] = segments;
  if (section === 'tools-and-server') return 'tools';
  if (section === 'settings') return 'settings';
  if (section === 'home') return 'home';
  if (section === 'team') return 'team';
  if (section === 'billing') return 'billing';
  if (section === 'projects') {
    const matched = _PROJECT_VIEWS.find(([segment]) => segment.slice(1) === projectView);
    return matched?.[1] ?? 'data';
  }
  return 'home';
}
const MainLayoutInner = memo(function MainLayoutInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const selectedSegments = useSelectedLayoutSegments();
  const segments = useMemo(
    () => selectedSegments.filter(segment => !segment.startsWith('(')),
    [selectedSegments],
  );
  const { session, isAuthReady } = useAuth();
  const {
    orgs,
    currentOrg,
    isLoading: orgsLoading,
    switchOrg,
  } = useOrganization();

  const activeBaseId = useMemo(() => {
    return segments[0] === 'projects' && segments[1] ? segments[1] : '';
  }, [segments]);

  const { project: routeProject, isLoading: routeProjectLoading } =
    useProject(session ? activeBaseId || null : null);
  const { projects, isLoading: projectsLoading } = useProjects(currentOrg?.id ?? null);

  useEffect(() => {
    const routeOrgId = routeProject?.org_id;
    if (!routeOrgId || currentOrg?.id === routeOrgId) return;
    switchOrg(routeOrgId);
  }, [currentOrg?.id, routeProject?.org_id, switchOrg]);

  const sidebarProjects = useMemo(() => {
    const projectsForCurrentRoute =
      routeProject?.org_id && currentOrg?.id !== routeProject.org_id ? [] : projects;
    if (!routeProject || projectsForCurrentRoute.some(p => p.id === routeProject.id)) {
      return projectsForCurrentRoute;
    }
    return [routeProject, ...projectsForCurrentRoute];
  }, [activeBaseId, currentOrg?.id, projects, routeProject]);

  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(200);

  // Onboarding — lives here so the "?" button works from every page
  const onboarding = useOnboarding();

  const activeView = useMemo(() => {
    return _resolveActiveView(segments);
  }, [segments]);

  const userIdentityLoading = !isAuthReady || !session;
  const orgIdentityLoading = Boolean(session) && (
    orgsLoading ||
    (orgs.length > 0 && !currentOrg)
  );
  const projectIdentityLoading = Boolean(activeBaseId) && !routeProject && routeProjectLoading;

  const userInitial = userIdentityLoading
    ? ''
    : (session?.user?.email?.[0] || 'U').toUpperCase();
  const userMetadata = session?.user?.user_metadata as Record<string, unknown> | undefined;
  const userAvatarUrl =
    (userMetadata?.avatar_url as string) ||
    (userMetadata?.picture as string) ||
    (userMetadata?.avatarUrl as string) ||
    undefined;
  const environmentLabel = useMemo(() => getEnvironmentLabel(), []);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--po-canvas)' }}>

      {/* Welcome modal — first-ever visit */}
      {!onboarding.hasSeenWelcome && (
        <WelcomeModal onDone={onboarding.completeWelcome} />
      )}

      <ActivityStack
        showGettingStarted={onboarding.hasSeenWelcome}
        projectId={activeBaseId || undefined}
      />

      <AppSidebar
        projects={sidebarProjects}
        projectsLoading={projectsLoading}
        activeBaseId={activeBaseId}
        activeView={activeView}
        userInitial={userInitial}
        userAvatarUrl={userAvatarUrl}
        environmentLabel={environmentLabel}
        isCollapsed={isNavCollapsed}
        onCollapsedChange={setIsNavCollapsed}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={setSidebarWidth}
        currentOrg={currentOrg}
        organizationIdentityLoading={orgIdentityLoading}
        projectIdentityLoading={projectIdentityLoading}
        userIdentityLoading={userIdentityLoading}
        onOpenGuide={onboarding.openChecklist}
      />

      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          height: '100vh',
          overflow: 'hidden',
          background: 'var(--po-canvas)',
        }}
      >
        {children}
      </main>
    </div>
  );
});

export default function MainLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <OrganizationProvider>
      <OnboardingProvider>
        <MainLayoutInner>{children}</MainLayoutInner>
      </OnboardingProvider>
    </OrganizationProvider>
  );
}
