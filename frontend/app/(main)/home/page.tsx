'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useProjects } from '@/lib/hooks/useData';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { ProjectManageDialog } from '@/components/ProjectManageDialog';
import { PreparingScreen } from '@/components/onboarding/PreparingScreen';
import { checkOnboardingStatus, completeOnboarding } from '@/lib/profileApi';

/**
 * Dashboard Page
 * 
 * Onboarding 主入口是 /auth/callback/route.ts（服务端处理，不受 React StrictMode 影响）。
 * 这里是 fallback：如果 callback 中 onboarding 处理失败，在客户端重试一次。
 */
function DashboardPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session } = useAuth();
  const { projects, isLoading: projectsLoading, refresh: refreshProjects } = useProjects();
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  
  // Onboarding fallback state
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const onboardingCheckedRef = useRef(false);

  const userName = session?.user?.email?.split('@')[0] 
    || session?.user?.user_metadata?.name
    || session?.user?.user_metadata?.full_name
    || undefined;

  // Fallback: 检查 onboarding 状态（以防 /auth/callback 中的处理失败）
  useEffect(() => {
    if (onboardingCheckedRef.current || projectsLoading) return;
    onboardingCheckedRef.current = true;

    const doOnboarding = async () => {
      try {
        const status = await checkOnboardingStatus();
        
        if (!status.has_onboarded) {
          // 新用户：显示 cooking 界面，执行 onboarding
          setIsOnboarding(true);
          
          try {
            const result = await completeOnboarding();
            // 成功：设置跳转到 demo project
            setRedirectUrl(result.redirect_to || null);
            setOnboardingReady(true);
          } catch (completeError) {
            console.error('Complete onboarding failed:', completeError);
            // 失败：redirectUrl 留空，点击按钮时直接退出 cooking 界面显示 dashboard
            // 不设 redirectUrl = '/home'，否则 window.location.href = '/home' 会刷新页面死循环
            setRedirectUrl(null);
            setOnboardingReady(true);
          }
        }
      } catch (e) {
        console.error('Onboarding check failed:', e);
        // checkOnboardingStatus 本身就失败了（网络不通等）
        // 不进入 onboarding 流程，让用户看到 dashboard（可能为空）
      }
    };

    doOnboarding();
  }, [projectsLoading]);

  // Handle ?create=true query param
  useEffect(() => {
    if (searchParams.get('create') === 'true' && !projectsLoading) {
      setCreateProjectOpen(true);
      router.replace('/home');
    }
  }, [searchParams, projectsLoading, router]);

  // 处理 "Enter Workspace" 点击
  const handleEnterWorkspace = () => {
    if (redirectUrl) {
      // 正常情况：跳转到 demo project 页面
      window.location.href = redirectUrl;
    } else {
      // 异常情况：onboarding 失败，退出 cooking 界面，显示 dashboard
      setIsOnboarding(false);
      // 刷新项目列表（可能 onboarding 创建了部分数据）
      refreshProjects();
    }
  };

  // Onboarding flow
  if (isOnboarding) {
    return (
      <PreparingScreen
        userName={userName}
        isReady={onboardingReady}
        onReady={handleEnterWorkspace}
      />
    );
  }

  // Loading state
  if (projectsLoading) {
    return (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          backgroundColor: '#0e0e0e',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div
            className='w-10 h-10 rounded-full animate-spin'
            style={{
              border: '3px solid rgba(255, 255, 255, 0.1)',
              borderTopColor: '#fff',
            }}
          />
          <span style={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.5)' }}>
            Loading...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        backgroundColor: '#202020',
      }}
    >
      {/* --- 全屏容器：Edge-to-Edge Pane Style --- */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          margin: 0,
          borderRadius: 0,
          border: 'none',
          borderLeft: '1px solid #2a2a2a',
          background: '#0e0e0e',
          overflow: 'hidden',
        }}
      >
        <DashboardView
          projects={projects}
          loading={projectsLoading}
          onProjectClick={projectId => router.push(`/projects/${projectId}`)}
          onCreateClick={() => setCreateProjectOpen(true)}
        />
      </div>

      {createProjectOpen && (
        <ProjectManageDialog
          mode='create'
          projectId={null}
          projects={projects}
          onClose={() => setCreateProjectOpen(false)}
        />
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100%', 
        backgroundColor: '#202020' 
      }}>
        <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Loading...</span>
      </div>
    }>
      <DashboardPageContent />
    </Suspense>
  );
}
