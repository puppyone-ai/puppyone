'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { usePathResolver } from './usePathResolver';

type FolderBreadcrumb = { id: string; name: string };

type PendingFolderNavigation = {
  path: string | null;
  pathKey: string;
  breadcrumbs: FolderBreadcrumb[];
};

type UseDataRouteControllerArgs = {
  projectId: string;
  path: string[];
};

function buildFolderBreadcrumbs(segments: string[]): FolderBreadcrumb[] {
  return segments.map((seg, index) => ({
    id: segments.slice(0, index + 1).join('/'),
    name: seg,
  }));
}

export function useDataRouteController({
  projectId,
  path,
}: UseDataRouteControllerArgs) {
  const router = useRouter();
  const routePathKey = path.join('/');
  const [pendingFolderNavigation, setPendingFolderNavigation] =
    useState<PendingFolderNavigation | null>(null);
  const [isRouteTransitionPending, startRouteTransition] = useTransition();

  const {
    currentFolderId: resolvedCurrentFolderId,
    folderBreadcrumbs: resolvedFolderBreadcrumbs,
    isResolvingPath: resolvedIsResolvingPath,
    activeNodeId: resolvedActiveNodeId,
    activeNodeType: resolvedActiveNodeType,
    activePreviewType: resolvedActivePreviewType,
    activeMimeType: resolvedActiveMimeType,
    // `textContent` here is the **server-side** value (any text-like
    // file: markdown, code, yaml, csv, plaintext). The page-level
    // editor draft comes from useMarkdownSave and may differ while dirty.
    textContent: serverTextContent,
    isLoadingText,
    markdownViewMode,
    setMarkdownViewMode,
  } = usePathResolver(projectId, path);

  const shouldUsePendingFolderNavigation =
    pendingFolderNavigation !== null &&
    (isRouteTransitionPending || pendingFolderNavigation.pathKey === routePathKey);

  const currentFolderId = shouldUsePendingFolderNavigation
    ? pendingFolderNavigation.path
    : resolvedCurrentFolderId;
  const folderBreadcrumbs = shouldUsePendingFolderNavigation
    ? pendingFolderNavigation.breadcrumbs
    : resolvedFolderBreadcrumbs;
  const isResolvingPath = shouldUsePendingFolderNavigation ? false : resolvedIsResolvingPath;
  const activeNodeId = shouldUsePendingFolderNavigation ? '' : resolvedActiveNodeId;
  const activeNodeType = shouldUsePendingFolderNavigation ? '' : resolvedActiveNodeType;
  const activePreviewType = shouldUsePendingFolderNavigation ? null : resolvedActivePreviewType;
  const activeMimeType = shouldUsePendingFolderNavigation ? null : resolvedActiveMimeType;

  useEffect(() => {
    if (!pendingFolderNavigation) return;

    if (pendingFolderNavigation.pathKey !== routePathKey) {
      if (!isRouteTransitionPending) {
        setPendingFolderNavigation(null);
      }
      return;
    }

    if (
      !resolvedIsResolvingPath &&
      !resolvedActiveNodeId &&
      (resolvedCurrentFolderId ?? null) === pendingFolderNavigation.path
    ) {
      setPendingFolderNavigation(null);
    }
  }, [
    isRouteTransitionPending,
    pendingFolderNavigation,
    resolvedActiveNodeId,
    resolvedCurrentFolderId,
    resolvedIsResolvingPath,
    routePathKey,
  ]);

  const navigateTo = useCallback((nextPath: string[], typeHint?: string) => {
    const encoded = nextPath.map((s) => encodeURIComponent(s)).join('/');
    const basePath = `/projects/${projectId}/data${encoded ? `/${encoded}` : ''}`;
    const url = typeHint ? `${basePath}?type=${encodeURIComponent(typeHint)}` : basePath;
    const nextPathKey = nextPath.join('/');

    if (typeHint === 'folder') {
      setPendingFolderNavigation({
        path: nextPathKey || null,
        pathKey: nextPathKey,
        breadcrumbs: buildFolderBreadcrumbs(nextPath),
      });
    } else {
      setPendingFolderNavigation(null);
    }

    startRouteTransition(() => {
      router.push(url);
    });
  }, [projectId, router, startRouteTransition]);

  return {
    currentFolderId,
    folderBreadcrumbs,
    isResolvingPath,
    activeNodeId,
    activeNodeType,
    activePreviewType,
    activeMimeType,
    serverTextContent,
    isLoadingText,
    markdownViewMode,
    setMarkdownViewMode,
    navigateTo,
  };
}
