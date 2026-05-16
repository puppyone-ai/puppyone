'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LibraryView } from '../components/LibraryView';
import {
  useAllTools,
  useMcpInstances,
  refreshToolsAndMcp,
} from '@/lib/hooks/useData';
import { deleteTool, type McpV2Instance } from '@/lib/mcpApi';
import { HeaderedPageLoadingShell } from '@/components/loading';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export default function ToolsListPage() {
  const router = useRouter();
  const [deleteToolId, setDeleteToolId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const handleDeleteTool = (toolId: string) => {
    setDeleteError(null);
    setDeleteToolId(toolId);
  };

  const confirmDeleteTool = async () => {
    if (!deleteToolId) return;
    setDeleteLoading(true);
    try {
      await deleteTool(deleteToolId);
      // 刷新 tools
      refreshToolsAndMcp();
      setDeleteToolId(null);
    } catch (e) {
      console.error('Failed to delete tool', e);
      setDeleteError('Error deleting tool');
    } finally {
      setDeleteLoading(false);
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

  const handleNavigateToTable = (_tableId: number) => {
    // This table-id-only callback does not have enough information to
    // build a project data URL. Fall back to the canonical workspace
    // home route instead of the redirect-only `/projects` route so the
    // shell and content never disagree during navigation.
    router.push('/home');
  };

  if (loading) {
    return (
      <HeaderedPageLoadingShell title="Tools List" />
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
      <ConfirmDialog
        open={deleteToolId !== null}
        title="Delete tool?"
        description={
          <div>
            <div>This removes the tool from the library.</div>
            {deleteError && (
              <div style={{ marginTop: 10, color: 'var(--po-danger)' }}>
                {deleteError}
              </div>
            )}
          </div>
        }
        confirmLabel="Delete"
        loading={deleteLoading}
        onCancel={() => {
          if (!deleteLoading) {
            setDeleteError(null);
            setDeleteToolId(null);
          }
        }}
        onConfirm={() => void confirmDeleteTool()}
      />
    </div>
  );
}
