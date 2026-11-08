import { useLocalization } from "@puppyone/localization";
import type { CloudCopy, DevicesAudience, ProjectAudience } from "../../../components/project-audience";
import type { LocalFolderCloudNotice } from "../../cloud";

/**
 * Who can open the local folder in this window. Its other computers come from the
 * sharing service as they are; a team reaches it only through a copy in the Cloud,
 * which is the folder's linked Cloud project (ADR-001) and sits under the audience
 * of the space that holds it. The link's state becomes what the copy row says.
 */
export function useLocalProjectAudience({
  cloudEnabled,
  devices,
  notice,
  disconnectable,
  unhosted,
  publishPending,
  linkedSpaceKind,
  canCopyToTeam,
  unsent,
  handlers,
}: {
  cloudEnabled: boolean;
  devices?: DevicesAudience;
  /** The folder's link to its copy, when it has one. */
  notice: LocalFolderCloudNotice | null;
  disconnectable: boolean;
  /** No link at all: the folder can be copied. */
  unhosted: boolean;
  /** A copy is being made and can be returned to. */
  publishPending: boolean;
  /** Whose space holds the copy; an unknown space is treated as a team's. */
  linkedSpaceKind?: "personal" | "team";
  /** A team this account can add projects to. */
  canCopyToTeam: boolean;
  /** Commits here that the copy has not had yet. */
  unsent: number;
  handlers: Readonly<{
    onCopyToTeam: () => void;
    onOpenCloudProject: (projectId: string) => void;
    onSignIn: () => void;
    onRetry: () => void;
    onDisconnect: () => void;
    onSend: () => void;
  }>;
}): ProjectAudience | null {
  const { t } = useLocalization();
  const copy = cloudEnabled && notice ? cloudCopy(notice) : null;
  const personal = Boolean(copy && linkedSpaceKind === "personal");
  const copyable = cloudEnabled && (publishPending || (unhosted && canCopyToTeam));
  const team = copyable || (copy && !personal)
    ? { copy: personal ? null : copy, onCopy: copyable ? handlers.onCopyToTeam : undefined } : undefined;
  if (!devices && !team && !personal) return null;
  return { devices, devicesCopy: personal ? copy : null, team };

  function cloudCopy(link: LocalFolderCloudNotice): CloudCopy {
    const disconnect = disconnectable
      ? { onResolve: handlers.onDisconnect, resolveLabel: t("shell.projectAudience.disconnect") } : {};
    switch (link.kind) {
      case "linked":
        return { onOpen: link.openable ? () => handlers.onOpenCloudProject(link.projectId) : undefined,
          unsent, onSend: unsent > 0 ? handlers.onSend : undefined };
      case "sign-in":
        return { problem: t("cloud.placeMenu.link.signIn"), onResolve: handlers.onSignIn, resolveLabel: t("cloud.auth.signIn") };
      case "unreachable":
        return { problem: t("cloud.placeMenu.link.unreachable"), onResolve: handlers.onRetry, resolveLabel: t("common.action.retry") };
      case "other-environment":
        return { problem: link.origin
          ? t("cloud.placeMenu.link.otherEnvironment", { origin: hostOf(link.origin) })
          : t("cloud.placeMenu.link.otherEnvironmentUnknown"), ...disconnect };
      case "missing":
        return { problem: t("cloud.placeMenu.link.missing"), ...disconnect };
      case "no-access":
        return { problem: t("cloud.placeMenu.link.noAccess"), ...disconnect };
      case "ambiguous":
        return { problem: t("cloud.placeMenu.link.ambiguous") };
    }
  }
}

/** `http://localhost:9090` reads as `localhost:9090`. */
function hostOf(origin: string) {
  try { return new URL(origin).host || origin; } catch { return origin; }
}
