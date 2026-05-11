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
 * Prompt text is shown in a compact code box with a clear centered copy
 * action. Keep the button obvious, but avoid the oversized glow/shadow
 * treatment.
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
        height: 132,
        borderRadius: 8,
        border: `1px solid ${COLOR_BORDER}`,
        background: COLOR_BG_SUNKEN,
        overflow: 'hidden',
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: '12px 14px 46px 14px',
          fontFamily: FONT_MONO,
          fontSize: 11,
          lineHeight: 1.6,
          color: COLOR_FG_MUTED,
          opacity: 0.58,
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
          inset: 0,
          background: 'rgba(0,0,0,0.34)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 'auto 0 0 0',
          height: 58,
          background: `linear-gradient(180deg, rgba(0,0,0,0) 0%, ${COLOR_BG_SUNKEN} 100%)`,
          pointerEvents: 'none',
          zIndex: 2,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 3,
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
            height: 32,
            padding: '0 14px',
            fontSize: 13,
            fontWeight: 600,
            color: copied ? '#15803d' : '#0a0a0a',
            background: copied
              ? '#bbf7d0'
              : hovered
                ? '#ffffff'
                : 'rgba(250,250,250,0.96)',
            border: '1px solid rgba(255,255,255,0.16)',
            borderRadius: 999,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 14px rgba(0,0,0,0.28)',
            transition: 'background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
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
