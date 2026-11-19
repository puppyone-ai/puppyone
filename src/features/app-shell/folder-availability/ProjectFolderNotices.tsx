import { FloatingNotice, FloatingNoticeAction } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import type { FolderCandidate, FolderStatus } from "../../../types/electron";
import { canLocate, folderStatusMessage } from "./folderAvailabilityCopy";

/**
 * One line for each of this window's folders that cannot be opened now, with what can
 * be done about it. The rest of the project keeps working. A folder whose disk is away
 * offers nothing to remove: it opens again by itself once the disk is back.
 */
export function ProjectFolderNotices({ statuses, removeLabel, busy, onUseFound, onLocate, onRemove, onRetry }: {
  statuses: readonly FolderStatus[];
  /** "Remove from project" beside other folders; "Remove from list" when it is the only one. */
  removeLabel: "project" | "list";
  busy: boolean;
  onUseFound: (candidate: FolderCandidate) => void;
  onLocate: (folderPath: string) => void;
  onRemove: (folderPath: string) => void;
  onRetry: () => void;
}) {
  const { t } = useLocalization();
  return statuses.map((status) => {
    const action = (label: string, onClick: () => void) => (
      <FloatingNoticeAction onClick={busy ? () => undefined : onClick}>{label}</FloatingNoticeAction>
    );
    let actions;
    if (status.suggestion) {
      const found = status.suggestion;
      actions = <>{action(t("shell.folderStatus.useFound", { name: bidiIsolate(found.name) }), () => onUseFound(found))}
        {action(t("shell.folderStatus.locate"), () => onLocate(status.path))}</>;
    } else if (canLocate(status)) {
      actions = <>{action(t("shell.folderStatus.locate"), () => onLocate(status.path))}
        {action(t(removeLabel === "project" ? "shell.folderStatus.removeFromProject" : "shell.folderStatus.removeFromList"),
          () => onRemove(status.path))}</>;
    } else {
      actions = action(t("common.action.retry"), onRetry);
    }
    return (
      <FloatingNotice key={status.path} tone="warning" role="status" actions={actions}
        className={`desktop-project-folder-notice is-${status.state}`}>
        {folderStatusMessage(t, status)}
      </FloatingNotice>
    );
  });
}
