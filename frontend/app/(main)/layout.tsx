'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { AppSidebar } from '@/components/AppSidebar';
import { useProjects } from '@/lib/hooks/useData';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import { OrganizationProvider, useOrganization } from '@/contexts/OrganizationContext';

function MainLayoutInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();

  const { session } = useAuth();
  const { currentOrg, orgs, switchOrg } = useOrganization();
  const { projects, isLoading: projectsLoading } = useProjects(currentOrg?.id);

  // 解析 URL 参数 - 增加更健壮的解析逻辑
  // 注意：params.projectId 和 tableId 在 layout 中可能获取不到，因为它们是在子页面的 params 中的
  // 所以需要从 pathname 中提取
  const [activeBaseId, setActiveBaseId] = useState('');
  const [activeTableId, setActiveTableId] = useState('');

  useEffect(() => {
    if (!pathname) return;

    // Pattern: /projects/[projectId]/[tableId]
    const projectsMatch = pathname.match(
      /^\/projects\/([^\/]+)(?:\/([^\/]+))?/
    );
    if (projectsMatch) {
      setActiveBaseId(projectsMatch[1]);
      setActiveTableId(projectsMatch[2] || '');
    } else {
      setActiveBaseId('');
      setActiveTableId('');
    }
  }, [pathname]);

  // 侧边栏状态 - 默认收起，让用户聚焦于二级 sidebar
  const [isNavCollapsed, setIsNavCollapsed] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [expandedBaseIds, setExpandedBaseIds] = useState<Set<string>>(
    new Set()
  );

  // 自动展开当前项目
  useEffect(() => {
    if (activeBaseId) {
      setExpandedBaseIds(prev => {
        const next = new Set(prev);
        next.add(activeBaseId);
        return next;
      });
    }
  }, [activeBaseId]);

  // 计算 Active View
  // URL structure: /projects/{projectId}/data|toolkit|connections|monitor|settings
  const activeView = useMemo(() => {
    if (!pathname) return 'data';
    
    // Global routes
    if (pathname.startsWith('/tools-and-server')) return 'tools';
    if (pathname.startsWith('/settings')) return 'settings';
    if (pathname.startsWith('/home')) return 'home';
    
    // Project-specific routes
    if (pathname.includes('/projects/')) {
      // Check toolkit before tools (toolkit used to be context-tools)
      if (pathname.includes('/toolkit')) return 'toolkit';
      if (pathname.includes('/connections')) return 'connections';
      if (pathname.includes('/monitor')) return 'monitor';
      if (pathname.includes('/settings')) return 'settings';
      return 'data'; // /projects/{id}/data/... or /projects/{id}
    }
    
    return 'data';
  }, [pathname]);

  // 用户信息
  const userInitial = (session?.user?.email?.[0] || 'U').toUpperCase();
  const userMetadata = session?.user?.user_metadata as
    | Record<string, any>
    | undefined;
  const userAvatarUrl =
    userMetadata?.avatar_url ||
    userMetadata?.picture ||
    userMetadata?.avatarUrl ||
    undefined;

  // 导航处理
  const handleBaseClick = (projectId: string) => {
    // 展开/收起
    setExpandedBaseIds(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
    // 不需要跳转，只做展开收起交互
  };

  const handleTableClick = (projectId: string, tableId: string) => {
    router.push(`/projects/${projectId}/${tableId}`);
  };

  const handleUtilityNavClick = (id: string) => {
    if (id === 'projects') {
      // 导航到 Dashboard
      router.push('/home');
    } else if (id === 'tools') {
      router.push('/tools-and-server/tools-list');
    } else if (id === 'settings') {
      router.push('/settings/connect');
    }
  };

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
        expandedBaseIds={expandedBaseIds}
        activeTableId={activeTableId}
        activeView={activeView}
        onBaseClick={handleBaseClick}
        onTableClick={handleTableClick}
        utilityNav={[]}
        onUtilityNavClick={handleUtilityNavClick}
        userInitial={userInitial}
        userAvatarUrl={userAvatarUrl}
        loading={projectsLoading}
        isCollapsed={isNavCollapsed}
        onCollapsedChange={setIsNavCollapsed}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={setSidebarWidth}
        toolsCount={0}
        currentOrg={currentOrg}
        orgs={orgs}
        onSwitchOrg={switchOrg}
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
