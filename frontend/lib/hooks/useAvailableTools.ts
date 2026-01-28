import { useMemo } from 'react';
import type { Tool as DbTool } from '@/lib/mcpApi';
import type { AccessOption } from '@/components/chat/ChatInputArea';
import type { AccessPoint } from '@/app/(main)/projects/[projectId]/data/[[...path]]/page';

const toolTypeLabels: Record<string, string> = {
  query_data: 'Query',
  search: 'Search',
  get_all_data: 'Get All',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  shell_access: 'Bash',
  shell_access_readonly: 'Bash (Read-only)',
};

const allToolTypes = [
  'shell_access',
  'shell_access_readonly',
  'query_data',
  'search',
  'get_all_data',
  'create',
  'update',
  'delete',
] as const;

export function useAvailableTools(
  projectTools: DbTool[] | undefined,
  accessPoints: AccessPoint[],
  tableNameById: Record<string, string>
): AccessOption[] {
  return useMemo(() => {
    const availableTools: AccessOption[] = [];
    const optionIdToTool = new Map<string, DbTool>();

    if (projectTools && projectTools.length > 0) {
      for (const t of projectTools) {
        const type = (t.type || '').trim();
        const isBash = type === 'shell_access' || type === 'shell_access_readonly';
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
          type: isBash ? ('bash' as const) : ('tool' as const),
          tableId: nid ?? undefined,
          tableName: nodeName,
        });
        optionIdToTool.set(optionId, t);
      }
    } else {
      accessPoints.forEach(ap => {
        allToolTypes.forEach(toolType => {
          // @ts-ignore
          if (ap.permissions[toolType]) {
            availableTools.push({
              id: `${ap.id}-${toolType}`,
              label: toolTypeLabels[toolType] || toolType,
              type:
                toolType === 'shell_access' || toolType === 'shell_access_readonly'
                  ? ('bash' as const)
                  : ('tool' as const),
            });
          }
        });
      });
    }
    return availableTools;
  }, [projectTools, accessPoints, tableNameById]);
}

