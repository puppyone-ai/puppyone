'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  deleteScope,
  regenerateScopeKey,
  updateScope,
  type RepoScope,
} from '@/lib/repoApi';
import { Dots } from '@/components/loading';
import {
  COLOR_BG_CARD,
  COLOR_BG_SUNKEN,
  COLOR_BORDER,
  COLOR_BORDER_HOVER,
  COLOR_DANGER,
  COLOR_DANGER_BG,
  COLOR_DANGER_BORDER,
  COLOR_DANGER_FAINT,
  COLOR_FG,
  COLOR_FG_DIM,
  COLOR_FG_MUTED,
  FONT_MONO,
} from './tokens';

/**
 * ScopeSettingsBlock — the full Settings panel for an access point.
 *
 * Keep this page lightweight. Connector-level capabilities now own the
 * detailed permission story, so Settings only keeps scope identity,
 * credential management, and deletion.
 *
 * The block renders as the dedicated Settings sub-page for a scope.
 * When dirty, a Save / Discard footer appears at the bottom so the
 * user can commit a batch of edits (rather than per-control auto-PATCH,
 * which would make the destructive `rw → r` flip happen mid-form).
 *
 * Dirty state is reported up via `onDirtyChange` so the parent can:
 *   - show an "unsaved" indicator on the Settings header toggle
 *   - confirm before collapsing the block or closing the panel
 *
 * Save → updateScope → onMutated (refresh SWR caches) → resets dirty,
 * stays mounted (user can keep editing). Delete → onScopeDeleted
 * (panel close). Rotate → regenerateScopeKey → onMutated, stays
 * mounted.
 */
export function ScopeSettingsBlock({
  scope,
  projectId,
  onMutated,
  onScopeDeleted,
  onDirtyChange,
  accessMethods,
}: {
  readonly scope: RepoScope;
  readonly projectId: string;
  readonly onMutated: () => Promise<unknown>;
  readonly onScopeDeleted: () => void;
  readonly accessMethods?: React.ReactNode;
  /** Lift dirty state to parent so the panel chrome ([⚙ Settings]
   *  toggle / [×] close) can confirm before discarding edits. Called
   *  on every dirty-change transition; the parent stores it as React
   *  state and gates close handlers on it. */
  readonly onDirtyChange?: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(scope.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-action confirm states.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);

  // Access key reveal/copy state.
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  // Reset everything when the user navigates to a different scope so a
  // half-armed destructive action doesn't leak across.
  useEffect(() => {
    setName(scope.name);
    setError(null);
    setConfirmDelete(false);
    setConfirmRotate(false);
    setKeyRevealed(false);
    setKeyCopied(false);
  }, [scope.id, scope.name, scope.access_key]);

  const dirty = name.trim() !== scope.name;

  // Push dirty up. Effect runs after render so consumers see consistent
  // state. The dependency on `onDirtyChange` itself is fine because
  // parent should pass a stable callback (usually via useCallback);
  // if not, the worst case is one extra notification per render.
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // ── Mutations ─────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await updateScope(projectId, scope.id, {
        // Root scope name is locked at the DB layer; sending the
        // original value is a no-op but keeps the patch consistent.
        name: scope.is_root ? scope.name : (name.trim() || scope.name),
      });
      await onMutated();
      // Stays mounted; SWR refresh will re-pass scope props and the
      // reset effect will sync local form back to the saved values
      // (dirty becomes false → footer auto-hides).
    } catch (e) {
      setError((e as Error).message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [projectId, scope.id, scope.is_root, scope.name, name, onMutated]);

  const handleDiscard = useCallback(() => {
    setName(scope.name);
    setError(null);
  }, [scope.name]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      // Auto-disarm in 4s so an accidental first click doesn't leave
      // the button in a destructive state if the user wanders off.
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteScope(projectId, scope.id);
      await onMutated();
      onScopeDeleted();
    } catch (e) {
      setError((e as Error).message || 'Failed to delete');
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [confirmDelete, projectId, scope.id, onMutated, onScopeDeleted]);

  const handleRotate = useCallback(async () => {
    if (!confirmRotate) {
      setConfirmRotate(true);
      setTimeout(() => setConfirmRotate(false), 4000);
      return;
    }
    setRotating(true);
    setError(null);
    try {
      await regenerateScopeKey(projectId, scope.id);
      await onMutated();
      // After rotate, the new key arrives via SWR → reset effect
      // re-syncs local state. Reveal stays as user had it.
      setKeyCopied(false);
    } catch (e) {
      setError((e as Error).message || 'Failed to regenerate key');
    } finally {
      setRotating(false);
      setConfirmRotate(false);
    }
  }, [confirmRotate, projectId, scope.id, onMutated]);

  const handleCopyKey = useCallback(async () => {
    if (!scope.access_key) return;
    try {
      await navigator.clipboard.writeText(scope.access_key);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 1500);
    } catch {
      // Clipboard permission denied. Fall through silently — the user
      // can still reveal and select-copy manually.
    }
  }, [scope.access_key]);

  // ── Render helpers ────────────────────────────────────────────────────

  const maskedKey = scope.access_key
    ? `${scope.access_key.slice(0, 4)}${'•'.repeat(Math.max(0, scope.access_key.length - 8))}${scope.access_key.slice(-4)}`
    : '—';

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <Card>
        <FieldLabel>Name</FieldLabel>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={scope.is_root}
          style={{
            background: COLOR_BG_SUNKEN,
            border: `1px solid ${COLOR_BORDER}`,
            borderRadius: 6,
            color: COLOR_FG,
            fontSize: 12,
            padding: '6px 10px',
            outline: 'none',
            opacity: scope.is_root ? 0.6 : 1,
          }}
        />
        {scope.is_root && (
          <FieldHelp>Root access keeps the project name.</FieldHelp>
        )}
      </Card>

      <Card>
        <FieldLabel>Access key</FieldLabel>
        <FieldHelp>
          Included in copied prompts and connector setup. Regenerate only if it leaked.
        </FieldHelp>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: COLOR_BG_SUNKEN,
            border: `1px solid ${COLOR_BORDER}`,
            borderRadius: 6,
            padding: '5px 6px 5px 10px',
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: FONT_MONO,
              fontSize: 12,
              color: scope.access_key ? COLOR_FG : COLOR_FG_DIM,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              userSelect: keyRevealed ? 'all' : 'none',
            }}
          >
            {keyRevealed ? scope.access_key || '—' : maskedKey}
          </span>
          <IconButton
            ariaLabel={keyRevealed ? 'Hide access key' : 'Reveal access key'}
            onClick={() => setKeyRevealed((v) => !v)}
            disabled={!scope.access_key}
          >
            {keyRevealed ? <EyeOffIcon /> : <EyeIcon />}
          </IconButton>
          <IconButton
            ariaLabel="Copy access key"
            onClick={handleCopyKey}
            disabled={!scope.access_key}
            title={keyCopied ? 'Copied' : 'Copy'}
          >
            {keyCopied ? <CheckIcon /> : <CopyIcon />}
          </IconButton>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={handleRotate}
            disabled={rotating || !scope.access_key}
            style={{
              height: 30,
              padding: '0 12px',
              fontSize: 12,
              fontWeight: 500,
              color: confirmRotate ? COLOR_DANGER_FAINT : COLOR_FG,
              background: confirmRotate
                ? COLOR_DANGER_BG
                : 'var(--po-hover)',
              border: `1px solid ${
                confirmRotate ? COLOR_DANGER_BORDER : COLOR_BORDER_HOVER
              }`,
              borderRadius: 6,
              cursor: rotating || !scope.access_key ? 'default' : 'pointer',
              opacity: !scope.access_key ? 0.5 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {rotating && <Dots size="xs" />}
            <RotateIcon />
            {rotating
              ? 'Regenerating…'
              : confirmRotate
                ? 'Confirm regenerate'
                : 'Regenerate'}
          </button>
          {confirmRotate && !rotating && (
            <span style={{ fontSize: 12, color: COLOR_DANGER_FAINT }}>
              Will invalidate all current CLI / Sync clients.
            </span>
          )}
        </div>
      </Card>

      {accessMethods}

      {/* Danger zone — delete, isolated at the bottom so a stray
          click on the way out can't catch it. Two-click confirm; root
          hard-disabled (DB enforces "exactly one root per project"). */}
      <Card danger>
        <FieldLabel danger>Danger zone</FieldLabel>
        <FieldHelp>
          Deletes this access point and cascades to its built-in cli + agent
          connectors. Bound third-party integrations must be removed first.
        </FieldHelp>
        <button
          type="button"
          onClick={handleDelete}
          disabled={scope.is_root || deleting}
          title={scope.is_root ? 'Root scope cannot be deleted' : undefined}
          style={{
            alignSelf: 'flex-start',
            height: 30,
            padding: '0 12px',
            fontSize: 12,
            fontWeight: 500,
            color: scope.is_root
              ? COLOR_FG_DIM
              : confirmDelete
                ? COLOR_DANGER_FAINT
                : COLOR_DANGER,
            background: scope.is_root
              ? 'transparent'
              : confirmDelete
                ? COLOR_DANGER_BG
                : 'transparent',
            border: `1px solid ${
              scope.is_root
                ? COLOR_BORDER
                : confirmDelete
                  ? COLOR_DANGER
                  : COLOR_DANGER_BORDER
            }`,
            borderRadius: 6,
            cursor: scope.is_root ? 'not-allowed' : 'pointer',
            opacity: scope.is_root ? 0.5 : 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {deleting && <Dots size="xs" tone="danger" />}
          {deleting
            ? 'Deleting…'
            : confirmDelete
              ? 'Confirm delete'
              : 'Delete access point'}
        </button>
      </Card>

      {error && (
        <div
          style={{
            fontSize: 12,
            color: COLOR_DANGER_FAINT,
            padding: '8px 12px',
            borderRadius: 6,
            background: COLOR_DANGER_BG,
            border: `1px solid ${COLOR_DANGER_BORDER}`,
          }}
        >
          {error}
        </div>
      )}

      {/* Save / Discard footer — only present when the form has dirty
          edits. Keeping it inline avoids a sticky strip competing with
          the settings rows. The parent panel confirms before leaving
          while dirty. */}
      {dirty && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 8,
            background: COLOR_BG_CARD,
            border: `1px solid ${COLOR_BORDER_HOVER}`,
          }}
        >
          <span style={{ fontSize: 12, color: COLOR_FG_MUTED, flex: 1 }}>
            Unsaved changes
          </span>
          <button
            type="button"
            onClick={handleDiscard}
            disabled={saving}
            style={{
              height: 30,
              padding: '0 12px',
              fontSize: 12,
              color: COLOR_FG,
              background: 'var(--po-hover)',
              border: `1px solid ${COLOR_BORDER_HOVER}`,
              borderRadius: 6,
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              height: 30,
              padding: '0 14px',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--po-inset)',
              background: saving ? COLOR_BORDER_HOVER : COLOR_FG,
              border: `1px solid ${saving ? COLOR_BORDER_HOVER : COLOR_FG}`,
              borderRadius: 6,
              cursor: saving ? 'default' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {saving && <Dots size="xs" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </section>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function Card({
  children,
  danger = false,
}: {
  readonly children: React.ReactNode;
  readonly danger?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        padding: danger ? 12 : '0 0 16px',
        borderRadius: danger ? 8 : 0,
        border: danger ? `1px solid ${COLOR_DANGER_BORDER}` : 'none',
        borderBottom: danger ? 'none' : '1px solid var(--po-divider)',
        background: danger
          ? 'color-mix(in srgb, var(--po-danger) 6%, transparent)'
          : 'transparent',
      }}
    >
      {children}
    </div>
  );
}

function FieldLabel({
  children,
  danger = false,
}: {
  readonly children: React.ReactNode;
  readonly danger?: boolean;
}) {
  return (
    <div
      style={{
        fontSize: 14,
        fontWeight: 600,
        color: danger ? COLOR_DANGER_FAINT : COLOR_FG,
      }}
    >
      {children}
    </div>
  );
}

function FieldHelp({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        lineHeight: 1.45,
        color: COLOR_FG_DIM,
      }}
    >
      {children}
    </div>
  );
}

function IconButton({
  children,
  onClick,
  ariaLabel,
  disabled = false,
  title,
}: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly title?: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title || ariaLabel}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        padding: 0,
        borderRadius: 6,
        border: 'none',
        background: !disabled && hovered ? 'var(--po-active)' : 'transparent',
        color: disabled
          ? COLOR_FG_DIM
          : hovered
            ? COLOR_FG
            : COLOR_FG_MUTED,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.12s ease, color 0.12s ease',
      }}
    >
      {children}
    </button>
  );
}

// ── Inline icons (Lucide stroke geometry, sized 14×14) ────────────────────

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
