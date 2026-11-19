import { CloudIcon } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { DesktopEntryState } from "../../../components/DesktopEntryState";
import { getCloudAuthSession } from "../auth";
import { CloudSignedOutRoute } from "../auth/CloudSignedOutRoute";
import type { CloudProjectPreparationProps } from "../types";
import { CloudFileWorkspaceGate } from "../workbench/CloudFileWorkspaceGate";
import { CloudProjectActivationScope } from "../components/CloudProjectActivation";

type Props = CloudProjectPreparationProps & { onOpenCloudProject: (projectId: string) => void };

/** Publishing never switches the local folder into its separate Cloud project. */
export function CloudPublishTask(props: Props) {
  const session = getCloudAuthSession(props.cloudAuthState);
  const identity = JSON.stringify([props.workspace.path, props.cloudEnvironment.apiBaseUrl,
    session?.user_id, session?.session_generation]);
  return <CloudProjectActivationScope projectName={props.workspace.name}>
    <ScopedCloudPublishTask key={identity} {...props} />
  </CloudProjectActivationScope>;
}

function ScopedCloudPublishTask(props: Props) {
  const { t } = useLocalization();
  const session = getCloudAuthSession(props.cloudAuthState);
  if (!session) return <CloudSignedOutRoute activeSection="initialize" authState={props.cloudAuthState}
    apiBaseUrl={props.cloudEnvironment.apiBaseUrl} loadingLabel={t("cloud.loading.session")} />;
  const context = props.projectContext;
  // An authorized remote can exist before the upload has finished. Recovery and
  // in-flight work always take precedence over the successful-project view.
  if (context?.status !== "resolved" || props.cloudBackupLoading || props.cloudPublishState
    || props.cloudPublishStateLoading || props.cloudPublishProgress || props.cloudPublishError) return <CloudFileWorkspaceGate {...props} />;
  const title = t("cloud.initialize.progress.completed");
  return <DesktopEntryState ariaLabel={title} title={title} visual={<CloudIcon size={48} />}
    description={context.projectName ? t("cloud.localFolderNotice.linked", { name: context.projectName })
      : t("cloud.localFolderNotice.linkedUnnamed")}
    action={context.target.kind === "project_root" && <button type="button" className="desktop-cloud-primary-button"
      onClick={() => props.onOpenCloudProject(context.projectId)}>{t("cloud.localFolderNotice.openProject")}</button>} />;
}
