'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { ProjectsSidebar } from '@/components/ProjectsSidebar';
import { useProjects } from '@/lib/hooks/useData';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();

  const { session } = useAuth();
  // useProjects 自动处理了 SWR 缓存
  const { projects, isLoading: projectsLoading } = useProjects();

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

  // 侧边栏状态
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
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
  const activeView = useMemo(() => {
    if (!pathname) return 'projects';
    if (pathname.startsWith('/tools-and-server')) return 'tools';
    if (pathname.startsWith('/settings')) return 'settings';
    if (pathname.startsWith('/projects')) return 'projects';
    return 'projects';
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
    if (id === 'tools') {
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
        backgroundColor: '#040404',
      }}
    >
      <ProjectsSidebar
        projects={projects}
        activeBaseId={activeBaseId}
        expandedBaseIds={expandedBaseIds}
        activeTableId={activeTableId}
        activeView={activeView}
        onBaseClick={handleBaseClick}
        onTableClick={handleTableClick}
        // 传入空数组，因为 ProjectsSidebar 内部对 tools 和 settings 有特殊处理
        utilityNav={[]}
        onUtilityNavClick={handleUtilityNavClick}
        userInitial={userInitial}
        userAvatarUrl={userAvatarUrl}
        loading={projectsLoading}
        isCollapsed={isNavCollapsed}
        onCollapsedChange={setIsNavCollapsed}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={setSidebarWidth}
        // 暂时写死 0，后续可从 context/hook 获取全局工具数量
        toolsCount={0}
      />

      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {children}
      </main>
    </div>
  );
}
