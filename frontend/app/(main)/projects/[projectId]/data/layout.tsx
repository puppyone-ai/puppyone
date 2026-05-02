'use client';

import { use, useMemo } from 'react';
import useSWR from 'swr';
import { get } from '@/lib/apiClient';
import { useProjectTools } from '@/lib/hooks/useData';
import { useAgent } from '@/contexts/AgentContext';
import { listMcpEndpoints } from '@/lib/mcpEndpointsApi';
import { listSandboxEndpoints } from '@/lib/sandboxEndpointsApi';
import {
  DataLayoutContext,
  type SyncEndpointInfo,
  type SyncStatusSync,
} from './DataLayoutContext';

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
  }, [syncStatusData, savedAgents, mcpEndpoints, sandboxEndpoints]);

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
    }),
    [syncStatusData, mutateSyncStatus, projectTools, syncEndpoints, nodeEndpointMap],
  );

  return (
    <DataLayoutContext.Provider value={contextValue}>
      {children}
    </DataLayoutContext.Provider>
  );
}
