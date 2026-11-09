import { useLocalization } from "@puppyone/localization";
import type { CloudCopy, DevicesAudience, ProjectAudience } from "../../../components/project-audience";
import type { LocalFolderCloudNotice } from "../../cloud";
import { cloudLinkProblemMessage } from "./projectPlaceMenuState";

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
  const copyable = cloudEnabled && (publishPending || (unhosted && canCopyToTeam));
  const team = copyable || copy
    ? { copy, onCopy: copyable ? handlers.onCopyToTeam : undefined } : undefined;
  if (!devices && !team) return null;
  return { devices, devicesCopy: null, team };

  function cloudCopy(link: LocalFolderCloudNotice): CloudCopy {
    const disconnect = disconnectable
      ? { onResolve: handlers.onDisconnect, resolveLabel: t("shell.projectAudience.disconnect") } : {};
    if (link.kind === "linked") {
      return { onOpen: link.openable ? () => handlers.onOpenCloudProject(link.projectId) : undefined,
        unsent, onSend: unsent > 0 ? handlers.onSend : undefined };
    }
    const message = cloudLinkProblemMessage(link)!;
    const problem = t(message.id, message.values);
    if (link.kind === "sign-in") return { problem, onResolve: handlers.onSignIn, resolveLabel: t("cloud.auth.signIn") };
    if (link.kind === "unreachable") return { problem, onResolve: handlers.onRetry, resolveLabel: t("common.action.retry") };
    // Nothing here can mend an ambiguous link; the others can at least be let go of.
    return link.kind === "ambiguous" ? { problem } : { problem, ...disconnect };
  }
}

