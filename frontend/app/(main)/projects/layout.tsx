'use client';

import React from 'react';

export default function ProjectsLayout({
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
        backgroundColor: '#202020',
      }}
    >
      {/* 浮动容器：提供圆角边框 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          margin: 8,
          marginLeft: 0,
          borderRadius: 12,
          border: '1px solid #2a2a2a',
          background: '#0e0e0e',
          overflow: 'hidden',
        }}
      >
        {/* 主内容区 */}
        <section
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: '#0a0a0a',
          }}
        >
          {children}
        </section>
      </div>
    </div>
  );
}
