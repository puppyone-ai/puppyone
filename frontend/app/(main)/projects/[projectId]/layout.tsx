'use client';

import React, { use } from 'react';
import { AgentProvider } from '@/contexts/AgentContext';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';


function ProjectLayoutInner({ children, projectId }: { children: React.ReactNode; projectId: string }) {
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
        <ProjectLayoutInner projectId={projectId}>{children}</ProjectLayoutInner>
      </WorkspaceProvider>
    </AgentProvider>
  );
}
