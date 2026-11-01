import { useEffect, useRef, useState } from "react";
import {
  deleteCloudProject,
  listCloudProjects,
  updateCloudProject,
  type DesktopCloudProject,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";
import type { RecentWorkspaceHomeItem } from "../../../lib/workspaceHomeModel";
import { clearCachedCatalog, readCachedCatalog, readLastCatalog, writeCachedCatalog } from "./homepageCloudCatalogCache";
import { buildHomepageProjects } from "./homepageCloudProjects";
import { loadCloudProjectActivity, readCachedProjectActivity, writeCachedProjectActivity } from "./homepageCloudActivity";

type Catalog = { authority: string; projects: DesktopCloudProject[]; status: "loading" | "ready" | "error";
  activity?: ReadonlyMap<string, string>;
  /** This session's own listing and history have arrived, so the order is the real one. */
  fresh?: boolean };

function cachedCatalog(scope: string | null, session: DesktopCloudSession) {
  // Offline the listing cannot answer, so a cached list would only show and vanish.
  if (!scope || session.status === "offline-authenticated") return undefined;
  const projects = readCachedCatalog(scope);
  return projects && { projects, activity: readCachedProjectActivity(scope) ?? new Map<string, string>() };
}

/** Revalidating never empties a list, and an account's cached list stands in for its first answer. */
function beginLoading(previous: Catalog | null, authority: string, cached: ReturnType<typeof cachedCatalog>): Catalog {
  const own = previous?.authority === authority ? previous : null;
  if (own?.status === "ready") return own;
  if (!own && cached) return { authority, status: "ready", ...cached };
  return { authority, projects: own?.projects ?? [], status: "loading" };
}

/** One account-scoped catalog shared by Homepage, Header and Sidebar navigation. */
export function useHomepageCloudProjects({ visible, enabled, session, restoring = false, apiBaseUrl, local }: {
  visible: boolean;
  enabled: boolean;
  session: DesktopCloudSession | null;
  /** The session is still being restored, so a missing one does not mean signed out. */
  restoring?: boolean;
  apiBaseUrl: string;
  local: readonly RecentWorkspaceHomeItem[];
}) {
  const authority = enabled && session ? JSON.stringify([apiBaseUrl, session.user_id, session.session_generation]) : null;
  // Session generations change between launches; the cached dates belong to the account.
  const accountScope = enabled && session ? JSON.stringify([apiBaseUrl, session.user_id]) : null;
  const current = useRef({ authority, session });
  current.current = { authority, session };
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [reload, setReload] = useState(0);
  const [lastCatalog] = useState(() => enabled && restoring ? readLastCatalog(apiBaseUrl) : undefined);
  useEffect(() => {
    if (!restoring && !session) clearCachedCatalog();
  }, [restoring, session]);
  useEffect(() => {
    if (!authority) { setCatalog(null); return; }
    if (!visible || !current.current.session) return;
    let cancelled = false;
    const capturedSession = current.current.session;
    const cached = cachedCatalog(accountScope, capturedSession);
    setCatalog((previous) => beginLoading(previous, authority, cached));
    const isCurrent = () => !cancelled && current.current.authority === authority;
    void listCloudProjects(capturedSession, apiBaseUrl).then(async (projects) => {
      if (!isCurrent()) return;
      const dates = accountScope ? readCachedProjectActivity(accountScope) : undefined;
      if (accountScope) writeCachedCatalog(accountScope, projects);
      setCatalog({ authority, projects, status: "ready", activity: dates });
      const loaded = await loadCloudProjectActivity(projects, capturedSession, apiBaseUrl, isCurrent);
      if (!isCurrent()) return;
      // A failed history read keeps the project's last known date, so it does not move.
      const activity = new Map(projects.flatMap(({ id }) => {
        const modified = loaded.get(id) ?? dates?.get(id);
        return modified ? [[id, modified] as const] : [];
      }));
      setCatalog({ authority, projects, status: "ready", activity, fresh: true });
      if (accountScope) writeCachedProjectActivity(accountScope, activity);
    }, () => {
      // A failed revalidation must not present revoked/stale projects as accessible.
      if (!cancelled && current.current.authority === authority) setCatalog({ authority, projects: [], status: "error" });
    });
    return () => { cancelled = true; };
  }, [accountScope, apiBaseUrl, authority, visible, reload]);
  // Reloading also drops any listing still in flight, which could bring the old entry back.
  const applyChange = (change: (projects: DesktopCloudProject[]) => DesktopCloudProject[]) => {
    setCatalog((previous) => previous?.authority === authority ? { ...previous, projects: change(previous.projects) } : previous);
    const cached = accountScope ? readCachedCatalog(accountScope) : undefined;
    if (accountScope && cached && current.current.authority === authority) writeCachedCatalog(accountScope, change(cached));
    setReload((value) => value + 1);
  };
  const changes = session ? {
    renameProject: async (projectId: string, name: string) => {
      const updated = await updateCloudProject(session, projectId, { name }, undefined, apiBaseUrl);
      applyChange((projects) => projects.map((project) => project.id === projectId ? { ...project, ...updated } : project));
    },
    deleteProject: async (projectId: string) => {
      await deleteCloudProject(session, projectId, undefined, apiBaseUrl);
      applyChange((projects) => projects.filter((project) => project.id !== projectId));
    },
  } : {};
  const scoped = authority && catalog?.authority === authority ? catalog : null;
  // A session slower than the first paint's patience must not cost the list its Cloud half.
  const standIn = restoring && !session ? lastCatalog : undefined;
  const items = buildHomepageProjects({ local, cloud: scoped?.projects ?? standIn?.projects ?? [], apiBaseUrl,
    activity: scoped?.activity ?? (standIn && readCachedProjectActivity(standIn.scope)) });
  return {
    /** Whose list this is, across the session generations of one account. */
    account: accountScope,
    items,
    status: !authority ? "signed-out" as const : scoped?.status ?? "loading" as const,
    /** No Cloud result is still on its way that would reorder the list. */
    settled: !authority || scoped?.status === "error" || (scoped?.status === "ready" && scoped.fresh === true),
    refresh: () => setReload((value) => value + 1),
    ...changes,
  };
}
