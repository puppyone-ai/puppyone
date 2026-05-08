'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { stat, readFile } from '@/lib/contentTreeApi';
import { isFolderType } from '@/lib/nodeTypeConfig';
import { resolveFormat, isTextLikeCategory, UNKNOWN_FORMAT } from '@/lib/fileFormats';
import { setPendingActiveId } from '../components/explorer';
import type { MarkdownViewMode } from '@/components/editors/markdown';

/**
 * Seed the `activeNodeType` (the *node* type, not the file format)
 * for an instant render before stat returns. Driven by the file-format
 * registry: any markdown format → 'markdown' nodeType, any JSON format
 * → 'json' nodeType, everything else → 'file'. Folders are handled
 * by `typeHint`, so this never returns 'folder'.
 */
function inferTypeFromName(name: string): string {
  const fmt = resolveFormat({ name, mimeType: null });
  if (fmt.id === 'markdown') return 'markdown';
  if (fmt.id === 'json') return 'json';
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
  if (isFolderType(resolvedType)) {
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

  // `textContent` holds the raw UTF-8 contents of the active file
  // when its file format is text-like (markdown / code / yaml / csv /
  // plaintext). It's empty when the active node is a folder, an
  // image, a PDF, or another binary.
  const [textContent, setTextContent] = useState<string>('');
  const [isLoadingText, setIsLoadingText] = useState(false);
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
        setIsLoadingText(false);
        setPendingActiveId(null);
        setCurrentFolderPath(null);
        setFolderBreadcrumbs([]);
        setActiveNodeId('');
        setActiveNodeType('');
        setActivePreviewType(null);
        setActiveMimeType(null);
        setTextContent('');
        return;
      }

      const fullPath = path.join('/');
      const breadcrumbs = buildBreadcrumbs(path);
      const fileName = path[path.length - 1] ?? '';

      // Resolve the file format up front from the filename alone —
      // extension is enough for ~99% of files, so we don't need to
      // wait for the stat round-trip to know what to fetch / render.
      const fmtFromName = resolveFormat({ name: fileName, mimeType: null });

      // When a type hint is available (sidebar click), render immediately
      // without waiting for the stat round-trip.
      if (typeHint) {
        applyFileState(fullPath, typeHint, path, breadcrumbs, setters);
        setPendingActiveId(null);
        setActiveMimeType(null);
        // Page-level spinner needs to stay up only when:
        //   - typeHint says it's a file, AND
        //   - extension didn't match anything in the registry, AND
        //   - we still need stat to give us a server-side mime
        // Otherwise the registry already knows what viewer to mount,
        // and the viewer's internal loader takes over.
        const isFolderHint = isFolderType(typeHint);
        const needsStatToDispatch =
          !isFolderHint && fmtFromName.id === UNKNOWN_FORMAT.id;
        setIsResolvingPath(needsStatToDispatch);
      } else {
        setIsResolvingPath(true);
      }

      // Pre-fetch the text content in parallel with stat for any
      // text-like format. The previous version only did this for
      // markdown — but code/yaml/csv/plaintext all want it too.
      const inferredType = typeHint || inferTypeFromName(fileName);
      const shouldReadFile =
        !isFolderType(inferredType) && isTextLikeCategory(fmtFromName);
      if (shouldReadFile) {
        setIsLoadingText(true);
      } else {
        setIsLoadingText(false);
      }

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
          setTextContent('');
          setIsLoadingText(false);
        }
        setIsResolvingPath(false);
        return;
      }

      applyFileState(fullPath, resolvedType, path, breadcrumbs, setters);
      setActiveMimeType(resolvedMime);
      setPendingActiveId(null);

      // Re-resolve format with mime now that we have it — covers the
      // "unknown extension but server-detected mime" edge case.
      const fmtFinal = resolveFormat({ name: fileName, mimeType: resolvedMime });
      const finalNeedsText =
        !isFolderType(resolvedType) && isTextLikeCategory(fmtFinal);

      if (finalNeedsText) {
        if (fileContent !== null) {
          setTextContent(typeof fileContent.content_text === 'string' ? fileContent.content_text : '');
          setIsLoadingText(false);
        } else {
          // Fallback: fetch now (e.g. extension unknown, mime arrived as
          // text/* via stat).
          setIsLoadingText(true);
          try {
            const content = await readFile(projectId, fullPath);
            if (cancelled) return;
            setTextContent(typeof content.content_text === 'string' ? content.content_text : '');
          } catch (readErr) {
            if (cancelled) return;
            console.error('[usePathResolver] Failed to load text content:', readErr);
            setTextContent('');
          } finally {
            if (!cancelled) setIsLoadingText(false);
          }
        }
      } else {
        setTextContent('');
        setIsLoadingText(false);
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
      setTextContent('');
      setIsLoadingText(false);
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
    textContent,
    setTextContent,
    isLoadingText,
    markdownViewMode,
    setMarkdownViewMode,
  };
}
