import type { CloudSpace, ProjectHomeItem } from "../../lib/workspaceHomeModel";

export type ProjectMenuGroup = Readonly<
  | { kind: "local"; items: readonly ProjectHomeItem[] }
  | { kind: "space"; space: CloudSpace; items: readonly ProjectHomeItem[] }
  | { kind: "cloud"; items: readonly ProjectHomeItem[] }
>;

/**
 * The project menu lists projects by the place that holds them, in the
 * Homepage's order: this computer, then each Space as the account's list orders
 * them (its own Space first), then Cloud projects whose Space is not known yet.
 * Opening a project in another Space is how a window moves between Spaces.
 */
export function groupProjectsByPlace(items: readonly ProjectHomeItem[], spaces: readonly CloudSpace[]): ProjectMenuGroup[] {
  const local = items.filter((item) => item.localPath);
  const cloud = items.filter((item) => !item.localPath);
  const groups: ProjectMenuGroup[] = local.length ? [{ kind: "local", items: local }] : [];
  for (const space of spaces) {
    const held = cloud.filter((item) => item.cloudOrganizationId === space.id);
    if (held.length) groups.push({ kind: "space", space, items: held });
  }
  const unplaced = cloud.filter((item) => !spaces.some((space) => space.id === item.cloudOrganizationId));
  if (unplaced.length) groups.push({ kind: "cloud", items: unplaced });
  return groups;
}

/** A menu of only this computer's folders needs no heading to say so. */
export function projectMenuGroupsNeedHeadings(groups: readonly ProjectMenuGroup[]): boolean {
  return groups.length > 1 || (groups.length === 1 && groups[0].kind !== "local");
}
