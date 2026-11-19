import { FloatingNotice, FloatingNoticeAction } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type { AuxiliaryWorkbenchCreationFailure } from "../../../../lib/workbench/types";

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
    <FloatingNotice
      tone="danger"
      occludesNativeSurfaces
      actions={failure.retryable && onRetry && (
        <FloatingNoticeAction onClick={onRetry}>{t("common.action.retry")}</FloatingNoticeAction>
      )}
      onDismiss={onDismiss}
      dismissLabel={t("terminal.workbench.dismissError")}
    >
      {message}
    </FloatingNotice>
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
