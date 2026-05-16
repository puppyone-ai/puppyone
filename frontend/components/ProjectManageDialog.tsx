'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectInfo } from '../lib/projectsApi';
import {
  createProject,
  updateProject,
  deleteProject,
} from '../lib/projectsApi';
import { refreshProjects } from '../lib/hooks/useData';
import { useOrganization } from '@/contexts/OrganizationContext';
import { Dots } from './loading';
import { ActionButton } from './ui/ActionButton';
import { DangerNotice } from './ui/DangerNotice';
import { DialogRoot, DialogSurface } from './ui/Dialog';
import { Field, TextAreaField, TextField } from './ui/Field';

// ── Visual tokens ────────────────────────────────────────────
const ACCENT = 'var(--po-success)';
const BORDER = 'var(--po-border)';
const BG = 'var(--po-panel)';
type DialogMode = 'create' | 'edit' | 'delete';

type ProjectManageDialogProps = {
  mode: DialogMode;
  projectId: string | null;
  projects: ProjectInfo[];
  onClose: () => void;
  onDeleted?: () => void;
  onModeChange?: (mode: DialogMode) => void;
};

export function ProjectManageDialog({
  mode,
  projectId,
  projects,
  onClose,
  onDeleted,
}: ProjectManageDialogProps) {
  const router = useRouter();
  const { currentOrg } = useOrganization();
  const project = projectId ? projects.find(p => p.id === projectId) : null;

  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description || '');
    }
  }, [project]);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const finalName = name.trim() || 'Untitled Project';

    try {
      if (mode === 'edit' && projectId) {
        setLoading(true);
        await updateProject(projectId, finalName, description);
        await refreshProjects(currentOrg?.id);
        onClose();
      } else {
        onClose();
        const created = await createProject(
          finalName,
          '',
          currentOrg?.id,
          false
        );
        // Jump straight into the new project. Refresh the org project list in
        // the background so navigation is not blocked by a home-page reload.
        router.push(`/projects/${created.id}/data`);
        void refreshProjects(currentOrg?.id);
      }
    } catch (error) {
      console.error('Failed to save project:', error);
      alert(
        'Operation failed: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      await deleteProject(projectId);
      await refreshProjects(currentOrg?.id);
      onClose();
      onDeleted?.();
    } catch (error) {
      console.error('Failed to delete project:', error);
      alert(
        'Delete failed: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogRoot onClose={onClose} style={{ padding: 24 }}>
      <DialogSurface
        width={460}
        maxWidth="100%"
        style={{
          background: BG,
          border: `1px solid ${BORDER}`,
          boxShadow:
            '0 24px 56px var(--po-shadow), 0 0 0 1px var(--po-panel) inset',
        }}
      >
        {mode === 'delete' ? (
          <DeleteBody
            projectName={project?.name}
            onClose={onClose}
            onConfirm={handleDelete}
            loading={loading}
          />
        ) : mode === 'edit' ? (
          <EditBody
            name={name}
            setName={setName}
            description={description}
            setDescription={setDescription}
            onClose={onClose}
            onSubmit={handleSubmit}
            loading={loading}
          />
        ) : (
          <CreateBody
            name={name}
            setName={setName}
            onClose={onClose}
            onSubmit={handleSubmit}
            loading={loading}
          />
        )}
      </DialogSurface>
    </DialogRoot>
  );
}

// ─────────────────────────────────────────────────────────────
// CREATE BODY
// ─────────────────────────────────────────────────────────────

function CreateBody({
  name,
  setName,
  onClose,
  onSubmit,
  loading,
}: {
  name: string;
  setName: (v: string) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  loading: boolean;
}) {
  return (
    <form onSubmit={onSubmit}>
      <div
        style={{
          padding: '24px 22px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* ── name ── */}
        <Field label="New project name">
          <TextField
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Untitled"
            autoFocus
          />
        </Field>

        <Field label="Start">
          <StartEmptyCard />
        </Field>
      </div>

      <FooterBar
        onClose={onClose}
        primaryLabel={loading ? 'Creating…' : 'Create Project'}
        loading={loading}
      />
    </form>
  );
}

function StartEmptyCard() {
  return (
    <div
      style={{
        width: '100%',
        minHeight: 74,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 8,
        border: '1px solid color-mix(in srgb, var(--po-success) 45%, transparent)',
        background: 'color-mix(in srgb, var(--po-success) 10%, transparent)',
        color: 'var(--po-text)',
        textAlign: 'left',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          border: '1px solid color-mix(in srgb, var(--po-success) 58%, transparent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: ACCENT,
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--po-text)' }}>
            Start empty
          </span>
          <span style={{
            fontSize: 10,
            lineHeight: '14px',
            padding: '1px 6px',
            borderRadius: 999,
            color: 'var(--po-success)',
            background: 'color-mix(in srgb, var(--po-success) 15%, transparent)',
            border: '1px solid color-mix(in srgb, var(--po-success) 26%, transparent)',
          }}>
            Recommended
          </span>
        </span>
        <span style={{ display: 'block', fontSize: 12, lineHeight: 1.45, color: 'var(--po-text-muted)' }}>
          Open the workspace first, then import from GitHub, Notion, Obsidian/local folders, URLs, or files.
        </span>
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// EDIT BODY
// ─────────────────────────────────────────────────────────────

function EditBody({
  name,
  setName,
  description,
  setDescription,
  onClose,
  onSubmit,
  loading,
}: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  loading: boolean;
}) {
  return (
    <form onSubmit={onSubmit}>
      <div
        style={{
          padding: '24px 22px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <Field label="Project name">
          <TextField value={name} onChange={e => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Description" hint="Optional">
          <TextAreaField
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
          />
        </Field>
      </div>
      <FooterBar
        onClose={onClose}
        primaryLabel={loading ? 'Saving…' : 'Save Changes'}
        loading={loading}
      />
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// DELETE BODY
// ─────────────────────────────────────────────────────────────

function DeleteBody({
  projectName,
  onClose,
  onConfirm,
  loading,
}: {
  projectName: string | undefined;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <div>
      <div style={{ padding: '24px 22px 22px' }}>
        <DangerNotice title={`Delete ${projectName ? `"${projectName}"` : 'this project'}?`}>
          This permanently deletes the project and every context node inside
          it. This action cannot be undone.
        </DangerNotice>
      </div>
      <FooterBar
        onClose={onClose}
        loading={loading}
        primaryLabel={loading ? 'Deleting…' : 'Delete Project'}
        primaryDanger
        onPrimaryClick={onConfirm}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SHARED ATOMS
// ─────────────────────────────────────────────────────────────

function FooterBar({
  onClose,
  primaryLabel,
  loading,
  primaryDanger,
  onPrimaryClick,
}: {
  onClose: () => void;
  primaryLabel: string;
  loading: boolean;
  primaryDanger?: boolean;
  onPrimaryClick?: () => void;
}) {
  return (
    <div
      style={{
        padding: '12px 16px',
        background: 'var(--po-canvas)',
        borderTop: `1px solid ${BORDER}`,
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <ActionButton
        type="button"
        onClick={onClose}
      >
        Cancel
      </ActionButton>
      <ActionButton
        type={onPrimaryClick ? 'button' : 'submit'}
        onClick={onPrimaryClick}
        variant={primaryDanger ? 'danger' : 'primary'}
        loading={loading}
      >
        {loading && <Dots size="xs" />}
        {primaryLabel}
      </ActionButton>
    </div>
  );
}
