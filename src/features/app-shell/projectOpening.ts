import type { ProjectNavigationTarget } from "./projectNavigation";

/**
 * The name of the local project this window is entering, or null when it is not
 * entering one. A chosen project is named as the Homepage names it; a dropped
 * folder is not in the catalog yet, so it is named by the folder.
 */
export function openingLocalProjectName({ pending, droppedProjectName, projectItems }: {
  pending: ProjectNavigationTarget | null;
  droppedProjectName: string | null;
  projectItems: readonly Readonly<{ label: string; localPath: string }>[];
}): string | null {
  if (droppedProjectName !== null) return droppedProjectName;
  if (pending?.kind !== "local") return null;
  return projectItems.find((item) => item.localPath === pending.path)?.label
    || pending.path.split(/[\\/]/).filter(Boolean).at(-1)
    || "";
}
