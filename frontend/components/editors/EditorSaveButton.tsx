'use client';

import { useEffect, useState } from 'react';
import { PulseGrid } from '@/components/loading';
import type { SaveStatus } from '@/lib/hooks/useManualSave';

/**
 * EditorSaveButton — single chip slot that morphs through save
 * states for the markdown editor's "invisible header" (see
 * ``EditorArea.tsx``).
 *
 * Design paradigm:
 *   One chip shape — same height, padding, radius, font. The four
 *   non-clean states are tonal variants of that shape:
 *
 *     clean   → render nothing.
 *     dirty   → 💾 Save changes        (orange tint, button)
 *     saving  → ⏳ Saving…              (neutral tint, pill)
 *     saved   → ✓ Saved                (green tint, pill)
 *     error   → ⚠ Save failed — Retry  (red tint, button)
 *
 * Why tinted, not solid:
 *   The previous solid-orange CTA was visually heavier than
 *   anything else on the page chrome. A tinted pill keeps the
 *   brand orange as a colour anchor but drops the "primary
 *   product CTA" weight. All four states then share the same
 *   visual vocabulary — only the hue tells the story.
 *
 * Why no keyboard shortcut badge:
 *   Power users learn ``⌘S`` after one or two saves; baking the
 *   hint into the button permanently is decoration, not signal.
 *
 * Identity rules:
 *   - 28 px tall, 6 px radius, 13 px / 500 weight everywhere.
 *   - Each state's leading icon shares the same 14 × 14 box.
 *   - dirty + error are buttons; saving + saved are spans.
 */
export function EditorSaveButton({
  status,
  onSave,
}: {
  readonly status: SaveStatus;
  readonly onSave: () => void;
}) {
  const [shortcutHint, setShortcutHint] = useState('Ctrl+S');
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const isMac = /Mac/i.test(navigator.platform);
    setShortcutHint(isMac ? '⌘S' : 'Ctrl+S');
  }, []);

  if (status === 'clean') return null;

  if (status === 'saving') {
    return (
      <>
        <ChipPill tone="muted">
          <PulseGrid size="xs" />
          <span>Saving…</span>
        </ChipPill>
        <FadeKeyframes />
      </>
    );
  }

  if (status === 'saved') {
    return (
      <>
        <ChipPill tone="success">
          <CheckIcon />
          <span>Saved</span>
        </ChipPill>
        <FadeKeyframes />
      </>
    );
  }

  if (status === 'error') {
    return (
      <>
        <ChipButton
          tone="error"
          onClick={onSave}
          title={`Retry save (${shortcutHint})`}
        >
          <AlertIcon />
          <span>Save failed — Retry</span>
        </ChipButton>
        <FadeKeyframes />
      </>
    );
  }

  // status === 'dirty'
  return (
    <>
      <ChipButton
        tone="action"
        onClick={onSave}
        title={`Save changes (${shortcutHint})`}
      >
        <SaveDiskIcon />
        <span>Save changes</span>
      </ChipButton>
      <FadeKeyframes />
    </>
  );
}

// ── Chip chrome (shared) ─────────────────────────────────────────

/** Identity of the chip — every state inherits this. The only
 *  things that change between states are ``background`` /
 *  ``color`` (set by the tone) and the children. */
const CHIP_BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 10px',
  borderRadius: 6,
  border: 'none',
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: '-0.005em',
  whiteSpace: 'nowrap',
} as const;

type ChipTone = 'action' | 'muted' | 'success' | 'error';

interface TonePalette {
  bg: string;
  bgHover?: string;   // only meaningful on actionable tones
  bgActive?: string;
  text: string;
}

const TONE_PALETTE: Record<ChipTone, TonePalette> = {
  // Brand-orange tint, not a fill. Background is a
  // 14 % wash of the orange so the pill anchors itself in the page
  // chrome instead of overpowering it. Hover steps the wash to
  // 22 % then 30 % on press — the only motion is opacity. Text and
  // icon ride the orange itself for a clear colour through-line.
  action: {
    bg: 'color-mix(in srgb, var(--po-warning) 14%, transparent)',
    bgHover: 'color-mix(in srgb, var(--po-warning) 22%, transparent)',
    bgActive: 'color-mix(in srgb, var(--po-warning) 30%, transparent)',
    text: 'var(--po-warning)',
  },
  // Neutral pill — used while a save is in flight. Same shape as
  // the action button so the transition reads as the same chip
  // freezing into a state, not a different element appearing.
  muted: {
    bg: 'var(--po-border-subtle)',
    text: 'var(--po-text-muted)',
  },
  // Soft green confirmation pill. Tinted background mirrors the
  // dirty-state opacity ramp (14 %) — same vocabulary, different
  // hue.
  success: {
    bg: 'color-mix(in srgb, var(--po-success) 14%, transparent)',
    text: 'var(--po-success)',
  },
  // Red retry button. Same tinted treatment as ``action`` so the
  // four states form a consistent pill family — only the hue
  // signals the semantic.
  error: {
    bg: 'color-mix(in srgb, var(--po-danger) 16%, transparent)',
    bgHover: 'color-mix(in srgb, var(--po-danger) 24%, transparent)',
    bgActive: 'color-mix(in srgb, var(--po-danger) 32%, transparent)',
    text: 'var(--po-danger)',
  },
};

/** Passive chip — span. Used for ``saving`` / ``saved``. */
function ChipPill({
  tone,
  children,
}: {
  readonly tone: Extract<ChipTone, 'muted' | 'success'>;
  readonly children: React.ReactNode;
}) {
  const palette = TONE_PALETTE[tone];
  return (
    <span
      style={{
        ...CHIP_BASE,
        background: palette.bg,
        color: palette.text,
        animation: `${FADE_IN} 180ms ease-out`,
      }}
    >
      {children}
    </span>
  );
}

/** Actionable chip — button. Used for ``dirty`` / ``error``.
 *  Hover steps the tint one stop more opaque; active steps once
 *  more. No border, no shadow, no shape change — only opacity. */
function ChipButton({
  tone,
  onClick,
  title,
  children,
}: {
  readonly tone: Extract<ChipTone, 'action' | 'error'>;
  readonly onClick: () => void;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  const palette = TONE_PALETTE[tone];
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        ...CHIP_BASE,
        background: pressed
          ? palette.bgActive ?? palette.bg
          : hovered
            ? palette.bgHover ?? palette.bg
            : palette.bg,
        color: palette.text,
        cursor: 'pointer',
        transition: 'background 0.1s ease',
        animation: `${FADE_IN} 180ms ease-out`,
      }}
    >
      {children}
    </button>
  );
}

// ── Animation ────────────────────────────────────────────────────

const FADE_IN = 'editor-save-fade-in';

function FadeKeyframes() {
  return (
    <style>{`
      @keyframes ${FADE_IN} {
        from { opacity: 0; transform: translateY(-2px); }
        to   { opacity: 1; transform: translateY(0);    }
      }
    `}</style>
  );
}

// ── Icons ────────────────────────────────────────────────────────

/** Floppy-disk save icon — universal "save" semantic anchor on the
 *  dirty CTA. 14 × 14 to match the other status icons exactly. */
function SaveDiskIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
