import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type {
  CloudPublishErrorCode,
  CloudPublishProgressStage,
} from "../../../types/electron";
import { formatCloudPublishFailure } from "../cloudPresentation";
import type { CloudWorkspaceSection } from "../types";
import { CloudActivationHero } from "../components/CloudActivationHero";
import { CloudPublishConfirmationDialog } from "./CloudPublishConfirmationDialog";
import { getCloudPublishProgressLabel } from "./CloudPublishProgressIndicator";

export function CloudGitPrerequisite({
  activeSection,
  publishBusy,
  publishEnabled,
  publishError,
  progressStage,
  organizations,
  selectedOrganizationId,
  organizationStatus,
  organizationError,
  onSelectOrganization,
  onRetryOrganizations,
  onPublishWorkspace,
}: {
  activeSection: CloudWorkspaceSection;
  publishBusy: boolean;
  publishEnabled: boolean;
  publishError: { code: CloudPublishErrorCode; retryable: boolean } | null;
  progressStage: CloudPublishProgressStage | null;
  organizations: readonly { id: string; name: string }[];
  selectedOrganizationId: string | null;
  organizationStatus: "signed-out" | "loading" | "selection-required" | "ready" | "none" | "error";
  organizationError: string | null;
  onSelectOrganization?: (organizationId: string) => void;
  onRetryOrganizations?: () => void;
  onPublishWorkspace: (organizationId?: string) => void;
}) {
  const { t } = useLocalization();
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  const showOrganizationSupplemental = [
    "selection-required",
    "none",
    "error",
  ].includes(organizationStatus);
  const supplemental = publishError || showOrganizationSupplemental ? (
    <>
      {publishError && (
        <div className="desktop-cloud-git-prerequisite-error" role="alert">
          {formatCloudPublishFailure(publishError, t)}
        </div>
      )}

      {showOrganizationSupplemental && (
        <div className="desktop-cloud-git-prerequisite-organization">
          {organizationStatus === "none" ? (
            <span>{t("cloud.initialize.noOrganization")}</span>
          ) : organizationStatus === "error" ? (
            <>
              <span>{organizationError ?? t("cloud.message.organization-load-failed")}</span>
              {onRetryOrganizations && (
                <button type="button" onClick={onRetryOrganizations}>
                  {t("cloud.common.retry")}
                </button>
              )}
            </>
          ) : organizations.length > 1 ? (
            <label>
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
          ) : null}
        </div>
      )}
    </>
  ) : undefined;

  return (
    <>
      <div className="desktop-cloud-publish-container">
        <CloudActivationHero
          activeSection={activeSection}
          className="desktop-cloud-git-prerequisite"
          ariaLabel={t("cloud.initialize.publishFolderTitle")}
          titleId="desktop-cloud-git-prerequisite-title"
          supplemental={supplemental}
          action={(
            <button
              className="desktop-cloud-row-action primary desktop-cloud-publish-primary"
              type="button"
              aria-busy={publishBusy || undefined}
              aria-haspopup="dialog"
              disabled={publishBusy || !publishEnabled}
              onClick={() => setConfirmationOpen(true)}
            >
              {publishBusy && <RefreshCw size={14} className="animate-spin" aria-hidden="true" />}
              <span>
                {progressStage
                  ? getCloudPublishProgressLabel(progressStage, t)
                  : t("cloud.initialize.enableGitAndPublish")}
              </span>
            </button>
          )}
        />
      </div>

      {confirmationOpen && (
        <CloudPublishConfirmationDialog
          onCancel={() => setConfirmationOpen(false)}
          onConfirm={() => {
            setConfirmationOpen(false);
            onPublishWorkspace(selectedOrganizationId ?? undefined);
          }}
        />
      )}
    </>
  );
}
