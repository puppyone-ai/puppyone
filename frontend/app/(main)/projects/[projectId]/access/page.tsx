'use client';

/**
 * Access Points page.
 *
 * Surface contract:
 *   - Master-detail layout: the left rail lists access scopes (paths).
 *     Selecting a path opens every connector bound to that path in the
 *     right pane.
 *   - The right pane owns access-point detail, scoped prompt / connect
 *     instructions, configuration, and scope settings.
 *   - Pause / Resume wired to the dedicated backend endpoints
 *     (`/connectors/:id/pause` and `/resume`), revalidating the SWR
 *     cache afterwards so the status pill flips immediately.
 *
 * This file is the route entry only. Tokens, constants, helpers,
 * icons, ui blocks, the Quick-Connect bodies, the connector card, the
 * navigator, the detail panel, and the loading/empty states live
 * alongside in `lib/`, `hooks/`, and `components/`.
 */

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ResizableSidebarColumn } from '@/components/sidebar/ResizableSidebarColumn';
import { T } from './lib/tokens';
import { useAccessData } from './hooks/useAccessData';
import { AccessHeader, LoadingState, NoConnectorsState } from './components/page-shell';
import { ScopeSidebar } from './components/ScopeSidebar';
import { ScopeDetailPanel } from './components/ScopeDetailPanel';
import { CreateAccessModal } from './components/CreateAccessModal';
import { enableTargetAccess, repositoryViewKey, type RepositoryView } from '@/lib/repoApi';
import { useProject } from '@/lib/hooks/useData';
import { projectAllows } from '@/lib/projectsApi';

export default function AccessPointsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialPath, setCreateInitialPath] = useState<string | null>(null);
  const [enablingTargetKey, setEnablingTargetKey] = useState<string | null>(null);
  const [enableError, setEnableError] = useState<string | null>(null);
  const { project } = useProject(projectId);
  const canManageAccess = projectAllows(project, 'access_surface.manage')
    && projectAllows(project, 'scope.manage');

  const {
    loading,
    noScopes,
    allScopes,
    sortedScopes,
    connectorsByTarget,
    selectedScope,
    selectedConnectors,
    pendingConnectorIds,
    setSelectedTargetKey,
    handlePauseResume,
    handleUpdate,
    handleDelete,
    refresh,
    clearScopeSelection,
  } = useAccessData(projectId);

  const openCreate = useCallback((path?: string | null) => {
    if (!canManageAccess) return;
    setCreateInitialPath(path ?? null);
    setCreateOpen(true);
  }, [canManageAccess]);

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateInitialPath(null);
    if (searchParams.get('create')) {
      router.replace(`/projects/${projectId}/access`, { scroll: false });
    }
  }, [projectId, router, searchParams]);

  const handleCreated = useCallback(async (scope: RepositoryView) => {
    await refresh();
    setSelectedTargetKey(repositoryViewKey(scope));
  }, [refresh, setSelectedTargetKey]);

  const handleEnableTargetAccess = useCallback(async (view: RepositoryView) => {
    const key = repositoryViewKey(view);
    setEnablingTargetKey(key);
    setEnableError(null);
    try {
      await enableTargetAccess(projectId, view.target);
      await refresh();
    } catch (error) {
      setEnableError(error instanceof Error ? error.message : 'Could not enable access.');
    } finally {
      setEnablingTargetKey(null);
    }
  }, [projectId, refresh]);

  useEffect(() => {
    const createMode = searchParams.get('create');
    if (createMode !== 'share-with-ai') return;
    openCreate(searchParams.get('path') ?? '');
  }, [openCreate, searchParams]);

  useEffect(() => {
    const targetKey = searchParams.get('target');
    if (!targetKey) return;
    setSelectedTargetKey(targetKey);
  }, [searchParams, setSelectedTargetKey]);

  // "SSH Terminal" from the data view routes here with ?remote=ssh&path=<folder>.
  // Preselect the scope matching that folder so the user lands on its Remote Dev
  // (SSH) card; fall back to root/first if the folder isn't its own scope.
  useEffect(() => {
    if (searchParams.get('remote') !== 'ssh') return;
    if (sortedScopes.length === 0) return;
    const path = searchParams.get('path') ?? '';
    const match =
      sortedScopes.find((s) => s.path === path) ??
      sortedScopes.find((s) => s.target.kind === 'project_root') ??
      sortedScopes[0];
    if (match) setSelectedTargetKey(repositoryViewKey(match));
  }, [searchParams, sortedScopes, setSelectedTargetKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--po-canvas)' }}>
      <AccessHeader
        count={loading ? 0 : sortedScopes.length}
        onCreate={canManageAccess ? () => openCreate() : undefined}
      />

      {loading ? (
        <LoadingState />
      ) : noScopes ? (
        <NoConnectorsState onCreateScope={canManageAccess ? () => openCreate() : undefined} />
      ) : (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <ResizableSidebarColumn
            storageKey='scope-sidebar:access'
            defaultWidth={220}
            minWidth={220}
            maxWidth={480}
          >
            <ScopeSidebar
              scopes={sortedScopes}
              connectorsByTarget={connectorsByTarget}
              selectedTargetKey={selectedScope ? repositoryViewKey(selectedScope) : undefined}
              onSelect={setSelectedTargetKey}
            />
          </ResizableSidebarColumn>
          {selectedScope ? (
            <ScopeDetailPanel
              scope={selectedScope}
              connectors={selectedConnectors}
              projectId={projectId}
              onPauseResume={handlePauseResume}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              pendingConnectorIds={pendingConnectorIds}
              onScopeMutated={refresh}
              onScopeDeleted={clearScopeSelection}
              canManage={canManageAccess}
              enablingStandardAccess={enablingTargetKey === repositoryViewKey(selectedScope)}
              enableStandardAccessError={enableError}
              onEnableStandardAccess={() => handleEnableTargetAccess(selectedScope)}
            />
          ) : (
            <div style={{ flex: 1, background: T.bg }} />
          )}
        </div>
      )}
      {canManageAccess && createOpen ? (
        <CreateAccessModal
          projectId={projectId}
          existingScopes={allScopes}
          connectorsByTarget={connectorsByTarget}
          initialPath={createInitialPath}
          onClose={closeCreate}
          onCreated={handleCreated}
        />
      ) : null}
    </div>
  );
}
