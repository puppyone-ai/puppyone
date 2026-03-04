'use client';

import { use, useMemo } from 'react';
import useSWR from 'swr';
import { get } from '@/lib/apiClient';
import { useProjectTools } from '@/lib/hooks/useData';
import { useAgent } from '@/contexts/AgentContext';
import {
  DataLayoutContext,
  type SyncEndpointInfo,
  type SyncStatusSync,
} from './DataLayoutContext';

interface DataLayoutProps {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
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

  const nodeEndpointMap = useMemo(() => {
    const map = new Map<string, SyncEndpointInfo[]>();
    const append = (nodeId: string, endpoint: SyncEndpointInfo) => {
      const list = map.get(nodeId) || [];
      list.push(endpoint);
      map.set(nodeId, list);
    };

    if (syncStatusData?.syncs) {
      for (const s of syncStatusData.syncs) {
        if (s.node_id)
          append(s.node_id, {
            syncId: s.id,
            provider: s.provider,
            direction: s.direction,
            status: s.status,
          });
      }
    }

    for (const agent of savedAgents) {
      if (agent.type === 'chat' && agent.resources) {
        for (const r of agent.resources) {
          append(r.nodeId, {
            syncId: agent.id,
            provider: `agent:${agent.type}`,
            direction: 'bidirectional',
            status: 'active',
          });
        }
      }
    }

    return map;
  }, [syncStatusData, savedAgents]);

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
