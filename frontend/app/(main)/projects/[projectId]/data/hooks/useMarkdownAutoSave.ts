'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { updateNode } from '@/lib/contentNodesApi';

export function useMarkdownAutoSave(
  activeNodeId: string,
  projectId: string,
  setMarkdownContent: (content: string) => void,
) {
  const [markdownSaveStatus, setMarkdownSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    };
  }, []);

  const handleMarkdownChange = useCallback((newContent: string) => {
    setMarkdownContent(newContent);

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      if (!activeNodeId) return;
      setMarkdownSaveStatus('saving');
      try {
        await updateNode(activeNodeId, projectId, { preview_md: newContent });
        setMarkdownSaveStatus('saved');
        statusTimeoutRef.current = setTimeout(() => setMarkdownSaveStatus('idle'), 2000);
      } catch (err) {
        console.error('[Markdown AutoSave] Failed:', err);
        setMarkdownSaveStatus('error');
        statusTimeoutRef.current = setTimeout(() => setMarkdownSaveStatus('idle'), 3000);
      }
    }, 1500);
  }, [activeNodeId, projectId, setMarkdownContent]);

  return { handleMarkdownChange, markdownSaveStatus };
}
