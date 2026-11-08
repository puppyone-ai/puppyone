import type { LocalFolderCloudNotice } from "../../cloud";
import { compactDisplayPath, getWorkspacePathForDisplay } from "../../../lib/workspaceHomeModel";

/**
 * What the Header's place menu offers beside who can open the project. A local
 * folder and its Cloud copy are two projects (puppy-issues ADR-001); from the
 * copy, the menu opens the folder it was made from. It never moves one project
 * between this computer and the Cloud.
 */
export type ProjectPlaceAction = { kind: "open-local-folder"; path: string; name: string };

/**
 * A local folder's link to its Cloud copy. The link is only the folder's Git
 * connection to that project; the Header's mark says it exists, and who can open
 * the project says what it is and how it ends.
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
  place: "local" | "cloud" | "computer";
  /** A named computer, rather than this computer or a Cloud organization. */
  label?: string;
  /** Access to a folder on another computer belongs in its place menu. */
  detail?: string;
  /** Absent while it is unknown; the Header then names the kind of place instead. */
  address?: ProjectPlaceAddress | null;
  action: ProjectPlaceAction | null;
  /** The open local folder's Cloud link, when it has one. */
  link?: ProjectPlaceCloudLink | null;
}>;

/**
 * What keeps a Cloud link from opening, as a message: said on the copy's line in the
 * menu and in the place button's name, so both read the same. Null when it opens.
 */
export function cloudLinkProblemMessage(notice: LocalFolderCloudNotice): { id: string; values?: Record<string, string> } | null {
  switch (notice.kind) {
    case "linked": return null;
    case "sign-in": return { id: "cloud.placeMenu.link.signIn" };
    case "unreachable": return { id: "cloud.placeMenu.link.unreachable" };
    case "other-environment": return notice.origin
      ? { id: "cloud.placeMenu.link.otherEnvironment", values: { origin: hostOf(notice.origin) } }
      : { id: "cloud.placeMenu.link.otherEnvironmentUnknown" };
    case "missing": return { id: "cloud.placeMenu.link.missing" };
    case "no-access": return { id: "cloud.placeMenu.link.noAccess" };
    case "ambiguous": return { id: "cloud.placeMenu.link.ambiguous" };
  }
}

/** `http://localhost:9090` reads as `localhost:9090`. */
function hostOf(origin: string) {
  try { return new URL(origin).host || origin; } catch { return origin; }
}

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

export function resolveProjectPlaceMenu({ place, address = null, cloudEnabled = true, notice = null, disconnectable = false, linkedFolder }: {
  place: "local" | "cloud";
  address?: ProjectPlaceAddress | null;
  /** Other-computer folders have a place menu even when Cloud is off. */
  cloudEnabled?: boolean;
  /** What the open local folder's Cloud link means, when it has one. */
  notice?: LocalFolderCloudNotice | null;
  /** This app can end the open local folder's Cloud link. */
  disconnectable?: boolean;
  /** For an open Cloud project: the local folder linked to it, if any. */
  linkedFolder?: Readonly<{ path: string; name: string }> | null;
}): ProjectPlaceMenu {
  if (!cloudEnabled) return { place: "local", address, action: null };
  if (place === "cloud") {
    return { place, address, action: linkedFolder ? { kind: "open-local-folder", ...linkedFolder } : null };
  }
  return { place, address, action: null, link: notice ? { notice, disconnectable } : null };
}
