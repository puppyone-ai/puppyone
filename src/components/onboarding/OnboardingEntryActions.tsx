import { Button } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { Download, FilePlus2, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import { InlineLoading } from "../loading";
import type { OnboardingHomeState } from "./types";

type OnboardingEntryActionsProps = {
  state: OnboardingHomeState;
  busy: boolean;
  openingFolder: boolean;
  draggingFolder: boolean;
  canCreateProject: boolean;
  canCloneRepository: boolean;
  footer?: ReactNode;
  onOpenFolder: () => void;
  onCreateProject: () => void;
  onCloneRepository: () => void;
};

/**
 * Homepage entry actions. "Create a new project" is the default path because it
 * is the only entry that does not require the user to hunt for an existing
 * folder first. Opening a folder and importing a repository are secondary.
 */
export function OnboardingEntryActions({
  state,
  busy,
  openingFolder,
  draggingFolder,
  canCreateProject,
  canCloneRepository,
  footer,
  onOpenFolder,
  onCreateProject,
  onCloneRepository,
}: OnboardingEntryActionsProps) {
  const { t } = useLocalization();
  const firstRun = state === "empty";

  return (
    <div className="onboarding-primary-area">
      <div className="onboarding-entry-actions" role="group" aria-label={t("onboarding.projects.title")}>
        <div className="onboarding-entry-action-primary">
          <Button
            className={`onboarding-entry-action ${firstRun ? "onboarding-entry-action-default" : ""}`}
            data-onboarding-action="create"
            tone="neutral"
            disabled={busy || !canCreateProject}
            leadingIcon={<FilePlus2 className="onboarding-entry-create-icon" aria-hidden="true" />}
            onClick={onCreateProject}
          >
            {t("onboarding.action.createLocalProject")}
          </Button>
        </div>

        <div className="onboarding-entry-action-secondary">
          <Button
            className={`onboarding-entry-action ${draggingFolder ? "is-dragging" : ""}`}
            data-onboarding-action="open"
            tone="neutral"
            disabled={busy}
            aria-busy={openingFolder || undefined}
            leadingIcon={openingFolder
              ? <InlineLoading label={null} size="sm" tone="neutral" />
              : <FolderOpen aria-hidden="true" />}
            onClick={onOpenFolder}
          >
            {t("onboarding.action.openFolder")}
          </Button>

          <Button
            className="onboarding-entry-action"
            data-onboarding-action="clone"
            tone="neutral"
            disabled={busy || !canCloneRepository}
            leadingIcon={<Download aria-hidden="true" />}
            onClick={onCloneRepository}
          >
            {t("onboarding.action.cloneRepository")}
          </Button>
        </div>

      </div>
      {footer}
    </div>
  );
}
