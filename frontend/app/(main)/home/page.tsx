'use client';

import React, { useCallback, useEffect, Suspense, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { refreshProjects, upsertProjectCache, useProjects } from '@/lib/hooks/useData';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import { useOrganization } from '@/contexts/OrganizationContext';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { PageLoading } from '@/components/loading';
import { useOnboarding } from '@/lib/hooks/useOnboarding';
import { createProject } from '@/lib/projectsApi';
import type { ProjectInfo } from '@/lib/projectsApi';

const PENDING_PROJECT_PREFIX = '__pending-project__';

function DashboardPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthReady } = useAuth();
  const { orgs, currentOrg, isLoading: orgsLoading } = useOrganization();
  const { projects, isLoading: projectsLoading } = useProjects(currentOrg?.id ?? null);
  const [pendingProject, setPendingProject] = useState<ProjectInfo | null>(null);
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
    setPendingProject({
      id: `${PENDING_PROJECT_PREFIX}-${Date.now()}`,
      name: 'Untitled Project',
      description: 'Preparing workspace...',
      org_id: currentOrg?.id,
      visibility: 'org',
      updated_at: new Date().toISOString(),
      access_point_count: 0,
    });

    let navigated = false;
    try {
      const created = await createProject('Untitled Project', '', currentOrg?.id, false);
      completeStep('project');
      await upsertProjectCache(currentOrg?.id, created);
      setPendingProject(null);
      navigated = true;
      router.push(`/projects/${created.id}/data`);
      void refreshProjects(currentOrg?.id);
    } catch (error) {
      setPendingProject(null);
      console.error('Failed to create project:', error);
      alert(
        'Create project failed: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    } finally {
      creatingProjectRef.current = false;
      if (!navigated) {
        setPendingProject(null);
      }
    }
  }, [completeStep, currentOrg?.id, router]);

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
    return <PageLoading variant='fill' />;
  }

  const displayProjects = pendingProject
    ? [pendingProject, ...projects]
    : projects;

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: 'var(--po-canvas)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: 0, borderRadius: 0, border: 'none', background: 'var(--po-canvas)', overflow: 'hidden' }}>
        <DashboardView
          projects={displayProjects}
          loading={projectsLoading}
          onProjectClick={projectId => {
            if (projectId.startsWith(PENDING_PROJECT_PREFIX)) return;
            router.push(`/projects/${projectId}/data`);
          }}
          onCreateClick={handleCreateProject}
        />
      </div>
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
