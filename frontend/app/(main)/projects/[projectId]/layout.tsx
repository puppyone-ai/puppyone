'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import { usePathname } from 'next/navigation';
import { AgentProvider, useAgent } from '@/contexts/AgentContext';
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext';
import { AgentViewport } from '@/components/agent/AgentViewport';
import { AccessDock } from '@/components/agent/AccessDock';
import { useProjectTools } from '@/lib/hooks/useData';

const MIN_CHAT_WIDTH = 400;
const MAX_CHAT_WIDTH = 600;
const DEFAULT_CHAT_WIDTH = 400;

/**
 * Project Layout
 *
 * Provides a consistent container styling for all project sub-pages (data, tools, settings).
 * 
 * Scheme C (Context Widget):
 * - No Right Rail.
 * - Single large container for content.
 * - Agents will be mounted in the Header area of the content.
 * 
 * AgentViewport is rendered here (in layout) so it persists across route changes
 * and doesn't re-render when navigating between folders/files.
 */

// Inner component that uses WorkspaceContext
function AgentViewportWrapper({ chatWidth }: { chatWidth: number }) {
  const { tableData, tableId, projectId, accessPoints, onDataUpdate, tableNameById } = useWorkspace();
  const { tools: projectTools } = useProjectTools(projectId || '');

  return (
    <AgentViewport
      chatWidth={chatWidth}
      tableData={tableData}
      tableId={tableId}
      projectId={projectId}
      onDataUpdate={onDataUpdate ? async () => { await onDataUpdate(); } : undefined}
      accessPoints={accessPoints}
      projectTools={projectTools}
      tableNameById={tableNameById}
    />
  );
}

// Resize handle component
function ResizeHandle({ 
  isResizing, 
  onMouseDown 
}: { 
  isResizing: boolean; 
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const { sidebarMode } = useAgent();
  
  if (sidebarMode === 'closed') return null;
  
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'relative',
        width: 8,
        height: '100%',
        cursor: 'col-resize',
        zIndex: 60,
        background: isResizing ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
        marginLeft: -4,
        marginRight: -4,
      }}
      onMouseEnter={e => {
        if (!isResizing) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
      }}
      onMouseLeave={e => {
        if (!isResizing) e.currentTarget.style.background = 'transparent';
      }}
    />
  );
}

function ProjectLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  
  // Hide Agent sidebar on non-context pages
  // Agent sidebar only makes sense on /data (Context) page where users interact with content
  const isDataPage = pathname?.endsWith('/data') || pathname?.includes('/data/');
  const hideAgentSidebar = !isDataPage;
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const windowWidth = window.innerWidth;
      const newWidth = windowWidth - e.clientX;
      const clampedWidth = Math.min(Math.max(newWidth, MIN_CHAT_WIDTH), MAX_CHAT_WIDTH);
      setChatWidth(clampedWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        backgroundColor: '#0f0f0f',
      }}
    >
      {/* Main Content Container */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          margin: 0,
          borderRadius: 0,
          border: 'none',
          borderLeft: '1px solid #2a2a2a', 
          background: '#0e0e0e',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Access Dock - horizontal bar above content (only on data pages) */}
        {!hideAgentSidebar && <AccessDock />}

        {/* Page Content row */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {children}
          </div>
          
          {/* Chat Sidebar - only visible when a chat agent is selected */}
          {!hideAgentSidebar && (
            <>
              <ResizeHandle isResizing={isResizing} onMouseDown={handleMouseDown} />
              <AgentViewportWrapper chatWidth={chatWidth} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface ProjectLayoutProps {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}

export default function ProjectLayout({
  children,
  params,
}: ProjectLayoutProps) {
  const { projectId } = use(params);
  
  return (
    <AgentProvider projectId={projectId}>
      <WorkspaceProvider>
        <ProjectLayoutInner>{children}</ProjectLayoutInner>
      </WorkspaceProvider>
    </AgentProvider>
  );
}
