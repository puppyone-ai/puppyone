import { useLocalization } from "@puppyone/localization";
import { getCloudAuthSession, type CloudAuthState } from "../auth";
import { CloudSignedOutRoute } from "../auth/CloudSignedOutRoute";
import { CloudWorkspaceLoadingState } from "../components/shared";
import { formatCloudMessage } from "../cloudPresentation";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import { CloudWorkspaceRecovery } from "./CloudWorkspaceRecovery";
import type { ReactNode } from "react";
import { CloudProjectActivation } from "../components/CloudProjectActivation";
import { ChevronRight } from "lucide-react";

/** Header recovery stays with the current repository, never a project picker. */
export function RepositoryCloudSwitchGate({ context, authState, apiBaseUrl, onRetry, onPublishLocal, publishEntry, missingProjectRecovery, initializationPending = false }: {
  context: ProjectCloudContext;
  authState: CloudAuthState;
  apiBaseUrl: string;
  onRetry: () => void;
  onPublishLocal?: () => void;
  publishEntry?: ReactNode;
  missingProjectRecovery?: ReactNode;
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
  if (context.status === "not-found" && missingProjectRecovery) return missingProjectRecovery;
  if (context.status === "wrong-host") return <CloudProjectActivation
    supplemental={<div className="desktop-cloud-project-connection-error">
      <p role="alert">{t("cloud.recovery.title")}</p>
      <details>
        <summary><ChevronRight size={12} aria-hidden="true" />{t("cloud.activation.project.errorDetails")}</summary>
        <p>{formatCloudMessage(context.message, t)}</p>
      </details>
    </div>}
    action={<button type="button" className="desktop-dialog-button primary"
      onClick={onRetry}>{t("cloud.activation.project.reconnect")}</button>} />;
  return <CloudWorkspaceRecovery title={context.status === "local-only" ? t("cloud.state.localOnly") : undefined}
    message={context.status === "local-only" ? t("cloud.state.localOnlyDescription")
    : formatCloudMessage(context.message, t)} onRetry={onRetry} showLocalState />;
}
