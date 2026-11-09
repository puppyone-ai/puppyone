import { useCallback, useLayoutEffect, useState } from "react";
import type { CloudSpace, ProjectHomeItem } from "../../../lib/workspaceHomeModel";

const LOCAL = "local";

/** One renderer is one window. Stored selection is a preference, never authority. */
export function useCurrentSpace({ account, spaces, projectId, items }: {
  account: string | null;
  spaces: readonly CloudSpace[];
  projectId: string | null;
  items: readonly ProjectHomeItem[];
}) {
  const key = account ? `puppyone.current-space:${account}` : null;
  const [selection, setSelection] = useState<{ key: string | null; id: string | null }>({ key: null, id: null });
  const stored = (() => { try { return key ? localStorage.getItem(key) : null; } catch { return null; } })();
  const preferred = selection.key === key ? selection.id : stored;
  const fallback = spaces.find((space) => space.isDefault)?.id ?? spaces[0]?.id ?? null;
  const projectSpaceId = projectId ? items.find((item) => item.cloudProjectId === projectId)?.cloudOrganizationId : null;
  let selected: string | null = fallback;
  if (preferred === LOCAL) selected = null;
  else if (spaces.some((space) => space.id === preferred)) selected = preferred;
  const id = account ? projectSpaceId ?? selected : null;

  useLayoutEffect(() => {
    if (projectSpaceId && key) {
      setSelection({ key, id: projectSpaceId });
      try { localStorage.setItem(key, projectSpaceId); } catch { /* Optional preference. */ }
    } else if (selection.key !== key) {
      // Capture the startup preference once for this window/account. Another
      // window may update storage later, but it must not change this window.
      setSelection({ key, id: stored ?? fallback });
    }
  }, [fallback, key, projectSpaceId, selection.key, stored]);

  const select = useCallback((next: string | null) => {
    setSelection({ key, id: next ?? LOCAL });
    try { if (key) localStorage.setItem(key, next ?? LOCAL); } catch { /* Optional preference. */ }
  }, [key]);
  return { id, space: spaces.find((space) => space.id === id) ?? null, select,
    items: projectsInSpace(items, id) };
}

export function projectsInSpace(items: readonly ProjectHomeItem[], spaceId: string | null): ProjectHomeItem[] {
  const ownership = new Map(items.filter((item) => item.cloudProjectId)
    .map((item) => [item.cloudProjectId!, item.cloudOrganizationId]));
  return items.filter((item) => {
    let owner = item.cloudOrganizationId;
    if (!item.cloudProjectId) owner = item.linkedCloudProject ? ownership.get(item.linkedCloudProject.id) : undefined;
    return spaceId === null ? Boolean(item.localPath && !owner) : owner === spaceId;
  });
}
