'use client';

import { useCallback, useState } from 'react';
import {
  COLOR_BORDER,
  COLOR_FG_MUTED,
  FONT_MONO,
} from '../tokens';
import { CheckIcon, CopyIcon } from './icons';

const PROMPT_PREVIEW_BG = 'var(--po-panel)';

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

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [prompt]);

  return (
    <div
      style={{
        position: 'relative',
        height: 132,
        borderRadius: 8,
        border: `1px solid ${COLOR_BORDER}`,
        background: PROMPT_PREVIEW_BG,
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
          opacity: 0.82,
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
          height: 58,
          background: `linear-gradient(180deg, transparent 0%, ${PROMPT_PREVIEW_BG} 100%)`,
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 2,
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
            padding: '0 12px',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'inherit',
            lineHeight: 1,
            color: copied ? 'var(--po-success-contrast)' : 'var(--po-panel)',
            background: copied
              ? 'var(--po-success)'
              : hovered
                ? 'color-mix(in srgb, var(--po-text) 78%, var(--po-panel) 22%)'
                : 'color-mix(in srgb, var(--po-text) 72%, var(--po-panel) 28%)',
            border: copied
              ? '1px solid var(--po-success)'
              : '1px solid color-mix(in srgb, var(--po-text) 62%, transparent)',
            borderRadius: 6,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            boxShadow: hovered
              ? '0 5px 14px color-mix(in srgb, var(--po-shadow) 85%, transparent)'
              : '0 2px 8px color-mix(in srgb, var(--po-shadow) 55%, transparent)',
            transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 13, height: 13 }}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </span>
          {copied ? 'Copied' : 'Copy prompt for AI agent'}
        </button>
      </div>
    </div>
  );
}
