'use client';

/**
 * Project Settings Page
 * 
 * URL: /projects/{projectId}/settings
 * Project configuration and management
 */

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useProjects, refreshProjects } from '@/lib/hooks/useData';
import { ProjectManageDialog } from '@/components/ProjectManageDialog';

interface SettingsPageProps {
  params: Promise<{ projectId: string }>;
}

export default function ProjectSettingsPage({ params }: SettingsPageProps) {
  const { projectId } = use(params);
  const router = useRouter();

  const { projects, isLoading } = useProjects();
  const currentProject = projects.find(p => p.id === projectId);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  if (isLoading) {
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
        Loading...
      </div>
    );
  }

  if (!currentProject) {
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
        Project not found
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
        overflow: 'auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px 24px',
          borderBottom: '1px solid #1a1a1a',
        }}
      >
        <h1
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: '#f5f5f5',
            margin: 0,
          }}
        >
          Project Settings
        </h1>
        <p
          style={{
            fontSize: 13,
            color: '#737373',
            margin: '4px 0 0 0',
          }}
        >
          Manage settings for {currentProject.name}
        </p>
      </div>

      {/* Content */}
      <div style={{ padding: 24 }}>
        {/* General Section */}
        <section style={{ marginBottom: 32 }}>
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#a3a3a3',
              margin: '0 0 16px 0',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            General
          </h2>

          <div
            style={{
              background: '#0a0a0a',
              border: '1px solid #1a1a1a',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {/* Project Name */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderBottom: '1px solid #1a1a1a',
              }}
            >
              <div>
                <div style={{ fontSize: 14, color: '#e5e5e5', fontWeight: 500 }}>
                  Project Name
                </div>
                <div style={{ fontSize: 13, color: '#737373', marginTop: 2 }}>
                  {currentProject.name}
                </div>
              </div>
              <button
                onClick={() => setEditDialogOpen(true)}
                style={{
                  padding: '6px 12px',
                  background: '#1a1a1a',
                  border: '1px solid #2a2a2a',
                  borderRadius: 6,
                  color: '#a3a3a3',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Edit
              </button>
            </div>

            {/* Project ID */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
              }}
            >
              <div>
                <div style={{ fontSize: 14, color: '#e5e5e5', fontWeight: 500 }}>
                  Project ID
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: '#737373',
                    marginTop: 2,
                    fontFamily: 'monospace',
                  }}
                >
                  {currentProject.id}
                </div>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(currentProject.id);
                }}
                style={{
                  padding: '6px 12px',
                  background: '#1a1a1a',
                  border: '1px solid #2a2a2a',
                  borderRadius: 6,
                  color: '#a3a3a3',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Copy
              </button>
            </div>
          </div>
        </section>

        {/* Danger Zone */}
        <section>
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#ef4444',
              margin: '0 0 16px 0',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Danger Zone
          </h2>

          <div
            style={{
              background: '#0a0a0a',
              border: '1px solid #7f1d1d',
              borderRadius: 8,
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: 14, color: '#e5e5e5', fontWeight: 500 }}>
                Delete Project
              </div>
              <div style={{ fontSize: 13, color: '#737373', marginTop: 2 }}>
                Permanently delete this project and all its data. This action cannot be undone.
              </div>
            </div>
            <button
              onClick={() => setDeleteDialogOpen(true)}
              style={{
                padding: '8px 16px',
                background: '#7f1d1d',
                border: 'none',
                borderRadius: 6,
                color: '#fca5a5',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Delete Project
            </button>
          </div>
        </section>
      </div>

      {/* Edit Dialog */}
      {editDialogOpen && (
        <ProjectManageDialog
          mode="edit"
          projectId={currentProject.id}
          projects={projects}
          onClose={() => {
            setEditDialogOpen(false);
            refreshProjects();
          }}
        />
      )}

      {/* Delete Dialog */}
      {deleteDialogOpen && (
        <ProjectManageDialog
          mode="delete"
          projectId={currentProject.id}
          projects={projects}
          onClose={() => {
            setDeleteDialogOpen(false);
            // If deleted, redirect to home
            router.push('/home');
          }}
        />
      )}
    </div>
  );
}


