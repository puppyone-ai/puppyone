import { AlertTriangle, Check, GitBranch, RefreshCw, UserRound } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import { CloudMainSection } from "../components/shared";

export function CloudProjectRecoveryState({
  title,
  message,
  remoteLabel = null,
  loading = false,
  onRetry,
  onUseAnotherAccount,
  showUseAnotherAccount = true,
  onOpenGitDetails,
  confirmLabel,
  onConfirm,
}: {
  title?: string;
  message: string;
  remoteLabel?: string | null;
  loading?: boolean;
  onRetry: () => void;
  onUseAnotherAccount: () => void;
  showUseAnotherAccount?: boolean;
  onOpenGitDetails: () => void;
  confirmLabel?: string;
  onConfirm?: () => void;
}) {
  const { t } = useLocalization();
  const resolvedTitle = title ?? t("cloud.recovery.title");
  return (
    <CloudMainSection
      title={resolvedTitle}
      count={t(loading ? "cloud.common.retrying" : "cloud.recovery.actionNeeded")}
      action={(
        <>
          {onConfirm && (
            <button className="desktop-cloud-row-action primary" type="button" disabled={loading} onClick={onConfirm}>
              <Check size={13} />
              <span>{confirmLabel ?? t("cloud.common.confirm")}</span>
            </button>
          )}
          <button className="desktop-cloud-row-action" type="button" disabled={loading} onClick={onRetry}>
            <RefreshCw size={13} className={loading ? "animate-spin" : undefined} />
            <span>{t("cloud.common.retry")}</span>
          </button>
          {showUseAnotherAccount && (
            <button className="desktop-cloud-row-action" type="button" onClick={onUseAnotherAccount}>
              <UserRound size={13} />
              <span>{t("cloud.recovery.useAnotherAccount")}</span>
            </button>
          )}
          <button className="desktop-cloud-row-action" type="button" onClick={onOpenGitDetails}>
            <GitBranch size={13} />
            <span>{t("cloud.auth.gitSyncDetails")}</span>
          </button>
        </>
      )}
    >
      <div className="desktop-cloud-empty-state">
        <span><AlertTriangle size={22} /></span>
        <div>
          <strong>{resolvedTitle}</strong>
          <p>
            {message}
            {remoteLabel ? ` ${t("cloud.recovery.remote", { remote: remoteLabel })}` : ""}
            {" "}
            {t("cloud.recovery.localStatePreserved")}
          </p>
        </div>
      </div>
    </CloudMainSection>
  );
}
