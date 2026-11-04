import { useEffect, useMemo, useState } from "react";
import { listCloudOrganizations, type DesktopCloudSession } from "../../../lib/cloudApi";
import { readCachedOrganizationNames, writeCachedOrganizationNames } from "./homepageCloudCatalogCache";

/** Accounts whose organizations this launch has asked for (or already has); the list rarely changes. */
const askedScopes = new Set<string>();
const answeredNames = new Map<string, ReadonlyMap<string, string>>();

/**
 * The name of the organization an open Cloud project belongs to: where in the
 * Cloud the project is, as the Header states it. The organizations are read
 * only while a Cloud project is open, never for the Homepage, and once per
 * account per launch; until they answer, the last launch's names stand in.
 * Returns null while the name is unknown, so the Header falls back to the Cloud.
 */
export function useCloudOrganizationName({ session, apiBaseUrl, organizationId }: {
  session: DesktopCloudSession | null;
  apiBaseUrl: string;
  /** Absent while no Cloud project is open, or its catalog entry does not state one. */
  organizationId: string | null | undefined;
}): string | null {
  const scope = session ? JSON.stringify([apiBaseUrl, session.user_id]) : null;
  const cached = useMemo(() => scope ? readCachedOrganizationNames(scope) : undefined, [scope]);
  const [, setAnswered] = useState(0);

  useEffect(() => {
    if (!scope || !session || !organizationId || askedScopes.has(scope)) return;
    askedScopes.add(scope);
    listCloudOrganizations(session, undefined, apiBaseUrl).then((organizations) => {
      const names = new Map(organizations.map((organization) => [organization.id, organization.name] as const));
      answeredNames.set(scope, names);
      writeCachedOrganizationNames(scope, names);
      setAnswered((count) => count + 1);
    }, () => {
      // Unanswered, the Header keeps naming the Cloud; the next open asks again.
      askedScopes.delete(scope);
    });
  }, [apiBaseUrl, organizationId, scope, session]);

  if (!scope || !organizationId) return null;
  const names = answeredNames.get(scope) ?? cached;
  return names?.get(organizationId)?.trim() || null;
}

/** Tests only: forget what this launch has asked and heard. */
export function resetCloudOrganizationNamesForTests() {
  askedScopes.clear();
  answeredNames.clear();
}
