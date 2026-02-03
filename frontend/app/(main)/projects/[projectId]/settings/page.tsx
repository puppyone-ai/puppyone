'use client';

/**
 * Project Settings Page
 * 
 * Purpose: Manage project lifecycle and configuration.
 * Design: Matches Supabase/Vercel settings style (Clean list groups).
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
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252', height: '100%' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <style jsx>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!currentProject) return null;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#09090b', overflow: 'hidden' }}>
      
      {/* Header - Consistent with Logs/Dashboard */}
      <div style={{ 
        height: 48, 
        minHeight: 48,
        borderBottom: '1px solid rgba(255,255,255,0.06)', 
        display: 'flex', 
        alignItems: 'center', 
        padding: '0 20px',
        background: '#141414',
        flexShrink: 0 
      }}>
        <h1 style={{ fontSize: 14, fontWeight: 500, color: '#e4e4e7', margin: 0 }}>Project Settings</h1>
      </div>

      {/* Content Container */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          
          {/* Section: General */}
          <div style={{ marginBottom: 48 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#e4e4e7', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>General</h2>
            
            {/* List Group */}
            <div style={{ 
              border: '1px solid #1f1f23', 
              borderRadius: 8, 
              overflow: 'hidden',
              background: '#0c0c0c'
            }}>
              
              {/* Row 1: Project Name */}
              <div style={{ 
                padding: '16px 20px', 
                borderBottom: '1px solid #1f1f23',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#e4e4e7', marginBottom: 4 }}>
                    Project Name
                  </label>
                  <div style={{ fontSize: 12, color: '#71717a' }}>
                    Used to identify your project in the dashboard.
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, color: '#e4e4e7' }}>
                    {currentProject.name}
                  </span>
                  <button
                    onClick={() => setEditDialogOpen(true)}
                    style={{
                      padding: '6px 12px',
                      background: '#18181b',
                      border: '1px solid #27272a',
                      borderRadius: 6,
                      color: '#e4e4e7',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = '#52525b'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = '#27272a'}
                  >
                    Edit
                  </button>
                </div>
              </div>

              {/* Row 2: Project ID */}
              <div style={{ 
                padding: '16px 20px', 
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#e4e4e7', marginBottom: 4 }}>
                    Project ID
                  </label>
                  <div style={{ fontSize: 12, color: '#71717a' }}>
                    Unique identifier for API access.
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <code style={{ 
                    fontSize: 12, 
                    color: '#a1a1aa', 
                    background: '#18181b', 
                    padding: '4px 8px', 
                    borderRadius: 4,
                    border: '1px solid #27272a',
                    fontFamily: 'monospace'
                  }}>
                    {currentProject.id}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(currentProject.id);
                      // Could add toast here
                    }}
                    style={{
                      padding: '6px 12px',
                      background: 'transparent',
                      border: '1px solid #27272a',
                      borderRadius: 6,
                      color: '#a1a1aa',
                      fontSize: 12,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = '#52525b';
                      e.currentTarget.style.color = '#e4e4e7';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = '#27272a';
                      e.currentTarget.style.color = '#a1a1aa';
                    }}
                  >
                    Copy
                  </button>
                </div>
              </div>

            </div>
          </div>

          {/* Section: Danger Zone */}
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#ef4444', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Danger Zone</h2>

            <div style={{ 
              border: '1px solid rgba(239, 68, 68, 0.2)', 
              borderRadius: 8, 
              overflow: 'hidden',
              background: 'rgba(239, 68, 68, 0.05)'
            }}>
              <div style={{ 
                padding: '16px 20px', 
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#e4e4e7', marginBottom: 4 }}>
                    Delete Project
                  </label>
                  <div style={{ fontSize: 12, color: '#a1a1aa' }}>
                    Permanently remove this project and all its data.
                  </div>
                </div>
                <button
                  onClick={() => setDeleteDialogOpen(true)}
                  style={{
                    padding: '6px 16px',
                    background: '#ef4444',
                    border: '1px solid #dc2626',
                    borderRadius: 6,
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#dc2626'}
                  onMouseLeave={e => e.currentTarget.style.background = '#ef4444'}
                >
                  Delete Project
                </button>
              </div>
            </div>
          </div>

        </div>
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
            router.push('/home');
          }}
        />
      )}
    </div>
  );
}
