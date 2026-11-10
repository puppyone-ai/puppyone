import type { CloudSpace, ProjectHomeItem } from "../../../lib/workspaceHomeModel";

/** Suggest a management target; never filter navigation or persist a global Space. */
export function resolveSettingsSpace({ account, spaces, projectId, items }: {
  account: string | null;
  spaces: readonly CloudSpace[];
  projectId: string | null;
  items: readonly ProjectHomeItem[];
}): CloudSpace | null {
  if (!account) return null;
  const ownerId = projectId ? items.find(item => item.cloudProjectId === projectId)?.cloudOrganizationId : null;
  return spaces.find(space => space.id === ownerId)
    ?? spaces.find(space => space.isDefault) ?? spaces[0] ?? null;
}
