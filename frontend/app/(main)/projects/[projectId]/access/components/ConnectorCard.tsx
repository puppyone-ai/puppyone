'use client';

/**
 * ConnectorCard — the selected access point's full detail view.
 *
 * Responsibilities:
 *
 *   - Header: AP name (page-level title, *inline-editable* via hover →
 *     pencil → input), single attribute line, primary action button
 *     (Pause / Resume / Retry), and a real action-menu (Rename, Copy
 *     ID, Disconnect for third-party).
 *   - Body (always visible — no expand/collapse): paused-banner, the
 *     provider-specific Quick-Connect block, the Configuration panel,
 *     and a Recent-activity placeholder.
 *
 * The card is presentational; mutation lives in `useAccessData`. We
 * receive everything needed via props (`onPauseResume`, `onUpdate`,
 * `onDelete`, `pending`) so the card itself stays declarative and
 * testable in isolation.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { APP_Z_INDEX } from '@/lib/zIndex';
import { T } from '../lib/tokens';
import {
  PROVIDER_LABELS,
  STATUS_COLORS,
  STATUS_LABEL,
} from '../lib/constants';
import {
  getPrimaryAction,
  getTypeLine,
  timeAgo,
} from '../lib/format';
import {
  ChevronRightIcon,
  CopyIcon,
  EditIcon,
  MoreVerticalIcon,
  PauseIcon,
  PlayIcon,
  RetryIcon,
} from './icons';
import { GhostButton, SubSectionLabel } from './ui-blocks';
import { ConnectorAccessPanel } from './quick-connect';
import type { ConnectorEditPatch } from '../hooks/useAccessData';

// ─── Built-in providers ──────────────────────────────────────────────
//
// Built-ins (cli / agent / filesystem) are auto-created by the DB
// trigger and undeletable through the API. The frontend mirrors that
// rule by hiding the "Disconnect" menu item and the editable Direction
// dropdown for these providers — built-ins are fixed bidirectional and
// fixed presence, only `name` and `status` are user-controllable.
const BUILTIN_PROVIDERS = new Set(['cli', 'agent', 'filesystem']);

// ─── Connector card (one access point, expanded view) ────────────────

export function ConnectorCard({
  connector,
  scope,
  onPauseResume,
  onUpdate,
  onDelete,
  pending,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope | undefined;
  readonly onPauseResume: () => void;
  readonly onUpdate: (patch: ConnectorEditPatch) => Promise<void>;
  readonly onDelete: () => Promise<void>;
  readonly pending: boolean;
}) {
  const statusColor = STATUS_COLORS[connector.status] ?? T.text3;
  const action = getPrimaryAction(connector.status);
  const name = connector.name || PROVIDER_LABELS[connector.provider] || connector.provider;
  const isBuiltin = BUILTIN_PROVIDERS.has(connector.provider);

  // Shared name-editing state, controlled from two surfaces:
  //   - Hover-pencil on the header name (direct entry).
  //   - "Rename" item in the action menu (entry from the menu).
  // Both flip this flag; the input then lives inside <NameField>.
  const [editingName, setEditingName] = useState(false);

  return (
    <div
      style={{
        background: T.cardBg,
        border: `1px solid ${T.cardBorder}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: '16px 16px 14px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <NameField
            initial={name}
            editing={editingName}
            onStartEdit={() => setEditingName(true)}
            onCancel={() => setEditingName(false)}
            onSubmit={async (newName) => {
              setEditingName(false);
              if (newName !== name) {
                await onUpdate({ name: newName });
              }
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: T.text3,
              fontFamily: T.fontSans,
              minWidth: 0,
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {getTypeLine(connector)}
            </span>
            <span style={{ color: T.text4, flexShrink: 0 }}>·</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: statusColor,
                  boxShadow: `0 0 6px ${statusColor}88`,
                }}
              />
              <span style={{ color: statusColor, fontWeight: 500 }}>
                {STATUS_LABEL[connector.status] ?? connector.status}
              </span>
            </div>
            <span style={{ color: T.text4, flexShrink: 0 }}>·</span>
            <span style={{ color: T.text3, flexShrink: 0 }}>
              {timeAgo(connector.last_run_at)}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <GhostButton
            onClick={onPauseResume}
            disabled={pending}
            icon={
              action.icon === 'pause'
                ? <PauseIcon size={10} />
                : action.icon === 'play'
                  ? <PlayIcon size={10} />
                  : <RetryIcon size={10} />
            }
          >
            {action.label}
          </GhostButton>
          <ConnectorActionMenu
            connector={connector}
            isBuiltin={isBuiltin}
            onRename={() => setEditingName(true)}
            onDelete={onDelete}
          />
        </div>
      </div>

      <div style={{ height: 1, background: T.cardBorder, margin: '0 16px' }} />

      <div style={{ padding: '16px' }}>
        {connector.status === 'paused' && (
          <PausedBanner
            provider={connector.provider}
            onResume={onPauseResume}
            pending={pending}
          />
        )}
        <ConnectorAccessPanel connector={connector} scope={scope} />
        <ConnectorConfigPanel
          connector={connector}
          isBuiltin={isBuiltin}
          onUpdate={onUpdate}
          pending={pending}
        />
        <ConnectorActivityPanel />
      </div>
    </div>
  );
}

// ─── Inline-editable name (header) ───────────────────────────────────
//
// Two visual states:
//   - Read mode: name span; on hover the pencil icon fades in to hint
//     edit affordance. Click anywhere on the row → enter edit mode.
//   - Edit mode: <input> autofocus + select-all; Enter or blur commits;
//     Escape cancels. While the parent's onSubmit is in flight we
//     keep the input mounted (disabled + dim) so users see why the UI
//     hasn't updated yet — never flash back to read mode mid-flight.
//
// Errors revert the draft to `initial` and surface a tiny red helper
// below the input. The parent decides what counts as success/error
// (typically: SWR revalidation either updates `initial` or throws).
function NameField({
  initial,
  editing,
  onStartEdit,
  onCancel,
  onSubmit,
}: {
  readonly initial: string;
  readonly editing: boolean;
  readonly onStartEdit: () => void;
  readonly onCancel: () => void;
  readonly onSubmit: (newName: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  // We need to suppress the implicit blur-submit when the user
  // explicitly cancels via Escape — otherwise the blur fires after the
  // ESC keydown clears `editing`, sending an empty/old draft to the API.
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!editing) {
      setDraft(initial);
      setError(null);
      cancelledRef.current = false;
    }
  }, [initial, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const submit = useCallback(async () => {
    if (cancelledRef.current) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      setError('Name cannot be empty');
      return;
    }
    if (trimmed === initial) {
      onCancel();
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename');
      setDraft(initial);
    } finally {
      setPending(false);
    }
  }, [draft, initial, onCancel, onSubmit]);

  if (!editing) {
    return (
      <button
        type='button'
        onClick={onStartEdit}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title='Click to rename'
        style={{
          all: 'unset',
          cursor: 'text',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          maxWidth: '100%',
          padding: '2px 6px',
          marginLeft: -6,
          borderRadius: 4,
          background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
          transition: 'background 0.12s ease',
        }}
      >
        <span
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: T.text1,
            fontFamily: T.fontSans,
            letterSpacing: '-0.01em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {initial}
        </span>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: T.text3,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.12s ease',
            flexShrink: 0,
          }}
        >
          <EditIcon size={11} />
        </span>
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: '100%' }}>
      <input
        ref={inputRef}
        value={draft}
        disabled={pending}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { void submit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelledRef.current = true;
            setDraft(initial);
            onCancel();
          }
        }}
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: T.text1,
          fontFamily: T.fontSans,
          letterSpacing: '-0.01em',
          background: '#08080a',
          border: `1px solid ${error ? '#f87171' : 'rgba(255,255,255,0.16)'}`,
          borderRadius: 6,
          padding: '4px 8px',
          marginLeft: -8,
          outline: 'none',
          minWidth: 0,
          opacity: pending ? 0.6 : 1,
        }}
      />
      {error ? (
        <span
          style={{
            fontSize: 11,
            color: '#f87171',
            fontFamily: T.fontSans,
            paddingLeft: 1,
          }}
        >
          {error}
        </span>
      ) : (
        <span
          style={{
            fontSize: 11,
            color: T.text4,
            fontFamily: T.fontSans,
            paddingLeft: 1,
          }}
        >
          Press Enter to save · Esc to cancel
        </span>
      )}
    </div>
  );
}

// ─── Action menu (3-dot dropdown) ────────────────────────────────────
//
// Portal-based dropdown identical in spirit to `ItemActionMenu` used
// across the data view, but typed to the connector's action set so the
// component is self-contained and reusable on this page only.
//
// Items:
//   • Rename       (always)        → defers to the parent's editingName flag
//   • Copy ID      (always)        → navigator.clipboard.writeText(connector.id)
//   • ──────────                   (only when both groups present)
//   • Disconnect   (third-party)   → confirm + onDelete()
function ConnectorActionMenu({
  connector,
  isBuiltin,
  onRename,
  onDelete,
}: {
  readonly connector: Connector;
  readonly isBuiltin: boolean;
  readonly onRename: () => void;
  readonly onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  const computePosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const menuWidth = 188;
    let left = r.right - menuWidth;
    if (left < 8) left = 8;
    if (left + menuWidth > globalThis.innerWidth - 8) {
      left = globalThis.innerWidth - menuWidth - 8;
    }
    return { top: r.bottom + 6, left };
  }, []);

  const toggle = () => {
    if (open) {
      close();
    } else {
      const p = computePosition();
      if (p) {
        setPos(p);
        setOpen(true);
      }
    }
  };

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      close();
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = () => close();
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    globalThis.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
      globalThis.removeEventListener('scroll', onScroll, true);
    };
  }, [open, close]);

  const handleCopyId = useCallback(async () => {
    close();
    try {
      await navigator.clipboard.writeText(connector.id);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard API failures are environmental (insecure context, etc.) —
      // we don't surface them as errors because the user explicitly chose
      // a "copy" action; either the system honours it or the platform UI
      // surfaces its own message.
    }
  }, [connector.id, close]);

  const handleDisconnect = useCallback(async () => {
    close();
    const ok = globalThis.confirm(
      `Disconnect "${connector.name}"? This removes the access point and is undoable only by re-creating it.`,
    );
    if (!ok) return;
    try {
      await onDelete();
    } catch {
      // Parent already logged it; user-visible failure surface comes
      // from SWR not flipping (the row stays put). A toast system on
      // this page would let us announce it explicitly — out of scope.
    }
  }, [connector.name, close, onDelete]);

  // Tiny visual confirmation for "Copy ID" — sits on the trigger
  // button as a 1.4-second floating pill so the user sees the result
  // even though the menu has already closed by then.
  const copiedToast = copied ? (
    <span
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: 6,
        fontSize: 10.5,
        fontWeight: 500,
        color: T.text1,
        fontFamily: T.fontSans,
        background: '#1f1f23',
        border: `1px solid ${T.cardBorder}`,
        borderRadius: 6,
        padding: '4px 8px',
        boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      Copied connector ID
    </span>
  ) : null;

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={buttonRef}
        type='button'
        onClick={toggle}
        aria-label='More actions'
        aria-haspopup='menu'
        aria-expanded={open}
        style={{
          all: 'unset',
          cursor: 'pointer',
          width: 26,
          height: 26,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          color: open ? T.text1 : T.text3,
          background: open ? 'rgba(255,255,255,0.06)' : 'transparent',
          transition: 'background 0.12s ease, color 0.12s ease',
        }}
        onMouseEnter={(e) => {
          if (!open) {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)';
            (e.currentTarget as HTMLButtonElement).style.color = T.text2;
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = T.text3;
          }
        }}
      >
        <MoreVerticalIcon size={12} />
      </button>
      {copiedToast}
      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role='menu'
              style={{
                position: 'fixed',
                top: pos.top,
                left: pos.left,
                minWidth: 188,
                background: '#1f1f23',
                border: `1px solid ${T.cardBorder}`,
                borderRadius: 10,
                padding: 4,
                boxShadow: '0 12px 28px rgba(0,0,0,0.45), 0 2px 4px rgba(0,0,0,0.18)',
                zIndex: APP_Z_INDEX.popover,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                fontFamily: T.fontSans,
              }}
            >
              <MenuItem
                icon={<EditIcon size={12} />}
                label='Rename'
                onClick={() => {
                  close();
                  onRename();
                }}
              />
              <MenuItem
                icon={<CopyIcon size={12} />}
                label='Copy connector ID'
                onClick={handleCopyId}
              />
              {!isBuiltin && (
                <>
                  <div
                    aria-hidden
                    style={{ height: 1, background: T.cardBorder, margin: '4px 6px' }}
                  />
                  <MenuItem
                    icon={<TrashIcon size={12} />}
                    label='Disconnect'
                    danger
                    onClick={handleDisconnect}
                  />
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
  readonly danger?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type='button'
      role='menuitem'
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 9px',
        borderRadius: 6,
        fontSize: 12.5,
        color: danger ? '#f87171' : T.text1,
        background: hovered
          ? danger
            ? 'rgba(248,113,113,0.10)'
            : 'rgba(255,255,255,0.06)'
          : 'transparent',
        transition: 'background 0.1s ease',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: danger ? '#f87171' : T.text3,
        }}
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

const TrashIcon = ({ size = 12 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
    <polyline points='3 6 5 6 21 6' />
    <path d='M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' />
    <path d='M10 11v6' />
    <path d='M14 11v6' />
    <path d='M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' />
  </svg>
);

// ─── Paused-state banner ─────────────────────────────────────────────

function PausedBanner({
  provider,
  onResume,
  pending,
}: {
  readonly provider: string;
  readonly onResume: () => void;
  readonly pending: boolean;
}) {
  const channelLabel: Record<string, string> = {
    cli: 'CLI',
    agent: 'Agent',
    filesystem: 'Folder sync',
  };
  const label = channelLabel[provider] ?? PROVIDER_LABELS[provider] ?? provider;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        marginBottom: 14,
        background: 'rgba(245, 158, 11, 0.08)',
        border: '1px solid rgba(245, 158, 11, 0.25)',
        borderRadius: 8,
        fontFamily: T.fontSans,
      }}
    >
      <PauseIcon size={11} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: T.text1, lineHeight: 1.4 }}>
          {label} is disabled
        </div>
        <div style={{ fontSize: 11.5, color: T.text2, lineHeight: 1.5, marginTop: 2 }}>
          New requests through this channel are rejected. Click Resume to re-enable.
        </div>
      </div>
      <GhostButton
        onClick={onResume}
        disabled={pending}
        icon={<PlayIcon size={10} />}
      >
        Resume
      </GhostButton>
    </div>
  );
}

// ─── Configuration table ─────────────────────────────────────────────
//
// Two flavours of row:
//   • Read-only metadata — Provider, Last run, Connector ID, Created.
//     These are server-managed (the user can't change `created_at`).
//   • Editable settings  — Direction, Trigger.  Built-in connectors
//     keep them locked (cli/agent/filesystem are fixed two-way and
//     don't have a meaningful schedule). Third-party gets inline
//     <select> dropdowns that PATCH on change.
//
// Provider-specific config (`connector.config` JSONB) is exposed as a
// disclosure block at the bottom for third-party integrations — for
// now read-only JSON, but it makes the surface honest about how much
// configurable state lives behind each AP.

function ConnectorConfigPanel({
  connector,
  isBuiltin,
  onUpdate,
  pending,
}: {
  readonly connector: Connector;
  readonly isBuiltin: boolean;
  readonly onUpdate: (patch: ConnectorEditPatch) => Promise<void>;
  readonly pending: boolean;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <SubSectionLabel>Configuration</SubSectionLabel>
      <div
        style={{
          background: '#08080a',
          border: `1px solid ${T.cardBorder}`,
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <ConfigRow
          label='Provider'
          isFirst
          value={PROVIDER_LABELS[connector.provider] ?? connector.provider}
        />
        <ConfigRowDirection
          connector={connector}
          isBuiltin={isBuiltin}
          onUpdate={onUpdate}
          pending={pending}
        />
        <ConfigRowTrigger
          connector={connector}
          isBuiltin={isBuiltin}
          onUpdate={onUpdate}
          pending={pending}
        />
        <ConfigRow
          label='OAuth'
          value={
            connector.oauth_connection_id != null
              ? `Connected · #${connector.oauth_connection_id}`
              : 'Not used'
          }
          muted={connector.oauth_connection_id == null}
          mono={connector.oauth_connection_id != null}
        />
        <ConfigRow
          label='Last run'
          value={
            connector.last_run_at
              ? `${timeAgo(connector.last_run_at)} (${connector.last_run_id ? connector.last_run_id.slice(0, 8) : '—'})`
              : 'Never'
          }
          muted={!connector.last_run_at}
          mono={!!connector.last_run_at}
        />
        <ConfigRow label='Connector ID' value={connector.id} mono />
        <ConfigRow
          label='Created'
          value={
            connector.created_at
              ? new Date(connector.created_at).toLocaleString()
              : '—'
          }
          muted={!connector.created_at}
        />
        {connector.error_message ? (
          <ConfigRow label='Error' value={connector.error_message} />
        ) : null}
      </div>

      {!isBuiltin ? (
        <ProviderConfigDisclosure connector={connector} />
      ) : null}
    </div>
  );
}

// Plain row — value is a string (read-only metadata). Keeps the same
// visual signature as before; merely extracted so editable rows can
// share identical chrome and we never accidentally drift the styling
// between read and edit cells.
function ConfigRow({
  label,
  value,
  isFirst,
  mono,
  muted,
}: {
  readonly label: string;
  readonly value: string;
  readonly isFirst?: boolean;
  readonly mono?: boolean;
  readonly muted?: boolean;
}) {
  return (
    <RowShell label={label} isFirst={isFirst}>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12,
          color: muted ? T.text3 : T.text2,
          fontFamily: mono ? T.fontMono : T.fontSans,
          wordBreak: 'break-word',
          lineHeight: 1.5,
          fontStyle: muted ? 'italic' : 'normal',
        }}
      >
        {value}
      </span>
    </RowShell>
  );
}

function RowShell({
  label,
  isFirst,
  children,
}: {
  readonly label: string;
  readonly isFirst?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        padding: '8px 12px',
        borderTop: isFirst ? 'none' : `1px solid ${T.cardBorder}`,
      }}
    >
      <span
        style={{
          width: 96,
          flexShrink: 0,
          fontSize: 11,
          color: T.text3,
          fontFamily: T.fontSans,
          fontWeight: 500,
          paddingTop: 6,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

// Direction dropdown — third-party only. Built-ins display a small
// "(locked)" hint instead, so the field's presence isn't mysteriously
// missing — the user sees it and understands why it can't be changed.
function ConfigRowDirection({
  connector,
  isBuiltin,
  onUpdate,
  pending,
}: {
  readonly connector: Connector;
  readonly isBuiltin: boolean;
  readonly onUpdate: (patch: ConnectorEditPatch) => Promise<void>;
  readonly pending: boolean;
}) {
  const directionLabel: Record<string, string> = {
    bidirectional: 'Two-way (read & write)',
    inbound: 'Inbound (import to workspace)',
    outbound: 'Outbound (export from workspace)',
  };
  if (isBuiltin) {
    return (
      <RowShell label='Direction'>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: T.text2,
            fontFamily: T.fontSans,
            lineHeight: 1.5,
          }}
        >
          <span>{directionLabel[connector.direction] ?? connector.direction}</span>
          <span
            style={{
              fontSize: 10.5,
              color: T.text4,
              fontFamily: T.fontSans,
              fontStyle: 'italic',
            }}
          >
            · Built-in (locked)
          </span>
        </span>
      </RowShell>
    );
  }
  return (
    <RowShell label='Direction'>
      <InlineSelect
        value={connector.direction}
        disabled={pending}
        options={[
          { value: 'inbound', label: 'Inbound (import to workspace)' },
          { value: 'outbound', label: 'Outbound (export from workspace)' },
          { value: 'bidirectional', label: 'Two-way (read & write)' },
        ]}
        onChange={async (next) => {
          if (next !== connector.direction) {
            await onUpdate({ direction: next as 'inbound' | 'outbound' | 'bidirectional' });
          }
        }}
      />
    </RowShell>
  );
}

// Trigger row — for third-party we expose two cells: type
// (manual/scheduled/on_change) and a config summary. Built-ins ride
// custom event paths (CLI/Agent/Filesystem) that aren't user-tunable,
// so we render a static label for them too.
function ConfigRowTrigger({
  connector,
  isBuiltin,
  onUpdate,
  pending,
}: {
  readonly connector: Connector;
  readonly isBuiltin: boolean;
  readonly onUpdate: (patch: ConnectorEditPatch) => Promise<void>;
  readonly pending: boolean;
}) {
  const t = (connector.trigger ?? {}) as Record<string, unknown>;
  const triggerType = (t.type as string | undefined) ?? 'manual';
  const summary = (() => {
    if (typeof t.cron === 'string') return `cron: ${t.cron}`;
    if (typeof t.interval === 'string') return `every ${t.interval}`;
    if (typeof t.mode === 'string') return `mode: ${t.mode}`;
    return null;
  })();

  if (isBuiltin) {
    return (
      <RowShell label='Trigger'>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: T.text2,
            fontFamily: T.fontSans,
            lineHeight: 1.5,
          }}
        >
          <span>{summary ?? 'Event-driven'}</span>
          <span
            style={{
              fontSize: 10.5,
              color: T.text4,
              fontFamily: T.fontSans,
              fontStyle: 'italic',
            }}
          >
            · Built-in (locked)
          </span>
        </span>
      </RowShell>
    );
  }

  return (
    <RowShell label='Trigger'>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <InlineSelect
          value={triggerType}
          disabled={pending}
          options={[
            { value: 'manual', label: 'Manual (run on demand)' },
            { value: 'scheduled', label: 'Scheduled (cron / interval)' },
            { value: 'on_change', label: 'On change (event-driven)' },
          ]}
          onChange={async (next) => {
            if (next !== triggerType) {
              // Preserve existing trigger.config if any so cron/interval
              // settings aren't accidentally wiped when toggling the
              // type — ideal would be a fuller editor for the config
              // payload, which lives in a follow-up.
              await onUpdate({
                trigger: {
                  type: next as 'manual' | 'scheduled' | 'on_change',
                  config: (t.config as Record<string, unknown> | undefined) ?? undefined,
                },
              });
            }
          }}
        />
        {summary ? (
          <span
            style={{
              fontSize: 11,
              color: T.text3,
              fontFamily: T.fontMono,
              lineHeight: 1.5,
            }}
          >
            {summary}
          </span>
        ) : null}
      </div>
    </RowShell>
  );
}

// Inline <select> styled to read like the surrounding row text plus a
// chevron hint. Native <select> is intentional — it gives keyboard
// navigation, mobile pickers, and screen-reader semantics for free,
// and the styling is restrained enough to feel native to the card.
function InlineSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  readonly value: string;
  readonly options: ReadonlyArray<{ value: string; label: string }>;
  readonly onChange: (next: string) => void | Promise<void>;
  readonly disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const baseStyle: CSSProperties = {
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    fontSize: 12,
    fontFamily: T.fontSans,
    color: T.text1,
    background: hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
    border: `1px solid ${hovered ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'}`,
    borderRadius: 6,
    padding: '4px 26px 4px 8px',
    margin: 0,
    width: '100%',
    cursor: disabled ? 'wait' : 'pointer',
    outline: 'none',
    transition: 'background 0.12s ease, border-color 0.12s ease',
    opacity: disabled ? 0.55 : 1,
  };
  return (
    <span style={{ position: 'relative', flex: 1, minWidth: 0, display: 'inline-block' }}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => { void onChange(e.target.value); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        style={baseStyle}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: '#1f1f23', color: T.text1 }}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          color: T.text3,
          pointerEvents: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ChevronDownIcon size={10} />
      </span>
    </span>
  );
}

const ChevronDownIcon = ({ size = 10 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'>
    <polyline points='6 9 12 15 18 9' />
  </svg>
);

// ─── Provider config (third-party only, read-only JSON for now) ─────
//
// Surfaces `connector.config` so the user knows there's *more* under
// the hood than the few canonical rows above. Keeping it collapsed
// by default avoids dumping an opaque JSON blob into the layout — but
// keeping it visible (as a closed disclosure) makes the existence of
// these settings discoverable, which is precisely what the user
// flagged as missing.

function ProviderConfigDisclosure({ connector }: { readonly connector: Connector }) {
  const [open, setOpen] = useState(false);
  const json = useMemo(() => {
    try {
      return JSON.stringify(connector.config ?? {}, null, 2);
    } catch {
      return '{}';
    }
  }, [connector.config]);
  const isEmpty = json.trim() === '{}';

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11.5,
          color: T.text3,
          fontFamily: T.fontSans,
          padding: '4px 0',
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.12s ease',
            color: T.text3,
          }}
        >
          <ChevronRightIcon size={10} />
        </span>
        <span>Provider config ({connector.provider}{isEmpty ? ' · empty' : ''})</span>
      </button>
      {open ? (
        <pre
          style={{
            margin: '6px 0 0',
            padding: '10px 12px',
            background: '#08080a',
            border: `1px solid ${T.cardBorder}`,
            borderRadius: 6,
            fontSize: 11.5,
            lineHeight: 1.55,
            color: T.text2,
            fontFamily: T.fontMono,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflowX: 'auto',
          }}
        >
          {isEmpty ? '— No provider-specific configuration set.' : json}
        </pre>
      ) : null}
    </div>
  );
}

// ─── Activity (placeholder until audit log is AP-scoped) ────────────

function ConnectorActivityPanel() {
  return (
    <div>
      <SubSectionLabel
        right={
          <GhostButton icon={<ChevronRightIcon size={10} />}>View all</GhostButton>
        }
      >
        Recent activity
      </SubSectionLabel>
      <div
        style={{
          padding: '10px 12px',
          fontSize: 12,
          color: T.text3,
          fontFamily: T.fontSans,
          background: '#08080a',
          border: `1px solid ${T.cardBorder}`,
          borderRadius: 6,
          fontStyle: 'italic',
        }}
      >
        No activity tracked for this access point yet.
      </div>
    </div>
  );
}
