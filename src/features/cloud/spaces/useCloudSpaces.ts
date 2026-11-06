import { useEffect, useRef, useState } from "react";
import { ensurePersonalCloudSpace, listCloudOrganizations, type DesktopCloudSession } from "../../../lib/cloudApi";
import type { CloudSpace } from "../../../lib/workspaceHomeModel";

export function useCloudSpaces({ enabled, visible, session, apiBaseUrl }: {
  enabled: boolean; visible: boolean; session: DesktopCloudSession | null; apiBaseUrl: string;
}) {
  const authority = enabled && session ? JSON.stringify([apiBaseUrl, session.user_id, session.session_generation]) : null;
  const current = useRef({ authority, session });
  current.current = { authority, session };
  const [state, setState] = useState<{ authority: string; spaces: CloudSpace[]; status: "ready" | "error" } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const captured = current.current.session;
    if (!authority || !captured || !visible) return;
    let cancelled = false;
    const valid = () => !cancelled && current.current.authority === authority;
    void (async () => {
      try {
        let organizations = await listCloudOrganizations(captured, undefined, apiBaseUrl);
        if (!valid()) return;
        // A POST is deliberate provisioning, not a mutating GET. Never guess the
        // identity of old rows. Old servers cannot offer authoritative drop targets.
        if (!organizations.some((org) => org.kind === "personal")) {
          const personal = await ensurePersonalCloudSpace(captured, apiBaseUrl);
          if (!valid()) return;
          organizations = [...organizations.filter((org) => org.id !== personal.id), personal];
        }
        if (organizations.some((org) => !["personal", "team"].includes(org.kind ?? "")
          || typeof org.can_create_projects !== "boolean")) throw new Error("Space discovery unavailable");
        const spaces = organizations.map((org): CloudSpace => ({ id: org.id, name: org.name,
          kind: org.kind === "personal" ? "personal" : "team", canCreateProjects: org.can_create_projects === true }));
        spaces.sort((a, b) => Number(b.kind === "personal") - Number(a.kind === "personal") || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        if (valid()) setState({ authority, spaces, status: "ready" });
      } catch {
        if (valid()) setState({ authority, spaces: [], status: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, [authority, apiBaseUrl, visible, revision]);
  useEffect(() => {
    if (!visible) return;
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [visible]);
  const own = authority && state?.authority === authority ? state : null;
  return { spaces: own?.spaces ?? [], authority,
    status: !authority ? "signed-out" as const : own?.status ?? "loading" as const,
    refresh: () => setRevision((value) => value + 1) };
}
