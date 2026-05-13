'use client';

import { use, useState, useEffect, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import { useProject, useProjects, refreshProjects } from '@/lib/hooks/useData';
import { useOrganization } from '@/contexts/OrganizationContext';
import { PROJECT_CONTENT_RAIL_WIDTH } from '@/lib/layout';
import { ProjectManageDialog } from '@/components/ProjectManageDialog';
import {
  getProjectMembers,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  updateProject,
  updateProjectVisibility,
  type ProjectMember,
} from '@/lib/projectsApi';
import { useTranslations } from 'next-intl';
import { PageLoading } from '@/components/loading';

interface SettingsPageProps {
  params: Promise<{ projectId: string }>;
}

// Local design tokens. Mirrors the `T` object in the Access page
// (`projects/[id]/access/lib/tokens.ts`) so this surface reads as the
// same family — same border alpha, same text scale, same Geist Sans
// font stack. The earlier copy used `Plus Jakarta Sans` + hardcoded
// neutrals (#0a0a0a / #27272a / #1f1f23), which is why the page
// felt visually out of step with the rest of /(main).
const T = {
  bg: '#0e0e0e',
  border: 'rgba(255,255,255,0.08)',
  cardBg: 'rgba(255,255,255,0.02)',
  cardBorder: 'rgba(255,255,255,0.06)',
  text1: '#fafafa',
  text2: '#a1a1aa',
  text3: '#52525b',
  text4: '#27272a',
  fontSans:
    'var(--font-geist-sans), -apple-system, BlinkMacSystemFont, sans-serif',
  fontMono:
    'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

// Role-tag colors. Kept saturated on purpose — these are user-facing
// permission signals, not chrome, so they need to register at a glance
// against the neutral page background.
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

// Close glyph for the feedback toast. The previous version reused
// `TrashIcon` as the dismiss control — semantically wrong (trash =
// "delete the underlying record", not "close this banner") and read
// as if dismissing the toast would also undo the action it was
// reporting on.
const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export default function ProjectSettingsPage({ params }: SettingsPageProps) {
  const { projectId } = use(params);
  const router = useRouter();
  const { session, isAuthReady } = useAuth();
  const { currentOrg, members: orgMembers, myRole: orgRole } = useOrganization();

  const { project: routeProject, isLoading: routeProjectLoading } = useProject(session ? projectId : null);
  const { projects, isLoading } = useProjects(currentOrg?.id ?? null);
  const currentProject = projects.find(p => p.id === projectId) ?? routeProject;
  const scopedProjects = useMemo(() => {
    const projectsForCurrentRoute =
      routeProject?.org_id && currentOrg?.id !== routeProject.org_id ? [] : projects;
    if (!routeProject || projectsForCurrentRoute.some(p => p.id === routeProject.id)) {
      return projectsForCurrentRoute;
    }
    return [routeProject, ...projectsForCurrentRoute];
  }, [currentOrg?.id, projects, routeProject]);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [visibility, setVisibility] = useState<'org' | 'private'>('org');

  // Inline editor state for ``bound_git_branch``. Mirrors what the
  // backend has when no edit is in flight; the input only commits on
  // explicit save so a stray keystroke can't mutate the project.
  const tProjSettings = useTranslations('projectSettings');
  const [boundBranchInput, setBoundBranchInput] = useState('');
  const [boundBranchEditing, setBoundBranchEditing] = useState(false);
  const [boundBranchSaving, setBoundBranchSaving] = useState(false);
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

  useEffect(() => {
    // Don't trample an in-flight edit if the projects list refetches
    // while the user is mid-keystroke.
    if (!boundBranchEditing) {
      setBoundBranchInput(currentProject?.bound_git_branch || 'main');
    }
  }, [currentProject?.bound_git_branch, boundBranchEditing]);

  const handleBoundBranchSave = async () => {
    const next = boundBranchInput.trim();
    if (!next) {
      setFeedback({ type: 'error', msg: 'Branch cannot be empty' });
      return;
    }
    if (next === (currentProject?.bound_git_branch || 'main')) {
      setBoundBranchEditing(false);
      return;
    }
    setBoundBranchSaving(true);
    try {
      await updateProject(projectId, { bound_git_branch: next });
      await refreshProjects();
      setBoundBranchEditing(false);
      setFeedback({ type: 'success', msg: 'Default branch updated.' });
      setTimeout(() => setFeedback(null), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update branch';
      setFeedback({ type: 'error', msg });
    } finally {
      setBoundBranchSaving(false);
    }
  };

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

  // Two distinct "no project yet" cases that used to be handled
  // unevenly:
  //   1. `isLoading=true` — first fetch in flight, no cache hit yet.
  //   2. `isLoading=false` AND `currentProject === undefined` —
  //      the projects array came back from cache but doesn't (yet)
  //      contain this projectId; could be a fresh project added in
  //      another tab, or the user navigated mid-revalidate.
  //
  // Old code returned `null` in case (2), which produced the "blank
  // screen for a beat, then content snaps in" feel users described as
  // "settings just freezes". Showing the same PageLoading for both
  // cases keeps the perceived loading state continuous from the
  // moment the user clicks the route until real content paints.
  if (!isAuthReady || isLoading || routeProjectLoading || !currentProject) {
    return (
      <div style={{ flex: 1, height: '100%' }}>
        <PageLoading variant="fill" />
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
        background: T.bg,
        overflow: 'hidden',
        fontFamily: T.fontSans,
      }}
    >
      {/* Page header — 46px row, single-line title, hairline border.
          Mirrors `AccessHeader` in `access/components/page-shell.tsx`
          so all project sub-pages share the same top band. Title is
          plain "Settings" rather than "Project Settings": the project
          name already lives in the workspace switcher up in the
          AppSidebar, so repeating it here is just noise. */}
      <div
        style={{
          height: 46,
          minHeight: 46,
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          background: T.bg,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>
          Settings
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px' }}>
        <div style={{ maxWidth: PROJECT_CONTENT_RAIL_WIDTH, margin: '0 auto' }}>

          {/* Feedback toast — softer than before. Both the
              background and the border use lower-alpha versions of
              the semantic color so the toast reads as a tinted card,
              not a saturated alert. The close glyph is a real "x"
              now, not a trash can. */}
          {feedback && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 14px',
                marginBottom: 20,
                borderRadius: 7,
                fontSize: 12.5,
                fontWeight: 500,
                lineHeight: 1.5,
                fontFamily: T.fontSans,
                background:
                  feedback.type === 'error'
                    ? 'rgba(239,68,68,0.07)'
                    : 'rgba(34,197,94,0.07)',
                border: `1px solid ${feedback.type === 'error' ? 'rgba(239,68,68,0.22)' : 'rgba(34,197,94,0.22)'}`,
                color: feedback.type === 'error' ? '#fca5a5' : '#86efac',
                animation: 'dialog-fade-in 0.2s ease-out',
              }}
            >
              {feedback.msg}
              <button
                onClick={() => setFeedback(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  opacity: 0.75,
                  display: 'flex',
                  padding: 4,
                  marginRight: -4,
                  borderRadius: 4,
                  transition: `opacity 0.12s ${T.ease}`,
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '0.75')}
                aria-label="Dismiss"
              >
                <CloseIcon />
              </button>
            </div>
          )}

          {/* Section: General */}
          <div style={{ marginBottom: 48 }}>
            <h2 style={sectionTitle}>General</h2>
            <div style={cardBox}>
              <div style={{ ...row, borderBottom: `1px solid ${T.cardBorder}` }}>
                <div>
                  <label style={labelStyle}>Project Name</label>
                  <div style={descStyle}>Used to identify your project in the dashboard.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, color: T.text1, fontWeight: 500 }}>{currentProject.name}</span>
                  <button
                    onClick={() => setEditDialogOpen(true)}
                    onMouseEnter={onGhostEnter}
                    onMouseLeave={onGhostLeave}
                    style={btnGhost}
                  >
                    <EditIcon /> Edit
                  </button>
                </div>
              </div>
              <div style={{ ...row, borderBottom: `1px solid ${T.cardBorder}` }}>
                <div>
                  <label style={labelStyle}>{tProjSettings('boundGitBranch')}</label>
                  <div style={descStyle}>{tProjSettings('boundGitBranchHint')}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {boundBranchEditing ? (
                    <>
                      <input
                        type="text"
                        autoFocus
                        value={boundBranchInput}
                        onChange={(e) => setBoundBranchInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleBoundBranchSave();
                          if (e.key === 'Escape') {
                            setBoundBranchEditing(false);
                            setBoundBranchInput(currentProject.bound_git_branch || 'main');
                          }
                        }}
                        disabled={boundBranchSaving}
                        style={{
                          background: 'rgba(0,0,0,0.28)',
                          border: `1px solid ${T.cardBorder}`,
                          borderRadius: 5,
                          color: T.text1,
                          fontFamily: T.fontMono,
                          fontSize: 12,
                          padding: '5px 9px',
                          width: 180,
                          outline: 'none',
                        }}
                      />
                      <button
                        onClick={() => void handleBoundBranchSave()}
                        disabled={boundBranchSaving}
                        onMouseEnter={onGhostEnter}
                        onMouseLeave={onGhostLeave}
                        style={btnGhost}
                      >
                        {boundBranchSaving ? '…' : 'Save'}
                      </button>
                      <button
                        onClick={() => {
                          setBoundBranchEditing(false);
                          setBoundBranchInput(currentProject.bound_git_branch || 'main');
                        }}
                        disabled={boundBranchSaving}
                        onMouseEnter={onGhostEnter}
                        onMouseLeave={onGhostLeave}
                        style={btnGhost}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <code
                        style={{
                          fontSize: 12,
                          color: T.text1,
                          background: 'rgba(0,0,0,0.28)',
                          padding: '5px 9px',
                          borderRadius: 5,
                          border: `1px solid ${T.cardBorder}`,
                          fontFamily: T.fontMono,
                        }}
                      >
                        {currentProject.bound_git_branch || 'main'}
                      </code>
                      <button
                        onClick={() => setBoundBranchEditing(true)}
                        onMouseEnter={onGhostEnter}
                        onMouseLeave={onGhostLeave}
                        style={btnGhost}
                      >
                        <EditIcon /> Edit
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div style={row}>
                <div>
                  <label style={labelStyle}>Project ID</label>
                  <div style={descStyle}>Unique identifier for API access.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <code
                    style={{
                      fontSize: 11,
                      color: T.text2,
                      background: 'rgba(0,0,0,0.28)',
                      padding: '5px 9px',
                      borderRadius: 5,
                      border: `1px solid ${T.cardBorder}`,
                      fontFamily: T.fontMono,
                    }}
                  >
                    {currentProject.id}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(currentProject.id);
                      setFeedback({ type: 'success', msg: 'Project ID copied to clipboard' });
                      setTimeout(() => setFeedback(null), 2000);
                    }}
                    onMouseEnter={onGhostEnter}
                    onMouseLeave={onGhostLeave}
                    style={btnGhost}
                  >
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

                {/* Visibility — segmented control. The earlier pill
                    (background `#121214` over `#27272a`) read as a
                    second card embedded inside the section card,
                    competing with the surface itself. The flatter
                    treatment below — translucent track + translucent
                    active fill — sits more quietly inside the row. */}
                <div style={{ ...row, borderBottom: `1px solid ${T.cardBorder}`, paddingBottom: 20 }}>
                  <div>
                    <label style={labelStyle}>Project Visibility</label>
                    <div style={descStyle}>
                      {visibility === 'org'
                        ? 'Anyone in the organization can view and collaborate on this project.'
                        : 'Only organization owners and explicitly invited members can access this project.'}
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      background: 'rgba(255,255,255,0.03)',
                      border: `1px solid ${T.cardBorder}`,
                      borderRadius: 7,
                      padding: 3,
                    }}
                  >
                    <button
                      onClick={() => handleVisibilityChange('org')}
                      style={{
                        padding: '4px 14px',
                        background:
                          visibility === 'org'
                            ? 'rgba(255,255,255,0.08)'
                            : 'transparent',
                        color: visibility === 'org' ? T.text1 : T.text2,
                        border: 'none',
                        borderRadius: 5,
                        fontSize: 12,
                        fontWeight: 500,
                        fontFamily: T.fontSans,
                        cursor: 'pointer',
                        transition: `all 0.15s ${T.ease}`,
                      }}
                    >
                      Organization
                    </button>
                    <button
                      onClick={() => handleVisibilityChange('private')}
                      style={{
                        padding: '4px 14px',
                        background:
                          visibility === 'private'
                            ? 'rgba(255,255,255,0.08)'
                            : 'transparent',
                        color: visibility === 'private' ? T.text1 : T.text2,
                        border: 'none',
                        borderRadius: 5,
                        fontSize: 12,
                        fontWeight: 500,
                        fontFamily: T.fontSans,
                        cursor: 'pointer',
                        transition: `all 0.15s ${T.ease}`,
                      }}
                    >
                      Private
                    </button>
                  </div>
                </div>

                {/* Members */}
                <div style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div>
                      <label style={labelStyle}>Project Members</label>
                      {visibility === 'org' && (
                        <div style={{ fontSize: 12, color: T.text2, marginTop: 2, lineHeight: 1.55 }}>
                          Members added here will retain access if visibility is changed to Private.
                        </div>
                      )}
                    </div>
                    {!showAddMember && availableOrgMembers.length > 0 && (
                      <button
                        onClick={() => setShowAddMember(true)}
                        onMouseEnter={onPrimaryEnter}
                        onMouseLeave={onPrimaryLeave}
                        style={btnPrimary}
                      >
                        <AddUserIcon /> Add Member
                      </button>
                    )}
                  </div>

                  {/* Add form — inset surface. Slightly darker than
                      the section card (cardBg + 0.01) so the form
                      reads as a recessed panel rather than another
                      stacked card. */}
                  {showAddMember && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        marginBottom: 16,
                        padding: 12,
                        background: 'rgba(0,0,0,0.2)',
                        borderRadius: 7,
                        border: `1px solid ${T.cardBorder}`,
                        animation: 'dialog-fade-in 0.15s ease-out',
                      }}
                    >
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
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={handleAddMember}
                          disabled={!selectedUserId}
                          onMouseEnter={selectedUserId ? onPrimaryEnter : undefined}
                          onMouseLeave={selectedUserId ? onPrimaryLeave : undefined}
                          style={{
                            ...btnPrimary,
                            opacity: selectedUserId ? 1 : 0.45,
                            cursor: selectedUserId ? 'pointer' : 'not-allowed',
                          }}
                        >
                          Add
                        </button>
                        <button
                          onClick={() => setShowAddMember(false)}
                          onMouseEnter={onGhostEnter}
                          onMouseLeave={onGhostLeave}
                          style={btnGhost}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Members list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {projectMembers.length === 0 && !showAddMember && (
                      <div
                        style={{
                          fontSize: 12,
                          color: T.text3,
                          padding: '20px 0',
                          textAlign: 'center',
                          border: `1px dashed ${T.cardBorder}`,
                          borderRadius: 7,
                        }}
                      >
                        No project-specific members yet.
                      </div>
                    )}
                    {projectMembers.map(m => {
                      const name = m.display_name || m.email || m.user_id.slice(0, 8);
                      const initial = (name[0] || '?').toUpperCase();
                      return (
                        <div
                          key={m.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 12px',
                            borderRadius: 7,
                            background: 'rgba(255,255,255,0.015)',
                            border: `1px solid ${T.cardBorder}`,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {m.avatar_url ? (
                              <img src={m.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                            ) : (
                              <div
                                style={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: '50%',
                                  background: 'rgba(255,255,255,0.06)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: T.text2,
                                }}
                              >
                                {initial}
                              </div>
                            )}
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>{name}</div>
                              {m.email && m.display_name && (
                                <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{m.email}</div>
                              )}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ position: 'relative' }}>
                              <select
                                value={m.role}
                                onChange={e => handleRoleChange(m.user_id, e.target.value)}
                                style={{
                                  ...selectStyle,
                                  padding: '4px 22px 4px 8px',
                                  height: 26,
                                  fontSize: 11.5,
                                  fontWeight: 500,
                                  color: ROLE_COLORS[m.role] || '#e4e4e7',
                                  background: 'transparent',
                                  borderColor: 'transparent',
                                  cursor: 'pointer',
                                  appearance: 'none',
                                  WebkitAppearance: 'none',
                                }}
                              >
                                <option value="admin">Admin</option>
                                <option value="editor">Editor</option>
                                <option value="viewer">Viewer</option>
                              </select>
                              <div style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: T.text3 }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                              </div>
                            </div>
                            <div style={{ width: 1, height: 14, background: T.cardBorder }}></div>
                            <button
                              onClick={() => handleRemove(m.user_id, name)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.text3, padding: 4, display: 'flex', alignItems: 'center', transition: `color 0.15s ${T.ease}` }}
                              title="Remove member"
                              onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                              onMouseLeave={e => (e.currentTarget.style.color = T.text3)}
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

          {/* Section: Danger Zone — same surface metrics as the
              other sections (so the page rhythm stays consistent),
              just tinted with a low-alpha red so it still reads as
              the "do not enter" zone. The button itself is the
              loudest element in the section, not the card chrome. */}
          <div>
            <h2 style={{ ...sectionTitle, color: '#fca5a5' }}>Danger Zone</h2>
            <div
              style={{
                border: '1px solid rgba(239, 68, 68, 0.18)',
                borderRadius: 8,
                overflow: 'hidden',
                background: 'rgba(239, 68, 68, 0.025)',
              }}
            >
              <div style={row}>
                <div>
                  <label style={{ ...labelStyle, color: '#fca5a5' }}>Delete Project</label>
                  <div style={descStyle}>Permanently remove this project and all its data.</div>
                </div>
                <button
                  onClick={() => setDeleteDialogOpen(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    height: 26,
                    padding: '0 12px',
                    background: 'rgba(239,68,68,0.12)',
                    border: '1px solid rgba(239,68,68,0.32)',
                    borderRadius: 6,
                    color: '#fca5a5',
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: T.fontSans,
                    cursor: 'pointer',
                    transition: `background 0.15s ${T.ease}, color 0.15s ${T.ease}, border-color 0.15s ${T.ease}`,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(239,68,68,0.2)';
                    e.currentTarget.style.borderColor = 'rgba(239,68,68,0.45)';
                    e.currentTarget.style.color = '#fff';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(239,68,68,0.12)';
                    e.currentTarget.style.borderColor = 'rgba(239,68,68,0.32)';
                    e.currentTarget.style.color = '#fca5a5';
                  }}
                >
                  Delete Project
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      {editDialogOpen && (
        <ProjectManageDialog mode="edit" projectId={currentProject.id} projects={scopedProjects} onClose={() => { setEditDialogOpen(false); refreshProjects(currentOrg?.id ?? null); }} />
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

// ─── Style primitives ────────────────────────────────────────────────
//
// All of these derive from `T` so the page reads as the same family
// as Access / Monitor / History. The earlier set hardcoded neutrals
// at low alpha (`#0a0a0a`, `#1f1f23`, `#27272a`) and a 4px box-shadow
// on every card, which gave the page a "settings-form 2018" feel
// against the rest of the chrome. The replacements use translucent
// borders + a subtle `rgba(255,255,255,0.02)` lift instead.
//
// Section title is 10.5px / 600 / `T.text3` / uppercase 0.08em — the
// exact spec used by `SectionLabel` on the Access page, so the two
// surfaces are interchangeable in the eye.

const sectionTitle: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: T.text3,
  fontFamily: T.fontSans,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 12,
  paddingLeft: 2,
};

const cardBox: CSSProperties = {
  border: `1px solid ${T.cardBorder}`,
  borderRadius: 8,
  overflow: 'hidden',
  background: T.cardBg,
};

const row: CSSProperties = {
  padding: '20px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 16,
};

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: '#e4e4e7',
  marginBottom: 4,
  fontFamily: T.fontSans,
};

const descStyle: CSSProperties = {
  fontSize: 12,
  color: T.text2,
  lineHeight: 1.55,
  fontFamily: T.fontSans,
};

// Ghost button — pulled directly from the Access page's `GhostButton`
// shape (26px tall, 12px text, transparent → 0.05-alpha hover). One
// neutral button across the whole project surface.
const btnGhost: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 26,
  padding: '0 10px',
  background: 'transparent',
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  color: T.text2,
  fontSize: 12,
  fontWeight: 500,
  fontFamily: T.fontSans,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: `background 0.15s ${T.ease}, color 0.15s ${T.ease}, border-color 0.15s ${T.ease}`,
};

// Primary action — same shape as the ghost, just with a permanently
// raised background so it reads as the dominant action in its row.
// Avoids the heavy "white pill on black" CTA the page used before,
// which felt out of step with the muted surface.
const btnPrimary: CSSProperties = {
  ...btnGhost,
  background: 'rgba(255,255,255,0.06)',
  borderColor: 'rgba(255,255,255,0.10)',
  color: T.text1,
};

const selectStyle: CSSProperties = {
  flex: 1,
  background: 'rgba(255,255,255,0.02)',
  border: `1px solid ${T.cardBorder}`,
  borderRadius: 6,
  padding: '6px 10px',
  color: '#e4e4e7',
  fontSize: 12,
  fontFamily: T.fontSans,
  outline: 'none',
  transition: `border-color 0.15s ${T.ease}`,
};

// Hover handlers for the ghost / primary buttons. Inline-styled
// React buttons can't use `:hover`, so we attach matching enter/leave
// handlers on the consuming JSX. Defined once here so each call site
// picks the same hover ramp.
function onGhostEnter(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)';
  e.currentTarget.style.color = T.text1;
}
function onGhostLeave(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'transparent';
  e.currentTarget.style.borderColor = T.border;
  e.currentTarget.style.color = T.text2;
}

function onPrimaryEnter(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'rgba(255,255,255,0.10)';
  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)';
}
function onPrimaryLeave(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)';
}
