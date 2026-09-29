import type { MessageFormatter } from "@puppyone/localization/core";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";

export type ProjectLocationKind = "local" | "local-cloud" | "resolving" | "attention";

export type ProjectLocationStatus = Readonly<{
  kind: ProjectLocationKind;
}>;

/**
 * The Header answers one question: where does the current project exist?
 * Authentication and Agent access are separate concerns and must not replace
 * the project's location label.
 */
export function resolveProjectLocationStatus(
  context: ProjectCloudContext,
  signedIn: boolean,
): ProjectLocationStatus {
  if (context.status === "local-only") return { kind: "local" };
  if (context.status === "resolving") return { kind: "resolving" };
  if (context.status === "resolved") return { kind: "local-cloud" };

  // A signed-out user can still see that this working copy points at a Cloud
  // project. Signing out only removes management access; it does not move the
  // project or turn its location into an authentication status.
  if (!signedIn) return { kind: "local-cloud" };
  return { kind: "attention" };
}

export function projectLocationBadge(status: ProjectLocationStatus, t: MessageFormatter): string {
  switch (status.kind) {
    case "local":
      return t("cloud.share.location.local");
    case "local-cloud":
      return t("cloud.share.location.localCloud");
    case "resolving":
      return t("cloud.share.location.resolving");
    case "attention":
      return t("cloud.share.location.attention");
  }
}
