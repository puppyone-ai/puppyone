'use client';

/**
 * Shared atomic UI building blocks for the access page.
 *
 * Each one is small (15-90 lines) and gets used in 2+ places across
 * ConnectorCard, ScopeDetailPanel, and the various Quick-Connect Body
 * components. Co-locating them in a single file makes it cheap for an
 * AI / human reader to scan "what neutral primitives can I reach for?"
 * before reinventing one — splitting them per-file would force 9
 * imports for the same idea.
 *
 * Family overview:
 *  - Buttons / badges       : GhostButton, PermBadge
 *  - Section labels         : SectionLabel, SubSectionLabel
 *  - Notice                 : NoAccessKeyNotice
 *  - Copy-paste UX          : PromptBlock, CommandStepsDisclosure,
 *                             CommandBlock, KvBlock, KvRow
 *
 * NONE of these talk to the network or hold business state — they're
 * pure presentation. Anything stateful (SWR, mutations) belongs in
 * `hooks/` or in the parent feature component.
 */

import React, { useCallback, useState } from 'react';
import {
  T,
  BTN_RADIUS,
  PROMPT_BLOCK_HEIGHT,
  PROMPT_BG,
} from '../lib/tokens';
import { CopyIcon } from './icons';

const PROMPT_PREVIEW_BG = 'var(--po-panel)';

// ─── Buttons & badges ────────────────────────────────────────────────
//
// Two button sizes only. Section-level ghost actions (Edit Scope, View
// all, Copy connect) all share `GhostButton`; primary actions on the
// Identity row (Pause/Resume, More) share `PrimaryGhostButton`. Both
// pull from the same neutral token palette on hover, so we no longer
// have three different sizes / fonts
// / colors competing for attention on the same screen.

export function GhostButton({
  icon,
  children,
  onClick,
  variant = 'default',
  disabled = false,
  title,
  ariaLabel,
}: {
  readonly icon?: React.ReactNode;
  readonly children?: React.ReactNode;
  readonly onClick?: () => void;
  readonly variant?: 'default' | 'square';
  readonly disabled?: boolean;
  readonly title?: string;
  readonly ariaLabel?: string;
}) {
  const isSquare = variant === 'square';
  const baseColor = T.text2;
  const hoverColor = T.text1;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: 30,
        width: isSquare ? 30 : undefined,
        padding: isSquare ? 0 : '0 12px',
        background: 'transparent',
        border: `1px solid ${T.border}`,
        borderRadius: BTN_RADIUS,
        color: baseColor,
        fontSize: 12,
        fontWeight: 500,
        fontFamily: T.fontSans,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: `background 0.15s ${T.ease}, color 0.15s ${T.ease}, border-color 0.15s ${T.ease}`,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = 'var(--po-hover)';
        e.currentTarget.style.borderColor = 'var(--po-border-strong)';
        e.currentTarget.style.color = hoverColor;
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = T.border;
        e.currentTarget.style.color = baseColor;
      }}
    >
      {icon}
      {children}
    </button>
  );
}

export function PermBadge({ label, active }: { readonly label: string; readonly active: boolean }) {
  // Read/write badges are neutral on purpose. The Scope card already
  // tells the user *what* is bound; the badges are just a yes/no
  // signal on capability. Coloring them per-provider would be more
  // chrome for no extra information.
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 22,
        padding: '0 8px',
        borderRadius: 5,
        background: active ? 'var(--po-border-subtle)' : 'transparent',
        border: `1px solid ${active ? 'var(--po-border-strong)' : T.border}`,
        color: active ? T.text2 : T.text4,
        fontSize: 11,
        fontWeight: 500,
        fontFamily: T.fontSans,
        letterSpacing: '0.02em',
      }}
    >
      {label}
    </span>
  );
}

// ─── Layout primitives ───────────────────────────────────────────────
//
// Two label tiers, by design — both Title Case, distinguished only by
// size and weight. ALL-CAPS is gone from the access page entirely:
//
//   • SectionLabel    — page-level section (sibling to other top-level
//     blocks). 13px / 600 / T.text2. Reads as a heading.
//     Used for "Scope", "Settings", "Connectors".
//
//   • SubSectionLabel — card-internal eyebrow (a small disambiguator
//     inside an already-bounded surface). 11px / 600 / T.text3.
//     Visually distinct from the page-level label by being smaller +
//     dimmer, not by being uppercase. Used for "Configuration",
//     "Prompt for AI agent", "Recent activity", etc.
//
// Acronyms ("CLI", "MCP", "API", "OAuth", "ID") that read naturally as
// caps are still rendered exactly as the source string says — that's
// orthography, not styling, and we don't normalize it.

export function SectionLabel({ children, right }: { readonly children: React.ReactNode; readonly right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingLeft: 2 }}>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: T.text2,
          fontFamily: T.fontSans,
          letterSpacing: '-0.005em',
        }}
      >
        {children}
      </span>
      {right}
    </div>
  );
}

export function SubSectionLabel({ children, right }: { readonly children: React.ReactNode; readonly right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, paddingLeft: 2 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: T.text3,
          fontFamily: T.fontSans,
        }}
      >
        {children}
      </span>
      {right}
    </div>
  );
}

// ─── Notice ──────────────────────────────────────────────────────────

export function NoAccessKeyNotice() {
  return (
    <div
      style={{
        marginBottom: 10,
        borderRadius: 6,
        border: `1px solid color-mix(in srgb, var(--po-warning) 25%, transparent)`,
        background: 'color-mix(in srgb, var(--po-warning) 6%, transparent)',
        color: 'var(--po-warning)',
        fontSize: 12,
        lineHeight: 1.5,
        padding: '8px 10px',
      }}
    >
      This scope has no access key issued. Regenerate one from scope settings to enable this method.
    </div>
  );
}

// ─── Prompt block ────────────────────────────────────────────────────

export function PromptBlock({ prompt }: { readonly prompt: string }) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — silent */
    }
  }, [prompt]);

  return (
    <div
      style={{
        position: 'relative',
        height: PROMPT_BLOCK_HEIGHT,
        borderRadius: 6,
        border: `1px solid ${T.cardBorder}`,
        background: PROMPT_PREVIEW_BG,
        overflow: 'hidden',
        marginBottom: 12,
      }}
    >
      <pre
        aria-hidden
        style={{
          margin: 0,
          padding: '12px 14px 58px 14px',
          fontFamily: T.fontMono,
          fontSize: 11,
          lineHeight: 1.6,
          color: T.text2,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {prompt}
      </pre>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 'auto 0 0 0',
          height: 70,
          background: `linear-gradient(180deg, transparent 0%, ${PROMPT_PREVIEW_BG} 100%)`,
          pointerEvents: 'none',
        }}
      />
      <button
        type="button"
        onClick={handleCopy}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 10,
          transform: 'translateX(-50%)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          height: 30,
          padding: '0 12px',
          fontFamily: T.fontSans,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 0,
          color: copied ? 'var(--po-success-contrast)' : 'var(--po-success)',
          background: copied
            ? 'var(--po-success)'
            : hovered
              ? 'color-mix(in srgb, var(--po-success) 20%, var(--po-panel) 80%)'
              : 'color-mix(in srgb, var(--po-success) 14%, var(--po-panel) 86%)',
          border: copied
            ? '1px solid var(--po-success)'
            : '1px solid color-mix(in srgb, var(--po-success) 38%, transparent)',
          borderRadius: BTN_RADIUS,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          boxShadow: 'none',
          transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease',
        }}
      >
        <CopyIcon size={12} />
        {copied ? 'Copied' : 'Copy setup prompt'}
      </button>
    </div>
  );
}

// ─── Command steps disclosure ────────────────────────────────────────

export function CommandStepsDisclosure({
  steps,
}: {
  readonly steps: ReadonlyArray<{ title: string; lines: readonly string[] }>;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-expanded={open}
        style={{
          all: 'unset',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 30,
          padding: '0 6px',
          marginLeft: -6,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: T.fontSans,
          color: hovered || open ? T.text1 : T.text2,
          cursor: 'pointer',
          transition: `color 0.12s ${T.ease}`,
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 10,
            height: 10,
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: `transform 0.15s ${T.ease}`,
          }}
        >
          <svg width={10} height={10} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 2.5l3.5 3.5L4 9.5" />
          </svg>
        </span>
        Show install steps
      </button>
      {open && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {steps.map((step, idx) => (
            <div key={step.title} style={{ display: 'flex', gap: 10 }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  background: 'var(--po-border-subtle)',
                  color: T.text2,
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: T.fontSans,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {idx + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.text1, fontFamily: T.fontSans }}>{step.title}</span>
                <CommandBlock lines={step.lines} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Command block ───────────────────────────────────────────────────

export function CommandBlock({ lines }: { readonly lines: readonly string[] }) {
  const text = lines.join('\n');
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — silent */
    }
  }, [text]);

  return (
    <div
      style={{
        borderRadius: 5,
        border: `1px solid ${T.cardBorder}`,
        background: PROMPT_BG,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: '10px 40px 10px 12px',
          fontFamily: T.fontMono,
          fontSize: 11.5,
          lineHeight: 1.6,
          color: T.text1,
          overflowX: 'auto',
          whiteSpace: 'pre',
        }}
      >
        {text}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? 'Copied' : 'Copy'}
        aria-label={copied ? 'Copied' : 'Copy command'}
        style={{
          all: 'unset',
          position: 'absolute',
          top: 6,
          right: 6,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          borderRadius: 5,
          color: copied ? 'var(--po-success)' : T.text2,
          cursor: 'pointer',
          transition: `color 0.12s ${T.ease}, background 0.12s ${T.ease}`,
        }}
        onMouseEnter={(e) => {
          if (!copied) e.currentTarget.style.color = T.text1;
          e.currentTarget.style.background = 'var(--po-border-subtle)';
        }}
        onMouseLeave={(e) => {
          if (!copied) e.currentTarget.style.color = T.text2;
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <CopyIcon size={12} />
      </button>
    </div>
  );
}

// ─── KV blocks ───────────────────────────────────────────────────────

export function KvBlock({
  rows,
}: {
  readonly rows: ReadonlyArray<{ label: string; value: string; mono?: boolean; copyable?: boolean }>;
}) {
  return (
    <div
      style={{
        marginBottom: 14,
        background: PROMPT_BG,
        border: `1px solid ${T.cardBorder}`,
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {rows.map((row, idx) => (
        <KvRow key={row.label} row={row} isFirst={idx === 0} />
      ))}
    </div>
  );
}

export function KvRow({
  row,
  isFirst,
}: {
  readonly row: { label: string; value: string; mono?: boolean; copyable?: boolean };
  readonly isFirst: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    if (!row.value) return;
    try {
      await navigator.clipboard.writeText(row.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — silent */
    }
  }, [row.value]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderTop: isFirst ? 'none' : `1px solid ${T.cardBorder}`,
      }}
    >
      <span
        style={{
          width: 96,
          flexShrink: 0,
          fontSize: 11,
          fontWeight: 500,
          color: T.text3,
          fontFamily: T.fontSans,
        }}
      >
        {row.label}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12,
          color: T.text2,
          fontFamily: row.mono ? T.fontMono : T.fontSans,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {row.value || '—'}
      </span>
      {row.copyable && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy'}
          title={copied ? 'Copied' : 'Copy'}
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: 5,
            color: copied ? 'var(--po-success)' : T.text2,
            transition: `color 0.12s ${T.ease}, background 0.12s ${T.ease}`,
          }}
          onMouseEnter={(e) => {
            if (!copied) e.currentTarget.style.color = T.text1;
            e.currentTarget.style.background = 'var(--po-border-subtle)';
          }}
          onMouseLeave={(e) => {
            if (!copied) e.currentTarget.style.color = T.text2;
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <CopyIcon size={12} />
        </button>
      )}
    </div>
  );
}
