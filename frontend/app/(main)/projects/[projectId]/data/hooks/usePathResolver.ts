'use client';

import { useState, useEffect } from 'react';
import { getNode, getDownloadUrl } from '@/lib/contentNodesApi';
import { getNodeTypeConfig } from '@/lib/nodeTypeConfig';
import { setPendingActiveId } from '../components/views';
import type { MarkdownViewMode } from '@/components/editors/markdown';

const nodeCache = new Map<string, { data: any; ts: number }>();
const NODE_CACHE_TTL = 60_000;

export async function getCachedNode(nodeId: string, projectId: string) {
  const key = `${projectId}:${nodeId}`;
  const cached = nodeCache.get(key);
  if (cached && Date.now() - cached.ts < NODE_CACHE_TTL) return cached.data;
  const node = await getNode(nodeId, projectId);
  nodeCache.set(key, { data: node, ts: Date.now() });
  return node;
}

export function usePathResolver(projectId: string, path: string[]) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
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
          setCurrentFolderId(null);
          setFolderBreadcrumbs([]);
          setActiveNodeId('');
          setActiveNodeType('');
          setActivePreviewType(null);
          setMarkdownContent('');
          return;
        }

        const results = await Promise.all(
          path.map(nodeId =>
            getCachedNode(nodeId, projectId).catch(err => {
              console.error(`Failed to get node ${nodeId}:`, err);
              return null;
            })
          )
        );
        if (cancelled) return;

        const pathNodes = results
          .filter((n): n is NonNullable<typeof n> => n != null)
          .map(n => ({ id: n.id, name: n.name, type: n.type }));

        const folders = pathNodes.filter(n => n.type === 'folder');
        const lastNode = pathNodes[pathNodes.length - 1];

        if (lastNode?.type === 'folder') {
          setPendingActiveId(null);
          setCurrentFolderId(lastNode.id);
          setFolderBreadcrumbs(folders.map(f => ({ id: f.id, name: f.name })));
          setActiveNodeId('');
          setActiveNodeType('');
          setActivePreviewType(null);
          setMarkdownContent('');
        } else if (lastNode) {
          setPendingActiveId(null);
          setActiveNodeId(lastNode.id);
          setActiveNodeType(lastNode.type);
          setActivePreviewType(null);

          if (folders.length > 0) {
            const lastFolder = folders[folders.length - 1];
            setCurrentFolderId(lastFolder.id);
            setFolderBreadcrumbs(folders.map(f => ({ id: f.id, name: f.name })));
          } else {
            setCurrentFolderId(null);
            setFolderBreadcrumbs([]);
          }

          const nodeConfig = getNodeTypeConfig(lastNode.type);
          if (nodeConfig.renderAs === 'markdown') {
            setIsLoadingMarkdown(true);
            try {
              const fullNode = await getCachedNode(lastNode.id, projectId);
              if (cancelled) return;
              if (typeof fullNode.preview_md === 'string') {
                setMarkdownContent(fullNode.preview_md);
              } else if (fullNode.s3_key) {
                const { download_url } = await getDownloadUrl(lastNode.id, projectId);
                if (cancelled) return;
                const response = await fetch(download_url);
                if (cancelled) return;
                setMarkdownContent(await response.text());
              } else {
                setMarkdownContent('');
              }
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
    currentFolderId,
    setCurrentFolderId,
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
