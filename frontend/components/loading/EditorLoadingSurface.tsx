'use client';

import type { CSSProperties, ReactNode } from 'react';
import { PageLoading } from './PageLoading';

export interface EditorLoadingSurfaceProps {
  label?: ReactNode | null;
  style?: CSSProperties;
}

/**
 * Full-surface loader for editor/viewer panes.
 *
 * Editor fallbacks often render as flex children while the real editor
 * renders as a block with 100% width. This wrapper declares both shapes
 * explicitly so dynamic import, worker boot, and data-fetch loaders
 * occupy the same rectangle and never snap to the left edge mid-load.
 */
export function EditorLoadingSurface({
  label = 'Loading',
  style,
}: EditorLoadingSurfaceProps) {
  return (
    <div
      style={{
        flex: 1,
        width: '100%',
        minWidth: 0,
        height: '100%',
        minHeight: 0,
        display: 'flex',
        background: 'var(--po-canvas)',
        ...style,
      }}
    >
      <PageLoading variant="fill" label={label} />
    </div>
  );
}
