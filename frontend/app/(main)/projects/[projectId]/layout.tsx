'use client';

import React from 'react';
import { AgentProvider } from '@/contexts/AgentContext';

/**
 * Project Layout
 *
 * Provides a consistent container styling for all project sub-pages (data, tools, settings).
 * 
 * Scheme C (Context Widget):
 * - No Right Rail.
 * - Single large container for content.
 * - Agents will be mounted in the Header area of the content.
 */

function ProjectLayoutInner({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        backgroundColor: '#0f0f0f', // Main content area - darker than bars (#1a1a1a)
      }}
    >
      {/* Main Content Container - Edge-to-Edge Pane Style */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          // Removed "Card" styling to reduce visual layers and match macOS Finder aesthetic
          margin: 0,
          borderRadius: 0,
          border: 'none',
          // Add a subtle left border to separate from the App Sidebar
          borderLeft: '1px solid #2a2a2a', 
          background: '#0e0e0e',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AgentProvider>
      <ProjectLayoutInner>{children}</ProjectLayoutInner>
    </AgentProvider>
  );
}
