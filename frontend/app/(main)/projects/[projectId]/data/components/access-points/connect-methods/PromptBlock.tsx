'use client';

import { useState } from 'react';
import {
  COLOR_BG_SUNKEN,
  COLOR_BORDER,
  COLOR_FG_MUTED,
  FONT_MONO,
} from '../tokens';
import { CheckIcon, CopyIcon } from './icons';

/**
 * PromptBlock — the headline action of every connection method.
 *
 * Most users in 2026 are working in Claude Code / Cursor / Codex and just
 * want to hand their AI agent a prompt explaining how to drive PuppyOne;
 * the agent then runs install / login / use itself. So we lead with this
 * block. The prompt text is shown in a dark box with a fade-out, followed
 * by a standard white button to copy it to the clipboard.
 */
export function PromptBlock({
  prompt,
}: {
  readonly prompt: string;
}) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can fail in restricted contexts; silently no-op.
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        height: 140,
        borderRadius: 8,
        border: `1px solid ${COLOR_BORDER}`,
        background: COLOR_BG_SUNKEN,
        overflow: 'hidden',
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: '12px 14px 48px 14px',
          fontFamily: FONT_MONO,
          fontSize: 11,
          lineHeight: 1.6,
          color: COLOR_FG_MUTED,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
        aria-hidden
      >
        {prompt}
      </pre>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 'auto 0 0 0',
          height: 64,
          background: `linear-gradient(180deg, rgba(0,0,0,0) 0%, ${COLOR_BG_SUNKEN} 100%)`,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        <button
          type="button"
          onClick={handleCopy}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            height: 30,
            padding: '0 14px',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '-0.005em',
            color: copied ? '#15803d' : '#0a0a0a',
            background: copied
              ? '#bbf7d0'
              : hovered
                ? '#ffffff'
                : 'rgba(250,250,250,0.94)',
            border: 'none',
            borderRadius: 999,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            boxShadow: hovered
              ? '0 0 36px rgba(0,0,0,0.55), 0 8px 22px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.16)'
              : '0 0 28px rgba(0,0,0,0.45), 0 5px 16px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08)',
            transition: 'background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 13, height: 13 }}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </div>
          {copied ? 'Copied' : 'Copy prompt for AI agent'}
        </button>
      </div>
    </div>
  );
}
