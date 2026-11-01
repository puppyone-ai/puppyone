import type { DesktopCloudProject } from "../../../lib/cloudApi";

const CATALOG_CACHE_KEY = "puppyone.desktop.cloud-project-catalog.v1";

/**
 * The list an account last saw, so its Homepage can appear whole at once. It only
 * stands in until the fresh catalog answers, and proves nothing: every Cloud open is
 * still authorized by the server. It holds project names, so signing out removes it.
 */
function readEntry() {
  try {
    const cached = JSON.parse(window.localStorage.getItem(CATALOG_CACHE_KEY) ?? "null") as
      { scope?: unknown; projects?: unknown } | null;
    if (typeof cached?.scope !== "string" || !Array.isArray(cached.projects)) return null;
    const projects = cached.projects.filter((project): project is DesktopCloudProject =>
      typeof project?.id === "string" && typeof project?.name === "string");
    return { scope: cached.scope, apiBaseUrl: (JSON.parse(cached.scope) as unknown[])[0], projects };
  } catch {
    return null;
  }
}

export function readCachedCatalog(scope: string): DesktopCloudProject[] | undefined {
  const entry = readEntry();
  return entry?.scope === scope ? entry.projects : undefined;
}

/** Whichever account last used this Cloud, for the moments before its session is known. */
export function readLastCatalog(apiBaseUrl: string) {
  const entry = readEntry();
  return entry?.apiBaseUrl === apiBaseUrl ? entry : undefined;
}

export function writeCachedCatalog(scope: string, projects: readonly DesktopCloudProject[]) {
  const kept = projects.map(({ id, name, updated_at, capabilities }) => ({ id, name, updated_at, capabilities }));
  try {
    window.localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ scope, projects: kept }));
  } catch {
    // Without the cache the next launch waits for the catalog before showing the list.
  }
}

export function clearCachedCatalog() {
  try {
    window.localStorage.removeItem(CATALOG_CACHE_KEY);
  } catch {
    // Nothing was readable either, so nothing can be shown from it.
  }
}
