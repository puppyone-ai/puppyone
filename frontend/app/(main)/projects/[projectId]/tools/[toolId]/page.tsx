'use client';

/**
 * Tool Detail Page
 * 
 * URL: /projects/{projectId}/tools/{toolId}
 * Shows details and allows editing of a specific tool
 */

import { use } from 'react';
import { useRouter } from 'next/navigation';

interface ToolDetailPageProps {
  params: Promise<{ projectId: string; toolId: string }>;
}

export default function ToolDetailPage({ params }: ToolDetailPageProps) {
  const { projectId, toolId } = use(params);
  const router = useRouter();

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#050607',
        padding: 24,
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => router.push(`/projects/${projectId}/tools`)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            background: 'transparent',
            border: 'none',
            color: '#737373',
            fontSize: 14,
            cursor: 'pointer',
            marginBottom: 16,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          Back to Tools
        </button>

        <h1
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: '#f5f5f5',
            margin: 0,
          }}
        >
          Tool Detail
        </h1>
        <p
          style={{
            fontSize: 14,
            color: '#737373',
            margin: '4px 0 0 0',
          }}
        >
          Tool ID: {toolId}
        </p>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#525252',
        }}
      >
        <p>Tool detail view coming soon...</p>
      </div>
    </div>
  );
}


