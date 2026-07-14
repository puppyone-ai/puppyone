'use client';

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { getApiBase } from '../components/access-points/labels';
import type { AccessPanelNavigationGuard, EditorTarget } from '../components/right-panel';
import { usePanelStore } from '../usePanelStore';
import {
  matchRepositoryViewForPath,
  repositoryViewKey,
  type Connector,
  type RepositoryView,
} from '@/lib/repoApi';
import { canonicalProjectGitUrl } from '@/lib/gitRemote';

function normalizeAccessPath(path: string | null | undefined): string {
  return (path ?? '').trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

type SyncEndpointLike = {
  syncId: string;
};

export function useDataPanelController({
  projectId,
  currentFolderId,
  effectiveNodeId,
  syncEndpoints,
  scopes,
  connectorsByTarget,
  mutateRepo,
  refreshAgents,
  setEditorTarget,
  setIsEditorFullScreen,
  setHoverHighlightNodeId,
}: {
  projectId: string;
  currentFolderId: string | null;
  effectiveNodeId: string;
  syncEndpoints: ReadonlyMap<string, SyncEndpointLike>;
  scopes: RepositoryView[];
  connectorsByTarget: Map<string, Connector[]>;
  mutateRepo: () => Promise<unknown>;
  refreshAgents: () => Promise<unknown> | unknown;
  setEditorTarget: Dispatch<SetStateAction<EditorTarget | null>>;
  setIsEditorFullScreen: Dispatch<SetStateAction<boolean>>;
  setHoverHighlightNodeId: Dispatch<SetStateAction<string | null>>;
}) {
  const router = useRouter();
  const { panel: panelState, openPanel, closePanel } = usePanelStore();
  const [rightPanelWidth, setRightPanelWidth] = useState(450);
  const [accessPanelNavigationGuard, setAccessPanelNavigationGuard] =
    useState<AccessPanelNavigationGuard | null>(null);
  const [accessOverviewOpen, setAccessOverviewOpen] = useState(false);
  const [quickAccessTargetKey, setQuickAccessTargetKey] = useState<string | null>(null);
  const [quickAccessScopeFallback, setQuickAccessScopeFallback] = useState<RepositoryView | null>(null);
  const [createAccessInitialPath, setCreateAccessInitialPath] = useState<string | null>(null);
  const [syncCreateInitialPath, setSyncCreateInitialPath] = useState<string | null>(null);

  const activeSyncNodeId = panelState.type === 'sync_config' ? panelState.nodeId ?? null : null;
  const activeSyncId = activeSyncNodeId !== null
    ? (syncEndpoints.get(activeSyncNodeId)?.syncId ?? null)
    : null;

  const isAccessPanelOpen = panelState.type === 'access_list';
  const accessPanelScopePath = currentFolderId || '';
  const accessDrilledScope = isAccessPanelOpen && panelState.selectedTargetKey
    ? scopes.find((scope) => repositoryViewKey(scope) === panelState.selectedTargetKey) ?? null
    : null;
  const accessFolderScope = matchRepositoryViewForPath(accessPanelScopePath, scopes);
  const accessResolvedScope = accessDrilledScope ?? accessFolderScope;
  const accessListView: 'overview' | 'detail' | 'settings' =
    isAccessPanelOpen && panelState.view === 'settings' && accessResolvedScope
      ? 'settings'
      : isAccessPanelOpen && panelState.view === 'overview'
        ? 'overview'
        : accessResolvedScope
          ? 'detail'
          : 'overview';
  const accessHeaderScope =
    isAccessPanelOpen && (accessListView === 'detail' || accessListView === 'settings')
      ? accessResolvedScope
      : null;
  const accessHeaderTitle =
    accessListView === 'settings'
        ? 'Settings'
        : accessHeaderScope
          ? accessHeaderScope.name
          : 'Access';
  const accessHeaderSubtitle = undefined;
  const showAccessHeaderBack =
    isAccessPanelOpen &&
    (accessListView === 'detail' || accessListView === 'settings');

  const rootScope = useMemo(() => matchRepositoryViewForPath('', scopes), [scopes]);
  const rootGitRemoteUrl = useMemo(() => {
    if (!rootScope) return null;
    return canonicalProjectGitUrl(getApiBase(), projectId);
  }, [projectId, rootScope]);

  const quickAccessScope = useMemo(() => {
    if (!quickAccessTargetKey) return null;
    return scopes.find((scope) => repositoryViewKey(scope) === quickAccessTargetKey)
      ?? quickAccessScopeFallback;
  }, [quickAccessScopeFallback, quickAccessTargetKey, scopes]);
  const quickAccessConnectors = useMemo(
    () => quickAccessScope ? connectorsByTarget.get(repositoryViewKey(quickAccessScope)) ?? [] : [],
    [connectorsByTarget, quickAccessScope],
  );

  const refreshRepoAndAgents = useCallback(async () => {
    await mutateRepo();
    await refreshAgents();
  }, [mutateRepo, refreshAgents]);

  const closeRightPanel = useCallback(() => {
    if (accessPanelNavigationGuard && !accessPanelNavigationGuard.canLeave()) return;
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    closePanel();
  }, [accessPanelNavigationGuard, closePanel, setEditorTarget, setIsEditorFullScreen]);

  const handleAccessHeaderBack = useCallback(() => {
    if (accessPanelNavigationGuard && !accessPanelNavigationGuard.canLeave()) return;
    if (accessListView === 'settings' && accessHeaderScope) {
      openPanel({
        type: 'access_list',
        view: 'detail',
        selectedTargetKey: repositoryViewKey(accessHeaderScope),
      });
      return;
    }
    openPanel({ type: 'access_list', view: 'overview' });
  }, [accessHeaderScope, accessListView, accessPanelNavigationGuard, openPanel]);

  const openVersionHistoryPanel = useCallback(() => {
    if (!effectiveNodeId) return;
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    openPanel({ type: 'version_history', nodeId: effectiveNodeId });
  }, [effectiveNodeId, openPanel, setEditorTarget, setIsEditorFullScreen]);

  const openSyncCreatePanel = useCallback((targetScopePath?: string | null) => {
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    setSyncCreateInitialPath(normalizeAccessPath(targetScopePath ?? currentFolderId ?? ''));
  }, [currentFolderId, setEditorTarget, setIsEditorFullScreen]);

  const openCreateAccessModal = useCallback((folderPath: string | null | undefined) => {
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    setAccessOverviewOpen(false);
    setQuickAccessTargetKey(null);
    setQuickAccessScopeFallback(null);
    setCreateAccessInitialPath(normalizeAccessPath(folderPath));
  }, [setEditorTarget, setIsEditorFullScreen]);

  const openQuickAccessModal = useCallback((scope: RepositoryView) => {
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    setAccessOverviewOpen(false);
    setCreateAccessInitialPath(null);
    setQuickAccessScopeFallback(scope);
    setQuickAccessTargetKey(repositoryViewKey(scope));
  }, [setEditorTarget, setIsEditorFullScreen]);

  const openAccessOverviewModal = useCallback(() => {
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    setQuickAccessTargetKey(null);
    setQuickAccessScopeFallback(null);
    setCreateAccessInitialPath(null);
    setAccessOverviewOpen(true);
    if (panelState.type === 'access_list') closePanel();
  }, [closePanel, panelState.type, setEditorTarget, setIsEditorFullScreen]);

  const openRootGitRemotePanel = useCallback(() => {
    setEditorTarget(null);
    setIsEditorFullScreen(false);
    setHoverHighlightNodeId(null);

    if (rootScope) {
      openQuickAccessModal(rootScope);
    } else {
      openCreateAccessModal(null);
    }
  }, [
    openCreateAccessModal,
    openQuickAccessModal,
    rootScope,
    setEditorTarget,
    setHoverHighlightNodeId,
    setIsEditorFullScreen,
  ]);

  const openShareWithAI = useCallback((folderPath: string | null | undefined) => {
    const normalizedPath = normalizeAccessPath(folderPath);
    const existingScope = matchRepositoryViewForPath(normalizedPath, scopes);
    if (existingScope) {
      openQuickAccessModal(existingScope);
      return;
    }
    openCreateAccessModal(normalizedPath);
  }, [openCreateAccessModal, openQuickAccessModal, scopes]);

  const closeAccessOverviewModal = useCallback(() => {
    setAccessOverviewOpen(false);
  }, []);

  const closeQuickAccessModal = useCallback(() => {
    setQuickAccessTargetKey(null);
    setQuickAccessScopeFallback(null);
  }, []);

  const closeCreateAccessModal = useCallback(() => {
    setCreateAccessInitialPath(null);
  }, []);

  const closeSyncCreateModal = useCallback(() => {
    setSyncCreateInitialPath(null);
  }, []);

  const handleDataAccessCreated = useCallback(async (scope: RepositoryView) => {
    try {
      await refreshRepoAndAgents();
    } finally {
      setQuickAccessScopeFallback(scope);
      setQuickAccessTargetKey(repositoryViewKey(scope));
    }
  }, [refreshRepoAndAgents]);

  const openAccessFullSettings = useCallback((targetKey: string) => {
    closeQuickAccessModal();
    router.push(`/projects/${projectId}/access?target=${encodeURIComponent(targetKey)}`);
  }, [closeQuickAccessModal, projectId, router]);

  return {
    panelState,
    openPanel,
    closePanel,
    rightPanelWidth,
    setRightPanelWidth,
    setAccessPanelNavigationGuard,
    activeSyncNodeId,
    activeSyncId,
    isAccessPanelOpen,
    accessListView,
    accessHeaderScope,
    accessHeaderTitle,
    accessHeaderSubtitle,
    showAccessHeaderBack,
    rootGitRemoteUrl,
    accessOverviewOpen,
    quickAccessScope,
    quickAccessConnectors,
    createAccessInitialPath,
    syncCreateInitialPath,
    refreshRepoAndAgents,
    closeRightPanel,
    handleAccessHeaderBack,
    openVersionHistoryPanel,
    openSyncCreatePanel,
    openRootGitRemotePanel,
    openShareWithAI,
    openAccessOverviewModal,
    openQuickAccessModal,
    openCreateAccessModal,
    closeAccessOverviewModal,
    closeQuickAccessModal,
    closeCreateAccessModal,
    closeSyncCreateModal,
    handleDataAccessCreated,
    openAccessFullSettings,
  };
}
