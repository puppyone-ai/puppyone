import { useEffect, useMemo, useRef, useState } from "react";
import { ensurePersonalCloudSpace, listCloudOrganizations, type DesktopCloudSession } from "../../../lib/cloudApi";
import type { CloudSpace } from "../../../lib/workspaceHomeModel";
import { readCachedSpaces, writeCachedSpaces } from "../workbench/homepageCloudCatalogCache";

const NO_SPACES: CloudSpace[] = [];

export function useCloudSpaces({ enabled, visible, session, apiBaseUrl }: {
  enabled: boolean; visible: boolean; session: DesktopCloudSession | null; apiBaseUrl: string;
}) {
  const authority = enabled && session ? JSON.stringify([apiBaseUrl, session.user_id, session.session_generation]) : null;
  // The same account scope as the catalog cache, which outlives session generations.
  const accountScope = enabled && session ? JSON.stringify([apiBaseUrl, session.user_id]) : null;
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
        if (!organizations.some((org) => org.is_default === true)) {
          const personal = await ensurePersonalCloudSpace(captured, apiBaseUrl);
          if (!valid()) return;
          organizations = [...organizations.filter((org) => org.id !== personal.id), personal];
        }
        if (organizations.some((org) => typeof org.can_create_projects !== "boolean")) throw new Error("Space discovery unavailable");
        const spaces = organizations.map((org): CloudSpace => ({ id: org.id, name: org.name,
          kind: "space", canCreateProjects: org.can_create_projects === true,
          isDefault: org.is_default === true, role: org.role, canManageSpace: org.can_manage_space === true,
          planId: typeof org.billing_plan_id === "string" ? org.billing_plan_id : null }));
        spaces.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        if (!valid()) return;
        if (accountScope) writeCachedSpaces(accountScope, spaces);
        setState({ authority, spaces, status: "ready" });
      } catch {
        // Keep what this account already answered; the failure is only reported.
        if (valid()) setState((previous) => ({ authority, status: "error",
          spaces: previous?.authority === authority ? previous.spaces : [] }));
      }
    })();
    return () => { cancelled = true; };
  }, [authority, accountScope, apiBaseUrl, visible, revision]);
  useEffect(() => {
    if (!visible) return;
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [visible]);
  const own = authority && state?.authority === authority ? state : null;
  // Until this account answers, the spaces it last saw stand in, as its catalog does.
  const cached = useMemo(() => (accountScope ? readCachedSpaces(accountScope) : undefined), [accountScope]);
  // A failed read says nothing about the spaces, so the last ones keep the groups put.
  let spaces = cached ?? NO_SPACES;
  if (own && (own.status === "ready" || own.spaces.length > 0)) spaces = own.spaces;
  const status = own?.status ?? (cached ? "ready" as const : "loading" as const);
  return { spaces, authority,
    status: !authority ? "signed-out" as const : status,
    refresh: () => setRevision((value) => value + 1) };
}
