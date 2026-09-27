import { Tooltip } from "@puppyone/shared-ui";
import {
  FilePenLine,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
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

export function CloudLocalOnlyWorkspace({
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
}: {
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
}) {
  const { t } = useLocalization();
  const [confirmingCleanup, setConfirmingCleanup] = useState(false);
  const publishBusy = publishLoading
    || publishStateLoading
    || (publishPending && !accountEmail);
  const waitingForSignIn = publishPending && !accountEmail && !publishLoading;
  const publishing = publishLoading;
  const activeProgressStage = publishProgress?.stage ?? (publishing ? "validating" : null);
  const resolvedReadiness = publishReadiness ?? (
    !isGitRepository
      ? "repository-required"
      : !hasHeadCommit
        ? "commit-required"
        : !hasCurrentBranch
          ? "branch-required"
          : "ready"
  );
  const readinessMessage = resolvedReadiness === "repository-required"
    ? t("cloud.initialize.repositoryRequired")
    : resolvedReadiness === "commit-required"
      ? t("cloud.initialize.commitRequired")
      : resolvedReadiness === "branch-required"
        ? t("cloud.initialize.branchRequired")
        : null;
  const readyToPush = readinessMessage === null;
  const organizationReady = organizationStatus === "signed-out" || organizationStatus === "ready";
  const pushAction = publishState ? getCloudPushAction(publishState.availableActions) : null;
  const cleanupAction = publishState?.availableActions.find((action) => (
    ["delete-empty-project", "finish-cleanup"].includes(action)
  )) ?? null;
  const publishEnabled = publishState
    ? Boolean(pushAction)
    : readyToPush && organizationReady;
  const showPublishSummary = Boolean(
    publishState
    || readinessMessage
    || organizationStatus === "selection-required"
    || organizationError,
  );
  const destinationBranchName = PUPPYONE_CLOUD_DEFAULT_BRANCH;
  const visiblePublishError = publishError;
  const cloudStatus = publishState
    ? getCloudInitializationStatusLabel(publishState, t)
    : t(waitingForSignIn
      ? "cloud.initialize.waitingForSignIn"
      : publishing
        ? "cloud.initialize.initializing"
        : "cloud.initialize.notInitialized");

  if (!activeProgressStage && !publishState && !publishStateLoading) {
    return (
      <CloudGitPrerequisite
        activeSection={activeSection}
        publishBusy={publishBusy}
        publishEnabled={organizationReady}
        publishError={visiblePublishError}
        progressStage={activeProgressStage}
        organizations={organizations}
        selectedOrganizationId={selectedOrganizationId}
        organizationStatus={organizationStatus}
        organizationError={organizationError}
        onSelectOrganization={onSelectOrganization}
        onRetryOrganizations={onRetryOrganizations}
        onPublishWorkspace={onPublishWorkspace}
      />
    );
  }

  if (activeProgressStage) {
    return (
      <div className="desktop-cloud-publish-container">
        {waitingForSignIn && (
          <div className="desktop-cloud-main-alert info" role="status">
            {t("cloud.state.publishSignInPending")}
          </div>
        )}
        {visiblePublishError && (
          <div className="desktop-cloud-main-alert" role="alert">
            {formatCloudPublishFailure(visiblePublishError, t)}
          </div>
        )}
        <section
          className="desktop-cloud-publish-running"
          aria-label={t("cloud.initialize.progress.stepsLabel")}
        >
          <CloudPublishProgressIndicator stage={activeProgressStage} t={t} />
        </section>
      </div>
    );
  }

  return (
    <div className="desktop-cloud-publish-container">
      {waitingForSignIn && (
        <div className="desktop-cloud-main-alert info" role="status">
          {t("cloud.state.publishSignInPending")}
        </div>
      )}
      {visiblePublishError && (
        <div className="desktop-cloud-main-alert" role="alert">
          {formatCloudPublishFailure(visiblePublishError, t)}
        </div>
      )}
      <section className="desktop-cloud-publish-card" aria-label={t("cloud.initialize.title")}>
        <div className="desktop-cloud-publish-hero">
          <div
            className="desktop-cloud-publish-symbol local"
            aria-label={t(isGitRepository ? "cloud.initialize.localRepository" : "cloud.initialize.localFolder")}
          >
            <div className="desktop-cloud-publish-symbol-mark">
              <CloudPublishFolderMark className="desktop-cloud-publish-symbol-icon" />
            </div>
            <div className="desktop-cloud-publish-details local">
              <Tooltip content={workspace.path} overflowOnly><p className="desktop-cloud-publish-project" dir="auto">
                {workspace.name}
              </p></Tooltip>
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

          <div className="desktop-cloud-publish-symbol cloud" aria-label="PuppyOne Cloud">
            <div className="desktop-cloud-publish-symbol-mark">
              <CloudPublishCloudMark className="desktop-cloud-publish-symbol-icon" />
            </div>
            <div className="desktop-cloud-publish-details cloud">
              <p className="desktop-cloud-publish-project">
                {t("cloud.initialize.newCloudProject")}
              </p>
              <ul className="desktop-cloud-publish-meta">
                <li>
                  <span className="desktop-cloud-publish-status">{cloudStatus}</span>
                </li>
                <li>
                  <GitBranch size={13} aria-hidden="true" />
                  <bdi>{destinationBranchName}</bdi>
                </li>
              </ul>
              {organizationStatus !== "signed-out" && (
                <div className="desktop-cloud-publish-organization">
                  {organizationStatus === "loading" ? (
                    <span>{t("cloud.common.loading")}</span>
                  ) : organizationStatus === "none" ? (
                    <span className="warning">{t("cloud.initialize.noOrganization")}</span>
                  ) : organizationStatus === "error" ? (
                    <button type="button" className="desktop-cloud-row-action" onClick={onRetryOrganizations}>
                      {t("cloud.common.retry")}
                    </button>
                  ) : organizations.length > 1 ? (
                    <label className="desktop-cloud-organization-selector">
                      <span>{t("cloud.organization.selectLabel")}</span>
                      <select
                        aria-label={t("cloud.organization.selectLabel")}
                        value={selectedOrganizationId ?? ""}
                        onChange={(event) => onSelectOrganization?.(event.target.value)}
                      >
                        <option value="" disabled>{t("cloud.organization.selectPlaceholder")}</option>
                        {organizations.map((organization) => (
                          <option value={organization.id} key={organization.id}>{organization.name}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span>{organizations[0]?.name}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {showPublishSummary && (
          <div className={`desktop-cloud-publish-summary ${readinessMessage ? "blocked" : ""}`} role={readinessMessage ? "alert" : undefined}>
            {publishState ? (
              <>
                <strong>{getCloudInitializationStatusLabel(publishState, t)}</strong>
                <p>{getCloudInitializationDescription(publishState, t)}</p>
                {publishState.hasUncommittedChanges && (
                  <small>{t("cloud.initialize.uncommittedChangesExcluded")}</small>
                )}
              </>
            ) : readinessMessage ? (
              <strong>{readinessMessage}</strong>
            ) : (
              <>
                {organizationStatus === "selection-required" && (
                  <small>{t("cloud.initialize.organizationRequired")}</small>
                )}
                {organizationError && <small className="warning">{organizationError}</small>}
              </>
            )}
          </div>
        )}

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
              {publishing && <RefreshCw size={13} className="spin" aria-hidden="true" />}
              <span>
                {activeProgressStage
                  ? getCloudPublishProgressLabel(activeProgressStage, t)
                  : pushAction
                    ? getCloudInitializationActionLabel(pushAction, t)
                    : t(waitingForSignIn
                      ? "cloud.initialize.waitingForSignIn"
                      : !accountEmail
                        ? "cloud.auth.signInToCloud"
                        : "cloud.initialize.initializeAndPush")}
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
      </section>
    </div>
  );
}
