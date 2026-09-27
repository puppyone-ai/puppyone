import { Tooltip } from "@puppyone/shared-ui";
import { Cloud, X } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { GitSyncState } from "../types";
import { SourceControlDots } from "./GitSidebarPrimitives";

export function GitRemotePrompt({
  state,
  disabled,
  cloudBackupLoading,
  cloudBackupError,
  dismissed,
  cloudEnabled,
  onDismiss,
  onStartPuppyoneBackup,
}: {
  state: GitSyncState;
  disabled: boolean;
  cloudBackupLoading: boolean;
  cloudBackupError: string | null;
  dismissed: boolean;
  cloudEnabled: boolean;
  onDismiss: () => void;
  onStartPuppyoneBackup: () => void;
}) {
  const { t } = useLocalization();
  if (!cloudEnabled || !state.setupRequired || (dismissed && !cloudBackupError)) return null;
  const message = cloudBackupError || t("source-control.backup.reminder");
  return (
    <section
      className={`desktop-git-backup-card${cloudBackupError ? " is-error" : ""}`}
      role={cloudBackupError ? "alert" : undefined}
    >
      <div className="desktop-git-backup-copy"><span>{message}</span></div>
      <Tooltip content={t("source-control.action.dismiss")}><button
        className="desktop-git-backup-dismiss"
        type="button"
        aria-label={t("source-control.backup.dismissAriaLabel")}
        disabled={cloudBackupLoading}
        onClick={onDismiss}
                                                            >
        <X size={13} />
      </button></Tooltip>
      <button
        className="desktop-git-backup-action"
        type="button"
        aria-busy={cloudBackupLoading || undefined}
        disabled={disabled || cloudBackupLoading}
        onClick={onStartPuppyoneBackup}
      >
        {cloudBackupLoading ? <SourceControlDots /> : <Cloud size={13} />}
        <span>{t("source-control.backup.getCloud")}</span>
      </button>
    </section>
  );
}
