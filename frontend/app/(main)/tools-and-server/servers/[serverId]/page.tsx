'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ServerView } from '../../components/ServerView';
import {
  useAllTools,
  useMcpInstances,
  refreshToolsAndMcp,
} from '@/lib/hooks/useData';
import { deleteMcpV2 } from '@/lib/mcpApi';

export default function ServerDetailPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = use(params);
  const router = useRouter();

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

  const handleDeleteServer = async (apiKey: string) => {
    if (!confirm('Delete this MCP instance?')) return;
    try {
      await deleteMcpV2(apiKey);
      refreshInstances();
      router.push('/tools-and-server/tools-list');
    } catch (e) {
      console.error('Failed to delete MCP', e);
      alert('Error deleting MCP instance');
    }
  };

  const handleRefresh = () => {
    refreshTools();
    refreshInstances();
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

  if (!server) return null;

  return (
    <div style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      <ServerView
        server={server}
        allTools={tools}
        onDeleteServer={handleDeleteServer}
        onRefresh={handleRefresh}
      />
    </div>
  );
}
