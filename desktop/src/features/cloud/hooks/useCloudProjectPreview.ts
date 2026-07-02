import { useEffect, useState } from "react";
import {
  listCloudRoot,
  type DesktopCloudSession,
  type DesktopCloudTreeEntry,
} from "../../../lib/cloudApi";

const CLOUD_PROJECT_PREVIEW_LIMIT = 8;
const CLOUD_PROJECT_PREVIEW_CACHE_LIMIT = 120;

const previewCache = new Map<string, DesktopCloudTreeEntry[]>();
const previewRequests = new Map<string, Promise<DesktopCloudTreeEntry[]>>();

type CloudProjectPreviewState = {
  entries: DesktopCloudTreeEntry[];
  loading: boolean;
  error: string | null;
};

export function useCloudProjectPreview({
  session,
  projectId,
  apiBaseUrl,
  onSessionChange,
}: {
  session: DesktopCloudSession | null;
  projectId: string;
  apiBaseUrl: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
}): CloudProjectPreviewState {
  const cacheKey = session
    ? [session.user_email, apiBaseUrl ?? session.api_base_url ?? "", projectId].join("\n")
    : null;
  const cachedEntries = cacheKey ? previewCache.get(cacheKey) : undefined;
  const [state, setState] = useState<CloudProjectPreviewState>({
    entries: cachedEntries ?? [],
    loading: Boolean(session && !cachedEntries),
    error: null,
  });

  useEffect(() => {
    if (!session || !projectId || !cacheKey) {
      setState({ entries: [], loading: false, error: null });
      return undefined;
    }

    const cached = previewCache.get(cacheKey);
    if (cached) {
      setState({ entries: cached, loading: false, error: null });
      return undefined;
    }

    let cancelled = false;
    setState((current) => ({
      entries: current.entries,
      loading: true,
      error: null,
    }));

    const request = getPreviewRequest(cacheKey, () => (
      listCloudRoot(session, projectId, onSessionChange, apiBaseUrl)
        .then((tree) => sortPreviewEntries(tree.entries).slice(0, CLOUD_PROJECT_PREVIEW_LIMIT))
    ));

    request
      .then((entries) => {
        if (cancelled) return;
        setState({
          entries,
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          entries: [],
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load project preview.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    apiBaseUrl,
    cacheKey,
    onSessionChange,
    projectId,
    session,
  ]);

  return state;
}

function getPreviewRequest(
  cacheKey: string,
  load: () => Promise<DesktopCloudTreeEntry[]>,
) {
  const existing = previewRequests.get(cacheKey);
  if (existing) return existing;

  const request = load()
    .then((entries) => {
      previewCache.set(cacheKey, entries);
      trimPreviewCache();
      return entries;
    })
    .finally(() => {
      previewRequests.delete(cacheKey);
    });

  previewRequests.set(cacheKey, request);
  return request;
}

function trimPreviewCache() {
  while (previewCache.size > CLOUD_PROJECT_PREVIEW_CACHE_LIMIT) {
    const oldestKey = previewCache.keys().next().value;
    if (!oldestKey) return;
    previewCache.delete(oldestKey);
  }
}

function sortPreviewEntries(entries: DesktopCloudTreeEntry[]) {
  return [...entries].sort((left, right) => {
    const leftFolder = left.type === "folder";
    const rightFolder = right.type === "folder";
    if (leftFolder !== rightFolder) return leftFolder ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}
