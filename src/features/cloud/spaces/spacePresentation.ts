import type { CloudSpace } from "../../../lib/workspaceHomeModel";

export type SpacePlanKey = "free" | "team" | "enterprise";

/** The plan a Space's projects use, in the three names people choose between. */
export function spacePlanKey(planId: string): SpacePlanKey {
  if (planId === "plus" || planId === "personal" || planId === "team_v2") return "team";
  if (planId === "business" || planId === "pro" || planId === "team" || planId === "enterprise_v2") return "enterprise";
  if (planId === "enterprise") return "enterprise";
  return "free";
}

/**
 * The account's own Space reads as "Personal" everywhere, never the server's
 * generated name, so it cannot be mistaken for a team Space named after the account.
 */
export function spaceDisplayName(space: Pick<CloudSpace, "name" | "isDefault">, personal: string): string {
  return space.isDefault ? personal : space.name;
}

export const SPACE_MARK_TONES = 6;

/** One stable tone per Space id, so a Space looks the same wherever it appears. */
export function spaceMarkTone(id: string): number {
  let hash = 0;
  for (const unit of id) hash = (hash * 31 + unit.codePointAt(0)!) >>> 0;
  return hash % SPACE_MARK_TONES;
}

/** The first letter of the Space's own name; the personal Space's is the account's. */
export function spaceMarkInitial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() || "S";
}

/** The Space that holds an open Cloud project, once the account's catalog names it. */
export function resolveProjectSpace({ spaces, projectId, items }: {
  spaces: readonly CloudSpace[];
  projectId: string | null | undefined;
  items: readonly { cloudProjectId?: string; cloudOrganizationId?: string }[];
}): CloudSpace | null {
  const ownerId = projectId ? items.find(item => item.cloudProjectId === projectId)?.cloudOrganizationId : null;
  return ownerId ? spaces.find(space => space.id === ownerId) ?? null : null;
}
