'use client';

import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { ResizablePanel } from '@/components/RightAuxiliaryPanel/ResizablePanel';
import { DocumentEditor } from '@/components/RightAuxiliaryPanel/DocumentEditor';
import { getMcpEndpoint, type McpEndpoint } from '@/lib/mcpEndpointsApi';
import { getSandboxEndpoint, type SandboxEndpoint } from '@/lib/sandboxEndpointsApi';
import type { AccessOption } from '@/components/chat/ChatInputArea';
import type { SavedAgent } from '@/components/AgentRail';
import type { Tool } from '@/lib/mcpApi';
import type { TableData } from '@/lib/projectsApi';
import { PanelShell } from '../PanelShell';
import { AccessPointsListPanel, endpointToPanelState, type EndpointEntry, type ProviderIconLookup } from '../access-points';
import type { SyncStatusSync } from '../../DataLayoutContext';
import type { PanelState } from '../../usePanelStore';

const PanelLoading = () => (
  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252', fontSize: 13 }}>
    Loading...
  </div>
);

const VersionHistoryPanel = dynamic(
  () => import('@/components/editors/VersionHistoryPanel').then(m => ({ default: m.VersionHistoryPanel })),
  { ssr: false, loading: PanelLoading },
);
const SyncConfigPanel = dynamic(
  () => import('../SyncConfigPanel').then(m => ({ default: m.SyncConfigPanel })),
  { ssr: false, loading: PanelLoading },
);
const McpConfigPanel = dynamic(
  () => import('../McpConfigPanel').then(m => ({ default: m.McpConfigPanel })),
  { ssr: false, loading: PanelLoading },
);
const SandboxConfigPanel = dynamic(
  () => import('../SandboxConfigPanel').then(m => ({ default: m.SandboxConfigPanel })),
  { ssr: false, loading: PanelLoading },
);
const ChatRuntimeView = dynamic(
  () => import('@/components/agent/views/ChatRuntimeView').then(m => ({ default: m.ChatRuntimeView })),
  { ssr: false, loading: PanelLoading },
);

export interface EditorTarget {
  path: string;
  value: string;
}

interface DataPageRightPanelProps {
  editorTarget: EditorTarget | null;
  isEditorFullScreen: boolean;
  panelState: PanelState;
  projectId: string;
  activeNodeId?: string;
  activeSyncId: string | null;
  currentTableData?: TableData;
  syncStatusData: { syncs: SyncStatusSync[] } | undefined;
  projectTools: Tool[];
  savedAgents: SavedAgent[];
  accessPointEntries: EndpointEntry[];
  providerIcons: ProviderIconLookup;
  onClose: () => void;
  onEditorClose: () => void;
  onEditorSave: (newValue: string) => void;
  onToggleEditorFullScreen: () => void;
  onRollbackComplete: () => void;
  onSyncCreated: (nodeId: string) => void | Promise<void>;
  onAccessPointHover: (nodeId: string | null) => void;
  onOpenPanel: (panel: PanelState) => void;
  onOpenSyncSetting: (
    syncId: string,
    resource: { path: string; nodeName: string; nodeType: 'folder'; readonly: boolean },
  ) => void;
  onDataUpdate: () => Promise<void>;
}

export function DataPageRightPanel({
  editorTarget,
  isEditorFullScreen,
  panelState,
  projectId,
  activeNodeId,
  activeSyncId,
  currentTableData,
  syncStatusData,
  projectTools,
  savedAgents,
  accessPointEntries,
  providerIcons,
  onClose,
  onEditorClose,
  onEditorSave,
  onToggleEditorFullScreen,
  onRollbackComplete,
  onSyncCreated,
  onAccessPointHover,
  onOpenPanel,
  onOpenSyncSetting,
  onDataUpdate,
}: DataPageRightPanelProps) {
  const panelMcpId = panelState.type === 'mcp_config' ? panelState.mcpEndpointId : undefined;
  const { data: mcpEndpointDetail } = useSWR<McpEndpoint>(
    panelMcpId ? ['mcp-endpoint-detail', panelMcpId] : null,
    () => getMcpEndpoint(panelMcpId!),
    { revalidateOnFocus: false },
  );

  const panelSandboxId = panelState.type === 'sandbox_config' ? panelState.sandboxEndpointId : undefined;
  const { data: sandboxEndpointDetail } = useSWR<SandboxEndpoint>(
    panelSandboxId ? ['sandbox-endpoint-detail', panelSandboxId] : null,
    () => getSandboxEndpoint(panelSandboxId!),
    { revalidateOnFocus: false },
  );
  const backToAccessList = () => onOpenPanel({ type: 'access_list' });

  return (
    <ResizablePanel isVisible={!!editorTarget || panelState.type !== 'none'}>
      {editorTarget && (
        <DocumentEditor
          path={editorTarget.path}
          value={editorTarget.value}
          onSave={onEditorSave}
          onClose={onEditorClose}
          isFullScreen={isEditorFullScreen}
          onToggleFullScreen={onToggleEditorFullScreen}
        />
      )}

      {!editorTarget && panelState.type === 'version_history' && panelState.nodeId && (
        <VersionHistoryPanel
          nodeId={panelState.nodeId}
          projectId={projectId}
          onClose={onClose}
          onRollbackComplete={onRollbackComplete}
        />
      )}

      {!editorTarget && panelState.type === 'sync_config' && activeSyncId && (
        <SyncConfigPanel
          mode="detail"
          syncId={activeSyncId}
          projectId={projectId}
          onClose={onClose}
          onBack={backToAccessList}
        />
      )}

      {!editorTarget && panelState.type === 'sync_config' && !activeSyncId && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
          {!syncStatusData ? (
            <span style={{ color: '#71717a', fontSize: 13 }}>Loading...</span>
          ) : (
            <>
              <span style={{ color: '#525252', fontSize: 13 }}>No access configured</span>
              <button
                onClick={() => {
                  const nodeId = panelState.nodeId;
                  if (nodeId) {
                    onOpenSyncSetting('_generic', { path: nodeId, nodeName: '', nodeType: 'folder', readonly: true });
                  }
                  onOpenPanel({ type: 'sync_create' });
                }}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 500,
                  background: '#242424', border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6, color: '#e4e4e7', cursor: 'pointer',
                }}
              >
                + New Access
              </button>
            </>
          )}
        </div>
      )}

      {!editorTarget && panelState.type === 'sync_create' && (
        <SyncConfigPanel
          mode="create"
          syncId={null}
          projectId={projectId}
          onClose={onClose}
          onSyncCreated={onSyncCreated}
        />
      )}

      {!editorTarget && panelState.type === 'access_list' && (
        <AccessPointsListPanel
          entries={accessPointEntries}
          providerIcons={providerIcons}
          expandedEndpointId={panelState.accessEndpointId ?? null}
          onClose={onClose}
          onEndpointHover={onAccessPointHover}
          onEndpointClick={(ep, nodeId) => {
            onAccessPointHover(null);
            onOpenPanel(endpointToPanelState(ep, nodeId));
          }}
        />
      )}

      {!editorTarget && panelState.type === 'mcp_config' && panelState.mcpEndpointId && (
        <McpConfigPanel endpoint={mcpEndpointDetail} onClose={onClose} onBack={backToAccessList} />
      )}

      {!editorTarget && panelState.type === 'sandbox_config' && panelState.sandboxEndpointId && (
        <SandboxConfigPanel endpoint={sandboxEndpointDetail} onClose={onClose} onBack={backToAccessList} />
      )}

      {panelState.type === 'agent_chat' && (() => {
        const agentId = panelState.agentId;
        const chatAgent = agentId ? savedAgents.find(agent => agent.id === agentId) : null;
        if (!chatAgent) {
          return !editorTarget ? (
            <PanelShell title="Chat Agent" onClose={onClose} onBack={backToAccessList}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252', fontSize: 13 }}>Agent not found</div>
            </PanelShell>
          ) : null;
        }

        const tools: AccessOption[] = [];
        if (chatAgent.resources) {
          for (const res of chatAgent.resources) {
            tools.push({
              id: `bash:${res.path}`,
              label: `${res.nodeName || res.path} · Bash${res.readonly ? ' (Read-only)' : ''}`,
              type: 'bash' as const,
              tableId: res.path,
              tableName: res.nodeName || res.path,
            });
          }
        }

        return (
          <div style={{ display: editorTarget ? 'none' : 'contents' }}>
            <ChatRuntimeView
              availableTools={tools}
              tableData={currentTableData?.data}
              tableId={activeNodeId}
              projectId={projectId}
              onDataUpdate={onDataUpdate}
              projectTools={projectTools}
              onClose={onClose}
              onBack={backToAccessList}
            />
          </div>
        );
      })()}
    </ResizablePanel>
  );
}
