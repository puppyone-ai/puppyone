import { useLocalization } from "@puppyone/localization";
import { getCloudAuthSession, type CloudAuthState } from "../auth";
import { CloudSignedOutRoute } from "../auth/CloudSignedOutRoute";
import { CloudWorkspaceLoadingState } from "../components/shared";
import { formatCloudMessage } from "../cloudPresentation";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import { CloudWorkspaceRecovery } from "./CloudWorkspaceRecovery";

/** Header recovery stays with the current repository, never a project picker. */
export function RepositoryCloudSwitchGate({ context, authState, apiBaseUrl, onRetry, onPublishLocal }: {
  context: ProjectCloudContext;
  authState: CloudAuthState;
  apiBaseUrl: string;
  onRetry: () => void;
  onPublishLocal?: () => void;
}) {
  const { t } = useLocalization();
  if (!getCloudAuthSession(authState)) return <CloudSignedOutRoute compact activeSection="contents"
    authState={authState} apiBaseUrl={apiBaseUrl} loadingLabel={t("cloud.loading.session")} />;
  if (context.status === "resolving" || context.status === "resolved") {
    return <CloudWorkspaceLoadingState label={t("cloud.loading.matchingProject")} />;
  }
  return <CloudWorkspaceRecovery title={context.status === "local-only" ? t("cloud.state.localOnly") : undefined}
    message={context.status === "local-only" ? t("cloud.state.localOnlyDescription")
    : formatCloudMessage(context.message, t)} onRetry={onRetry} showLocalState
    actions={context.status === "local-only" && onPublishLocal && <button type="button" className="desktop-dialog-button"
      onClick={onPublishLocal}>{t("cloud.catalog.publishLocal")}</button>} />;
}
