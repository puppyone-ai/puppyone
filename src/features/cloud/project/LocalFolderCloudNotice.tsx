import { FloatingNotice, FloatingNoticeAction } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { formatCloudMessage } from "../cloudPresentation";
import type { LocalFolderCloudNotice as LocalFolderCloudNoticeState } from "./localFolderCloudNoticeState";

/**
 * The local folder stays fully usable; this notice only says what its Cloud
 * project means and offers the one action that can help.
 */
export function LocalFolderCloudNotice({ notice, onOpenCloudProject, onSignIn, onPutInCloud, onRetry, onDismiss }: {
  notice: LocalFolderCloudNoticeState;
  onOpenCloudProject: (projectId: string) => void;
  onSignIn: () => void;
  /** Offered only when this app can retire the missing project's old link. */
  onPutInCloud?: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLocalization();
  const action = (label: string, onClick: () => void) => (
    <FloatingNoticeAction onClick={onClick}>{label}</FloatingNoticeAction>
  );
  let message: string;
  let actions = null;
  let tone: "info" | "warning" = "info";
  switch (notice.kind) {
    case "linked":
      message = notice.projectName
        ? t("cloud.localFolderNotice.linked", { name: notice.projectName })
        : t("cloud.localFolderNotice.linkedUnnamed");
      if (notice.openable) actions = action(t("cloud.localFolderNotice.openProject"), () => onOpenCloudProject(notice.projectId));
      break;
    case "sign-in":
      message = t("cloud.localFolderNotice.signIn");
      actions = action(t("cloud.auth.signIn"), onSignIn);
      break;
    case "other-environment":
      message = notice.origin
        ? t("cloud.localFolderNotice.otherEnvironment", { origin: notice.origin })
        : t("cloud.localFolderNotice.otherEnvironmentUnknown");
      break;
    case "missing":
      tone = "warning";
      message = t(onPutInCloud ? "cloud.localFolderNotice.missing" : "cloud.localFolderNotice.missingNoAction");
      if (onPutInCloud) actions = action(t("cloud.localFolderNotice.putInCloud"), onPutInCloud);
      break;
    case "no-access":
      tone = "warning";
      message = t("cloud.localFolderNotice.noAccess");
      break;
    case "ambiguous":
      tone = "warning";
      message = t("cloud.localFolderNotice.ambiguous");
      break;
    case "unreachable":
      tone = "warning";
      // The readable cause only; technical detail stays out of the notice.
      message = notice.cause
        ? `${t("cloud.localFolderNotice.unreachable")} ${formatCloudMessage({ ...notice.cause, detail: undefined }, t)}`
        : t("cloud.localFolderNotice.unreachable");
      actions = action(t("common.action.retry"), onRetry);
      break;
  }
  return (
    <FloatingNotice tone={tone} role="status" actions={actions} onDismiss={onDismiss}
      className={`desktop-local-folder-cloud-notice is-${notice.kind}`}>
      {message}
    </FloatingNotice>
  );
}
