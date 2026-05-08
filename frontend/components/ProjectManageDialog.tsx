'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import type {
  ProjectInfo,
  ProjectTemplateInfo,
  ProjectTemplatePreviewNode,
} from '../lib/projectsApi';
import {
  createProject,
  updateProject,
  deleteProject,
  getProjectTemplates,
} from '../lib/projectsApi';
import { refreshProjects } from '../lib/hooks/useData';
import { useOrganization } from '@/contexts/OrganizationContext';
import { Dots } from './loading';

// ── Visual tokens ────────────────────────────────────────────
const ACCENT = '#329955';
const BORDER = '#2a2a2a';
const BORDER_HI = '#3a3a3a';
const BG = '#0f0f0f';
const PANEL_BG = '#0d0d0d';
const TAB_BG = '#171717';
// monospace ONLY for file paths inside template previews
const FONT_MONO =
  'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace';

const FILE_ICON: Record<string, string> = {
  folder: '/icons/folder.svg',
  json: '/icons/json-doc.svg',
  markdown: '/icons/markdown-doc.svg',
  file: '/icons/markdown-doc.svg',
};
const fileIcon = (type: string) => FILE_ICON[type] ?? FILE_ICON.file;

// Virtual "blank" template — keeps grid logic uniform & always first
const BLANK_TEMPLATE: ProjectTemplateInfo = {
  id: 'blank',
  name: 'Blank',
  description: '',
  icon: '',
  preview: [],
};

type DialogMode = 'create' | 'edit' | 'delete';

type ProjectManageDialogProps = {
  mode: DialogMode;
  projectId: string | null;
  projects: ProjectInfo[];
  onClose: () => void;
  onModeChange?: (mode: DialogMode) => void;
};

export function ProjectManageDialog({
  mode,
  projectId,
  projects,
  onClose,
}: ProjectManageDialogProps) {
  const router = useRouter();
  const { currentOrg } = useOrganization();
  const project = projectId ? projects.find(p => p.id === projectId) : null;

  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [loading, setLoading] = useState(false);

  const [templates, setTemplates] = useState<ProjectTemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('blank');

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description || '');
    }
  }, [project]);

  useEffect(() => {
    if (mode === 'create') {
      getProjectTemplates().then(setTemplates).catch(console.error);
    }
  }, [mode]);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const allTemplates = [BLANK_TEMPLATE, ...templates];
  const selected = allTemplates.find(t => t.id === selectedTemplate);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const finalName =
      name.trim() ||
      (selected && selected.id !== 'blank' ? selected.name : 'Untitled Project');

    try {
      setLoading(true);
      if (mode === 'edit' && projectId) {
        await updateProject(projectId, finalName, description);
        await refreshProjects(currentOrg?.id);
        onClose();
      } else {
        const created = await createProject(
          finalName,
          '',
          currentOrg?.id,
          false,
          selectedTemplate === 'blank' ? undefined : selectedTemplate
        );
        await refreshProjects(currentOrg?.id);
        // Jump straight into the new project — saves the user an extra click.
        // [projectId]/page.tsx redirects to /home for us.
        router.push(`/projects/${created.id}`);
        onClose();
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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'relative',
          background: BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          width: mode === 'create' ? 580 : 460,
          maxWidth: '100%',
          boxShadow:
            '0 24px 56px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02) inset',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'pj-dialog-in 0.18s ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        <style jsx>{`
          @keyframes pj-dialog-in {
            from {
              opacity: 0;
              transform: translateY(6px) scale(0.99);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
        `}</style>

        {/* === Body (no header, no close button — esc + click-outside) === */}
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
            templates={allTemplates}
            selectedId={selectedTemplate}
            setSelectedId={setSelectedTemplate}
            onClose={onClose}
            onSubmit={handleSubmit}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CREATE BODY
// ─────────────────────────────────────────────────────────────

function CreateBody({
  name,
  setName,
  templates,
  selectedId,
  setSelectedId,
  onClose,
  onSubmit,
  loading,
}: {
  name: string;
  setName: (v: string) => void;
  templates: ProjectTemplateInfo[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  loading: boolean;
}) {
  const selected = templates.find(t => t.id === selectedId);
  const namePlaceholder =
    selected && selected.id !== 'blank' ? selected.name : 'Untitled';

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
          <Input
            value={name}
            onChange={setName}
            placeholder={namePlaceholder}
            autoFocus
          />
        </Field>

        {/* ── template ── */}
        <Field label="Template">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
            }}
          >
            {templates.map(t => (
              <TemplateCard
                key={t.id}
                template={t}
                selected={selectedId === t.id}
                onClick={() => setSelectedId(t.id)}
              />
            ))}
          </div>
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

// ─────────────────────────────────────────────────────────────
// TEMPLATE CARD
// Default: name + description fill the card.
// Hover: left half holds the name; right half slides in with file preview.
// ─────────────────────────────────────────────────────────────

const REVEAL_RATIO = 0.46; // width of the right (preview) panel on hover

function TemplateCard({
  template,
  selected,
  onClick,
}: {
  template: ProjectTemplateInfo;
  selected: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isBlank = template.id === 'blank';
  const preview = template.preview ?? [];

  // Default: no border, faint bg tint. Selected: subtle green tint + thin green hairline.
  const bg = selected
    ? 'rgba(50, 153, 85, 0.07)'
    : hovered
      ? 'rgba(255, 255, 255, 0.045)'
      : 'rgba(255, 255, 255, 0.022)';
  const borderColor = selected
    ? 'rgba(50, 153, 85, 0.42)'
    : hovered
      ? 'rgba(255, 255, 255, 0.06)'
      : 'transparent';

  // Reveal the preview only when *selected* — and Blank has nothing meaningful
  // to show, so we keep it as a single calm panel (description stays visible).
  const showPreview = selected && !isBlank;
  const leftWidthPct = showPreview ? `${(1 - REVEAL_RATIO) * 100}%` : '100%';
  const rightWidthPct = showPreview ? `${REVEAL_RATIO * 100}%` : '0%';

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: 'pointer',
        outline: 'none',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'relative',
          height: 72,
          background: bg,
          border: `1px solid ${borderColor}`,
          borderRadius: 6,
          overflow: 'hidden',
          transition:
            'background-color 180ms ease, border-color 180ms ease',
        }}
      >
        {/* Left panel: name + description (description fades when preview opens) */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: leftWidthPct,
            padding: '10px 12px',
            paddingRight: showPreview ? 10 : 12,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 3,
            boxSizing: 'border-box',
            overflow: 'hidden',
            transition:
              'width 280ms cubic-bezier(0.4, 0, 0.2, 1), padding-right 280ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
            }}
          >
            {selected && (
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: ACCENT,
                  flexShrink: 0,
                }}
              />
            )}
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                color: selected ? '#d4ead9' : '#cccccc',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                transition: 'color 0.15s',
              }}
            >
              {template.name}
            </span>
          </div>
          <div
            style={{
              fontSize: 11,
              color: '#6a6a6a',
              lineHeight: 1.4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              opacity: showPreview ? 0 : 1,
              transition: 'opacity 160ms ease',
            }}
          >
            {isBlank ? 'Empty workspace' : template.description}
          </div>
        </div>

        {/* Right panel: file preview — reveals when this template is selected.
            Skipped entirely for Blank (nothing meaningful to preview). */}
        {!isBlank && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: rightWidthPct,
              borderLeft: showPreview
                ? '1px dashed rgba(50,153,85,0.28)'
                : '1px dashed transparent',
              overflow: 'hidden',
              transition:
                'width 280ms cubic-bezier(0.4, 0, 0.2, 1), border-color 220ms ease',
              pointerEvents: 'none',
            }}
          >
            {/* Inner wrapper keeps preview at constant width while right panel grows */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                right: 0,
                width: `${REVEAL_RATIO * 100}%`,
                minWidth: 110,
                padding: '8px 10px',
                boxSizing: 'border-box',
                opacity: showPreview ? 1 : 0,
                transform: showPreview ? 'translateX(0)' : 'translateX(8px)',
                transition:
                  'opacity 200ms ease 60ms, transform 280ms cubic-bezier(0.4, 0, 0.2, 1) 60ms',
              }}
            >
              <FilePreviewGrid nodes={preview} compact />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FilePreviewGrid({
  nodes,
  compact,
}: {
  nodes: ProjectTemplatePreviewNode[];
  compact?: boolean;
}) {
  const limit = compact ? 4 : 8;
  const items = nodes.slice(0, limit);
  if (items.length === 0) {
    return <BlankPreview />;
  }
  // Compact reveal panel is narrow → 2-col tree-like list reads better than a grid.
  if (compact) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          height: '100%',
          justifyContent: 'center',
        }}
      >
        {items.map((node, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
            }}
          >
            <Image
              src={fileIcon(node.type)}
              alt={node.type}
              width={14}
              height={14}
              style={{ opacity: 0.7, flexShrink: 0 }}
            />
            <span
              style={{
                fontSize: 10.5,
                color: '#888',
                fontFamily: FONT_MONO,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: 1.2,
              }}
            >
              {node.name.replace(/\/$/, '')}
              {node.type === 'folder' && (
                <span style={{ color: '#444' }}>/</span>
              )}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        columnGap: 4,
        rowGap: 12,
        alignContent: 'center',
        height: '100%',
      }}
    >
      {items.map((node, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 3,
            minWidth: 0,
          }}
        >
          <Image
            src={fileIcon(node.type)}
            alt={node.type}
            width={24}
            height={24}
            style={{ opacity: 0.7 }}
          />
          <span
            style={{
              fontSize: 9.5,
              color: '#666',
              fontFamily: FONT_MONO,
              textAlign: 'center',
              width: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.1,
            }}
          >
            {node.name.replace(/\/$/, '')}
          </span>
        </div>
      ))}
    </div>
  );
}

function BlankPreview() {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#3a3a3a',
        fontSize: 22,
        fontWeight: 200,
      }}
    >
      +
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
  onSubmit: (e: React.FormEvent) => void;
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
          <Input value={name} onChange={setName} autoFocus />
        </Field>
        <Field label="Description" hint="Optional">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: PANEL_BG,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              fontSize: 14,
              color: '#ededed',
              outline: 'none',
              resize: 'vertical',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
              lineHeight: 1.5,
              transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = BORDER_HI)}
            onBlur={e => (e.currentTarget.style.borderColor = BORDER)}
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
        <p
          style={{
            color: '#ededed',
            marginBottom: 8,
            fontSize: 14,
            paddingRight: 24,
          }}
        >
          Delete{' '}
          <span style={{ fontWeight: 600 }}>
            {projectName ? `"${projectName}"` : 'this project'}
          </span>
          ?
        </p>
        <p
          style={{
            color: '#888',
            fontSize: 13,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          This permanently deletes the project and every context node inside
          it. This action cannot be undone.
        </p>
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: '#aaa',
            letterSpacing: 0,
          }}
        >
          {label}
        </span>
        {hint && (
          <span
            style={{
              fontSize: 11,
              color: '#555',
              fontWeight: 400,
            }}
          >
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      style={{
        width: '100%',
        padding: '10px 12px',
        background: PANEL_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        fontSize: 14,
        color: '#ededed',
        outline: 'none',
        boxSizing: 'border-box',
        transition: 'border-color 0.15s',
        fontFamily: 'inherit',
      }}
      onFocus={e => (e.currentTarget.style.borderColor = BORDER_HI)}
      onBlur={e => (e.currentTarget.style.borderColor = BORDER)}
    />
  );
}

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
  const dangerStyle: React.CSSProperties | undefined = primaryDanger
    ? {
        background: 'rgba(239,68,68,0.1)',
        color: '#ef4444',
        border: '1px solid rgba(239,68,68,0.3)',
      }
    : undefined;

  return (
    <div
      style={{
        padding: '12px 16px',
        background: '#0c0c0c',
        borderTop: `1px solid ${BORDER}`,
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <button
        type="button"
        onClick={onClose}
        style={{
          height: 32,
          padding: '0 14px',
          borderRadius: 8,
          border: `1px solid ${BORDER}`,
          background: 'transparent',
          color: '#bbb',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.15s',
          fontFamily: 'inherit',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = BORDER_HI;
          e.currentTarget.style.color = '#eee';
          e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = BORDER;
          e.currentTarget.style.color = '#bbb';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        Cancel
      </button>
      <button
        type={onPrimaryClick ? 'button' : 'submit'}
        onClick={onPrimaryClick}
        disabled={loading}
        style={{
          height: 32,
          padding: '0 16px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.12)',
          background: '#ededed',
          color: '#0a0a0a',
          fontSize: 13,
          fontWeight: 600,
          cursor: loading ? 'default' : 'pointer',
          fontFamily: 'inherit',
          transition: 'all 0.15s',
          opacity: loading ? 0.6 : 1,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          ...dangerStyle,
        }}
        onMouseEnter={e => {
          if (loading) return;
          if (primaryDanger) {
            e.currentTarget.style.background = 'rgba(239,68,68,0.15)';
          } else {
            e.currentTarget.style.background = '#fff';
          }
        }}
        onMouseLeave={e => {
          if (loading) return;
          if (primaryDanger) {
            e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
          } else {
            e.currentTarget.style.background = '#ededed';
          }
        }}
      >
        {loading && <Dots size="xs" />}
        {primaryLabel}
      </button>
    </div>
  );
}
