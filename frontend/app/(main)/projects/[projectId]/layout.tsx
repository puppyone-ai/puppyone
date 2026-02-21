'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import { usePathname } from 'next/navigation';
import { AgentProvider, useAgent } from '@/contexts/AgentContext';
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext';
import { AgentViewport } from '@/components/agent/AgentViewport';
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

const HEADER_HEIGHT = 48;

function ProjectLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { sidebarMode } = useAgent();
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  const isDataPage = pathname?.endsWith('/data') || pathname?.includes('/data/');
  const hideAgentSidebar = !isDataPage;
  const sidebarOpen = !hideAgentSidebar && sidebarMode !== 'closed';

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
    <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#0f0f0f' }}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid #2a2a2a',
          background: '#0e0e0e',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Children (header + content) — full width, with CSS variable for sidebar offset */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            '--sidebar-offset': sidebarOpen ? `${chatWidth}px` : '0px',
          } as React.CSSProperties}
        >
          {children}
        </div>

        {/* Sidebar — absolutely positioned below header, doesn't affect header width */}
        {!hideAgentSidebar && (
          <div
            style={{
              position: 'absolute',
              top: HEADER_HEIGHT,
              right: 0,
              bottom: 0,
              width: sidebarOpen ? chatWidth : 0,
              zIndex: 50,
              display: 'flex',
              overflow: 'hidden',
              transition: 'width 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <ResizeHandle isResizing={isResizing} onMouseDown={handleMouseDown} />
            <AgentViewportWrapper chatWidth={chatWidth} />
          </div>
        )}
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
