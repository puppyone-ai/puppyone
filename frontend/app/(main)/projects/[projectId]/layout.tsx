'use client';

import React, { use, useCallback } from 'react';
import { AgentProvider } from '@/contexts/AgentContext';
import { MutWebSocketProvider, useMutNotifications } from '@/contexts/MutWebSocketContext';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';


function ProjectLayoutInner({ children, projectId }: { children: React.ReactNode; projectId: string }) {
  // Keep the WebSocket open for the entire time the user is on any
  // sub-page of this project, not just on the data / history pages.
  //
  // Background: ``subscribeMutNotifications`` ref-counts handlers and
  // tears the socket down when the count reaches zero. Without this
  // layout-level no-op subscriber, navigating to settings / monitor /
  // toolkit (which don't call ``useCommitUpdates``) drops the count
  // to zero, the socket closes, and re-entering data / history forces
  // a full reconnect (visible as ``connected … disconnected`` pairs in
  // the backend log every tab switch — see mixed_changes.md §10.2).
  // A single permanent handler at the layout level holds count ≥ 1,
  // turning every page-level subscription into "share an existing
  // connection" instead of "open a new one".
  const noop = useCallback(() => {}, []);
  useMutNotifications(noop);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', background: '#0e0e0e' }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          background: '#0e0e0e',
          overflow: 'hidden',
        }}
      >
        {children}
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
        <MutWebSocketProvider projectId={projectId}>
          <ProjectLayoutInner projectId={projectId}>{children}</ProjectLayoutInner>
        </MutWebSocketProvider>
      </WorkspaceProvider>
    </AgentProvider>
  );
}
