import { useMemo } from 'react';
import type { Tool as DbTool, AccessPoint } from '@/lib/mcpApi';
import type { AccessOption } from '@/components/chat/ChatInputArea';

// NOTE: shell_access is NOT a Tool - it's managed via agent_bash table per Agent
const toolTypeLabels: Record<string, string> = {
  query_data: 'Query',
  search: 'Search',
  get_all_data: 'Get All',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  custom_script: 'Custom Script',
};

const allToolTypes = [
  'query_data',
  'search',
  'get_all_data',
  'create',
  'update',
  'delete',
  'custom_script',
] as const;

export function useAvailableTools(
  projectTools: DbTool[] | undefined,
  accessPoints: AccessPoint[],
  tableNameById: Record<string, string>
): AccessOption[] {
  return useMemo(() => {
    const availableTools: AccessOption[] = [];

    // Process real tools from projectTools
    // NOTE: shell_access is NOT stored here - it's in agent_bash per Agent
    if (projectTools && projectTools.length > 0) {
      for (const t of projectTools) {
        const type = (t.type || '').trim();
        // Skip any legacy shell_access entries (should be cleaned up in DB)
        if (type === 'shell_access' || type === 'shell_access_readonly') continue;
        
        const nid = t.node_id || null;
        const nodeName =
          nid && tableNameById?.[nid]
            ? tableNameById[nid]
            : nid
              ? `Node ${nid}`
              : 'Node';
        const scopePath = (t.json_path || '').trim() || 'root';
        const labelBase = toolTypeLabels[type] || type || 'tool';
        const label = `${nodeName} · ${labelBase} · ${scopePath}`;
        const optionId = `tool:${t.id}`;
        availableTools.push({
          id: optionId,
          label,
          type: 'tool' as const,
          tableId: nid ?? undefined,
          tableName: nodeName,
        });
      }
    } else {
      // Fallback to accessPoints (legacy)
      accessPoints.forEach(ap => {
        allToolTypes.forEach(toolType => {
          // @ts-ignore
          if (ap.permissions[toolType]) {
            availableTools.push({
              id: `${ap.id}-${toolType}`,
              label: toolTypeLabels[toolType] || toolType,
              type: 'tool' as const,
            });
          }
        });
      });
    }
    return availableTools;
  }, [projectTools, accessPoints, tableNameById]);
}


