'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { stat, readFile } from '@/lib/contentTreeApi';
import { getNodeTypeConfig } from '@/lib/nodeTypeConfig';
import { setPendingActiveId } from '../components/explorer';
import type { MarkdownViewMode } from '@/components/editors/markdown';

function inferTypeFromName(name: string): string {
  if (/\.json$/i.test(name)) return 'json';
  if (/\.md$/i.test(name)) return 'markdown';
  return 'file';
}

function buildBreadcrumbs(segments: string[]): Array<{ id: string; name: string }> {
  return segments.map((seg, i) => ({
    id: segments.slice(0, i + 1).join('/'),
    name: seg,
  }));
}

function applyFileState(
  fullPath: string,
  resolvedType: string,
  segments: string[],
  breadcrumbs: Array<{ id: string; name: string }>,
  setters: {
    setActiveNodeId: (v: string) => void;
    setActiveNodeType: (v: string) => void;
    setActivePreviewType: (v: string | null) => void;
    setCurrentFolderPath: (v: string | null) => void;
    setFolderBreadcrumbs: (v: Array<{ id: string; name: string }>) => void;
  },
) {
  const isFolder = getNodeTypeConfig(resolvedType).renderAs === 'folder';
  if (isFolder) {
    setters.setCurrentFolderPath(fullPath);
    setters.setFolderBreadcrumbs(breadcrumbs);
    setters.setActiveNodeId('');
    setters.setActiveNodeType('');
  } else {
    setters.setActiveNodeId(fullPath);
    setters.setActiveNodeType(resolvedType);
    if (segments.length > 1) {
      setters.setCurrentFolderPath(segments.slice(0, -1).join('/'));
      setters.setFolderBreadcrumbs(breadcrumbs.slice(0, -1));
    } else {
      setters.setCurrentFolderPath(null);
      setters.setFolderBreadcrumbs([]);
    }
  }
  setters.setActivePreviewType(null);
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function usePathResolver(projectId: string, rawPath: string[]) {
  const path = rawPath.map(safeDecode);
  const searchParams = useSearchParams();
  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(null);
  const [folderBreadcrumbs, setFolderBreadcrumbs] = useState<Array<{ id: string; name: string }>>([]);
  const [isResolvingPath, setIsResolvingPath] = useState(path.length > 0);

  const [activeNodeId, setActiveNodeId] = useState<string>('');
  const [activeNodeType, setActiveNodeType] = useState<string>('');
  const [activePreviewType, setActivePreviewType] = useState<string | null>(null);
  const [activeMimeType, setActiveMimeType] = useState<string | null>(null);

  const [markdownContent, setMarkdownContent] = useState<string>('');
  const [isLoadingMarkdown, setIsLoadingMarkdown] = useState(false);
  const [markdownViewMode, setMarkdownViewMode] = useState<MarkdownViewMode>('wysiwyg');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pathKey = path.join('/');
  const typeHint = searchParams.get('type') ?? '';

  useEffect(() => {
    let cancelled = false;
    const setters = {
      setActiveNodeId,
      setActiveNodeType,
      setActivePreviewType,
      setCurrentFolderPath,
      setFolderBreadcrumbs,
    };

    async function resolve() {
      if (path.length === 0) {
        setIsResolvingPath(false);
        setIsLoadingMarkdown(false);
        setPendingActiveId(null);
        setCurrentFolderPath(null);
        setFolderBreadcrumbs([]);
        setActiveNodeId('');
        setActiveNodeType('');
        setActivePreviewType(null);
        setActiveMimeType(null);
        setMarkdownContent('');
        return;
      }

      const fullPath = path.join('/');
      const breadcrumbs = buildBreadcrumbs(path);

      // When a type hint is available (sidebar click), render immediately
      // without waiting for the stat round-trip.
      if (typeHint) {
        applyFileState(fullPath, typeHint, path, breadcrumbs, setters);
        setPendingActiveId(null);
        setIsResolvingPath(false);
      } else {
        setIsResolvingPath(true);
      }

      // When typeHint is available, start readFile in parallel with stat
      // so the user sees content as fast as possible.
      const inferredType = typeHint || inferTypeFromName(path[path.length - 1]);
      const inferredRenderAs = getNodeTypeConfig(inferredType).renderAs;
      const shouldReadFile = inferredRenderAs === 'markdown';
      if (shouldReadFile) {
        setIsLoadingMarkdown(true);
      } else {
        setIsLoadingMarkdown(false);
      }

      // Fire stat and (if likely needed) readFile in parallel
      const statPromise = stat(projectId, fullPath).catch((err) => {
        console.error('[usePathResolver] stat failed:', fullPath, err);
        return null;
      });
      const readFilePromise = shouldReadFile
        ? readFile(projectId, fullPath).catch(() => null)
        : Promise.resolve(null);

      const [statResult, fileContent] = await Promise.all([statPromise, readFilePromise]);
      if (cancelled) return;

      let resolvedType: string;
      let resolvedMime: string | null = null;
      let exists = true;

      if (statResult) {
        exists = statResult.exists;
        resolvedType = statResult.type || inferredType;
        resolvedMime = statResult.mime_type ?? null;
      } else {
        resolvedType = inferredType;
      }

      if (!exists) {
        // If we already rendered the editor via typeHint, keep it — don't
        // fall back to root just because stat lost the race against an
        // in-flight write. (Without typeHint there's no pending render to
        // preserve, so resetting is correct.)
        if (!typeHint) {
          setPendingActiveId(null);
          setCurrentFolderPath(null);
          setFolderBreadcrumbs([]);
          setActiveNodeId('');
          setActiveNodeType('');
          setActivePreviewType(null);
          setActiveMimeType(null);
          setMarkdownContent('');
          setIsLoadingMarkdown(false);
        }
        setIsResolvingPath(false);
        return;
      }

      applyFileState(fullPath, resolvedType, path, breadcrumbs, setters);
      setActiveMimeType(resolvedMime);
      setPendingActiveId(null);

      const renderAs = getNodeTypeConfig(resolvedType).renderAs;
      const isTextMime = resolvedMime?.startsWith('text/') && resolvedMime !== 'text/markdown';

      if (renderAs === 'markdown' || isTextMime) {
        // If we already fetched in parallel, use that result
        if (fileContent !== null) {
          setMarkdownContent(typeof fileContent.content_text === 'string' ? fileContent.content_text : '');
          setIsLoadingMarkdown(false);
        } else {
          // Fallback: fetch now (e.g. mime turned out to be text after stat)
          setIsLoadingMarkdown(true);
          try {
            const content = await readFile(projectId, fullPath);
            if (cancelled) return;
            setMarkdownContent(typeof content.content_text === 'string' ? content.content_text : '');
          } catch (readErr) {
            if (cancelled) return;
            console.error('[usePathResolver] Failed to load text content:', readErr);
            setMarkdownContent('');
          } finally {
            if (!cancelled) setIsLoadingMarkdown(false);
          }
        }
      } else {
        setMarkdownContent('');
        setIsLoadingMarkdown(false);
      }

      if (!cancelled) setIsResolvingPath(false);
    }

    resolve().catch((err) => {
      if (cancelled) return;
      console.error('[usePathResolver] Unexpected error:', err);
      const fullPath = path.join('/');
      const breadcrumbs = buildBreadcrumbs(path);
      const guessedType = typeHint || inferTypeFromName(path[path.length - 1] ?? '');
      applyFileState(fullPath, guessedType, path, breadcrumbs, setters);
      setPendingActiveId(null);
      setMarkdownContent('');
      setIsLoadingMarkdown(false);
      setIsResolvingPath(false);
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, pathKey, typeHint]);

  return {
    currentFolderId: currentFolderPath,
    setCurrentFolderId: setCurrentFolderPath,
    folderBreadcrumbs,
    isResolvingPath,
    activeNodeId,
    activeNodeType,
    activePreviewType,
    activeMimeType,
    markdownContent,
    setMarkdownContent,
    isLoadingMarkdown,
    markdownViewMode,
    setMarkdownViewMode,
  };
}
