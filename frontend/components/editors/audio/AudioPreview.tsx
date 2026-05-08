'use client';

import React, { useEffect, useState } from 'react';
import { getInlinePreviewUrl } from '@/lib/contentTreeApi';
import { PageLoading } from '@/components/loading';

interface AudioPreviewProps {
  projectId: string;
  filePath: string;
  nodeName: string;
  /** Format-resolved MIME (e.g. 'audio/mpeg'). Passed through to
   *  `<source type>` so codec routing is deterministic, in case
   *  the server's blob.type was lost or stripped by a proxy. */
  mimeType?: string;
}

/**
 * Native `<audio>` player backed by a signed inline URL. The browser
 * owns streaming, buffering, and range requests; we don't fetch the
 * whole file into JS memory before playback.
 */
export function AudioPreview({ projectId, filePath, nodeName, mimeType }: AudioPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getInlinePreviewUrl(projectId, filePath)
      .then((url) => {
        if (cancelled) return;
        setPreviewUrl(url);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, filePath]);

  if (error) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ef4444',
        }}
      >
        Failed to load audio: {error}
      </div>
    );
  }

  if (!previewUrl) {
    return <PageLoading variant="fill" />;
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#0a0a0a',
        gap: 16,
      }}
    >
      <div style={{ fontSize: 13, color: '#a1a1aa' }}>{nodeName}</div>
      <audio key={previewUrl} controls preload="metadata" style={{ width: 'min(560px, 90%)' }}>
        <source src={previewUrl} type={mimeType} />
        Your browser does not support audio playback.
      </audio>
    </div>
  );
}

export default AudioPreview;
