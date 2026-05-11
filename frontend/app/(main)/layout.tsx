'use client';

import React, { useState, useEffect, useMemo, memo } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { AppSidebar } from '@/components/AppSidebar';
import { useProjects } from '@/lib/hooks/useData';
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

function _resolveActiveView(pathname: string | null): string {
  if (!pathname) return 'data';
  if (pathname.startsWith('/tools-and-server')) return 'tools';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/home')) return 'home';
  if (pathname.startsWith('/team')) return 'team';
  if (pathname.startsWith('/billing')) return 'billing';
  if (pathname.includes('/projects/')) {
    for (const [segment, view] of _PROJECT_VIEWS) {
      if (pathname.includes(segment)) return view;
    }
    return 'data';
  }
  return 'home';
}
const MainLayoutInner = memo(function MainLayoutInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { session } = useAuth();
  const { currentOrg } = useOrganization();
  const { projects } = useProjects(currentOrg?.id);

  const [activeBaseId, setActiveBaseId] = useState('');
  useEffect(() => {
    if (!pathname) return;
    const match = /^\/projects\/([^/]+)/.exec(pathname);
    setActiveBaseId(match ? match[1] : '');
  }, [pathname]);

  const [isNavCollapsed, setIsNavCollapsed] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);

  // Onboarding — lives here so the "?" button works from every page
  const onboarding = useOnboarding();

  const activeView = useMemo(() => {
    return _resolveActiveView(pathname);
  }, [pathname]);

  const userInitial = (session?.user?.email?.[0] || 'U').toUpperCase();
  const userMetadata = session?.user?.user_metadata as Record<string, unknown> | undefined;
  const userAvatarUrl =
    (userMetadata?.avatar_url as string) ||
    (userMetadata?.picture as string) ||
    (userMetadata?.avatarUrl as string) ||
    undefined;
  const environmentLabel = useMemo(() => getEnvironmentLabel(), []);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: '#0e0e0e' }}>

      {/* Welcome modal — first-ever visit */}
      {!onboarding.hasSeenWelcome && (
        <WelcomeModal onDone={onboarding.completeWelcome} />
      )}

      <ActivityStack
        showGettingStarted={onboarding.hasSeenWelcome}
        projectId={activeBaseId || undefined}
      />

      <AppSidebar
        projects={projects}
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
          background: '#0e0e0e',
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
