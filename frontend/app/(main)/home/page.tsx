'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useProjects } from '@/lib/hooks/useData';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import { useOrganization } from '@/contexts/OrganizationContext';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { ProjectManageDialog } from '@/components/ProjectManageDialog';
import { PageLoading } from '@/components/loading';
import { useOnboarding } from '@/lib/hooks/useOnboarding';

function DashboardPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthReady } = useAuth();
  const { orgs, currentOrg, isLoading: orgsLoading } = useOrganization();
  const { projects, isLoading: projectsLoading } = useProjects(currentOrg?.id ?? null);
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

  if (!isAuthReady || orgsLoading || (orgs.length > 0 && !currentOrg) || projectsLoading) {
    return <PageLoading variant='fill' />;
  }

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#0e0e0e' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: 0, borderRadius: 0, border: 'none', background: '#0e0e0e', overflow: 'hidden' }}>
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
    <Suspense fallback={<PageLoading variant='fill' />}>
      <DashboardPageContent />
    </Suspense>
  );
}
