import type { CloudSpace, ProjectHomeItem } from "../../../lib/workspaceHomeModel";
import { resolveProjectSpace } from "./spacePresentation";

/**
 * The one Space Settings manages: the Space its opener named, else the open
 * project's, else the account's own. Never filters navigation or persists a global Space.
 */
export function resolveSettingsSpace({ account, spaces, projectId, items, requestedId = null }: {
  account: string | null;
  spaces: readonly CloudSpace[];
  projectId: string | null;
  items: readonly ProjectHomeItem[];
  /** Named by the control that opened Settings, such as a Space's own heading. */
  requestedId?: string | null;
}): CloudSpace | null {
  if (!account) return null;
  const ownerId = projectId ? items.find(item => item.cloudProjectId === projectId)?.cloudOrganizationId : null;
  return spaces.find(space => space.id === requestedId)
    ?? spaces.find(space => space.id === ownerId)
    ?? spaces.find(space => space.isDefault) ?? spaces[0] ?? null;
}

/** The Space that holds the open Cloud project, once the account's catalog names it. */
export function resolveProjectSpaceId({ spaces, projectId, items }: {
  spaces: readonly CloudSpace[];
  projectId: string | null;
  items: readonly ProjectHomeItem[];
}): string | null {
  return resolveProjectSpace({ spaces, projectId, items })?.id ?? null;
}
