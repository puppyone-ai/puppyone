import {
  FilePenLine,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import type { MessageFormatter } from "@puppyone/localization/core";
import type { Workspace } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import "./initialization.css";
import type {
  CloudPublishErrorCode,
  CloudPublishProgress,
  CloudPublishState,
} from "../../../types/electron";
import {
  CloudPublishCloudMark,
  CloudPublishFolderMark,
} from "../components/CloudPublishHeroMarks";
import type { CloudPublishReadiness } from "../workspace/cloudPublishReadiness";
import type { CloudWorkspaceSection } from "../types";
import { formatCloudPublishFailure } from "../cloudPresentation";
import { CloudGitPrerequisite } from "./CloudGitPrerequisite";
import {
  CloudPublishProgressIndicator,
  getCloudPublishProgressLabel,
} from "./CloudPublishProgressIndicator";
import {
  getCloudInitializationActionLabel,
  getCloudInitializationDescription,
  getCloudInitializationStatusLabel,
  getCloudPushAction,
} from "./cloudInitializationModel";

const PUPPYONE_CLOUD_DEFAULT_BRANCH = "main";

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

export function CloudLocalOnlyWorkspace(input: CloudLocalOnlyWorkspaceProps) {
  const { t } = useLocalization();
  const [confirmingCleanup, setConfirmingCleanup] = useState(false);
  const props = resolveCloudProps(input);
  const view = deriveCloudPublishView(props, t);
  if (!view.activeProgressStage && !props.publishState && !props.publishStateLoading) {
    return (
      <CloudGitPrerequisite
        activeSection={props.activeSection}
        publishBusy={view.publishBusy}
        publishEnabled={view.organizationReady}
        publishError={props.publishError}
        progressStage={view.activeProgressStage}
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
  if (view.activeProgressStage) {
    return <div className="desktop-cloud-publish-container">
      <CloudPublishAlerts props={props} view={view} />
      <section className="desktop-cloud-publish-running" aria-label={t("cloud.initialize.progress.stepsLabel")}>
        <CloudPublishProgressIndicator stage={view.activeProgressStage} t={t} />
      </section>
    </div>;
  }
  return <div className="desktop-cloud-publish-container">
    <CloudPublishAlerts props={props} view={view} />
    <section className="desktop-cloud-publish-card" aria-label={t("cloud.initialize.title")}>
      <CloudPublishHero props={props} view={view} />
      <CloudPublishSummary props={props} view={view} />
      <CloudPublishActions props={props} view={view} confirmingCleanup={confirmingCleanup} onConfirmingCleanupChange={setConfirmingCleanup} />
    </section>
  </div>;
}

type PublishView = ReturnType<typeof deriveCloudPublishView>;
type PublishSectionProps = { props: ResolvedCloudProps; view: PublishView };

function deriveCloudPublishView(props: ResolvedCloudProps, t: MessageFormatter) {
  const { publishLoading, publishStateLoading, publishPending, accountEmail, publishProgress, organizationStatus, publishState, organizationError } = props;
  const publishBusy = publishLoading || publishStateLoading || (publishPending && !accountEmail);
  const waitingForSignIn = publishPending && !accountEmail && !publishLoading;
  const activeProgressStage = publishProgress?.stage ?? (publishLoading ? "validating" : null);
  const readinessMessage = cloudReadinessMessage(props, t);
  const organizationReady = organizationStatus === "signed-out" || organizationStatus === "ready";
  const pushAction = publishState ? getCloudPushAction(publishState.availableActions) : null;
  const cleanupAction = publishState?.availableActions.find(action => ["delete-empty-project", "finish-cleanup"].includes(action)) ?? null;
  return {
    publishBusy, waitingForSignIn, activeProgressStage, readinessMessage, organizationReady, cleanupAction,
    publishEnabled: publishState ? Boolean(pushAction) : readinessMessage === null && organizationReady,
    showPublishSummary: Boolean(publishState || readinessMessage || organizationStatus === "selection-required" || organizationError),
    cloudStatus: cloudStatusLabel(props, waitingForSignIn, t),
    actionLabel: cloudActionLabel(props, { activeProgressStage, pushAction, waitingForSignIn }, t),
  };
}
function cloudReadinessMessage(props: ResolvedCloudProps, t: MessageFormatter) {
  let readiness = props.publishReadiness;
  if (readiness == null) {
    if (!props.isGitRepository) readiness = "repository-required";
    else if (!props.hasHeadCommit) readiness = "commit-required";
    else if (!props.hasCurrentBranch) readiness = "branch-required";
    else readiness = "ready";
  }
  if (readiness === "repository-required") return t("cloud.initialize.repositoryRequired");
  if (readiness === "commit-required") return t("cloud.initialize.commitRequired");
  if (readiness === "branch-required") return t("cloud.initialize.branchRequired");
  return null;
}
function cloudStatusLabel(props: ResolvedCloudProps, waitingForSignIn: boolean, t: MessageFormatter) {
  if (props.publishState) return getCloudInitializationStatusLabel(props.publishState, t);
  if (waitingForSignIn) return t("cloud.initialize.waitingForSignIn");
  if (props.publishLoading) return t("cloud.initialize.initializing");
  return t("cloud.initialize.notInitialized");
}
function cloudActionLabel(props: ResolvedCloudProps, view: {
  activeProgressStage: CloudPublishProgress["stage"] | null;
  pushAction: ReturnType<typeof getCloudPushAction>;
  waitingForSignIn: boolean;
}, t: MessageFormatter) {
  if (view.activeProgressStage) return getCloudPublishProgressLabel(view.activeProgressStage, t);
  if (view.pushAction) return getCloudInitializationActionLabel(view.pushAction, t);
  if (view.waitingForSignIn) return t("cloud.initialize.waitingForSignIn");
  if (!props.accountEmail) return t("cloud.auth.signInToCloud");
  return t("cloud.initialize.initializeAndPush");
}
function CloudPublishAlerts({ props, view }: PublishSectionProps) {
  const { t } = useLocalization();
  return <>
    {view.waitingForSignIn && <div className="desktop-cloud-main-alert info" role="status">{t("cloud.state.publishSignInPending")}</div>}
    {props.publishError && <div className="desktop-cloud-main-alert" role="alert">{formatCloudPublishFailure(props.publishError, t)}</div>}
  </>;
}
function CloudPublishHero({ props, view }: PublishSectionProps) {
  const { t } = useLocalization();
  const { isGitRepository, workspace, branchName, totalCommits, localChangeCount, localChangeCountIsMinimum } = props;
  return (
    <div className="desktop-cloud-publish-hero">
      <div
        className="desktop-cloud-publish-symbol local"
        aria-label={t(isGitRepository ? "cloud.initialize.localRepository" : "cloud.initialize.localFolder")}
      >
        <div className="desktop-cloud-publish-symbol-mark">
          <CloudPublishFolderMark className="desktop-cloud-publish-symbol-icon" />
        </div>
        <div className="desktop-cloud-publish-details local">
          <p className="desktop-cloud-publish-project" dir="auto">
            {workspace.name}
          </p>
          <ul className="desktop-cloud-publish-meta">
            <li>
              <GitBranch size={13} aria-hidden="true" />
              <bdi>{branchName}</bdi>
            </li>
            <li>
              <GitCommitHorizontal size={13} aria-hidden="true" />
              <span>{t("cloud.branches.commitCount", { count: totalCommits })}</span>
            </li>
            <li className={localChangeCount > 0 ? "warning" : undefined}>
              <FilePenLine size={13} aria-hidden="true" />
              <span>
                {t(
                  localChangeCountIsMinimum
                    ? "cloud.initialize.localChangeCountAtLeast"
                    : "cloud.initialize.localChangeCount",
                  { count: localChangeCount },
                )}
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div className="desktop-cloud-publish-arrow" aria-label={t("cloud.initialize.push")}>
        <svg
          className="desktop-cloud-publish-arrow-horizontal"
          viewBox="0 0 240 24"
          preserveAspectRatio="none"
          focusable="false"
          aria-hidden="true"
        >
          <path
            d="M1 12 H228 M216 4 L228 12 L216 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <svg
          className="desktop-cloud-publish-arrow-vertical"
          viewBox="0 0 24 96"
          preserveAspectRatio="none"
          focusable="false"
          aria-hidden="true"
        >
          <path
            d="M12 1 V84 M4 72 L12 84 L20 72"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="desktop-cloud-publish-symbol cloud" aria-label="Puppyone Cloud">
        <div className="desktop-cloud-publish-symbol-mark">
          <CloudPublishCloudMark className="desktop-cloud-publish-symbol-icon" />
        </div>
        <div className="desktop-cloud-publish-details cloud">
          <p className="desktop-cloud-publish-project">
            {t("cloud.initialize.newCloudProject")}
          </p>
          <ul className="desktop-cloud-publish-meta">
            <li>
              <span className="desktop-cloud-publish-status">{view.cloudStatus}</span>
            </li>
            <li>
              <GitBranch size={13} aria-hidden="true" />
              <bdi>{PUPPYONE_CLOUD_DEFAULT_BRANCH}</bdi>
            </li>
          </ul>
          <CloudPublishOrganization props={props} />
        </div>
      </div>
    </div>
  );
}
function CloudPublishOrganization({ props }: { props: ResolvedCloudProps }) {
  const { t } = useLocalization();
  if (props.organizationStatus === "signed-out") return null;
  return <div className="desktop-cloud-publish-organization"><CloudPublishOrganizationContent props={props} t={t} /></div>;
}
function CloudPublishOrganizationContent({ props, t }: { props: ResolvedCloudProps; t: MessageFormatter }) {
  const { organizationStatus, organizations, selectedOrganizationId, onRetryOrganizations, onSelectOrganization } = props;
  if (organizationStatus === "loading") return <span>{t("cloud.common.loading")}</span>;
  if (organizationStatus === "none") return <span className="warning">{t("cloud.initialize.noOrganization")}</span>;
  if (organizationStatus === "error") return <button type="button" className="desktop-cloud-row-action" onClick={onRetryOrganizations}>{t("cloud.common.retry")}</button>;
  if (organizations.length > 1) return <label className="desktop-cloud-organization-selector">
    <span>{t("cloud.organization.selectLabel")}</span>
    <select aria-label={t("cloud.organization.selectLabel")} value={selectedOrganizationId ?? ""} onChange={event => onSelectOrganization?.(event.target.value)}>
      <option value="" disabled>{t("cloud.organization.selectPlaceholder")}</option>
      {organizations.map(organization => <option value={organization.id} key={organization.id}>{organization.name}</option>)}
    </select>
  </label>;
  return <span>{organizations[0]?.name}</span>;
}
function CloudPublishSummary({ props, view }: PublishSectionProps) {
  if (!view.showPublishSummary) return null;
  return <div className={`desktop-cloud-publish-summary ${view.readinessMessage ? "blocked" : ""}`} role={view.readinessMessage ? "alert" : undefined}>
    <CloudPublishSummaryContent props={props} view={view} />
  </div>;
}
function CloudPublishSummaryContent({ props, view }: PublishSectionProps) {
  const { t } = useLocalization();
  const { publishState, organizationStatus, organizationError } = props;
  if (publishState) return <>
    <strong>{getCloudInitializationStatusLabel(publishState, t)}</strong>
    <p>{getCloudInitializationDescription(publishState, t)}</p>
    {publishState.hasUncommittedChanges && <small>{t("cloud.initialize.uncommittedChangesExcluded")}</small>}
  </>;
  if (view.readinessMessage) return <strong>{view.readinessMessage}</strong>;
  return <>
    {organizationStatus === "selection-required" && <small>{t("cloud.initialize.organizationRequired")}</small>}
    {organizationError && <small className="warning">{organizationError}</small>}
  </>;
}
function CloudPublishActions({ props, view, confirmingCleanup, onConfirmingCleanupChange: setConfirmingCleanup }: PublishSectionProps & {
  confirmingCleanup: boolean; onConfirmingCleanupChange: (value: boolean) => void;
}) {
  const { t } = useLocalization();
  const { onAbandonPublish, onPublishWorkspace, selectedOrganizationId, publishState, publishLoading: publishing } = props;
  const { cleanupAction, publishBusy, publishEnabled } = view;
  return <>
        <div className="desktop-cloud-publish-actions">
          {cleanupAction === "finish-cleanup" && onAbandonPublish ? (
            <button
              className="desktop-cloud-row-action primary desktop-cloud-publish-primary"
              type="button"
              disabled={publishBusy}
              onClick={onAbandonPublish}
            >
              {t("cloud.initialize.finishCleanup")}
            </button>
          ) : (
            <button
              className="desktop-cloud-row-action primary desktop-cloud-publish-primary"
              type="button"
              aria-busy={publishBusy || undefined}
              disabled={publishBusy || !publishEnabled}
              onClick={() => onPublishWorkspace(selectedOrganizationId ?? undefined)}
            >
              {publishing && <RefreshCw size={13} className="animate-spin" aria-hidden="true" />}
              <span>
                {view.actionLabel}
              </span>
            </button>
          )}
          {cleanupAction === "delete-empty-project" && onAbandonPublish && !confirmingCleanup && (
            <button
              className="desktop-cloud-row-action desktop-cloud-publish-abandon"
              type="button"
              disabled={publishBusy}
              onClick={() => setConfirmingCleanup(true)}
            >
              {t("cloud.initialize.deleteEmptyProject")}
            </button>
          )}
        </div>
        {confirmingCleanup && cleanupAction === "delete-empty-project" && onAbandonPublish && (
          <div className="desktop-cloud-publish-summary blocked" role="alertdialog" aria-label={t("cloud.initialize.deleteEmptyProject")}>
            <strong>{t("cloud.initialize.deleteEmptyProjectConfirmTitle")}</strong>
            <p>{t("cloud.initialize.deleteEmptyProjectConfirmDescription", { project: publishState?.projectName ?? "" })}</p>
            <div className="desktop-cloud-publish-actions">
              <button type="button" className="desktop-cloud-row-action" onClick={() => setConfirmingCleanup(false)}>
                {t("cloud.common.cancel")}
              </button>
              <button
                type="button"
                className="desktop-cloud-row-action primary"
                disabled={publishBusy}
                onClick={() => {
                  setConfirmingCleanup(false);
                  onAbandonPublish();
                }}
              >
                {t("cloud.initialize.confirmDeleteEmptyProject")}
              </button>
            </div>
          </div>
        )}
  </>;
}
