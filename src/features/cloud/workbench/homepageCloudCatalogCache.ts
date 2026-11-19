import type { DesktopCloudProject } from "../../../lib/cloudApi";
import type { CloudSpace } from "../../../lib/workspaceHomeModel";

const CATALOG_CACHE_KEY = "puppyone.desktop.cloud-project-catalog.v1";
const ORGANIZATION_NAMES_CACHE_KEY = "puppyone.desktop.cloud-organization-names.v1";
const SPACES_CACHE_KEY = "puppyone.desktop.cloud-spaces.v1";

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
  const kept = projects.map(({ id, name, org_id, updated_at, capabilities }) => ({ id, name, org_id, updated_at, capabilities }));
  try {
    window.localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ scope, projects: kept }));
  } catch {
    // Without the cache the next launch waits for the catalog before showing the list.
  }
}

/**
 * The names of an account's organizations, so an open Cloud project's Header can
 * say where it is from the first frame. Like the catalog, it only stands in until
 * the account answers, and it holds names, so signing out removes it.
 */
export function readCachedOrganizationNames(scope: string): ReadonlyMap<string, string> | undefined {
  try {
    const cached = JSON.parse(window.localStorage.getItem(ORGANIZATION_NAMES_CACHE_KEY) ?? "null") as
      { scope?: unknown; names?: unknown } | null;
    if (cached?.scope !== scope || !cached.names || typeof cached.names !== "object") return undefined;
    return new Map(Object.entries(cached.names).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return undefined;
  }
}

export function writeCachedOrganizationNames(scope: string, names: ReadonlyMap<string, string>) {
  try {
    window.localStorage.setItem(ORGANIZATION_NAMES_CACHE_KEY, JSON.stringify({ scope, names: Object.fromEntries(names) }));
  } catch {
    // Without the cache the next launch states the Cloud until the account answers.
  }
}

/**
 * The spaces an account last saw. They decide which Homepage group each Cloud project
 * is in, so they stand in with the cached catalog: a list shown before its spaces would
 * be grouped once provisionally and then again. Names only; signing out removes them.
 */
export function readCachedSpaces(scope: string): CloudSpace[] | undefined {
  try {
    const cached = JSON.parse(window.localStorage.getItem(SPACES_CACHE_KEY) ?? "null") as
      { scope?: unknown; spaces?: unknown } | null;
    if (cached?.scope !== scope || !Array.isArray(cached.spaces)) return undefined;
    return cached.spaces.filter((space): space is CloudSpace => typeof space?.id === "string"
      && typeof space?.name === "string" && (["space", "personal", "team"].includes(space.kind))
      && typeof space.canCreateProjects === "boolean").map((space) => ({ ...space, kind: "space" as const }));
  } catch {
    return undefined;
  }
}

export function writeCachedSpaces(scope: string, spaces: readonly CloudSpace[]) {
  try {
    window.localStorage.setItem(SPACES_CACHE_KEY, JSON.stringify({ scope, spaces }));
  } catch {
    // Without the cache the next launch waits for the spaces before grouping the list.
  }
}

export function clearCachedCatalog() {
  try {
    window.localStorage.removeItem(CATALOG_CACHE_KEY);
    window.localStorage.removeItem(ORGANIZATION_NAMES_CACHE_KEY);
    window.localStorage.removeItem(SPACES_CACHE_KEY);
  } catch {
    // Nothing was readable either, so nothing can be shown from it.
  }
}
