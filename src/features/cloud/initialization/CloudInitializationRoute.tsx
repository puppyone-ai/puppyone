import { useEffect, useRef, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { CloudProjectPreparationProps, CloudWorkspaceSection } from "../types";
import { useCloudOrganizationData } from "../organization/CloudOrganizationTeamPage";
import { CloudWorkspaceLoadingState } from "../components/shared";
import { formatCloudMessage, type CloudMessageDescriptor } from "../cloudPresentation";
import { getCloudPublishReadiness } from "../workspace/cloudPublishReadiness";
import { CloudLocalOnlyWorkspace } from "./CloudInitializationView";
import { CloudLocalGitStatusError } from "./CloudLocalGitStatusError";

type Props = Pick<CloudProjectPreparationProps, "workspace" | "status" | "loading" | "error"
  | "cloudBackupLoading" | "cloudBackupPending" | "cloudPublishError" | "cloudPublishNotice"
  | "cloudPublishProgress" | "cloudPublishState" | "cloudPublishStateLoading" | "publishOrganizationId"> & {
  activeSection: CloudWorkspaceSection;
  session: DesktopCloudSession;
  apiBaseUrl: string | null;
  accountEmail: string | null;
  cloudActionNotice: CloudMessageDescriptor | null;
  onSessionChange: CloudProjectPreparationProps["onCloudSessionChange"];
  onAbandonPublish: CloudProjectPreparationProps["onAbandonPuppyoneBackup"];
  onRefresh: CloudProjectPreparationProps["onRefresh"];
  onPublishWorkspace: CloudProjectPreparationProps["onStartPuppyoneBackup"];
};

export function CloudInitializationRoute(props: Props) {
  const { t } = useLocalization();
  if (props.error) return <CloudInitializationFrame>
    <CloudLocalGitStatusError error={props.error} loading={props.loading} onRetry={props.onRefresh} />
  </CloudInitializationFrame>;
  if (!props.status) return <CloudInitializationFrame>
    <CloudWorkspaceLoadingState label={t("cloud.initialize.loadingRepository")} />
  </CloudInitializationFrame>;
  return <CloudInitializationFrame>
    {props.cloudActionNotice && <div className="desktop-cloud-main-alert success" role="status">
      {formatCloudMessage(props.cloudActionNotice, t)}
    </div>}
    {props.cloudPublishNotice === "cleanup-completed" && <div className="desktop-cloud-main-alert success" role="status">
      {t("cloud.initialize.cleanupCompleted")}
    </div>}
    {props.cloudPublishState || props.cloudPublishStateLoading
      ? <PublishWorkspace {...props} status={props.status} />
      : <AuthenticatedCloudInitialize {...props} status={props.status} />}
  </CloudInitializationFrame>;
}

function CloudInitializationFrame({ children }: { children: ReactNode }) {
  return <main className="desktop-cloud-main-view desktop-cloud-initialize-main-view" data-po-scrollbar="content">
    <div className="desktop-cloud-page-shell">{children}</div>
  </main>;
}

type ReadyProps = Props & { status: NonNullable<Props["status"]> };
type OrganizationProps = Pick<Parameters<typeof CloudLocalOnlyWorkspace>[0], "organizations" | "selectedOrganizationId"
  | "organizationStatus" | "organizationError" | "onSelectOrganization" | "onRetryOrganizations">;

function PublishWorkspace(props: ReadyProps & OrganizationProps) {
  const { t } = useLocalization();
  return <CloudLocalOnlyWorkspace activeSection="initialize" workspace={props.workspace} accountEmail={props.accountEmail}
    branchName={props.status.branch ?? t("cloud.git.noBranch")} totalCommits={props.status.totalCommits ?? 0}
    localChangeCount={props.status.entries.length} localChangeCountIsMinimum={props.status.didHitStatusLimit}
    publishReadiness={getCloudPublishReadiness(props.status)} isGitRepository={props.status.isRepo === true}
    hasHeadCommit={Boolean(props.status.headCommitId)} hasCurrentBranch={getCloudPublishReadiness(props.status) !== "branch-required"}
    publishLoading={props.cloudBackupLoading} publishPending={props.cloudBackupPending} publishError={props.cloudPublishError}
    publishProgress={props.cloudPublishProgress} publishState={props.cloudPublishState} publishStateLoading={props.cloudPublishStateLoading}
    onAbandonPublish={props.onAbandonPublish} onPublishWorkspace={props.onPublishWorkspace}
    organizations={props.organizations} selectedOrganizationId={props.selectedOrganizationId} organizationStatus={props.organizationStatus}
    organizationError={props.organizationError} onSelectOrganization={props.onSelectOrganization} onRetryOrganizations={props.onRetryOrganizations} />;
}

function AuthenticatedCloudInitialize(props: ReadyProps) {
  const { t } = useLocalization();
  const { cloudBackupPending, cloudBackupLoading, onPublishWorkspace } = props;
  const autoStartedOrganizationRef = useRef<string | null>(null);
  const organizationData = useCloudOrganizationData(props.session, props.apiBaseUrl, props.onSessionChange,
    { loadTeamDetails: false, selectionPolicy: "explicit" });
  useEffect(() => {
    const organizationId = organizationData.selectedOrganizationId;
    if (props.publishOrganizationId || !cloudBackupPending || cloudBackupLoading || organizationData.status !== "ready"
      || organizationData.organizations.length !== 1 || !organizationId
      || autoStartedOrganizationRef.current === organizationId) return;
    autoStartedOrganizationRef.current = organizationId;
    onPublishWorkspace(organizationId);
  }, [cloudBackupLoading, cloudBackupPending, onPublishWorkspace, props.publishOrganizationId,
    organizationData.organizations.length, organizationData.selectedOrganizationId, organizationData.status]);
  const target = props.publishOrganizationId;
  const destination = target ? organizationData.organizations.find((org) => org.id === target && org.can_create_projects === true) : null;
  const loaded = ["ready", "selection-required", "none", "partial"].includes(organizationData.status);
  const resolvedTargetStatus = destination ? "ready" : "error";
  const targetStatus = target && loaded ? resolvedTargetStatus : null;
  const organizationError = organizationData.error ? formatCloudMessage(organizationData.error, t) : null;
  return <PublishWorkspace {...props} organizations={organizationData.organizations}
    selectedOrganizationId={target ? destination?.id ?? null : organizationData.selectedOrganizationId}
    organizationStatus={targetStatus ?? (organizationData.status === "partial" ? "ready" : organizationData.status)}
    organizationError={target && loaded && !destination ? t("onboarding.spaces.unavailable") : organizationError}
    onSelectOrganization={target ? undefined : organizationData.selectOrganization} onRetryOrganizations={organizationData.refresh} />;
}
