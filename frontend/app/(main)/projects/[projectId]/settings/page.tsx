'use client';

import { use, useState, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import { useProject, useProjects, refreshProjects } from '@/lib/hooks/useData';
import { useOrganization } from '@/contexts/OrganizationContext';
import { PROJECT_CONTENT_RAIL_WIDTH } from '@/lib/layout';
import { ProjectManageDialog } from '@/components/ProjectManageDialog';
import { ActivityIconButton } from '@/components/ActivityIconButton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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
import { ProjectPageLoadingShell, SkeletonBlock } from '@/components/loading';

const T = {
  bg: 'var(--po-canvas)',
  border: 'var(--po-border)',
  cardBg: 'var(--po-panel)',
  cardBorder: 'var(--po-border-subtle)',
  text1: 'var(--po-text)',
  text2: 'var(--po-text-muted)',
  text3: 'var(--po-text-disabled)',
  text4: 'var(--po-filetree-rail)',
  fontSans:
    'var(--po-font-sans)',
  fontMono:
    'var(--po-font-mono)',
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

// Role-tag colors. Kept saturated on purpose — these are user-facing
// permission signals, not chrome, so they need to register at a glance
// against the neutral page background.
const ROLE_COLORS: Record<string, string> = {
  admin: 'var(--po-warning)',
  editor: 'var(--po-accent)',
  viewer: 'var(--po-text-subtle)',
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

function memberDisplayName(member: { display_name?: string | null; email?: string | null }) {
  return member.display_name || member.email || 'Unknown member';
}

interface SettingsPageProps {
  params: Promise<{ projectId: string }>;
}

function ProjectMembersSkeleton() {
  return (
    <>
      {Array.from({ length: 2 }).map((_, index) => (
        <div
          key={index}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 12px',
            borderRadius: 7,
            background: 'var(--po-control)',
            border: `1px solid ${T.cardBorder}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SkeletonBlock width={28} height={28} radius={999} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <SkeletonBlock width={132} height={10} radius={3} />
              <SkeletonBlock width={176} height={9} radius={3} />
            </div>
          </div>
          <SkeletonBlock width={70} height={10} radius={3} />
        </div>
      ))}
    </>
  );
}

export default function ProjectSettingsPage({ params }: SettingsPageProps) {
  const { projectId } = use(params);
  const router = useRouter();
  const { session, isAuthReady } = useAuth();
  const {
    currentOrg,
    members: orgMembers,
    myRole: orgRole,
    isMembersLoading: orgMembersLoading,
  } = useOrganization();

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

  const {
    data: projectMembers = [],
    isLoading: projectMembersLoading,
    mutate: mutateProjectMembers,
  } =
    useSWR<ProjectMember[]>(
      session ? ['project-members', projectId] : null,
      async () => {
        try {
          return await getProjectMembers(projectId);
        } catch {
          // project_members table might not exist yet
          return [];
        }
      },
      { revalidateOnFocus: false },
    );
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
  const [memberRemoval, setMemberRemoval] = useState<{ userId: string; name: string } | null>(null);
  const [memberRemovalLoading, setMemberRemovalLoading] = useState(false);

  const isOrgOwner = orgRole === 'owner';

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
      await mutateProjectMembers();
      setFeedback({ type: 'success', msg: 'Member added successfully.' });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Failed to add member' });
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await updateProjectMemberRole(projectId, userId, newRole);
      await mutateProjectMembers();
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Failed to update role' });
    }
  };

  const handleConfirmRemoveMember = async () => {
    if (!memberRemoval) return;
    setMemberRemovalLoading(true);
    try {
      await removeProjectMember(projectId, memberRemoval.userId);
      await mutateProjectMembers();
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Failed to remove member' });
    } finally {
      setMemberRemovalLoading(false);
      setMemberRemoval(null);
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
  // "settings just freezes". Keep the final 46px header band mounted
  // during loading so the loader doesn't jump when content paints.
  if (!isAuthReady || isLoading || routeProjectLoading || !currentProject) {
    return <ProjectPageLoadingShell title="Settings" />;
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
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--po-text)' }}>
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
                    ? 'color-mix(in srgb, var(--po-danger) 8%, transparent)'
                    : 'color-mix(in srgb, var(--po-success) 8%, transparent)',
                border: `1px solid ${feedback.type === 'error' ? 'color-mix(in srgb, var(--po-danger) 24%, transparent)' : 'color-mix(in srgb, var(--po-success) 24%, transparent)'}`,
                color: feedback.type === 'error' ? 'var(--po-danger)' : 'var(--po-success)',
                animation: 'dialog-fade-in 0.2s ease-out',
              }}
            >
              {feedback.msg}
              <ActivityIconButton
                kind="close"
                title="Dismiss"
                size="sm"
                onClick={() => setFeedback(null)}
              />
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
                          background: 'var(--po-control)',
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
                          background: 'var(--po-control)',
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
                      background: 'var(--po-control)',
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
                    (a dark literal over `var(--po-filetree-rail)`) read as a
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
                      background: 'var(--po-hover)',
                      border: `1px solid ${T.cardBorder}`,
                      borderRadius: 7,
                      padding: 3,
                    }}
                  >
                    <button
                      onClick={() => handleVisibilityChange('org')}
                      style={{
                        height: 30,
                        padding: '0 14px',
                        background:
                          visibility === 'org'
                            ? 'var(--po-border)'
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
                        height: 30,
                        padding: '0 14px',
                        background:
                          visibility === 'private'
                            ? 'var(--po-border)'
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
                    {!showAddMember && !orgMembersLoading && availableOrgMembers.length > 0 && (
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
                        background: 'var(--po-control)',
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
                        <option value="" disabled>
                          {orgMembersLoading ? 'Loading members...' : 'Select an organization member...'}
                        </option>
                        {availableOrgMembers.map(m => (
                          <option key={m.user_id} value={m.user_id}>
                            {memberDisplayName(m)}
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
                    {projectMembersLoading && projectMembers.length === 0 ? (
                      <ProjectMembersSkeleton />
                    ) : projectMembers.length === 0 && !showAddMember && (
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
                      const name = memberDisplayName(m);
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
                            background: 'var(--po-control)',
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
                                  background: 'var(--po-border-subtle)',
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
                              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--po-text)' }}>{name}</div>
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
                                  height: 30,
                                  fontSize: 11.5,
                                  fontWeight: 500,
                                  color: ROLE_COLORS[m.role] || 'var(--po-text)',
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
                              onClick={() => setMemberRemoval({ userId: m.user_id, name })}
                              style={{ width: 30, height: 30, background: 'none', border: 'none', cursor: 'pointer', color: T.text3, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: `color 0.15s ${T.ease}` }}
                              title="Remove member"
                              onMouseEnter={e => (e.currentTarget.style.color = 'var(--po-danger)')}
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
            <h2 style={{ ...sectionTitle, color: 'var(--po-danger)' }}>Danger Zone</h2>
            <div
              style={{
                border: '1px solid color-mix(in srgb, var(--po-danger) 20%, transparent)',
                borderRadius: 8,
                overflow: 'hidden',
                background: 'color-mix(in srgb, var(--po-danger) 5%, transparent)',
              }}
            >
              <div style={row}>
                <div>
                  <label style={{ ...labelStyle, color: 'var(--po-danger)' }}>Delete Project</label>
                  <div style={descStyle}>Permanently remove this project and all its data.</div>
                </div>
                <button
                  onClick={() => setDeleteDialogOpen(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    height: 30,
                    padding: '0 12px',
                    background: 'color-mix(in srgb, var(--po-danger) 14%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--po-danger) 34%, transparent)',
                    borderRadius: 6,
                    color: 'var(--po-danger)',
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: T.fontSans,
                    cursor: 'pointer',
                    transition: `background 0.15s ${T.ease}, color 0.15s ${T.ease}, border-color 0.15s ${T.ease}`,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'color-mix(in srgb, var(--po-danger) 20%, transparent)';
                    e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--po-danger) 45%, transparent)';
                    e.currentTarget.style.color = 'var(--po-danger)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'color-mix(in srgb, var(--po-danger) 12%, transparent)';
                    e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--po-danger) 32%, transparent)';
                    e.currentTarget.style.color = 'var(--po-danger)';
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
        <ProjectManageDialog
          mode="delete"
          projectId={currentProject.id}
          projects={scopedProjects}
          onClose={() => setDeleteDialogOpen(false)}
          onDeleted={() => router.push('/home')}
        />
      )}
      <ConfirmDialog
        open={memberRemoval !== null}
        title={memberRemoval ? `Remove ${memberRemoval.name}?` : 'Remove member?'}
        description="This removes the member from this project. They may still have access through the organization if the project is organization-visible."
        confirmLabel="Remove"
        loading={memberRemovalLoading}
        onCancel={() => {
          if (!memberRemovalLoading) setMemberRemoval(null);
        }}
        onConfirm={() => void handleConfirmRemoveMember()}
      />
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
// at low alpha (`var(--po-inset)`, `var(--po-overlay)`, `var(--po-filetree-rail)`) and a 4px box-shadow
// on every card, which gave the page a "settings-form 2018" feel
// against the rest of the chrome. The replacements use translucent
// borders + a subtle `var(--po-panel)` lift instead.
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
  color: 'var(--po-text)',
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
// shape (30px tall, 12px text, transparent → 0.05-alpha hover). One
// neutral button across the whole project surface.
const btnGhost: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 30,
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
  background: 'var(--po-border-subtle)',
  borderColor: 'var(--po-border-strong)',
  color: T.text1,
};

const selectStyle: CSSProperties = {
  flex: 1,
  background: 'var(--po-panel)',
  border: `1px solid ${T.cardBorder}`,
  borderRadius: 6,
  padding: '6px 10px',
  color: 'var(--po-text)',
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
  e.currentTarget.style.background = 'var(--po-hover)';
  e.currentTarget.style.borderColor = 'var(--po-border-strong)';
  e.currentTarget.style.color = T.text1;
}
function onGhostLeave(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'transparent';
  e.currentTarget.style.borderColor = T.border;
  e.currentTarget.style.color = T.text2;
}

function onPrimaryEnter(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'var(--po-border-strong)';
  e.currentTarget.style.borderColor = 'var(--po-border-strong)';
}
function onPrimaryLeave(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'var(--po-border-subtle)';
  e.currentTarget.style.borderColor = 'var(--po-border-strong)';
}
