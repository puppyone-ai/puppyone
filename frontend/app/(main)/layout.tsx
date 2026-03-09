'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { AppSidebar } from '@/components/AppSidebar';
import { useProjects } from '@/lib/hooks/useData';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import { OrganizationProvider, useOrganization } from '@/contexts/OrganizationContext';
import { getEnvironmentLabel } from '@/lib/env';

function MainLayoutInner({
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
    const projectsMatch = pathname.match(/^\/projects\/([^\/]+)/);
    setActiveBaseId(projectsMatch ? projectsMatch[1] : '');
  }, [pathname]);

  const [isNavCollapsed, setIsNavCollapsed] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);

  const activeView = useMemo(() => {
    if (!pathname) return 'data';
    if (pathname.startsWith('/tools-and-server')) return 'tools';
    if (pathname.startsWith('/settings')) return 'settings';
    if (pathname.startsWith('/home')) return 'home';
    if (pathname.includes('/projects/')) {
      if (pathname.includes('/toolkit')) return 'toolkit';
      if (pathname.includes('/connections')) return 'connections';
      if (pathname.includes('/monitor')) return 'monitor';
      if (pathname.includes('/settings')) return 'settings';
      return 'data';
    }
    return 'data';
  }, [pathname]);

  const userInitial = (session?.user?.email?.[0] || 'U').toUpperCase();
  const userMetadata = session?.user?.user_metadata as Record<string, any> | undefined;
  const userAvatarUrl = userMetadata?.avatar_url || userMetadata?.picture || userMetadata?.avatarUrl || undefined;
  const environmentLabel = useMemo(() => getEnvironmentLabel(), []);

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#1c1c1c',
      }}
    >
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
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <OrganizationProvider>
      <MainLayoutInner>{children}</MainLayoutInner>
    </OrganizationProvider>
  );
}
