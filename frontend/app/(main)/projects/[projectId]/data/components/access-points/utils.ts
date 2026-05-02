import type { PanelState } from '../../usePanelStore';
import type { SyncEndpointInfo } from '../explorer';
import type { EndpointEntry, EndpointNameMap } from './types';

export function endpointToPanelState(ep: SyncEndpointInfo, nodeId: string): PanelState {
  if (ep.provider.startsWith('agent:')) return { type: 'agent_chat', nodeId, agentId: ep.syncId };
  if (ep.provider === 'mcp') return { type: 'mcp_config', nodeId, mcpEndpointId: ep.syncId };
  if (ep.provider === 'sandbox') return { type: 'sandbox_config', nodeId, sandboxEndpointId: ep.syncId };
  return { type: 'sync_config', nodeId };
}

export function getEndpointEntries(
  nodeEndpointMap: Map<string, SyncEndpointInfo[]>,
  nameMap: EndpointNameMap,
): EndpointEntry[] {
  const map = new Map<string, EndpointEntry>();
  for (const [nodeId, eps] of nodeEndpointMap.entries()) {
    for (const ep of eps) {
      if (!map.has(ep.syncId)) {
        const isAgent = ep.provider.startsWith('agent:');
        const name = isAgent
          ? (ep.name || nameMap.agents[ep.syncId] || 'Agent')
          : (ep.name || nameMap.syncs[ep.syncId] || ep.provider);
        const nodeName = nameMap.nodes[nodeId] || (nodeId ? nodeId : 'Root');
        map.set(ep.syncId, { ep, nodeId, name, nodeName });
      }
    }
  }
  return Array.from(map.values());
}

