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

// Lazy-loaded — don't affect the initial app shell bundle
const WelcomeModal = dynamic(
  () => import('@/components/onboarding/WelcomeModal').then(m => ({ default: m.WelcomeModal })),
  { ssr: false }
);
const GettingStartedPanel = dynamic(
  () => import('@/components/onboarding/GettingStartedPanel').then(m => ({ default: m.GettingStartedPanel })),
  { ssr: false }
);

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
    if (!pathname) return 'data';
    if (pathname.startsWith('/tools-and-server')) return 'tools';
    if (pathname.startsWith('/settings')) return 'settings';
    if (pathname.startsWith('/home')) return 'home';
    if (pathname.includes('/projects/')) {
      if (pathname.includes('/home')) return 'home';
      if (pathname.includes('/overview')) return 'home';
      if (pathname.includes('/toolkit')) return 'toolkit';
      if (pathname.includes('/history')) return 'history';
      if (pathname.includes('/access')) return 'access';
      if (pathname.includes('/monitor')) return 'monitor';
      if (pathname.includes('/settings')) return 'settings';
      if (pathname.includes('/data')) return 'data';
      return 'home';
    }
    return 'home';
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
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: '#1c1c1c' }}>

      {/* Welcome modal — first-ever visit */}
      {!onboarding.hasSeenWelcome && (
        <WelcomeModal onDone={onboarding.completeWelcome} />
      )}

      {/* Getting-started checklist — always rendered after welcome so the mini-button stays accessible */}
      {onboarding.hasSeenWelcome && (
        <GettingStartedPanel projectId={activeBaseId || undefined} />
      )}

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
          height: 'calc(100vh - 16px)',
          overflow: 'hidden',
          margin: '8px 8px 8px 0',
          borderRadius: 12,
          background: '#0e0e0e',
          border: '1.5px solid rgba(255,255,255,0.15)',
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
