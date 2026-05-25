'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ServerView } from '../../components/ServerView';
import {
  useAllTools,
  useMcpInstances,
  refreshToolsAndMcp,
} from '@/lib/hooks/useData';
import { deleteMcpV2 } from '@/lib/mcpApi';
import { HeaderedPageLoadingShell } from '@/components/loading';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export default function ServerDetailPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = use(params);
  const router = useRouter();
  const [deleteTargetApiKey, setDeleteTargetApiKey] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
  const server = instances.find(m => m.api_key === serverId);

  // 如果找不到 server 且加载完毕，跳回 Library
  useEffect(() => {
    if (!loading && !server) {
      router.replace('/tools-and-server/tools-list');
    }
  }, [loading, server, router]);

  const handleDeleteServer = (apiKey: string) => {
    setDeleteError(null);
    setDeleteTargetApiKey(apiKey);
  };

  const confirmDeleteServer = async () => {
    if (!deleteTargetApiKey) return;
    setDeleteLoading(true);
    try {
      await deleteMcpV2(deleteTargetApiKey);
      refreshInstances();
      setDeleteTargetApiKey(null);
      router.push('/tools-and-server/tools-list');
    } catch (e) {
      console.error('Failed to delete MCP', e);
      setDeleteError('Error deleting MCP instance');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleRefresh = () => {
    refreshTools();
    refreshInstances();
  };

  if (loading) {
    return (
      <HeaderedPageLoadingShell />
    );
  }

  if (!server) return null;

  return (
    <div style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      <ServerView
        server={server}
        allTools={tools}
        onDeleteServer={handleDeleteServer}
        onRefresh={handleRefresh}
      />
      <ConfirmDialog
        open={deleteTargetApiKey !== null}
        title="Delete server?"
        description={
          <div>
            <div>This removes the MCP server and its tool bindings from this workspace.</div>
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
            setDeleteTargetApiKey(null);
          }
        }}
        onConfirm={() => void confirmDeleteServer()}
      />
    </div>
  );
}
