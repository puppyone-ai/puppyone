import { useMemo } from 'react';
import { useConnectorSpecs } from '@/lib/hooks/useData';
import type { SyncStatusSync } from '../DataLayoutContext';
import type { SyncEndpointInfo } from '../components/explorer';
import { getEndpointEntries } from '../components/access-points/utils';
import type { EndpointNameMap, ProviderIconLookup } from '../components/access-points';

interface AgentNameSource {
  id: string;
  name: string;
}

export function useAccessPointEntries({
  nodeEndpointMap,
  savedAgents,
  tableNameById,
  syncStatusData,
}: {
  nodeEndpointMap: Map<string, SyncEndpointInfo[]>;
  savedAgents: readonly AgentNameSource[];
  tableNameById: Record<string, string>;
  syncStatusData: { syncs: SyncStatusSync[] } | undefined;
}) {
  const { specs: connectorSpecs } = useConnectorSpecs();

  const endpointNameMap = useMemo<EndpointNameMap>(() => {
    const agents: Record<string, string> = {};
    for (const agent of savedAgents) agents[agent.id] = agent.name;

    const nodes: Record<string, string> = { ...tableNameById };
    if (syncStatusData?.syncs) {
      for (const sync of syncStatusData.syncs) {
        if (sync.path && !nodes[sync.path] && sync.name) nodes[sync.path] = sync.name;
      }
    }

    const syncs: Record<string, string> = {};
    if (syncStatusData?.syncs) {
      for (const sync of syncStatusData.syncs) {
        const providerLabels: Record<string, string> = {
          filesystem: 'Local Sync',
          gmail: 'Gmail',
          google_calendar: 'Calendar',
          google_sheets: 'Sheets',
          google_drive: 'Drive',
          google_docs: 'Docs',
          github: 'GitHub',
          notion: 'Notion',
          linear: 'Linear',
          airtable: 'Airtable',
          mcp: 'MCP Server',
          sandbox: 'Sandbox',
        };
        syncs[sync.id] = sync.name || providerLabels[sync.provider] || sync.provider;
      }
    }

    return { agents, nodes, syncs };
  }, [savedAgents, tableNameById, syncStatusData]);

  const providerIcons = useMemo<ProviderIconLookup>(() => {
    const icons: ProviderIconLookup = {};
    for (const spec of connectorSpecs) {
      icons[spec.provider] = { icon: spec.icon, iconUrl: spec.icon_url };
    }
    return icons;
  }, [connectorSpecs]);

  const accessPointEntries = useMemo(
    () => getEndpointEntries(nodeEndpointMap, endpointNameMap),
    [nodeEndpointMap, endpointNameMap],
  );

  return { accessPointEntries, endpointNameMap, providerIcons };
}
