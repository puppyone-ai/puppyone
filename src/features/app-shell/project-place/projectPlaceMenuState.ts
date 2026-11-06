import type { LocalFolderCloudNotice } from "../../cloud";
import { compactDisplayPath, getWorkspacePathForDisplay } from "../../../lib/workspaceHomeModel";

/**
 * What the Header's place menu offers. A local folder and its Cloud project are
 * two projects (puppy-issues ADR-001): the menu states where the open project
 * is, then either starts putting a folder in the Cloud, shows the folder's link
 * to its Cloud project, or opens the other project of a linked pair. It never
 * moves one project between this computer and the Cloud.
 */
export type ProjectPlaceAction =
  /** A folder without a Cloud project; the conversion entry. */
  | { kind: "put-in-cloud"; continuing: boolean }
  | { kind: "open-local-folder"; path: string; name: string };

/**
 * A local folder's link to its Cloud project. The link is only the folder's Git
 * connection to that project, so the Header is where it is seen and where it
 * ends; ending it never touches the Cloud project.
 */
export type ProjectPlaceCloudLink = Readonly<{
  notice: LocalFolderCloudNotice;
  /** This app can end the link by itself: exactly one Cloud connection. */
  disconnectable: boolean;
}>;

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
  /** The open local folder's Cloud link, when it has one. */
  link?: ProjectPlaceCloudLink | null;
}>;

/** The link exists but cannot be used from this app as it is. */
export function cloudLinkHasProblem(link: ProjectPlaceCloudLink | null | undefined): boolean {
  return Boolean(link && link.notice.kind !== "linked" && link.notice.kind !== "sign-in");
}

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

export function resolveProjectPlaceMenu({ place, address = null, cloudEnabled = true, unhosted, publishPending, notice, disconnectable, linkedFolder }: {
  place: "local" | "cloud";
  address?: ProjectPlaceAddress | null;
  /** Other-computer folders have a place menu even when Cloud is off. */
  cloudEnabled?: boolean;
  /** The open local folder has no Cloud association at all. */
  unhosted: boolean;
  /** A first publish is running or saved for the open local folder. */
  publishPending: boolean;
  /** What the open local folder's Cloud link means, when it has one. */
  notice: LocalFolderCloudNotice | null;
  /** This app can end the open local folder's Cloud link. */
  disconnectable: boolean;
  /** For an open Cloud project: the local folder linked to it, if any. */
  linkedFolder?: Readonly<{ path: string; name: string }> | null;
}): ProjectPlaceMenu {
  if (!cloudEnabled) return { place: "local", address, action: null };
  if (place === "cloud") {
    return { place, address, action: linkedFolder ? { kind: "open-local-folder", ...linkedFolder } : null };
  }
  // A running or saved first publish owns the folder's link until it ends.
  if (publishPending) return { place, address, action: { kind: "put-in-cloud", continuing: true } };
  if (unhosted) return { place, address, action: { kind: "put-in-cloud", continuing: false } };
  return { place, address, action: null, link: notice ? { notice, disconnectable } : null };
}
