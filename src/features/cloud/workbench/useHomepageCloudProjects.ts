import { useEffect, useRef, useState } from "react";
import { listCloudProjects, type DesktopCloudProject, type DesktopCloudSession } from "../../../lib/cloudApi";
import type { RecentWorkspaceHomeItem } from "../../app-shell/workspaceHomeModel";
import { buildHomepageProjects } from "./homepageCloudProjects";
import { readCloudProjectHistory } from "./homepageCloudHistory";

type Catalog = { authority: string; projects: DesktopCloudProject[]; status: "loading" | "ready" | "error" };

/** Auto-load only on the visible Homepage. Header switching never fetches this catalog. */
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
    void listCloudProjects(current.current.session, apiBaseUrl).then((projects) => {
      if (!cancelled && current.current.authority === authority) setCatalog({ authority, projects, status: "ready" });
    }, () => {
      // A failed revalidation must not present revoked/stale projects as accessible.
      if (!cancelled && current.current.authority === authority) setCatalog({ authority, projects: [], status: "error" });
    });
    return () => { cancelled = true; };
  }, [apiBaseUrl, authority, visible, reload]);
  const scoped = authority && catalog?.authority === authority ? catalog : null;
  return {
    items: buildHomepageProjects({ local, cloud: scoped?.projects ?? [], apiBaseUrl,
      history: enabled && session ? readCloudProjectHistory(apiBaseUrl, session.user_id) : new Map() }),
    status: !authority ? "signed-out" as const : scoped?.status ?? "loading" as const,
    refresh: () => setReload((value) => value + 1),
  };
}
