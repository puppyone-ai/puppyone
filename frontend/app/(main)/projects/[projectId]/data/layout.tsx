'use client';

import { use, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { get } from '@/lib/apiClient';
import { useProjectTools, refreshFolderNodes } from '@/lib/hooks/useData';
import { useAgent } from '@/contexts/AgentContext';
import { useCommitUpdates } from '@/contexts/MutWebSocketContext';
import { listMcpEndpoints } from '@/lib/mcpEndpointsApi';
import { listSandboxEndpoints } from '@/lib/sandboxEndpointsApi';
import { listScopes, listConnectors, getRepoIdentity, type Connector } from '@/lib/repoApi';
import {
  DataLayoutContext,
  type SyncEndpointInfo,
  type SyncStatusSync,
} from './DataLayoutContext';

/** Combine a scope-relative path with the scope path to get a
 *  project-root-relative path. Empty scope = root scope. */
function _toRootRelative(scope: string, scopeRelativePath: string): string {
  const file = scopeRelativePath.replaceAll(/^\/+|\/+$/g, '');
  if (!scope) return file;
  return file ? `${scope}/${file}` : scope;
}

/** Parent folder of a root-relative path (root = empty string). */
function _parentFolder(rootRelativePath: string): string {
  const idx = rootRelativePath.lastIndexOf('/');
  return idx >= 0 ? rootRelativePath.slice(0, idx) : '';
}

interface DataLayoutProps {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}

function normalizeEndpointPath(path: string | null | undefined): string {
  if (!path || path === '/') return '';
  return path.replace(/^\/+|\/+$/g, '');
}

export default function DataLayout({ children, params }: DataLayoutProps) {
  const { projectId } = use(params);

  const { savedAgents } = useAgent();
  const { tools: projectTools } = useProjectTools(projectId);

  // Auto-refresh affected folder listings when *any* client (sandbox,
  // agent, GitHub webhook, another browser tab) lands a commit. Replaces
  // the manual "user must refocus the tab" revalidation flow and closes
  // the §六 "侧栏永不刷新" bug class once and for all.
  //
  // ``changed_files`` is scope-relative; we lift each path back to
  // project-root, take its parent folder, dedupe, and revalidate only
  // those folders' SWR caches via the existing ``refreshFolderNodes``
  // helper (which also revalidates ``__shallow_1`` for the sidebar).
  const onCommitUpdate = useCallback((event: { scope: string; changed_files: string[] }) => {
    const folders = new Set<string>();
    for (const rel of event.changed_files || []) {
      const root = _toRootRelative(event.scope || '', rel);
      folders.add(_parentFolder(root));
    }
    if (folders.size === 0) {
      // Commit had no path-bearing changes (e.g. metadata-only). Refresh
      // the root sidebar anyway so the user's view of HEAD stays fresh.
      folders.add('');
    }
    void refreshFolderNodes(projectId, ...folders);
  }, [projectId]);
  useCommitUpdates(onCommitUpdate);

  const { data: syncStatusData, mutate: mutateSyncStatus } = useSWR<{
    syncs: SyncStatusSync[];
  }>(
    projectId ? ['sync-status', projectId] : null,
    () => get(`/api/v1/sync/status?project_id=${projectId}`),
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  );
  const { data: mcpEndpoints } = useSWR(
    projectId ? ['mcp-endpoints', projectId] : null,
    () => listMcpEndpoints(projectId),
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  );
  const { data: sandboxEndpoints } = useSWR(
    projectId ? ['sandbox-endpoints', projectId] : null,
    () => listSandboxEndpoints(projectId),
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  );

  // Redesign (2026-05-02): scopes + connectors via the new repo endpoints.
  const { data: scopes, mutate: mutateScopes } = useSWR(
    projectId ? ['repo-scopes', projectId] : null,
    () => listScopes(projectId),
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  );
  const { data: connectorsList, mutate: mutateConnectors } = useSWR(
    projectId ? ['repo-connectors', projectId] : null,
    () => listConnectors(projectId),
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  );
  const { data: repoIdentity, mutate: mutateIdentity } = useSWR(
    projectId ? ['repo-identity', projectId] : null,
    () => getRepoIdentity(projectId),
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  );

  const connectorsByScope = useMemo(() => {
    const m = new Map<string, Connector[]>();
    for (const c of connectorsList || []) {
      const list = m.get(c.scope_id) || [];
      list.push(c);
      m.set(c.scope_id, list);
    }
    return m;
  }, [connectorsList]);

  const mutateRepo = async () => {
    await Promise.all([mutateScopes(), mutateConnectors(), mutateIdentity()]);
  };

  const nodeEndpointMap = useMemo(() => {
    const map = new Map<string, SyncEndpointInfo[]>();
    const append = (rawNodeId: string | null | undefined, endpoint: SyncEndpointInfo) => {
      const nodeId = normalizeEndpointPath(rawNodeId);
      const list = map.get(nodeId) || [];
      if (list.some((item) => item.syncId === endpoint.syncId && item.provider === endpoint.provider)) return;
      list.push(endpoint);
      map.set(nodeId, list);
    };

    if (syncStatusData?.syncs) {
      for (const s of syncStatusData.syncs) {
        append(s.path, {
          syncId: s.id,
          provider: s.provider,
          direction: s.direction,
          status: s.status,
          name: s.name,
          accessKey: s.access_key,
        });
      }
    }

    // Redesign 2026-05-02: project the new connectors+scopes data into the
    // legacy SyncEndpointInfo shape so the existing per-row plug button
    // and AP-list affordances light up post-migration. cli connectors map
    // to `filesystem` (matching the boss-era
    // provider taxonomy that AccessPointProviderIcon / setup-snippet code
    // branches on); the access_key for cli is the *scope's* access_key,
    // not the connector's. agent connectors are skipped here because the
    // savedAgents loop below already populates them from AgentContext.
    const scopeById = new Map((scopes || []).map((s) => [s.id, s]));
    for (const c of connectorsList || []) {
      if (c.provider === 'agent') continue;
      const scope = scopeById.get(c.scope_id);
      if (!scope) continue;
      append(scope.path, {
        syncId: c.id,
        provider: c.provider === 'cli' ? 'filesystem' : c.provider,
        direction: c.direction,
        status: c.status,
        name: c.name || scope.name,
        accessKey: scope.access_key ?? null,
      });
    }

    for (const agent of savedAgents) {
      if (agent.type === 'chat' && agent.resources) {
        for (const r of agent.resources) {
          append(r.path, {
            syncId: agent.id,
            provider: `agent:${agent.type}`,
            direction: 'bidirectional',
            status: 'active',
            name: agent.name,
            accessKey: agent.mcp_api_key,
          });
        }
      }
    }

    for (const endpoint of mcpEndpoints || []) {
      const info: SyncEndpointInfo = {
        syncId: endpoint.id,
        provider: 'mcp',
        direction: 'bidirectional',
        status: endpoint.status,
        name: endpoint.name,
        accessKey: endpoint.api_key,
      };
      append(endpoint.path, info);
      for (const access of endpoint.accesses || []) {
        append(access.path, info);
      }
    }

    for (const endpoint of sandboxEndpoints || []) {
      const info: SyncEndpointInfo = {
        syncId: endpoint.id,
        provider: 'sandbox',
        direction: 'bidirectional',
        status: endpoint.status,
        name: endpoint.name,
        accessKey: endpoint.access_key,
      };
      append(endpoint.path, info);
      for (const mount of endpoint.mounts || []) {
        append(mount.path, info);
      }
    }

    return map;
  }, [syncStatusData, savedAgents, mcpEndpoints, sandboxEndpoints, scopes, connectorsList]);

  const syncEndpoints = useMemo(() => {
    const pickPriority = (provider: string): number => {
      if (provider.startsWith('agent:')) return 1;
      if (provider === 'mcp') return 2;
      if (provider === 'sandbox') return 3;
      return 4;
    };

    const map = new Map<string, SyncEndpointInfo>();
    for (const [nodeId, endpoints] of nodeEndpointMap.entries()) {
      const selected = [...endpoints].sort(
        (a, b) => pickPriority(a.provider) - pickPriority(b.provider),
      )[0];
      if (selected) map.set(nodeId, selected);
    }
    return map;
  }, [nodeEndpointMap]);

  const contextValue = useMemo(
    () => ({
      syncStatusData,
      mutateSyncStatus,
      projectTools,
      syncEndpoints,
      nodeEndpointMap,
      scopes: scopes || [],
      connectorsByScope,
      repoIdentity,
      mutateRepo,
    }),
    [
      syncStatusData,
      mutateSyncStatus,
      projectTools,
      syncEndpoints,
      nodeEndpointMap,
      scopes,
      connectorsByScope,
      repoIdentity,
      mutateRepo,
    ],
  );

  return (
    <DataLayoutContext.Provider value={contextValue}>
      {children}
    </DataLayoutContext.Provider>
  );
}
