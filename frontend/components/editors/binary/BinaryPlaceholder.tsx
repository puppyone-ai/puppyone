'use client';

import React from 'react';

interface BinaryPlaceholderProps {
  /** Display name shown to the user. */
  nodeName: string;
  /** Format label, e.g. "HEIC Image", "Word Document". Helps the
   *  user understand *why* we can't render it inline. */
  formatLabel?: string;
}

/**
 * Fallback viewer for files we recognize but can't render inline
 * (HEIC, DOCX, ZIP, etc.). The user still sees the file name and a
 * format label, plus the implicit affordance to download via the
 * existing right-panel download flow.
 */
export function BinaryPlaceholder({ nodeName, formatLabel }: BinaryPlaceholderProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        color: '#71717a',
      }}
    >
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <div style={{ fontSize: 16, fontWeight: 500, color: '#d4d4d8' }}>{nodeName}</div>
      <div style={{ fontSize: 13, textAlign: 'center', maxWidth: 360 }}>
        {formatLabel ? `${formatLabel} — preview not available in browser` : 'Raw file stored in S3'}
      </div>
    </div>
  );
}

export default BinaryPlaceholder;
