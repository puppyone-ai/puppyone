'use client';

import React, { useMemo, useState } from 'react';
import {
  parseConflictMarkers,
  resolveConflictMarkers,
  type ConflictBlock,
} from '@/lib/conflictMarkers';

interface ConflictMarkerBannerProps {
  /** The full file content as currently loaded. */
  content: string;
  /**
   * Optional callback the user can press "pick ours / theirs / merged"
   * with. When omitted, the banner is read-only — surfaces the
   * conflict count plus an inline expander but doesn't write back.
   */
  onResolve?: (newContent: string) => void;
}

/**
 * Surfaces Git-style conflict markers produced by the V1 version
 * engine. Sits above the editor / viewer when the loaded file content
 * contains at least one full ``<<<<<<< / ======= / >>>>>>>`` block.
 *
 * Two affordances:
 *   - Bulk: "Keep all server" / "Keep all incoming" rewrites every
 *     block uniformly. Useful for hard-decided files.
 *   - Per-block: expand the block list to see each conflict region's
 *     ours vs theirs side by side and pick individually.
 *
 * The banner never auto-resolves — it only writes via ``onResolve``
 * after an explicit user action.
 */
export function ConflictMarkerBanner({
  content,
  onResolve,
}: ConflictMarkerBannerProps) {
  const blocks = useMemo<ConflictBlock[]>(
    () => parseConflictMarkers(content),
    [content],
  );
  const [expanded, setExpanded] = useState(false);

  if (blocks.length === 0) {
    return null;
  }

  const pickAll = (side: 'ours' | 'theirs') => {
    if (!onResolve) return;
    onResolve(resolveConflictMarkers(content, side));
  };

  const pickOne = (idx: number, side: 'ours' | 'theirs') => {
    if (!onResolve) return;
    onResolve(
      resolveConflictMarkers(content, (b) =>
        b === blocks[idx] ? (side === 'ours' ? b.ours : b.theirs) : b.ours,
      ),
    );
  };

  return (
    <div
      style={{
        background: 'color-mix(in srgb, var(--po-warning) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--po-warning) 32%, transparent)',
        borderRadius: 8,
        padding: '10px 14px',
        margin: '8px 12px',
        fontSize: 13,
        color: 'var(--po-text)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            background: 'var(--po-warning)',
            color: 'var(--po-text-inverse)',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          conflict
        </span>
        <span style={{ flex: 1, minWidth: 200 }}>
          This file has{' '}
          <strong>{blocks.length}</strong>{' '}
          unresolved merge conflict{blocks.length > 1 ? 's' : ''} from
          concurrent edits. Pick a side or merge manually.
        </span>
        {onResolve && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => pickAll('ours')}
              style={btnStyle()}
              title="Discard all incoming changes; keep server's version everywhere"
            >
              Keep all server
            </button>
            <button
              type="button"
              onClick={() => pickAll('theirs')}
              style={btnStyle()}
              title="Discard the server's version; take all incoming changes"
            >
              Keep all incoming
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            ...btnStyle(),
            background: 'transparent',
            border: '1px solid var(--po-border-subtle)',
          }}
        >
          {expanded ? 'Hide blocks' : `Show ${blocks.length} block${blocks.length > 1 ? 's' : ''}`}
        </button>
      </div>

      {expanded && (
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {blocks.map((block, idx) => (
            <div
              key={idx}
              style={{
                background: 'var(--po-panel)',
                border: '1px solid var(--po-border-subtle)',
                borderRadius: 6,
                overflow: 'hidden',
                fontFamily: 'var(--po-font-mono)',
                fontSize: 12,
              }}
            >
              <div
                style={{
                  padding: '4px 10px',
                  background: 'var(--po-control)',
                  borderBottom: '1px solid var(--po-border-subtle)',
                  fontSize: 11,
                  color: 'var(--po-text-muted)',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <span>
                  block {idx + 1} of {blocks.length} — line{' '}
                  {block.startLine + 1}–{block.endLine + 1}
                </span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 1,
                  background: 'var(--po-border-subtle)',
                }}
              >
                <SideColumn
                  label={block.oursLabel || 'current (server)'}
                  content={block.ours}
                  onPick={onResolve ? () => pickOne(idx, 'ours') : undefined}
                />
                <SideColumn
                  label={block.theirsLabel || 'incoming'}
                  content={block.theirs}
                  onPick={onResolve ? () => pickOne(idx, 'theirs') : undefined}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SideColumn({
  label,
  content,
  onPick,
}: {
  label: string;
  content: string;
  onPick?: () => void;
}) {
  return (
    <div
      style={{
        background: 'var(--po-panel)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 60,
      }}
    >
      <div
        style={{
          padding: '4px 10px',
          fontSize: 10,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--po-text-muted)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <span style={{ flex: 1 }}>{label}</span>
        {onPick && (
          <button
            type="button"
            onClick={onPick}
            style={{
              ...btnStyle(),
              padding: '1px 8px',
              fontSize: 10,
            }}
          >
            Pick this side
          </button>
        )}
      </div>
      <pre
        style={{
          margin: 0,
          padding: '6px 10px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          flex: 1,
        }}
      >
        {content || <span style={{ opacity: 0.4 }}>(empty)</span>}
      </pre>
    </div>
  );
}

function btnStyle(): React.CSSProperties {
  return {
    background: 'var(--po-panel)',
    color: 'var(--po-text)',
    border: '1px solid var(--po-border-subtle)',
    borderRadius: 4,
    padding: '3px 10px',
    fontSize: 12,
    cursor: 'pointer',
  };
}
