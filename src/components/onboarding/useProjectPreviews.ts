import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listCloudRoot, type DesktopCloudSession, type DesktopCloudTreeEntry } from "../../lib/cloudApi";
import { projectHomeItemLocation, type ProjectHomeItem } from "../../lib/workspaceHomeModel";
import type { ProjectAssetPreview, ProjectAssetPreviewKind } from "../../types/electron";

const EMPTY_PREVIEWS: ReadonlyMap<string, readonly ProjectAssetPreview[]> = new Map();

const ASSET_KIND_PRIORITY: Record<ProjectAssetPreviewKind, number> = {
  html: 0,
  md: 1,
  csv: 2,
  other: 3,
};

function classifyCloudEntryKind(entry: DesktopCloudTreeEntry): ProjectAssetPreviewKind {
  const name = entry.name ?? "";
  if (entry.type === "html" || /\.html?$/i.test(name)) return "html";
  if (entry.type === "markdown" || /\.(?:md|markdown|mdx)$/i.test(name)) return "md";
  if (/\.(?:csv|tsv)$/i.test(name)) return "csv";
  return "other";
}

function isCloudFolderEntry(entry: DesktopCloudTreeEntry): boolean {
  return entry.type === "folder" || entry.type === "dir" || entry.type === "directory";
}

export function selectCloudProjectPreviews(entries: readonly DesktopCloudTreeEntry[]): ProjectAssetPreview[] {
  return entries
    .filter((entry) => entry && !isCloudFolderEntry(entry) && Boolean(entry.name) && !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      kind: classifyCloudEntryKind(entry),
      snippet: null,
    }))
    .sort((left, right) => (
      ASSET_KIND_PRIORITY[left.kind] - ASSET_KIND_PRIORITY[right.kind]
      || left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    ))
    .slice(0, 3);
}

function samePreviewList(left: readonly ProjectAssetPreview[], right: readonly ProjectAssetPreview[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (a.name !== b.name || a.kind !== b.kind || a.snippet !== b.snippet) return false;
  }
  return true;
}

function samePreviewMaps(
  left: ReadonlyMap<string, readonly ProjectAssetPreview[]>,
  right: ReadonlyMap<string, readonly ProjectAssetPreview[]>,
) {
  if (left.size !== right.size) return false;
  for (const [key, list] of right) {
    const other = left.get(key);
    if (!other || !samePreviewList(other, list)) return false;
  }
  return true;
}

/**
 * Batch-reads up to three top-level asset previews per project on mount and window focus.
 * Local projects read via `workspace:project-previews`; Cloud projects read filenames and
 * types via `listCloudRoot` without fetching file contents.
 */
export function useProjectPreviews({
  items,
  enabled,
  session = null,
  apiBaseUrl = null,
}: {
  items: readonly ProjectHomeItem[];
  enabled: boolean;
  session?: DesktopCloudSession | null;
  apiBaseUrl?: string | null;
}): ReadonlyMap<string, readonly ProjectAssetPreview[]> {
  const [previews, setPreviews] = useState<ReadonlyMap<string, readonly ProjectAssetPreview[]>>(EMPTY_PREVIEWS);
  const generationRef = useRef(0);

  const targets = useMemo(() => {
    const localPaths: string[] = [];
    const seenLocal = new Set<string>();
    const cloudProjectIds: string[] = [];
    const seenCloud = new Set<string>();

    for (const item of items) {
      if (projectHomeItemLocation(item) === "cloud") {
        if (item.cloudProjectId && !seenCloud.has(item.cloudProjectId)) {
          seenCloud.add(item.cloudProjectId);
          cloudProjectIds.push(item.cloudProjectId);
        }
      } else if (item.localPath && !seenLocal.has(item.localPath)) {
        seenLocal.add(item.localPath);
        localPaths.push(item.localPath);
      }
    }
    return {
      localKey: localPaths.join("\n"),
      cloudKey: cloudProjectIds.join("\n"),
    };
  }, [items]);

  const sessionKey = session && apiBaseUrl
    ? `${session.user_id}:${session.session_generation}:${apiBaseUrl}`
    : "";

  const refresh = useCallback(async () => {
    if (!enabled || (!targets.localKey && (!targets.cloudKey || !sessionKey || !session || !apiBaseUrl))) {
      setPreviews((current) => (current.size ? EMPTY_PREVIEWS : current));
      return;
    }

    const requestId = ++generationRef.current;
    const bridge = window.puppyoneDesktop;
    const localPaths = targets.localKey ? targets.localKey.split("\n") : [];
    const cloudProjectIds = session && apiBaseUrl && targets.cloudKey ? targets.cloudKey.split("\n") : [];

    const [localResults, cloudResults] = await Promise.all([
      localPaths.length > 0 && bridge?.getProjectPreviews
        ? bridge.getProjectPreviews(localPaths).catch(() => null)
        : Promise.resolve(null),
      cloudProjectIds.length > 0 && session && apiBaseUrl
        ? Promise.all(cloudProjectIds.map(async (projectId) => {
          const tree = await listCloudRoot(session, projectId, undefined, apiBaseUrl).catch(() => null);
          return tree ? { projectId, previews: selectCloudProjectPreviews(tree.entries ?? []) } : null;
        }))
        : Promise.resolve(null),
    ]);

    if (requestId !== generationRef.current) return;

    const next = new Map<string, readonly ProjectAssetPreview[]>();
    if (localResults) {
      for (const entry of localResults) {
        if (entry.previews.length > 0) {
          next.set(entry.path, entry.previews);
        }
      }
    }
    if (cloudResults) {
      for (const entry of cloudResults) {
        if (entry && entry.previews.length > 0) {
          next.set(`cloud:${entry.projectId}`, entry.previews);
        }
      }
    }

    setPreviews((current) => (samePreviewMaps(current, next) ? current : next));
  }, [apiBaseUrl, enabled, session, sessionKey, targets.cloudKey, targets.localKey]);

  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      generationRef.current += 1;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return enabled ? previews : EMPTY_PREVIEWS;
}
