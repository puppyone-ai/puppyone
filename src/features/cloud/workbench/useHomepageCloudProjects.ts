import { useEffect, useRef, useState } from "react";
import { listCloudProjects, type DesktopCloudProject, type DesktopCloudSession } from "../../../lib/cloudApi";
import type { RecentWorkspaceHomeItem } from "../../../lib/workspaceHomeModel";
import { buildHomepageProjects } from "./homepageCloudProjects";
import { loadCloudProjectActivity, readCachedProjectActivity, writeCachedProjectActivity } from "./homepageCloudActivity";

type Catalog = { authority: string; projects: DesktopCloudProject[]; status: "loading" | "ready" | "error";
  activity?: ReadonlyMap<string, string> };

/** One account-scoped catalog shared by Homepage, Header and Sidebar navigation. */
export function useHomepageCloudProjects({ visible, enabled, session, apiBaseUrl, local }: {
  visible: boolean;
  enabled: boolean;
  session: DesktopCloudSession | null;
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
  useEffect(() => {
    if (!authority) { setCatalog(null); return; }
    if (!visible || !current.current.session) return;
    let cancelled = false;
    setCatalog((previous) => ({ authority, projects: previous?.authority === authority ? previous.projects : [], status: "loading" }));
    const capturedSession = current.current.session;
    const isCurrent = () => !cancelled && current.current.authority === authority;
    void listCloudProjects(capturedSession, apiBaseUrl).then(async (projects) => {
      if (!isCurrent()) return;
      const cached = accountScope ? readCachedProjectActivity(accountScope) : undefined;
      setCatalog({ authority, projects, status: "ready", activity: cached });
      const loaded = await loadCloudProjectActivity(projects, capturedSession, apiBaseUrl, isCurrent);
      if (!isCurrent()) return;
      // A failed history read keeps the project's last known date, so it does not move.
      const activity = new Map(projects.flatMap(({ id }) => {
        const modified = loaded.get(id) ?? cached?.get(id);
        return modified ? [[id, modified] as const] : [];
      }));
      setCatalog({ authority, projects, status: "ready", activity });
      if (accountScope) writeCachedProjectActivity(accountScope, activity);
    }, () => {
      // A failed revalidation must not present revoked/stale projects as accessible.
      if (!cancelled && current.current.authority === authority) setCatalog({ authority, projects: [], status: "error" });
    });
    return () => { cancelled = true; };
  }, [accountScope, apiBaseUrl, authority, visible, reload]);
  const scoped = authority && catalog?.authority === authority ? catalog : null;
  const items = buildHomepageProjects({ local, cloud: scoped?.projects ?? [], apiBaseUrl, activity: scoped?.activity });
  return {
    items,
    status: !authority ? "signed-out" as const : scoped?.status ?? "loading" as const,
    /** No Cloud result is still on its way that would reorder the list. */
    settled: !authority || scoped?.status === "error" || (scoped?.status === "ready" && scoped.activity !== undefined),
    refresh: () => setReload((value) => value + 1),
  };
}
