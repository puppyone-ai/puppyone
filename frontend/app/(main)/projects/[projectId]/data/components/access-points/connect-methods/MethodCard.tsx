'use client';

import { useState, type ReactNode } from 'react';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  COLOR_BORDER,
  COLOR_BORDER_HOVER,
  COLOR_FG,
  COLOR_FG_DIM,
  COLOR_FG_MUTED,
} from '../tokens';
import { AgentIcon, SyncIcon, TerminalIcon } from './icons';
import type { MethodMeta } from './meta';

const ACTIVE_METHOD_BG =
  'var(--po-control)';
const ACTIVE_METHOD_BG_HOVER =
  'var(--po-control-hover)';
const PAUSED_METHOD_BG =
  'color-mix(in srgb, var(--po-text) 3%, var(--po-panel) 97%)';
const PAUSED_METHOD_BG_HOVER =
  'color-mix(in srgb, var(--po-text) 5%, var(--po-panel) 95%)';

/**
 * MethodCard — wrapper for one connection method.
 *
 * Header layout (left to right):
 *
 *   [icon] [title + subtitle]                          [toggle]
 *
 * Body visibility is **a pure function of the toggle**:
 *
 *   - active  → body expanded
 *   - paused  → body collapsed
 *
 * There is no separate user-controlled expand/collapse affordance —
 * the toggle is the single source of truth. The previous round had a
 * chevron that let the user pin the body open/closed independently of
 * the toggle, which created confusing combinations like
 * "active-but-collapsed" or "paused-but-expanded". The user called
 * this out as redundant: if I turn it off I want it out of the way;
 * if I turn it on I want to see how to use it. The toggle alone now
 * carries both meanings.
 *
 * Other behaviours:
 *
 *   - Toggle is the only interactive element. The header chrome is a
 *     plain `<div>` (not a `<button>`) — clicking on the title /
 *     subtitle / icon does nothing, which prevents the "looks
 *     clickable but isn't" trap.
 *   - Toggle is wired to the connector's `status` field via the
 *     `pauseConnector` / `resumeConnector` API (the parent owns the
 *     request; we just emit `onToggle`).
 *   - When the method is paused, the icon, title, and subtitle dim,
 *     and the subtitle picks up a "(paused)" suffix so the off state
 *     reads at a glance even without the body for context.
 */
export function MethodCard({
  meta,
  children,
  active = true,
  togglePending = false,
  onToggle,
}: {
  readonly meta: MethodMeta;
  readonly children: ReactNode;
  /** Current connector status — true when `status === 'active'`. When
   *  `false`, the card renders in its paused appearance with the body
   *  hidden. Defaults to `true` for legacy callers that don't pass
   *  per-connector state (in that case the body is always shown,
   *  matching the pre-toggle behaviour). */
  readonly active?: boolean;
  /** Set while a pause/resume request is in flight. De-dupes rapid
   *  re-clicks while the first request is still resolving. */
  readonly togglePending?: boolean;
  /** Click handler for the toggle. When omitted, the toggle is not
   *  rendered and the body is always shown — used by callers that
   *  don't yet have a connector to pause/resume (legacy / CLI before
   *  the DB trigger that auto-provisions a `cli` connector). */
  readonly onToggle?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  // Single source of truth: body visibility = active state. No
  // useState, no manual override.
  const expanded = active;
  const cardBackground = expanded
    ? hovered
      ? ACTIVE_METHOD_BG_HOVER
      : ACTIVE_METHOD_BG
    : hovered
      ? PAUSED_METHOD_BG_HOVER
      : PAUSED_METHOD_BG;

  return (
    <div
      style={{
        borderRadius: 10,
        border: `1px solid ${hovered ? COLOR_BORDER_HOVER : COLOR_BORDER}`,
        background: cardBackground,
        overflow: 'hidden',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {/* Header is a plain <div>, NOT a button. Mouse hover still
          updates the card border so the user gets a faint "this is a
          live card" cue, but no click handler — only the toggle on
          the right is interactive. */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          minHeight: 42,
          padding: '8px 12px',
          color: COLOR_FG,
        }}
      >
        <MethodIcon meta={meta} active={active} />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'baseline',
            gap: 7,
          }}
        >
          <span
            style={{
              flexShrink: 0,
              fontSize: 13,
              fontWeight: 600,
              color: active ? COLOR_FG : COLOR_FG_MUTED,
              lineHeight: 1.3,
            }}
          >
            {meta.title}
          </span>
          <span
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 12,
              color: COLOR_FG_DIM,
              lineHeight: 1.45,
            }}
          >
            {meta.subtitle}
            {!active && (
              <span style={{ marginLeft: 6, color: COLOR_FG_DIM }}>
                · paused
              </span>
            )}
          </span>
        </div>
        {onToggle && (
          <MethodToggle
            active={active}
            pending={togglePending}
            onClick={onToggle}
            label={`${active ? 'Pause' : 'Resume'} ${meta.title}`}
          />
        )}
      </div>
      {expanded && (
        <div
          style={{
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MethodIcon({
  meta,
  active,
}: {
  readonly meta: MethodMeta;
  readonly active: boolean;
}) {
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: 7,
        background: active ? meta.accentBg : 'var(--po-control)',
        border: `1px solid ${active ? meta.accentBorder : COLOR_BORDER}`,
        color: active ? meta.accent : COLOR_FG_DIM,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        opacity: active ? 1 : 0.65,
        transition: 'background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s',
      }}
      aria-hidden
    >
      {meta.id === 'terminal' && <TerminalIcon />}
      {meta.id === 'sync' && <SyncIcon />}
      {meta.id === 'agent' && <AgentIcon />}
    </div>
  );
}

/**
 * MethodToggle — compact on/off switch for a method card.
 *
 * 32×18 track, 14×14 thumb. Active state uses a single restrained
 * success colour, while paused falls back to neutral grey.
 *
 * Optimistic UI contract: the parent flips `active` immediately on
 * click — the actual pause / resume API call runs fire-and-forget in
 * the background. The `pending` prop only deduplicates concurrent
 * requests (it blocks a second click while the first is in flight)
 * — it does NOT visually disable the switch. Visually disabling it
 * would defeat the point of optimistic UI: to the user the action
 * already succeeded the moment the thumb slid across.
 *
 * Note on event propagation: the parent header is now a plain <div>
 * (not a <button>), so click bubbling no longer triggers a card-level
 * toggle. The `stopPropagation` is kept defensively in case the
 * surrounding chrome ever wires up a click handler — it's cheap and
 * correctly scopes the click to the switch itself.
 */
function MethodToggle({
  active,
  pending,
  onClick,
  label,
}: {
  readonly active: boolean;
  readonly pending: boolean;
  readonly onClick: () => void;
  readonly label: string;
}) {
  return (
    <ToggleSwitch
      as="span"
      checked={active}
      pending={pending}
      ariaLabel={label}
      title={label}
      size="sm"
      stopPropagation
      onCheckedChange={onClick}
    />
  );
}

/**
 * SectionHeader — the `Connect` eyebrow above the method stack.
 */
export function SectionHeader({
  eyebrow,
  description,
}: {
  readonly eyebrow: string;
  readonly description?: string;
}) {
  return (
    <div style={{ padding: '0 2px' }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: COLOR_FG_DIM,
        }}
      >
        {eyebrow}
      </div>
      {description && (
        <div style={{ fontSize: 13, color: COLOR_FG_DIM, marginTop: 4, lineHeight: 1.45 }}>
          {description}
        </div>
      )}
    </div>
  );
}

/**
 * NoAccessKeyNotice — banner shown when scope.access_key is empty.
 * All three method cards are degenerate without it, so we surface the
 * fix path inline rather than letting the cards render unusable copy.
 */
export function NoAccessKeyNotice() {
  return (
    <div
      style={{
        borderRadius: 8,
        border: '1px solid color-mix(in srgb, var(--po-warning) 28%, transparent)',
        background: 'color-mix(in srgb, var(--po-warning) 8%, transparent)',
        color: 'var(--po-warning)',
        fontSize: 13,
        lineHeight: 1.5,
        padding: '10px 12px',
      }}
    >
      This scope has no access key issued. Regenerate one from scope settings to enable any of these methods.
    </div>
  );
}
