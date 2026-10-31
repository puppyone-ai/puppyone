import type { ProjectTarget } from "./windowProjectStore";

export type ProjectOpening = Readonly<{ location: "local" | "cloud"; projectName: string }>;

/** A chosen project is named as the catalog names it; a dropped folder is not in it yet. */
function localProjectName(path: string, projectItems: ProjectOpeningInput["projectItems"]) {
  return projectItems.find((item) => item.localPath === path)?.label
    || path.split(/[\\/]/).filter(Boolean).at(-1)
    || "";
}

type ProjectOpeningInput = Readonly<{
  opening: ProjectTarget | null;
  /** Reselecting what is on screen is not an open: nothing should cover it. */
  displayedPath: string | null;
  displayedCloudProjectId: string | null;
  projectItems: readonly Readonly<{ label: string; localPath: string; cloudProjectId?: string }>[];
  /** What the Cloud has said about the project, for one the catalog does not list. */
  preparedCloudProjectName?: string;
}>;

/** What a surface says about the project this window is entering, if any. */
export function describeProjectOpening({
  opening, displayedPath, displayedCloudProjectId, projectItems, preparedCloudProjectName,
}: ProjectOpeningInput): ProjectOpening | null {
  if (!opening) return null;
  if (opening.kind === "dropped") return { location: "local", projectName: opening.folder.name };
  if (opening.kind === "local") {
    if (opening.path === displayedPath) return null;
    return { location: "local", projectName: localProjectName(opening.path, projectItems) };
  }
  if (opening.projectId === displayedCloudProjectId) return null;
  return { location: "cloud", projectName: projectItems.find((item) => item.cloudProjectId === opening.projectId)?.label
    ?? preparedCloudProjectName ?? "" };
}
