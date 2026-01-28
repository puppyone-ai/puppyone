'use client';

/**
 * Project Tools Page
 * 
 * URL: /projects/{projectId}/tools
 * Shows all tools configured for this project
 */

import { use } from 'react';
import { useRouter } from 'next/navigation';
import {
  useProjectTools,
  useProjects,
  refreshProjectTools,
} from '@/lib/hooks/useData';
import { deleteTool } from '@/lib/mcpApi';
import { ToolsTable } from '@/app/(main)/tools-and-server/components/ToolsTable';

interface ToolsPageProps {
  params: Promise<{ projectId: string }>;
}

export default function ProjectToolsPage({ params }: ToolsPageProps) {
  const { projectId } = use(params);
  const router = useRouter();

  const { tools, isLoading: toolsLoading } = useProjectTools(projectId);
  const { projects } = useProjects();

  const currentProject = projects.find(p => p.id === projectId);

  const handleDeleteTool = async (toolId: number) => {
    if (!confirm('Delete this tool?')) return;
    try {
      await deleteTool(toolId);
      refreshProjectTools(projectId);
    } catch (e) {
      console.error('Failed to delete tool', e);
      alert('Error deleting tool');
    }
  };

  const handleNavigateToTable = (tableId: number) => {
    // Navigate to the data view for this table
    router.push(`/projects/${projectId}/data/${tableId}`);
  };

  if (toolsLoading) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#525252',
          height: '100%',
        }}
      >
        Loading tools...
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px 24px',
          borderBottom: '1px solid #1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: '#f5f5f5',
              margin: 0,
            }}
          >
            Tools & MCP
          </h1>
          <p
            style={{
              fontSize: 14,
              color: '#737373',
              margin: '4px 0 0 0',
            }}
          >
            {currentProject?.name || 'Project'} • {tools.length} tool{tools.length !== 1 ? 's' : ''} configured
          </p>
        </div>

        <button
          onClick={() => refreshProjectTools(projectId)}
          style={{
            padding: '8px 16px',
            background: '#1a1a1a',
            border: '1px solid #2a2a2a',
            borderRadius: 6,
            color: '#a3a3a3',
            fontSize: 14,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 24,
        }}
      >
        {tools.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 16,
              color: '#525252',
            }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 15, fontWeight: 500, color: '#737373', margin: 0 }}>
                No tools configured
              </p>
              <p style={{ fontSize: 14, color: '#525252', margin: '8px 0 0 0' }}>
                Go to Data view and configure access points on your contexts to create tools.
              </p>
            </div>
            <button
              onClick={() => router.push(`/projects/${projectId}/data`)}
              style={{
                marginTop: 8,
                padding: '10px 20px',
                background: '#2563eb',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Go to Data
            </button>
          </div>
        ) : (
          <ToolsTable
            tools={tools}
            onDeleteTool={handleDeleteTool}
            onNavigateToTable={handleNavigateToTable}
          />
        )}
      </div>
    </div>
  );
}


