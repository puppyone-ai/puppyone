'use client';

import React from 'react';
import { getNodeTypeConfig } from '@/lib/nodeTypeConfig';
import { MarkdownEditor, type MarkdownViewMode } from '@/components/editors/markdown';
import { GithubRepoView } from '@/components/views/GithubRepoView';
import { ProjectWorkspaceView } from '@/components/ProjectWorkspaceView';
import type { EditorType } from '@/components/ProjectsHeader';
import type { McpToolPermissions } from '@/lib/mcpApi';

function FilePreview({ nodeName }: { nodeName: string }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16, color: '#71717a',
    }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <div style={{ fontSize: 16, fontWeight: 500 }}>{nodeName}</div>
      <div style={{ fontSize: 13 }}>Raw file stored in S3</div>
    </div>
  );
}

interface EditorAreaProps {
  activeNodeId: string;
  activeNodeType: string;
  activeProject: { id: string; name: string } & Record<string, any>;
  currentTableData: any;
  markdownContent: string;
  isLoadingMarkdown: boolean;
  markdownSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  markdownViewMode: MarkdownViewMode;
  handleMarkdownChange: (content: string) => void;
  setMarkdownViewMode: (mode: MarkdownViewMode) => void;
  editorType: EditorType;
  configuredAccessPoints: { path: string; permissions: any }[];
  onActiveTableChange: (id: string) => void;
  onAccessPointChange: (path: string, permissions: McpToolPermissions) => void;
  onAccessPointRemove: (path: string) => void;
  onOpenDocument: (path: string, value: string) => void;
  onCreateTool: (path: string, value: any) => void;
}

export function EditorArea({
  activeNodeId,
  activeNodeType,
  activeProject,
  currentTableData,
  markdownContent,
  isLoadingMarkdown,
  markdownSaveStatus,
  markdownViewMode,
  handleMarkdownChange,
  setMarkdownViewMode,
  editorType,
  configuredAccessPoints,
  onActiveTableChange,
  onAccessPointChange,
  onAccessPointRemove,
  onOpenDocument,
  onCreateTool,
}: EditorAreaProps) {
  const nodeConfig = getNodeTypeConfig(activeNodeType);

  if (nodeConfig.renderAs === 'markdown') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {isLoadingMarkdown ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#666' }}>
            <div style={{ textAlign: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 8px', animation: 'spin 1s linear infinite' }}>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
              <div>Loading markdown...</div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            {markdownSaveStatus !== 'idle' && (
              <div style={{
                position: 'absolute', top: 12, right: 12, zIndex: 30,
                background: markdownSaveStatus === 'error' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(0, 0, 0, 0.7)',
                color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: 6, backdropFilter: 'blur(8px)',
              }}>
                {markdownSaveStatus === 'saving' && (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    Saving...
                  </>
                )}
                {markdownSaveStatus === 'saved' && (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Saved
                  </>
                )}
                {markdownSaveStatus === 'error' && (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    Save failed
                  </>
                )}
              </div>
            )}
            <MarkdownEditor
              content={markdownContent}
              onChange={handleMarkdownChange}
              viewMode={markdownViewMode}
              onViewModeChange={setMarkdownViewMode}
            />
          </div>
        )}
      </div>
    );
  }

  if (activeNodeType === 'github') {
    return (
      <GithubRepoView
        nodeId={activeNodeId}
        nodeName={currentTableData?.name || ''}
        content={currentTableData?.content}
        syncUrl={currentTableData?.sync_url ?? undefined}
      />
    );
  }

  if (['file', 'image'].includes(nodeConfig.renderAs) && !currentTableData?.data && !markdownContent) {
    return <FilePreview nodeName={currentTableData?.name || ''} />;
  }

  return (
    <ProjectWorkspaceView
      projectId={activeProject.id}
      project={activeProject}
      activeTableId={activeNodeId}
      onActiveTableChange={onActiveTableChange}
      onTreePathChange={() => {}}
      editorType={editorType}
      configuredAccessPoints={configuredAccessPoints}
      onAccessPointChange={onAccessPointChange}
      onAccessPointRemove={onAccessPointRemove}
      onOpenDocument={onOpenDocument}
      onCreateTool={onCreateTool}
    />
  );
}
