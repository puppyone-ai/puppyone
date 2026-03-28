'use client';

import { useState, useEffect } from 'react';
import { stat, readFile } from '@/lib/contentTreeApi';
import { getNodeTypeConfig } from '@/lib/nodeTypeConfig';
import { setPendingActiveId } from '../components/views';
import type { MarkdownViewMode } from '@/components/editors/markdown';

export function usePathResolver(projectId: string, path: string[]) {
  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(null);
  const [folderBreadcrumbs, setFolderBreadcrumbs] = useState<Array<{ id: string; name: string }>>([]);
  const [isResolvingPath, setIsResolvingPath] = useState(path.length > 0);

  const [activeNodeId, setActiveNodeId] = useState<string>('');
  const [activeNodeType, setActiveNodeType] = useState<string>('');
  const [activePreviewType, setActivePreviewType] = useState<string | null>(null);

  const [markdownContent, setMarkdownContent] = useState<string>('');
  const [isLoadingMarkdown, setIsLoadingMarkdown] = useState(false);
  const [markdownViewMode, setMarkdownViewMode] = useState<MarkdownViewMode>('wysiwyg');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pathKey = path.join('/');

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      setIsResolvingPath(true);

      try {
        if (path.length === 0) {
          setPendingActiveId(null);
          setCurrentFolderPath(null);
          setFolderBreadcrumbs([]);
          setActiveNodeId('');
          setActiveNodeType('');
          setActivePreviewType(null);
          setMarkdownContent('');
          return;
        }

        // Join URL path segments to form the full file path
        const fullPath = path.join('/');

        // Stat to determine type
        const statResult = await stat(projectId, fullPath);
        if (cancelled) return;

        if (!statResult.exists) {
          setPendingActiveId(null);
          setCurrentFolderPath(null);
          setFolderBreadcrumbs([]);
          setActiveNodeId('');
          setActiveNodeType('');
          setActivePreviewType(null);
          setMarkdownContent('');
          return;
        }

        // Build breadcrumbs from path segments
        const breadcrumbs: Array<{ id: string; name: string }> = [];
        for (let i = 0; i < path.length; i++) {
          const segmentPath = path.slice(0, i + 1).join('/');
          breadcrumbs.push({ id: segmentPath, name: path[i] });
        }

        if (statResult.type === 'folder') {
          setPendingActiveId(null);
          setCurrentFolderPath(fullPath);
          setFolderBreadcrumbs(breadcrumbs);
          setActiveNodeId('');
          setActiveNodeType('');
          setActivePreviewType(null);
          setMarkdownContent('');
        } else {
          // It's a file — the folder is everything except the last segment
          setPendingActiveId(null);
          setActiveNodeId(fullPath);
          setActiveNodeType(statResult.type);
          setActivePreviewType(null);

          if (path.length > 1) {
            const folderPath = path.slice(0, -1).join('/');
            setCurrentFolderPath(folderPath);
            setFolderBreadcrumbs(breadcrumbs.slice(0, -1));
          } else {
            setCurrentFolderPath(null);
            setFolderBreadcrumbs([]);
          }

          const nodeConfig = getNodeTypeConfig(statResult.type);
          if (nodeConfig.renderAs === 'markdown') {
            setIsLoadingMarkdown(true);
            try {
              const content = await readFile(projectId, fullPath);
              if (cancelled) return;
              setMarkdownContent(typeof content.content_text === 'string' ? content.content_text : '');
            } catch (err) {
              if (cancelled) return;
              console.error('Failed to load markdown content:', err);
              setMarkdownContent('');
            } finally {
              if (!cancelled) setIsLoadingMarkdown(false);
            }
          } else {
            setMarkdownContent('');
          }
        }
      } finally {
        if (!cancelled) setIsResolvingPath(false);
      }
    }

    resolve();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, pathKey]);

  return {
    currentFolderId: currentFolderPath,
    setCurrentFolderId: setCurrentFolderPath,
    folderBreadcrumbs,
    isResolvingPath,
    activeNodeId,
    activeNodeType,
    activePreviewType,
    markdownContent,
    setMarkdownContent,
    isLoadingMarkdown,
    markdownViewMode,
    setMarkdownViewMode,
  };
}
