import { useEffect, useRef, useState } from "react";
import { listCloudProjects, type DesktopCloudProject, type DesktopCloudSession } from "../../../lib/cloudApi";
import type { RecentWorkspaceHomeItem } from "../../app-shell/workspaceHomeModel";
import { buildHomepageProjects } from "./homepageCloudProjects";
import { loadCloudProjectActivity } from "./homepageCloudActivity";

type Catalog = { authority: string; projects: DesktopCloudProject[]; status: "loading" | "ready" | "error";
  activity?: ReadonlyMap<string, string> };

/** One account-scoped catalog shared by Homepage and Header project navigation. */
export function useHomepageCloudProjects({ visible, enabled, session, apiBaseUrl, local }: {
  visible: boolean;
  enabled: boolean;
  session: DesktopCloudSession | null;
  apiBaseUrl: string;
  local: readonly RecentWorkspaceHomeItem[];
}) {
  const authority = enabled && session ? JSON.stringify([apiBaseUrl, session.user_id, session.session_generation]) : null;
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
      setCatalog({ authority, projects, status: "ready" });
      const activity = await loadCloudProjectActivity(projects, capturedSession, apiBaseUrl, isCurrent);
      if (isCurrent()) setCatalog({ authority, projects, status: "ready", activity });
    }, () => {
      // A failed revalidation must not present revoked/stale projects as accessible.
      if (!cancelled && current.current.authority === authority) setCatalog({ authority, projects: [], status: "error" });
    });
    return () => { cancelled = true; };
  }, [apiBaseUrl, authority, visible, reload]);
  const scoped = authority && catalog?.authority === authority ? catalog : null;
  return {
    items: buildHomepageProjects({ local, cloud: scoped?.projects ?? [], apiBaseUrl,
      activity: scoped?.activity }),
    status: !authority ? "signed-out" as const : scoped?.status ?? "loading" as const,
    refresh: () => setReload((value) => value + 1),
  };
}
