import type { LocalFolderCloudNotice } from "../../cloud";
import { compactDisplayPath, getWorkspacePathForDisplay } from "../../../lib/workspaceHomeModel";

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

/**
 * Where exactly the open project is. The icon already says which kind of place it
 * is, so the words say where: a local project's folder (`~/project`), or the
 * organization that holds a Cloud project. `full` is the unabbreviated form.
 */
export type ProjectPlaceAddress = Readonly<{ short: string; full: string }>;

export type ProjectPlaceMenu = Readonly<{
  place: "local" | "cloud";
  /** Absent while it is unknown; the Header then names the kind of place instead. */
  address?: ProjectPlaceAddress | null;
  action: ProjectPlaceAction | null;
}>;

/** A local project's address: the folder that holds it, from the home folder, shortened. */
export function localProjectAddress(path: string | null | undefined): ProjectPlaceAddress | null {
  const trimmed = path?.trim().replace(/(.)[\\/]+$/, "$1");
  if (!trimmed || trimmed.startsWith("puppyone-cloud:")) return null;
  const full = getWorkspacePathForDisplay(trimmed);
  const separator = full.includes("\\") && !full.includes("/") ? "\\" : "/";
  const cut = full.lastIndexOf(separator);
  return { short: compactDisplayPath(parentDisplayPath(full, separator, cut)), full };
}

/** The home folder or a filesystem root is its own address. */
function parentDisplayPath(full: string, separator: string, cut: number) {
  if (cut > 0) return full.slice(0, cut);
  if (cut === 0 && full.length > 1) return separator;
  return full;
}

/** A Cloud project's address: the organization that holds it. */
export function cloudProjectAddress(organizationName: string | null | undefined): ProjectPlaceAddress | null {
  const name = organizationName?.trim();
  return name ? { short: name, full: name } : null;
}

export function resolveProjectPlaceMenu({ place, address = null, unhosted, publishPending, notice, missingReplaceable, linkedFolder }: {
  place: "local" | "cloud";
  address?: ProjectPlaceAddress | null;
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
  return { place, address, action: resolveProjectPlaceAction({ place, unhosted, publishPending, notice, missingReplaceable, linkedFolder }) };
}

function resolveProjectPlaceAction({ place, unhosted, publishPending, notice, missingReplaceable, linkedFolder }: {
  place: "local" | "cloud";
  unhosted: boolean;
  publishPending: boolean;
  notice: LocalFolderCloudNotice | null;
  missingReplaceable: boolean;
  linkedFolder?: Readonly<{ path: string; name: string }> | null;
}): ProjectPlaceAction | null {
  if (place === "cloud") return linkedFolder ? { kind: "open-local-folder", ...linkedFolder } : null;
  if (publishPending) return { kind: "put-in-cloud", continuing: true };
  if (unhosted) return { kind: "put-in-cloud", continuing: false };
  if (notice?.kind === "linked" && notice.openable) {
    return { kind: "open-cloud-project", projectId: notice.projectId, projectName: notice.projectName };
  }
  if (notice?.kind === "sign-in") return { kind: "sign-in" };
  if (notice?.kind === "missing" && missingReplaceable) return { kind: "put-in-cloud-again" };
  // Another environment, no access, an ambiguous or unreachable link: the
  // folder's own notice explains it; the menu offers nothing that cannot work.
  return null;
}
