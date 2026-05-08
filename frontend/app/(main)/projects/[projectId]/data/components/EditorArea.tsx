'use client';

import React, { useEffect, useRef, useState } from 'react';
import { resolveFormat, isTextLikeCategory } from '@/lib/fileFormats';
import { VIEWERS } from '@/lib/viewers/registry';
import { type MarkdownViewMode } from '@/components/editors/markdown';
import { PageLoading } from '@/components/loading';
import { EditorSaveButton } from '@/components/editors/EditorSaveButton';
import type { SaveStatus } from '@/lib/hooks/useManualSave';
import dynamic from 'next/dynamic';

// Loaded on demand — only when user opens a GitHub-connected node.
// GitHub repos are a folder-shaped *connector*, not a file format,
// so they sit outside the file-format registry.
const GithubRepoView = dynamic(
  () => import('@/components/views/GithubRepoView').then((m) => ({ default: m.GithubRepoView })),
  { ssr: false }
);

import { ProjectWorkspaceView } from '@/components/ProjectWorkspaceView';
import type { EditorType } from '@/components/ProjectsHeader';
import type { McpToolPermissions } from '@/lib/mcpApi';

interface EditorAreaProps {
  activeNodeId: string;
  activeNodeType: string;
  activeMimeType: string | null;
  activeProject: { id: string; name: string } & Record<string, any>;
  currentTableData: any;
  /** Raw UTF-8 contents of the active file when its file format is
   *  text-like (markdown / code / yaml / csv / plaintext). For markdown
   *  this is the editing draft (may differ from server); for read-only
   *  formats it equals the server value. Empty for non-text formats. */
  textContent: string;
  /** True while the parent's text fetch is still pending. */
  isLoadingText: boolean;
  /** Five-state save status from the parent's text-editor save hook.
   *  Drives the floating save button at the top-right. Only meaningful
   *  for editable formats (currently just markdown). */
  saveStatus: SaveStatus;
  /** Markdown-only: WYSIWYG vs source toggle. */
  markdownViewMode: MarkdownViewMode;
  setMarkdownViewMode: (mode: MarkdownViewMode) => void;
  /** Called by editable text viewers (currently just markdown) when
   *  the user types. */
  onTextChange: (content: string) => void;
  /** Click handler for the save button + Cmd+S. */
  onSave: () => void;
  editorType: EditorType;
  configuredAccessPoints: { path: string; permissions: any }[];
  onActiveTableChange: (id: string) => void;
  onAccessPointChange: (path: string, permissions: McpToolPermissions) => void;
  onAccessPointRemove: (path: string) => void;
  onOpenDocument: (path: string, value: string) => void;
  onCreateTool: (path: string, value: any) => void;
}

export function EditorArea({
  activeNodeId,
  activeNodeType,
  activeMimeType,
  activeProject,
  currentTableData,
  textContent,
  isLoadingText,
  saveStatus,
  markdownViewMode,
  setMarkdownViewMode,
  onTextChange,
  onSave,
  editorType,
  configuredAccessPoints,
  onActiveTableChange,
  onAccessPointChange,
  onAccessPointRemove,
  onOpenDocument,
  onCreateTool,
}: EditorAreaProps) {
  // Connector-shaped nodes are dispatched by `activeNodeType`, not
  // by file format — they don't have a single underlying file.
  if (activeNodeType === 'github') {
    return (
      <GithubRepoView
        nodeId={activeNodeId}
        nodeName={currentTableData?.name || ''}
        content={currentTableData?.content}
        syncUrl={currentTableData?.sync_url ?? undefined}
      />
    );
  }

  // Resolve the file format from the active node. `activeNodeId` is
  // a path so it carries the extension; `activeMimeType` is the
  // server-detected fallback. The registry guarantees a non-null
  // result (UNKNOWN_FORMAT for anything we don't know).
  const format = resolveFormat({ name: activeNodeId, mimeType: activeMimeType });

  // Special viewers consume non-standard props and are dispatched
  // here. Currently only `json-table` — it consumes `currentTableData`
  // (already parsed by the data hook) and the full workspace
  // plumbing, so it can't go through the generic VIEWERS registry.
  if (format.defaultViewer === 'json-table') {
    return (
      <ProjectWorkspaceView
        projectId={activeProject.id}
        project={activeProject}
        activeTableId={activeNodeId}
        onActiveTableChange={onActiveTableChange}
        onTreePathChange={() => {}}
        editorType={editorType}
        configuredAccessPoints={configuredAccessPoints}
        onAccessPointChange={onAccessPointChange}
        onAccessPointRemove={onAccessPointRemove}
        onOpenDocument={onOpenDocument}
        onCreateTool={onCreateTool}
      />
    );
  }

  // For text-like content (markdown / code / structured-as-text),
  // wait for the parent's text fetch to complete before mounting
  // the viewer — otherwise editors momentarily mount with an empty
  // string and flash a spinner of their own.
  const needsText = isTextLikeCategory(format);
  if (needsText && isLoadingText) {
    return <PageLoading variant="fill" />;
  }

  // The path is the canonical identity. `nodeName` is just the
  // final segment for display — UI chrome only, never logic.
  const nodeName = activeNodeId.split('/').pop() || '';
  const ViewerDef = VIEWERS[format.defaultViewer];
  const Viewer = ViewerDef.component;

  // The invisible-header chrome strip is rendered for every markdown
  // file (editable or not) so the view-mode toggle has a stable home.
  // The save button only appears inside it when the file is editable.
  const isMarkdown = format.defaultViewer === 'markdown-editor';
  const showSaveChrome = isMarkdown && format.editable;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {isMarkdown && (
        <InvisibleHeader
          markdownViewMode={markdownViewMode}
          onMarkdownViewModeChange={setMarkdownViewMode}
          saveStatus={showSaveChrome ? saveStatus : 'clean'}
          onSave={onSave}
        />
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Viewer
          projectId={activeProject.id}
          filePath={activeNodeId}
          nodeName={nodeName}
          textContent={needsText ? textContent : undefined}
          isTextLoading={isLoadingText}
          monacoLanguage={format.monacoLanguage}
          formatLabel={format.label}
          mimeType={format.mimeTypes[0] ?? activeMimeType ?? undefined}
          editable={format.editable}
          onTextChange={format.editable ? onTextChange : undefined}
          markdownViewMode={markdownViewMode}
          onMarkdownViewModeChange={setMarkdownViewMode}
        />
      </div>
    </div>
  );
}

/**
 * InvisibleHeader — Obsidian-style strip at the top of every markdown
 * editor.
 *
 * Slots:
 *   - **Centre**: the save status row (text + button) when the doc
 *     is dirty/saving/saved/error. Empty when clean.
 *   - **Right**: a permanently visible 3-way view-mode picker
 *     (``wysiwyg`` ✏ / ``source`` </> / ``preview`` 👁). Click opens
 *     a dropdown.
 *
 * Why no filename: the page-level breadcrumb already shows it.
 *
 * The strip's height is always reserved so a clean ↔ dirty
 * transition never shifts the editor body mid-keystroke.
 */
function InvisibleHeader({
  markdownViewMode,
  onMarkdownViewModeChange,
  saveStatus,
  onSave,
}: {
  readonly markdownViewMode: MarkdownViewMode;
  readonly onMarkdownViewModeChange: (m: MarkdownViewMode) => void;
  readonly saveStatus: SaveStatus;
  readonly onSave: () => void;
}) {
  return (
    <div
      style={{
        // 40 px = 30 px Save CTA + 5 px breathing room top/bottom.
        // Tight enough that the strip recedes into the page chrome
        // when clean, but tall enough that the dirty CTA can sit in
        // it without feeling cramped.
        height: 40,
        flexShrink: 0,
        display: 'grid',
        // Symmetric 1fr / auto / 1fr keeps the centre slot optically
        // centred regardless of how wide the picker on the right is.
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        padding: '0 14px',
      }}
    >
      <div />
      <div style={{ justifySelf: 'center' }}>
        <EditorSaveButton status={saveStatus} onSave={onSave} />
      </div>
      <div style={{ justifySelf: 'end' }}>
        <ViewModePicker
          mode={markdownViewMode}
          onChange={onMarkdownViewModeChange}
        />
      </div>
    </div>
  );
}

// ── View-mode picker ────────────────────────────────────────────

interface ViewOption {
  value: MarkdownViewMode;
  label: string;
  Icon: React.FC;
}

// Original PuppyOne terminology — the three concrete states a
// user can put the markdown surface into:
//   - ``Live view``  : visual rendering, edit-as-you-type (Milkdown).
//   - ``Source``     : raw markdown text, edit the source.
//   - ``Read only``  : visual rendering, locked (no editing).
const VIEW_OPTIONS: ViewOption[] = [
  { value: 'wysiwyg', label: 'Live view', Icon: PencilIcon },
  { value: 'source',  label: 'Source',    Icon: CodeIcon   },
  { value: 'preview', label: 'Read only', Icon: EyeIcon    },
];

/**
 * ViewModePicker — restrained trigger + minimal dropdown.
 *
 * Trigger: the current mode's icon in the same dim grey as the
 * page chrome's divider stroke (``rgba(255,255,255,0.08)``). No
 * border, no chevron — both would announce "I'm important" louder
 * than this control deserves.
 *
 * Menu: a tight three-row list. Each row is one line: a small icon
 * (the same icon that would appear in the trigger), then a single-
 * line label. No sublabels, no per-item border, no orange accent
 * on the active row. The active row carries a small ✓ in the same
 * neutral grey as the labels.
 */
function ViewModePicker({
  mode,
  onChange,
}: {
  readonly mode: MarkdownViewMode;
  readonly onChange: (m: MarkdownViewMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — standard dropdown affordances.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = VIEW_OPTIONS.find((o) => o.value === mode) ?? VIEW_OPTIONS[0];
  const TriggerIcon = current.Icon;

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={`View mode: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          borderRadius: 5,
          // Hover background is the only paint this control ever
          // gets. Like the Access pill chrome above, it earns no
          // resting border.
          background: open || hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
          border: 'none',
          // Resting tone tracks the page chrome's divider stroke
          // (``rgba(255,255,255,0.08)`` — see SidebarLayout's
          // header rule). The icon sits a hair more visible than
          // that line so a user actively hunting for it can find
          // it, then steps up to ``0.55`` on hover for clear intent
          // feedback. No coloured fill, no border, no chevron — the
          // control is entirely subordinate to the document.
          color: open || hovered
            ? 'rgba(255,255,255,0.55)'
            : 'rgba(255,255,255,0.22)',
          cursor: 'pointer',
          transition: 'background 0.12s ease, color 0.12s ease',
        }}
      >
        <TriggerIcon />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            // Icon + label + ✓ across three columns — 156 keeps the
            // longest label ("Read only") snug against neither edge.
            minWidth: 156,
            padding: 4,
            background: '#1a1a1a',
            border: '1px solid #262626',
            borderRadius: 6,
            boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
            zIndex: 40,
          }}
        >
          {VIEW_OPTIONS.map((opt) => (
            <ViewOptionRow
              key={opt.value}
              option={opt}
              active={opt.value === mode}
              onSelect={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ViewOptionRow({
  option,
  active,
  onSelect,
}: {
  readonly option: ViewOption;
  readonly active: boolean;
  readonly onSelect: () => void;
}) {
  const { Icon } = option;
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        // Tight rows — single-line labels in a calm list, not a
        // menu of headlines.
        padding: '5px 8px',
        background: hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
        border: 'none',
        borderRadius: 4,
        color: '#d4d4d8',
        fontSize: 12.5,
        fontWeight: 400,
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'background 0.1s ease',
      }}
    >
      {/* Mode icon — same glyph as the trigger uses when this mode
       *  is active. Grey on inactive rows, slightly brighter on the
       *  active row to mirror the trigger's hover feedback. */}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          color: active ? '#e4e4e7' : '#a3a3a3',
          flexShrink: 0,
        }}
      >
        <Icon />
      </span>
      <span style={{ flex: 1 }}>{option.label}</span>
      {/* Checkmark only appears for the active row. Same neutral
       *  grey as the label — a cue, not a callout. */}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          color: '#d4d4d8',
          flexShrink: 0,
        }}
      >
        {active && <CheckMini />}
      </span>
    </button>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CheckMini() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
