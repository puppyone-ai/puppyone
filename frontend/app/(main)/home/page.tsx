'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useProjects } from '@/lib/hooks/useData';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { ProjectManageDialog } from '@/components/ProjectManageDialog';
import { createProject } from '@/lib/projectsApi';

/* ── Preparing screen (full-page loading between click and data page) ── */

const PREPARING_MESSAGES = [
  'Creating project...',
  'Copying template files...',
  'Setting up folder structure...',
  'Almost ready...',
];

function PreparingScreen({ templateName }: { templateName: string }) {
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setMsgIdx(prev => Math.min(prev + 1, PREPARING_MESSAGES.length - 1));
    }, 1200);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: '#0e0e0e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        {/* Animated rings */}
        <div style={{ position: 'relative', width: 56, height: 56 }}>
          <div
            className="animate-spin"
            style={{
              position: 'absolute', inset: 0,
              borderRadius: '50%',
              border: '3px solid rgba(255,255,255,0.06)',
              borderTopColor: 'rgba(255,255,255,0.5)',
            }}
          />
          <div
            className="animate-spin"
            style={{
              position: 'absolute', inset: 6,
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.04)',
              borderBottomColor: 'rgba(255,255,255,0.25)',
              animationDirection: 'reverse',
              animationDuration: '1.5s',
            }}
          />
        </div>

        {/* Template name */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: '#ccc', marginBottom: 8 }}>
            {templateName}
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'rgba(255,255,255,0.35)',
              transition: 'opacity 0.3s',
            }}
          >
            {PREPARING_MESSAGES[msgIdx]}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Dashboard Page
 *
 * Template-driven onboarding: users pick a template card to create their
 * first project. No automatic project creation or multi-step wizard.
 * A lightweight welcome toast shows once (localStorage flag).
 */
function DashboardPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session } = useAuth();
  const { currentOrg } = useOrganization();
  const { projects, isLoading: projectsLoading, refresh: refreshProjects } = useProjects(currentOrg?.id);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  // Preparing state for template creation
  const [preparing, setPreparing] = useState<{ name: string } | null>(null);

  // Lightweight welcome toast (shows once per device, no backend state)
  const [showWelcome, setShowWelcome] = useState(false);
  const welcomeCheckedRef = useRef(false);

  useEffect(() => {
    if (welcomeCheckedRef.current || projectsLoading) return;
    welcomeCheckedRef.current = true;

    const key = 'puppyone_welcomed';
    if (!localStorage.getItem(key)) {
      setShowWelcome(true);
      localStorage.setItem(key, '1');
      setTimeout(() => setShowWelcome(false), 5000);
    }
  }, [projectsLoading]);

  // Handle ?create=true query param
  useEffect(() => {
    if (searchParams.get('create') === 'true' && !projectsLoading) {
      setCreateProjectOpen(true);
      router.replace('/home');
    }
  }, [searchParams, projectsLoading, router]);

  // Template click → show preparing screen → create project → navigate
  const handleTemplateClick = async (
    templateId: string,
    templateName: string,
    templateDescription: string,
  ) => {
    setPreparing({ name: templateName });
    try {
      const project = await createProject(
        templateName,
        templateDescription,
        currentOrg?.id,
        false,
        templateId,
      );
      await refreshProjects();
      router.push(`/projects/${project.id}/data`);
    } catch {
      setPreparing(null);
    }
  };

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
      {/* Full-screen preparing overlay */}
      {preparing && <PreparingScreen templateName={preparing.name} />}

      {/* Welcome toast */}
      {showWelcome && !preparing && (
        <div
          style={{
            position: 'fixed',
            top: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 12,
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            animation: 'fadeInDown 0.3s ease-out',
          }}
        >
          <span style={{ fontSize: 18 }}>🐕</span>
          <span style={{ fontSize: 14, color: '#ddd' }}>
            Welcome to PuppyOne! Pick a template below to get started.
          </span>
          <button
            onClick={() => setShowWelcome(false)}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              fontSize: 16,
              padding: '0 4px',
              marginLeft: 8,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Main content */}
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
          onTemplateClick={handleTemplateClick}
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
        backgroundColor: '#202020',
      }}>
        <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Loading...</span>
      </div>
    }>
      <DashboardPageContent />
    </Suspense>
  );
}
