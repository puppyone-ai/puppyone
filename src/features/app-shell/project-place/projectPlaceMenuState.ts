import type { LocalFolderCloudNotice } from "../../cloud";

/**
 * What the Header's place menu offers. A local folder and its Cloud project are
 * two projects (puppy-issues ADR-001): the menu states where the open project
 * is, and its one action either starts putting a folder in the Cloud or opens
 * the other project. It never moves one project between this computer and the
 * Cloud.
 */
export type ProjectPlaceAction =
  /** A folder without a Cloud project; the conversion entry. */
  | { kind: "put-in-cloud"; continuing: boolean }
  | { kind: "open-cloud-project"; projectId: string; projectName: string | null }
  | { kind: "sign-in" }
  | { kind: "put-in-cloud-again" }
  | { kind: "open-local-folder"; path: string; name: string };

export type ProjectPlaceMenu = Readonly<{
  place: "local" | "cloud";
  action: ProjectPlaceAction | null;
}>;

export function resolveProjectPlaceMenu({ place, unhosted, publishPending, notice, missingReplaceable, linkedFolder }: {
  place: "local" | "cloud";
  /** The open local folder has no Cloud association at all. */
  unhosted: boolean;
  /** A first publish is running or saved for the open local folder. */
  publishPending: boolean;
  /** The open local folder's notice, which already explains any other state. */
  notice: LocalFolderCloudNotice | null;
  missingReplaceable: boolean;
  /** For an open Cloud project: the local folder linked to it, if any. */
  linkedFolder?: Readonly<{ path: string; name: string }> | null;
}): ProjectPlaceMenu {
  if (place === "cloud") {
    return { place, action: linkedFolder ? { kind: "open-local-folder", ...linkedFolder } : null };
  }
  if (publishPending) return { place, action: { kind: "put-in-cloud", continuing: true } };
  if (unhosted) return { place, action: { kind: "put-in-cloud", continuing: false } };
  if (notice?.kind === "linked" && notice.openable) {
    return { place, action: { kind: "open-cloud-project", projectId: notice.projectId, projectName: notice.projectName } };
  }
  if (notice?.kind === "sign-in") return { place, action: { kind: "sign-in" } };
  if (notice?.kind === "missing" && missingReplaceable) return { place, action: { kind: "put-in-cloud-again" } };
  // Another environment, no access, an ambiguous or unreachable link: the
  // folder's own notice explains it; the menu offers nothing that cannot work.
  return { place, action: null };
}
