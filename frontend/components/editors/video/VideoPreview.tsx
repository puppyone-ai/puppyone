'use client';

import React, { useEffect, useState } from 'react';
import { getInlinePreviewUrl } from '@/lib/contentTreeApi';
import { PageLoading } from '@/components/loading';

interface VideoPreviewProps {
  projectId: string;
  filePath: string;
  nodeName: string;
  /** Format-resolved MIME (e.g. 'video/mp4'). See AudioPreview note. */
  mimeType?: string;
}

/**
 * Native `<video>` player backed by a signed inline URL. The browser
 * owns streaming, buffering, and range requests; we don't fetch the
 * whole file into JS memory before playback.
 */
export function VideoPreview({ projectId, filePath, nodeName, mimeType }: VideoPreviewProps) {
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
        Failed to load video: {error}
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
        gap: 12,
      }}
    >
      <div style={{ fontSize: 13, color: '#a1a1aa' }}>{nodeName}</div>
      <video
        key={previewUrl}
        controls
        preload="metadata"
        style={{
          maxWidth: '100%',
          maxHeight: 'calc(100% - 40px)',
          borderRadius: 8,
          background: '#000',
        }}
      >
        <source src={previewUrl} type={mimeType} />
        Your browser does not support video playback.
      </video>
    </div>
  );
}

export default VideoPreview;
