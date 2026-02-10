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
 * Onboarding 主要在 /auth/callback/route.ts（服务端）处理。
 * 这里有一个 fallback 检查，以防用户绕过 callback 直接访问。
 */
function DashboardPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session } = useAuth();
  const { projects, isLoading: projectsLoading } = useProjects();
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  
  // Onboarding fallback state
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const onboardingCheckedRef = useRef(false);

  const userName = session?.user?.email?.split('@')[0] || undefined;

  // Fallback: 检查 onboarding 状态（以防用户绕过 auth callback）
  useEffect(() => {
    if (onboardingCheckedRef.current || projectsLoading) return;
    onboardingCheckedRef.current = true;

    const checkOnboarding = async () => {
      let enteredOnboarding = false;
      
      try {
        const status = await checkOnboardingStatus();
        
        if (!status.has_onboarded) {
          // 未完成 onboarding，进入 onboarding 流程
          enteredOnboarding = true;
          setIsOnboarding(true);
          
          try {
            const result = await completeOnboarding();
            setRedirectUrl(result.redirect_to || '/home');
            setOnboardingReady(true);
          } catch (completeError) {
            // completeOnboarding 失败时，也允许进入工作区
            console.error('Complete onboarding failed:', completeError);
            setRedirectUrl('/home');
            setOnboardingReady(true);
          }
        }
      } catch (e) {
        console.error('Onboarding check failed:', e);
        
        // API 调用失败时的 fallback：
        // 如果已经进入了 onboarding 流程（显示了 cooking 界面），让用户能够进入工作区
        if (enteredOnboarding) {
          setRedirectUrl('/home');
          setOnboardingReady(true);
        }
        // 如果还没进入 onboarding 流程，用户会看到正常的 dashboard（可能是已注册用户）
      }
    };

    checkOnboarding();
  }, [projectsLoading]);

  // Handle ?create=true query param
  useEffect(() => {
    if (searchParams.get('create') === 'true' && !projectsLoading) {
      setCreateProjectOpen(true);
      router.replace('/home');
    }
  }, [searchParams, projectsLoading, router]);

  // Onboarding flow
  if (isOnboarding) {
    return (
      <PreparingScreen
        userName={userName}
        isReady={onboardingReady}
        onReady={() => redirectUrl && (window.location.href = redirectUrl)}
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
