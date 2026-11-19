import type { DesktopCloudProject, DesktopCloudSession } from "../../../lib/cloudApi";
import { getCloudHistory } from "../../../lib/cloudHistoryApi";

export function latestProjectModifiedAt(...values: (string | null | undefined)[]): string | null {
  const timestamps = values.map((value) => value ? Date.parse(value) : NaN).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

const ACTIVITY_CACHE_KEY = "puppyone.desktop.cloud-project-activity.v1";

/**
 * Last known activity dates for one account. They only date projects the fresh
 * catalog returned, so they never prove access; they let the list start in its
 * real order without waiting for one history read per project.
 */
export function readCachedProjectActivity(scope: string): ReadonlyMap<string, string> | undefined {
  try {
    const cached = JSON.parse(window.localStorage.getItem(ACTIVITY_CACHE_KEY) ?? "null") as
      { scope?: unknown; activity?: unknown } | null;
    if (cached?.scope !== scope || !cached.activity || typeof cached.activity !== "object") return undefined;
    return new Map(Object.entries(cached.activity).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return undefined;
  }
}

export function writeCachedProjectActivity(scope: string, activity: ReadonlyMap<string, string>) {
  try {
    window.localStorage.setItem(ACTIVITY_CACHE_KEY, JSON.stringify({ scope, activity: Object.fromEntries(activity) }));
  } catch {
    // Without the cache the next launch reads history before showing the list.
  }
}

/** Project.updated_at alone need not advance on content writes. Read one existing history entry.
 * Bounded parallelism; history denial/offline never hides an accessible project or opens its files.
 */
export async function loadCloudProjectActivity(projects: readonly DesktopCloudProject[], session: DesktopCloudSession,
  apiBaseUrl: string, isCurrent: () => boolean): Promise<ReadonlyMap<string, string>> {
  const activity = new Map<string, string>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, projects.length) }, async () => {
    while (cursor < projects.length && isCurrent()) {
      const project = projects[cursor++]!;
      try {
        const history = await getCloudHistory(session, project.id, 1, undefined, apiBaseUrl);
        const modified = latestProjectModifiedAt(project.updated_at, ...history.commits.map((commit) => commit.created_at));
        if (modified && isCurrent()) activity.set(project.id, modified);
      } catch { /* Keep the actual Project metadata timestamp, or unknown. */ }
    }
  }));
  return activity;
}
