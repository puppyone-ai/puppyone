'use client';

import { use, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useProjects, refreshProjects } from '@/lib/hooks/useData';
import { useOrganization } from '@/contexts/OrganizationContext';
import { ProjectManageDialog } from '@/components/ProjectManageDialog';
import {
  getProjectMembers,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  updateProjectVisibility,
  type ProjectMember,
} from '@/lib/projectsApi';

interface SettingsPageProps {
  params: Promise<{ projectId: string }>;
}

const ROLE_COLORS: Record<string, string> = {
  admin: '#f59e0b',
  editor: '#3b82f6',
  viewer: '#6b7280',
};

// SVG Icons for better UI
const AddUserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
    <circle cx="8.5" cy="7" r="4"></circle>
    <line x1="20" y1="8" x2="20" y2="14"></line>
    <line x1="23" y1="11" x2="17" y2="11"></line>
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
);

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
  </svg>
);

export default function ProjectSettingsPage({ params }: SettingsPageProps) {
  const { projectId } = use(params);
  const router = useRouter();
  const { currentOrg, members: orgMembers, myRole: orgRole } = useOrganization();

  const { projects, isLoading } = useProjects(currentOrg?.id);
  const currentProject = projects.find(p => p.id === projectId);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [visibility, setVisibility] = useState<'org' | 'private'>('org');
  const [showAddMember, setShowAddMember] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [addRole, setAddRole] = useState<'editor' | 'viewer'>('editor');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);

  const isOrgOwner = orgRole === 'owner';

  const loadMembers = useCallback(async () => {
    try {
      const data = await getProjectMembers(projectId);
      setProjectMembers(data);
    } catch {
      // project_members table might not exist yet
    }
  }, [projectId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (currentProject?.visibility) {
      setVisibility(currentProject.visibility as 'org' | 'private');
    }
  }, [currentProject?.visibility]);

  const handleVisibilityChange = async (newVis: 'org' | 'private') => {
    try {
      await updateProjectVisibility(projectId, newVis);
      setVisibility(newVis);
      setFeedback({ type: 'success', msg: `Project is now ${newVis === 'org' ? 'visible to the organization' : 'private'}.` });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Failed to update visibility' });
    }
  };

  const handleAddMember = async () => {
    if (!selectedUserId) return;
    try {
      await addProjectMember(projectId, selectedUserId, addRole);
      setShowAddMember(false);
      setSelectedUserId('');
      await loadMembers();
      setFeedback({ type: 'success', msg: 'Member added successfully.' });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Failed to add member' });
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await updateProjectMemberRole(projectId, userId, newRole);
      await loadMembers();
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Failed to update role' });
    }
  };

  const handleRemove = async (userId: string, name: string) => {
    if (!confirm(`Remove ${name} from this project?`)) return;
    try {
      await removeProjectMember(projectId, userId);
      await loadMembers();
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Failed to remove member' });
    }
  };

  const existingUserIds = new Set(projectMembers.map(m => m.user_id));
  const availableOrgMembers = orgMembers.filter(m => !existingUserIds.has(m.user_id));

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

      <div style={{
        height: 40, minHeight: 40,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', alignItems: 'center', padding: '0 16px',
        background: '#0e0e0e', flexShrink: 0
      }}>
        <h1 style={{ fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif', fontSize: 13, fontWeight: 500, color: '#CDCDCD', margin: 0 }}>Project Settings</h1>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>

          {/* Feedback */}
          {feedback && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px', marginBottom: 24, borderRadius: 8, fontSize: 13, fontWeight: 500,
              background: feedback.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
              border: `1px solid ${feedback.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
              color: feedback.type === 'error' ? '#f87171' : '#4ade80',
              animation: 'dialog-fade-in 0.2s ease-out',
            }}>
              {feedback.msg}
              <button onClick={() => setFeedback(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.8, display: 'flex' }}><TrashIcon /></button>
            </div>
          )}

          {/* Section: General */}
          <div style={{ marginBottom: 48 }}>
            <h2 style={sectionTitle}>General</h2>
            <div style={cardBox}>
              <div style={{ ...row, borderBottom: '1px solid #1f1f23' }}>
                <div>
                  <label style={labelStyle}>Project Name</label>
                  <div style={descStyle}>Used to identify your project in the dashboard.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, color: '#e4e4e7', fontWeight: 500 }}>{currentProject.name}</span>
                  <button onClick={() => setEditDialogOpen(true)} style={btnSecondary}>
                    <EditIcon /> Edit
                  </button>
                </div>
              </div>
              <div style={row}>
                <div>
                  <label style={labelStyle}>Project ID</label>
                  <div style={descStyle}>Unique identifier for API access.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <code style={{ fontSize: 12, color: '#a1a1aa', background: '#18181b', padding: '6px 10px', borderRadius: 6, border: '1px solid #27272a', fontFamily: 'monospace' }}>
                    {currentProject.id}
                  </code>
                  <button onClick={() => {
                    navigator.clipboard.writeText(currentProject.id);
                    setFeedback({ type: 'success', msg: 'Project ID copied to clipboard' });
                    setTimeout(() => setFeedback(null), 2000);
                  }} style={btnSecondary}>
                    <CopyIcon /> Copy
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section: Access */}
          {isOrgOwner && (
            <div style={{ marginBottom: 48 }}>
              <h2 style={sectionTitle}>Access & Visibility</h2>
              <div style={cardBox}>

                {/* Visibility */}
                <div style={{ ...row, borderBottom: '1px solid #1f1f23', paddingBottom: 24 }}>
                  <div>
                    <label style={labelStyle}>Project Visibility</label>
                    <div style={descStyle}>
                      {visibility === 'org'
                        ? 'Anyone in the organization can view and collaborate on this project.'
                        : 'Only organization owners and explicitly invited members can access this project.'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', background: '#121214', border: '1px solid #27272a', borderRadius: 8, padding: 4 }}>
                    <button
                      onClick={() => handleVisibilityChange('org')}
                      style={{
                        padding: '6px 16px',
                        background: visibility === 'org' ? '#27272a' : 'transparent',
                        color: visibility === 'org' ? '#fff' : '#a1a1aa',
                        border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s'
                      }}
                    >
                      Organization
                    </button>
                    <button
                      onClick={() => handleVisibilityChange('private')}
                      style={{
                        padding: '6px 16px',
                        background: visibility === 'private' ? '#27272a' : 'transparent',
                        color: visibility === 'private' ? '#fff' : '#a1a1aa',
                        border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s'
                      }}
                    >
                      Private
                    </button>
                  </div>
                </div>

                {/* Members */}
                <div style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div>
                      <label style={labelStyle}>Project Members</label>
                      {visibility === 'org' && (
                        <div style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>
                          Members added here will retain access if visibility is changed to Private.
                        </div>
                      )}
                    </div>
                    {!showAddMember && availableOrgMembers.length > 0 && (
                      <button onClick={() => setShowAddMember(true)} style={btnPrimary}>
                        <AddUserIcon /> Add Member
                      </button>
                    )}
                  </div>

                  {/* Add form */}
                  {showAddMember && (
                    <div style={{ display: 'flex', gap: 12, marginBottom: 20, padding: 16, background: '#141416', borderRadius: 8, border: '1px solid #27272a', animation: 'dialog-fade-in 0.15s ease-out' }}>
                      <select
                        value={selectedUserId}
                        onChange={e => setSelectedUserId(e.target.value)}
                        style={selectStyle}
                      >
                        <option value="" disabled>Select an organization member...</option>
                        {availableOrgMembers.map(m => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.display_name || m.email || m.user_id.slice(0, 8)}
                          </option>
                        ))}
                      </select>
                      <select value={addRole} onChange={e => setAddRole(e.target.value as any)} style={{ ...selectStyle, maxWidth: 120 }}>
                        <option value="admin">Admin</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={handleAddMember}
                          disabled={!selectedUserId}
                          style={{ ...btnPrimary, opacity: selectedUserId ? 1 : 0.5 }}
                        >
                          Add
                        </button>
                        <button onClick={() => setShowAddMember(false)} style={btnSecondary}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Members list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {projectMembers.length === 0 && !showAddMember && (
                      <div style={{ fontSize: 13, color: '#52525b', padding: '24px 0', textAlign: 'center', border: '1px dashed #27272a', borderRadius: 8 }}>
                        No project-specific members yet.
                      </div>
                    )}
                    {projectMembers.map(m => {
                      const name = m.display_name || m.email || m.user_id.slice(0, 8);
                      const initial = (name[0] || '?').toUpperCase();
                      return (
                        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: 8, background: '#121214', border: '1px solid #1f1f23' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {m.avatar_url ? (
                              <img src={m.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                            ) : (
                              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#27272a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#a1a1aa' }}>{initial}</div>
                            )}
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>{name}</div>
                              {m.email && m.display_name && <div style={{ fontSize: 11, color: '#71717a', marginTop: 2 }}>{m.email}</div>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ position: 'relative' }}>
                              <select
                                value={m.role}
                                onChange={e => handleRoleChange(m.user_id, e.target.value)}
                                style={{ ...selectStyle, padding: '4px 24px 4px 10px', height: 28, fontSize: 12, color: ROLE_COLORS[m.role] || '#e4e4e7', background: 'transparent', borderColor: 'transparent', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none' }}
                              >
                                <option value="admin">Admin</option>
                                <option value="editor">Editor</option>
                                <option value="viewer">Viewer</option>
                              </select>
                              <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#52525b' }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                              </div>
                            </div>
                            <div style={{ width: 1, height: 16, background: '#27272a' }}></div>
                            <button
                              onClick={() => handleRemove(m.user_id, name)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#71717a', padding: 4, display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
                              title="Remove member"
                              onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                              onMouseLeave={e => e.currentTarget.style.color = '#71717a'}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Section: Danger Zone */}
          <div>
            <h2 style={{ ...sectionTitle, color: '#ef4444' }}>Danger Zone</h2>
            <div style={{ border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 8, overflow: 'hidden', background: 'rgba(239, 68, 68, 0.03)' }}>
              <div style={row}>
                <div>
                  <label style={{ ...labelStyle, color: '#f87171' }}>Delete Project</label>
                  <div style={descStyle}>Permanently remove this project and all its data.</div>
                </div>
                <button onClick={() => setDeleteDialogOpen(true)} style={{ padding: '8px 16px', background: '#ef4444', border: '1px solid #dc2626', borderRadius: 6, color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'background 0.15s' }} onMouseEnter={e => e.currentTarget.style.background = '#dc2626'} onMouseLeave={e => e.currentTarget.style.background = '#ef4444'}>
                  Delete Project
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      {editDialogOpen && (
        <ProjectManageDialog mode="edit" projectId={currentProject.id} projects={projects} onClose={() => { setEditDialogOpen(false); refreshProjects(currentOrg?.id); }} />
      )}
      {deleteDialogOpen && (
        <ProjectManageDialog mode="delete" projectId={currentProject.id} projects={projects} onClose={() => { setDeleteDialogOpen(false); router.push('/home'); }} />
      )}
      <style jsx>{`
        @keyframes dialog-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#a1a1aa', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' };
const cardBox: React.CSSProperties = { border: '1px solid #27272a', borderRadius: 8, overflow: 'hidden', background: '#09090b', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' };
const row: React.CSSProperties = { padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 14, fontWeight: 500, color: '#e4e4e7', marginBottom: 4 };
const descStyle: React.CSSProperties = { fontSize: 13, color: '#71717a', lineHeight: 1.5 };
const btnSecondary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#18181b', border: '1px solid #27272a', borderRadius: 6, color: '#e4e4e7', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s' };
const btnPrimary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: '#e4e4e7', border: 'none', borderRadius: 6, color: '#09090b', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s' };
const selectStyle: React.CSSProperties = { flex: 1, background: '#09090b', border: '1px solid #27272a', borderRadius: 6, padding: '8px 12px', color: '#e4e4e7', fontSize: 13, outline: 'none', transition: 'border-color 0.15s' };

