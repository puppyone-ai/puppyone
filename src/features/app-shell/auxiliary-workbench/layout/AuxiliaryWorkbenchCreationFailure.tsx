import { AlertCircle, RefreshCw, X } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopMenuIconButton } from "../../../../components/DesktopMenu";
import type { AuxiliaryWorkbenchCreationFailure } from "../types";

export function AuxiliaryWorkbenchCreationFailure({
  failure,
  onDismiss,
  onRetry,
}: Readonly<{
  failure: AuxiliaryWorkbenchCreationFailure;
  onDismiss: () => void;
  onRetry?: () => void;
}>) {
  const { t } = useLocalization();
  const messageKey = failure.code ? OPEN_FAILURE_MESSAGE_KEYS[failure.code] : null;
  const message = messageKey
    ? t(messageKey)
    : t("terminal.workbench.itemLoadFailed", { item: failure.label });
  return (
    <div
      className="desktop-terminal-workbench-create-failure"
      role="alert"
      data-native-surface-occluder="true"
      title={failure.detail || undefined}
    >
      <AlertCircle size={14} strokeWidth={1.8} aria-hidden="true" />
      <span>{message}</span>
      {failure.retryable && onRetry && (
        <button type="button" className="desktop-terminal-workbench-create-retry" aria-label={t("common.action.retry")} onClick={onRetry}>
          <RefreshCw size={12} strokeWidth={1.8} aria-hidden="true" /> {t("common.action.retry")}
        </button>
      )}
      <DesktopMenuIconButton
        label={t("terminal.workbench.dismissError")}
        icon={<X size={12} strokeWidth={1.8} aria-hidden="true" />}
        onClick={onDismiss}
      />
    </div>
  );
}

const OPEN_FAILURE_MESSAGE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  SESSION_NOT_FOUND: "agent.history.openError.sessionNotFound",
  SOURCE_CHANGED: "agent.history.openError.sourceChanged",
  HISTORY_READ_FAILED: "agent.history.openError.readFailed",
  AUTH_REQUIRED: "agent.history.openError.authRequired",
  AUTH_EXPIRED: "agent.history.openError.authExpired",
  RUNTIME_UNAVAILABLE: "agent.history.openError.runtimeUnavailable",
  RESUME_UNSUPPORTED: "agent.history.openError.unsupported",
  RESUME_TIMED_OUT: "agent.history.openError.timedOut",
  WORKSPACE_MISMATCH: "agent.history.openError.workspaceMismatch",
  PROTOCOL_ERROR: "agent.history.openError.protocol",
});
