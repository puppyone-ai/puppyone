'use client';

import React, { useEffect, useState } from 'react';
import { getInlinePreviewUrl } from '@/lib/contentTreeApi';
import { PageLoading } from '@/components/loading';

interface PdfPreviewProps {
  projectId: string;
  filePath: string;
  nodeName: string;
}

/**
 * PDF preview using the browser's built-in PDF viewer via a signed
 * inline URL. Zero-dependency — every modern browser ships a PDF.js
 * implementation and exposes it through `<iframe src="..." />`.
 *
 * If we ever need annotation tooling or page extraction, swap this
 * for `react-pdf` and bump the package — the registry entry doesn't
 * have to change.
 */
export function PdfPreview({ projectId, filePath, nodeName }: PdfPreviewProps) {
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
          padding: 24,
        }}
      >
        Failed to load PDF: {error}
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
        minHeight: 0,
        background: '#0a0a0a',
      }}
    >
      <iframe
        src={previewUrl}
        title={nodeName}
        style={{
          flex: 1,
          width: '100%',
          border: 'none',
          background: '#1a1a1a',
        }}
      />
    </div>
  );
}

export default PdfPreview;
