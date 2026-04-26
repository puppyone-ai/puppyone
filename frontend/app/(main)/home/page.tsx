'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useProjects } from '@/lib/hooks/useData';
import { useOrganization } from '@/contexts/OrganizationContext';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { ProjectManageDialog } from '@/components/ProjectManageDialog';
import { useOnboarding } from '@/lib/hooks/useOnboarding';

function DashboardPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentOrg } = useOrganization();
  const { projects, isLoading: projectsLoading } = useProjects(currentOrg?.id);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  // Auto-complete 'project' onboarding step when user has a project
  const { completeStep } = useOnboarding();
  useEffect(() => {
    if (!projectsLoading && projects.length > 0) {
      completeStep('project');
    }
  }, [projects, projectsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle ?create=true query param
  useEffect(() => {
    if (searchParams.get('create') === 'true' && !projectsLoading) {
      setCreateProjectOpen(true);
      router.replace('/home');
    }
  }, [searchParams, projectsLoading, router]);

  if (projectsLoading) {
    return (
      <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#0e0e0e', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div className='w-10 h-10 rounded-full animate-spin' style={{ border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#fff' }} />
          <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#202020' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: 0, borderRadius: 0, border: 'none', borderLeft: '1px solid #2a2a2a', background: '#0e0e0e', overflow: 'hidden' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: '#202020' }}>
        <span style={{ color: 'rgba(255,255,255,0.5)' }}>Loading...</span>
      </div>
    }>
      <DashboardPageContent />
    </Suspense>
  );
}
