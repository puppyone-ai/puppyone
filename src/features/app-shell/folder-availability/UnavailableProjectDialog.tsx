import { bidiIsolate, useLocalization } from "@puppyone/localization";
import type { FolderCandidate, FolderStatus } from "../../../types/electron";
import { canLocate, folderNameOf, folderStatusMessage } from "./folderAvailabilityCopy";
import { FolderDialog } from "./useFolderRelocation";

/**
 * Opening a Homepage project whose folder cannot be opened now. What happened is said
 * first; the main button is the one most likely to help: the folder found renamed in
 * place, else finding it, else (its disk away or not permitted) only closing.
 */
export function UnavailableProjectDialog({ status, busy, error, onUseFound, onLocate, onRemove, onClose }: {
  status: FolderStatus;
  busy: boolean;
  error: string | null;
  onUseFound: (candidate: FolderCandidate) => void;
  onLocate: (folderPath: string) => void;
  onRemove: (folderPath: string) => void;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const name = folderNameOf(status.path);
  const found = status.suggestion;
  let primary = { label: t("common.action.close"), onClick: onClose };
  let secondary = { label: t("shell.folderStatus.removeFromList"), onClick: () => onRemove(status.path) };
  if (found) {
    primary = { label: t("shell.folderStatus.useFound", { name: bidiIsolate(found.name) }), onClick: () => onUseFound(found) };
    secondary = { label: t("shell.folderStatus.locate"), onClick: () => onLocate(status.path) };
  } else if (canLocate(status)) {
    primary = { label: t("shell.folderStatus.locate"), onClick: () => onLocate(status.path) };
  }
  const title = status.state === "disconnected" || status.state === "denied"
    ? "shell.folderStatus.cantOpenTitle" : "shell.folderStatus.cantFindTitle";
  return (
    <FolderDialog title={t(title, { name: bidiIsolate(name) })} body={folderStatusMessage(t, status, name)}
      error={error} busy={busy} onClose={onClose} secondary={secondary} primary={primary} />
  );
}
