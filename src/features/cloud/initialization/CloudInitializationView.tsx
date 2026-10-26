import type { Workspace } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import "./initialization.css";
import type {
  CloudPublishErrorCode,
  CloudPublishProgress,
  CloudPublishState,
} from "../../../types/electron";
import type { CloudPublishReadiness } from "../workspace/cloudPublishReadiness";
import type { CloudWorkspaceSection } from "../types";
import { formatCloudPublishFailure } from "../cloudPresentation";
import { CloudGitPrerequisite } from "./CloudGitPrerequisite";
import { CloudPublishResume } from "./CloudPublishResume";
import { CloudPublishRunning } from "./CloudPublishRunning";

type CloudLocalOnlyWorkspaceProps = {
  activeSection?: CloudWorkspaceSection;
  workspace: Workspace;
  accountEmail: string | null;
  branchName: string;
  totalCommits: number;
  localChangeCount: number;
  localChangeCountIsMinimum?: boolean;
  publishReadiness?: CloudPublishReadiness;
  isGitRepository: boolean;
  hasHeadCommit: boolean;
  hasCurrentBranch: boolean;
  publishLoading: boolean;
  publishPending?: boolean;
  publishError?: { code: CloudPublishErrorCode; retryable: boolean } | null;
  publishProgress?: CloudPublishProgress | null;
  publishState?: CloudPublishState | null;
  publishStateLoading?: boolean;
  organizations?: readonly { id: string; name: string }[];
  selectedOrganizationId?: string | null;
  organizationStatus?: "signed-out" | "loading" | "selection-required" | "ready" | "none" | "error";
  organizationError?: string | null;
  onSelectOrganization?: (organizationId: string) => void;
  onRetryOrganizations?: () => void;
  onAbandonPublish?: () => void;
  onPublishWorkspace: (organizationId?: string) => void;
};

function resolveCloudProps({
  activeSection = "mcp",
  workspace,
  accountEmail,
  branchName,
  totalCommits,
  localChangeCount,
  localChangeCountIsMinimum = false,
  publishReadiness,
  isGitRepository,
  hasHeadCommit,
  hasCurrentBranch,
  publishLoading,
  publishPending = false,
  publishError = null,
  publishProgress = null,
  publishState = null,
  publishStateLoading = false,
  organizations = [],
  selectedOrganizationId = null,
  organizationStatus = "signed-out",
  organizationError = null,
  onSelectOrganization,
  onRetryOrganizations,
  onAbandonPublish,
  onPublishWorkspace,
}: CloudLocalOnlyWorkspaceProps) {
  return {
    activeSection, workspace, accountEmail, branchName, totalCommits, localChangeCount, localChangeCountIsMinimum,
    publishReadiness, isGitRepository, hasHeadCommit, hasCurrentBranch, publishLoading, publishPending,
    publishError, publishProgress, publishState, publishStateLoading, organizations, selectedOrganizationId,
    organizationStatus, organizationError, onSelectOrganization, onRetryOrganizations, onAbandonPublish, onPublishWorkspace,
  };
}

type ResolvedCloudProps = ReturnType<typeof resolveCloudProps>;

/**
 * The first publish has exactly two pictures. Before it starts: the
 * activation banner with what Cloud gives the project. Once it has started:
 * the same banner with its progress — running, or standing still where it
 * stopped, with the action that continues it.
 */
export function CloudLocalOnlyWorkspace(input: CloudLocalOnlyWorkspaceProps) {
  const { t } = useLocalization();
  const props = resolveCloudProps(input);
  const view = deriveCloudPublishView(props);
  if (view.activeProgressStage) {
    return <div className="desktop-cloud-publish-container">
      <CloudPublishRunning projectName={props.workspace.name} stage={view.activeProgressStage}
        transfer={props.publishProgress?.transfer ?? null}
        notice={<CloudPublishAlerts props={props} view={view} />} />
    </div>;
  }
  if (!props.publishState) {
    // While the saved state is still being read, the banner stays with a busy
    // action rather than flashing a recovery page that may not apply.
    return (
      <CloudGitPrerequisite
        activeSection={props.activeSection}
        projectName={props.workspace.name}
        publishBusy={view.publishBusy}
        publishEnabled={view.organizationReady}
        publishError={props.publishError}
        progressStage={null}
        organizations={props.organizations}
        selectedOrganizationId={props.selectedOrganizationId}
        organizationStatus={props.organizationStatus}
        organizationError={props.organizationError}
        onSelectOrganization={props.onSelectOrganization}
        onRetryOrganizations={props.onRetryOrganizations}
        onPublishWorkspace={props.onPublishWorkspace}
      />
    );
  }
  return <div className="desktop-cloud-publish-container">
    <CloudPublishResume
      projectName={props.workspace.name}
      state={props.publishState}
      busy={view.publishBusy}
      error={props.publishError ? formatCloudPublishFailure(props.publishError, t) : null}
      onContinue={() => props.onPublishWorkspace(props.selectedOrganizationId ?? undefined)}
      onAbandon={props.onAbandonPublish}
    />
  </div>;
}

type PublishView = ReturnType<typeof deriveCloudPublishView>;
type PublishSectionProps = { props: ResolvedCloudProps; view: PublishView };

function deriveCloudPublishView(props: ResolvedCloudProps) {
  const {
    publishLoading, publishStateLoading, publishPending, accountEmail, publishProgress, publishState, organizationStatus,
  } = props;
  return {
    publishBusy: publishLoading || publishStateLoading || (publishPending && !accountEmail),
    waitingForSignIn: publishPending && !accountEmail && !publishLoading,
    // Only a send may draw the send. Loading alone stands for a first send
    // only while nothing is saved yet. With a saved, unfinished publish, a
    // retry reports its progress at once, so loading without progress is the
    // Discard deleting the empty cloud project, and drawing the send from
    // step one for it would show an upload that is not happening.
    activeProgressStage: publishProgress?.stage
      ?? (publishLoading && !publishState ? "validating" as const : null),
    organizationReady: organizationStatus === "signed-out" || organizationStatus === "ready",
  };
}

function CloudPublishAlerts({ props, view }: PublishSectionProps) {
  const { t } = useLocalization();
  return <>
    {view.waitingForSignIn && <div className="desktop-cloud-main-alert info" role="status">{t("cloud.state.publishSignInPending")}</div>}
    {props.publishError && <div className="desktop-cloud-main-alert" role="alert">{formatCloudPublishFailure(props.publishError, t)}</div>}
  </>;
}
