'use client';

import React, { useCallback, useEffect, Suspense, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { refreshProjects, useProjects } from '@/lib/hooks/useData';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import { useOrganization } from '@/contexts/OrganizationContext';
import { DashboardLoadingSkeleton, DashboardView } from '@/components/dashboard/DashboardView';
import { useOnboarding } from '@/lib/hooks/useOnboarding';
import { nextUntitledProjectName } from '@/lib/projectNames';
import { createProject } from '@/lib/projectsApi';

function DashboardPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthReady } = useAuth();
  const { orgs, currentOrg, isLoading: orgsLoading } = useOrganization();
  const { projects, isLoading: projectsLoading } = useProjects(currentOrg?.id ?? null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const creatingProjectRef = useRef(false);
  const handledCreateParamRef = useRef(false);

  // Auto-complete 'project' onboarding step when user has a project
  const { completeStep } = useOnboarding();
  useEffect(() => {
    if (!projectsLoading && projects.length > 0) {
      completeStep('project');
    }
  }, [projects, projectsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateProject = useCallback(async () => {
    if (creatingProjectRef.current) return;

    creatingProjectRef.current = true;
    setIsCreatingProject(true);

    try {
      const projectName = nextUntitledProjectName(projects);
      const created = await createProject(projectName, '', currentOrg?.id, false);
      completeStep('project');
      router.push(`/projects/${created.id}/data`);
      void refreshProjects(currentOrg?.id);
    } catch (error) {
      creatingProjectRef.current = false;
      setIsCreatingProject(false);
      console.error('Failed to create project:', error);
      alert(
        'Create project failed: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    }
  }, [completeStep, currentOrg?.id, projects, router]);

  // Handle ?create=true query param
  useEffect(() => {
    if (
      searchParams.get('create') === 'true' &&
      !projectsLoading &&
      !creatingProjectRef.current &&
      !handledCreateParamRef.current
    ) {
      handledCreateParamRef.current = true;
      router.replace('/home');
      void handleCreateProject();
    }
  }, [searchParams, projectsLoading, router, handleCreateProject]);

  if (!isAuthReady || orgsLoading || (orgs.length > 0 && !currentOrg) || projectsLoading) {
    return <DashboardLoadingSkeleton />;
  }

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: 'var(--po-canvas)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: 0, borderRadius: 0, border: 'none', background: 'var(--po-canvas)', overflow: 'hidden' }}>
        <DashboardView
          projects={projects}
          loading={projectsLoading}
          onProjectClick={projectId => {
            router.push(`/projects/${projectId}/data`);
          }}
          onCreateClick={handleCreateProject}
          onBrowseTemplates={() => router.push('/templates')}
          creatingProject={isCreatingProject}
        />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoadingSkeleton />}>
      <DashboardPageContent />
    </Suspense>
  );
}
