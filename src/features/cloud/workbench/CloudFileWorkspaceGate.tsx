import { useLocalization } from "@puppyone/localization";
import { getCloudAuthEmail, getCloudAuthSession } from "../auth";
import { CloudSignedOutRoute } from "../auth/CloudSignedOutRoute";
import { CloudInitializationRoute } from "../initialization/CloudInitializationRoute";
import { CloudWorkspaceLoadingState } from "../components/shared";
import { CloudProjectRecoveryState } from "../states/CloudProjectRecoveryState";
import { formatCloudMessage } from "../cloudPresentation";
import { isCloudContextRecovery } from "../project/context";
import type { CloudServiceMainViewProps } from "../types";

/** Preparation content has no services navigation or authority to select Cloud. */
export function CloudFileWorkspaceGate(props: CloudServiceMainViewProps & { compactSignIn?: boolean }) {
  const { t } = useLocalization();
  const { cloudAuthState, cloudEnvironment, projectContext, workspace, status, loading, error,
    cloudPublishState, cloudPublishStateLoading, onCloudSessionChange, onRefresh } = props;
  const session = getCloudAuthSession(cloudAuthState);
  if (!session) {
    return <CloudSignedOutRoute compact={props.compactSignIn} activeSection="contents" authState={cloudAuthState}
      apiBaseUrl={cloudEnvironment.apiBaseUrl} loadingLabel={t("cloud.loading.session")} />;
  }
  if (projectContext?.status === "local-only" || cloudPublishState || cloudPublishStateLoading) {
    return <CloudInitializationRoute activeSection="initialize" workspace={workspace} status={status}
      session={session} apiBaseUrl={cloudEnvironment.apiBaseUrl} accountEmail={getCloudAuthEmail(cloudAuthState)}
      loading={loading} error={error} cloudActionNotice={null}
      cloudBackupLoading={props.cloudBackupLoading} cloudBackupPending={props.cloudBackupPending}
      cloudPublishError={props.cloudPublishError} cloudPublishNotice={props.cloudPublishNotice}
      cloudPublishProgress={props.cloudPublishProgress} cloudPublishState={cloudPublishState}
      cloudPublishStateLoading={cloudPublishStateLoading} onSessionChange={onCloudSessionChange}
      onAbandonPublish={props.onAbandonPuppyoneBackup} onRefresh={onRefresh}
      onPublishWorkspace={props.onStartPuppyoneBackup} />;
  }
  return <div className="desktop-cloud-main-view" data-cloud-file-provider-state={projectContext?.status ?? "resolving"}>
    <div className="desktop-cloud-page-shell">
      {projectContext && isCloudContextRecovery(projectContext)
        ? <CloudProjectRecoveryState message={formatCloudMessage(projectContext.message, t)}
            remoteLabel={cloudEnvironment.cloudRemote?.info.displayId} loading={loading}
            onRetry={onRefresh} onUseAnotherAccount={() => onCloudSessionChange(null)}
            showUseAnotherAccount={projectContext.status !== "temporarily-unavailable"}
            onOpenGitDetails={props.onOpenGitSettings} />
        : <CloudWorkspaceLoadingState label={t("cloud.loading.matchingProject")} />}
    </div>
  </div>;
}
