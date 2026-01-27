'use client';

import React from 'react';

/**
 * Project Layout
 * 
 * Provides a consistent container styling for all project sub-pages (data, tools, settings).
 * Matches the floating container style used in the dashboard view.
 */
export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        backgroundColor: '#202020', // Matches sidebar background
      }}
    >
      {/* Floating container - matches dashboard style */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          margin: 8,
          marginLeft: 0,
          borderRadius: 12,
          border: '1px solid #2a2a2a',
          background: '#0e0e0e',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}
