import type { CloudMessageDescriptor } from "../cloudPresentation";
import type { ProjectCloudContext } from "./context/projectCloudContext";

/**
 * What a local folder's Cloud association means for the person. A local
 * folder and its Cloud project are two projects (puppy-issues ADR-001): the
 * association only decides this notice and its action, never whether the
 * local folder can be used.
 */
export type LocalFolderCloudNotice =
  /**
   * `openable` is false for a scoped checkout: it is linked to part of the
   * Cloud project, so opening the whole project would broaden it.
   */
  | { kind: "linked"; projectId: string; projectName: string | null; openable: boolean }
  | { kind: "sign-in" }
  | { kind: "other-environment"; origin: string | null }
  | { kind: "missing" }
  | { kind: "no-access" }
  | { kind: "ambiguous" }
  /** `cause` is the readable reason, when the Cloud gave one. */
  | { kind: "unreachable"; cause: CloudMessageDescriptor | null };

export function resolveLocalFolderCloudNotice(context: ProjectCloudContext): LocalFolderCloudNotice | null {
  switch (context.status) {
    case "local-only":
    case "resolving":
      return null;
    case "resolved":
      return { kind: "linked", projectId: context.projectId, projectName: context.projectName?.trim() || null,
        openable: context.target.kind === "project_root" };
    case "wrong-account":
      return { kind: "sign-in" };
    case "wrong-host":
      return { kind: "other-environment", origin: readOrigin(context.message.values) };
    case "not-found":
      return { kind: "missing" };
    case "not-authorized":
      return { kind: "no-access" };
    case "locator-conflict":
      return { kind: "ambiguous" };
    case "temporarily-unavailable":
    case "unresolvable":
    case "error":
      return { kind: "unreachable", cause: context.message };
  }
}

/**
 * What asking for a local folder's Cloud project does. The folder is never
 * replaced or blocked: a linked folder opens its Cloud project as another
 * project, a folder without one starts putting it in the Cloud, signing in or
 * a link still being checked goes to the Cloud dialog, and anything else is
 * explained by the folder's notice.
 */
export type LocalFolderCloudEntry =
  | { kind: "open"; projectId: string }
  | { kind: "publish" }
  | { kind: "cloud-dialog" }
  | { kind: "explain" };

export function resolveLocalFolderCloudEntry(context: ProjectCloudContext, { signedIn, publishPending }: {
  signedIn: boolean;
  /** A first publish is running or saved; its own surface continues it. */
  publishPending: boolean;
}): LocalFolderCloudEntry {
  if (publishPending || context.status === "local-only") return { kind: "publish" };
  if (context.status === "resolved") return context.target.kind === "project_root"
    ? { kind: "open", projectId: context.projectId } : { kind: "explain" };
  if (context.status === "resolving" || (!signedIn && context.status === "wrong-account")) return { kind: "cloud-dialog" };
  return { kind: "explain" };
}

/** Changes whenever the folder or what its association means changes. */
export function localFolderCloudNoticeKey(rootPath: string | null | undefined, notice: LocalFolderCloudNotice | null): string | null {
  if (!rootPath || !notice) return null;
  return JSON.stringify([rootPath, notice.kind, notice.kind === "linked" ? notice.projectId : null]);
}

function readOrigin(values: Readonly<Record<string, string | number>> | undefined): string | null {
  const origin = values?.origin;
  return typeof origin === "string" && origin.trim() ? origin.trim() : null;
}
