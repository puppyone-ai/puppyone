'use client';

import React, { useEffect, useState } from 'react';
import { getNodeTypeConfig } from '@/lib/nodeTypeConfig';
import { fetchRawBlob } from '@/lib/contentTreeApi';
import { MarkdownEditor, type MarkdownViewMode } from '@/components/editors/markdown';
import dynamic from 'next/dynamic';

// Loaded on demand — only when user opens a GitHub-connected node
const GithubRepoView = dynamic(
  () => import('@/components/views/GithubRepoView').then(m => ({ default: m.GithubRepoView })),
  { ssr: false }
);

// ProjectWorkspaceView already uses dynamic imports internally for Monaco/Table editors
import { ProjectWorkspaceView } from '@/components/ProjectWorkspaceView';
import type { EditorType } from '@/components/ProjectsHeader';
import type { McpToolPermissions } from '@/lib/mcpApi';

function FilePlaceholder({ nodeName }: { nodeName: string }) {
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

function ImagePreview({ projectId, filePath, nodeName }: { projectId: string; filePath: string; nodeName: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let url: string | null = null;

    fetchRawBlob(projectId, filePath)
      .then(blob => {
        if (revoked) return;
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch(err => {
        if (revoked) return;
        setError(err.message);
      });

    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [projectId, filePath]);

  if (error) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
        Failed to load image: {error}
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717a' }}>
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="28" strokeDashoffset="8" />
        </svg>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', overflow: 'auto', padding: 24, background: '#0a0a0a',
    }}>
      <div style={{ fontSize: 13, color: '#71717a', marginBottom: 12 }}>{nodeName}</div>
      <img
        src={blobUrl}
        alt={nodeName}
        style={{ maxWidth: '100%', maxHeight: 'calc(100% - 40px)', objectFit: 'contain', borderRadius: 8 }}
      />
    </div>
  );
}

function TextPreview({ content, nodeName }: { content: string; nodeName: string }) {
  const ext = nodeName.split('.').pop()?.toLowerCase() || '';
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{
        padding: '8px 16px', borderBottom: '1px solid #262626', fontSize: 12,
        color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontWeight: 500 }}>{nodeName}</span>
        {ext && <span style={{ color: '#525252' }}>{ext.toUpperCase()}</span>}
      </div>
      <pre style={{
        flex: 1, margin: 0, padding: 16, overflow: 'auto',
        fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace',
        fontSize: 13, lineHeight: 1.6, color: '#d4d4d8', background: '#0a0a0a',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', tabSize: 4,
      }}>
        {content}
      </pre>
    </div>
  );
}

interface EditorAreaProps {
  activeNodeId: string;
  activeNodeType: string;
  activeMimeType: string | null;
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
  activeMimeType,
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#525252' }}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="28" strokeDashoffset="8" />
            </svg>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
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

  if (['file', 'image'].includes(nodeConfig.renderAs) && !currentTableData?.data) {
    const nodeName = currentTableData?.name || '';
    const isImage = activeMimeType?.startsWith('image/');
    const isText = activeMimeType?.startsWith('text/') || activeMimeType === 'application/javascript' || activeMimeType === 'application/typescript';

    if (isImage) {
      return <ImagePreview projectId={activeProject.id} filePath={activeNodeId} nodeName={nodeName} />;
    }

    if (isText && markdownContent) {
      return <TextPreview content={markdownContent} nodeName={nodeName} />;
    }

    if (isText && isLoadingMarkdown) {
      return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252' }}>
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="28" strokeDashoffset="8" />
          </svg>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      );
    }

    return <FilePlaceholder nodeName={nodeName} />;
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
