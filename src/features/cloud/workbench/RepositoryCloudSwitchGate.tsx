import { useLocalization } from "@puppyone/localization";
import { getCloudAuthSession, type CloudAuthState } from "../auth";
import { CloudSignedOutRoute } from "../auth/CloudSignedOutRoute";
import { CloudWorkspaceLoadingState } from "../components/shared";
import { formatCloudMessage } from "../cloudPresentation";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import { CloudWorkspaceRecovery } from "./CloudWorkspaceRecovery";
import type { ReactNode } from "react";
import { CloudProjectActivation } from "../components/CloudProjectActivation";

/** Header recovery stays with the current repository, never a project picker. */
export function RepositoryCloudSwitchGate({ context, authState, apiBaseUrl, onRetry, onPublishLocal, publishEntry, initializationPending = false }: {
  context: ProjectCloudContext;
  authState: CloudAuthState;
  apiBaseUrl: string;
  onRetry: () => void;
  onPublishLocal?: () => void;
  publishEntry?: ReactNode;
  initializationPending?: boolean;
}) {
  const { t } = useLocalization();
  if (!getCloudAuthSession(authState)) return <CloudSignedOutRoute compact activeSection="contents"
    authState={authState} apiBaseUrl={apiBaseUrl} loadingLabel={t("cloud.loading.session")} />;
  if (publishEntry && (context.status === "local-only" || initializationPending)) return publishEntry;
  if (context.status === "resolving" || context.status === "resolved") {
    return <CloudWorkspaceLoadingState label={t("cloud.loading.matchingProject")} />;
  }
  if (context.status === "local-only" && onPublishLocal) return <CloudProjectActivation
    action={<button type="button" className="desktop-dialog-button primary" data-desktop-dialog-initial-focus="true"
      onClick={onPublishLocal}>{t("cloud.activation.project.publish")}</button>} />;
  if (context.status === "wrong-host") return <CloudProjectActivation
    supplemental={<p role="alert">{formatCloudMessage(context.message, t)}</p>}
    action={<button type="button" className="desktop-dialog-button primary"
      onClick={onRetry}>{t("cloud.activation.project.reconnect")}</button>} />;
  return <CloudWorkspaceRecovery title={context.status === "local-only" ? t("cloud.state.localOnly") : undefined}
    message={context.status === "local-only" ? t("cloud.state.localOnlyDescription")
    : formatCloudMessage(context.message, t)} onRetry={onRetry} showLocalState />;
}
