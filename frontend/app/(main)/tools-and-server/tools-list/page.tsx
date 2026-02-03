'use client';

import { useRouter } from 'next/navigation';
import { LibraryView } from '../components/LibraryView';
import {
  useAllTools,
  useMcpInstances,
  refreshToolsAndMcp,
} from '@/lib/hooks/useData';
import { deleteTool, type McpV2Instance } from '@/lib/mcpApi';

export default function ToolsListPage() {
  const router = useRouter();

  // 使用 SWR hooks
  const {
    tools,
    isLoading: toolsLoading,
    refresh: refreshTools,
  } = useAllTools();
  const {
    instances,
    isLoading: instancesLoading,
    refresh: refreshInstances,
  } = useMcpInstances();

  const loading = toolsLoading || instancesLoading;

  const handleDeleteTool = async (toolId: string) => {
    if (!confirm('Delete this tool?')) return;
    try {
      await deleteTool(toolId);
      // 刷新 tools
      refreshToolsAndMcp();
    } catch (e) {
      console.error('Failed to delete tool', e);
      alert('Error deleting tool');
    }
  };

  const handleRefresh = () => {
    refreshTools();
    refreshInstances();
  };

  const handleMcpCreated = (newMcp: McpV2Instance) => {
    // 刷新实例列表并跳转到 Server 详情页
    refreshInstances();
    router.push(`/tools-and-server/servers/${newMcp.api_key}`);
  };

  const handleNavigateToTable = (tableId: number) => {
    // 这里需要根据 tableId 找到 projectId，暂时先跳到 projects 根目录或者需要更复杂的逻辑
    // 为了简单起见，我们先跳到 /projects
    // 理想情况下，我们应该通过 API 获取 table 所属的 project
    router.push('/projects');
  };

  if (loading) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#525252',
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <div style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      <LibraryView
        tools={tools}
        mcpInstances={instances}
        onDeleteTool={handleDeleteTool}
        onNavigateToTable={handleNavigateToTable}
        onRefresh={handleRefresh}
        onMcpCreated={handleMcpCreated}
      />
    </div>
  );
}
