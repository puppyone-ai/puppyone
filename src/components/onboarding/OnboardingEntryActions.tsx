import { Button } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { Download, FilePlus2, FolderOpen, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { InlineLoading } from "../loading";
import { ImportSourceMark } from "./ImportSourceMark";
import type { OnboardingHomeState } from "./types";

const IMPORT_PREVIEW_BRANDS = ["github", "notion", "google-drive"] as const;

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
  /** Opens the source picker. */
  onCloneRepository: () => void;
};

/**
 * Homepage entry actions. "Create an empty project" is the default path because it
 * is the only entry that does not require the user to hunt for an existing
 * folder first. Importing existing work sits below the two direct-start
 * actions as a text-like entry, with a compact source preview beside its label.
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
        </div>

        <div className="onboarding-entry-import-area">
          <Button
            className="onboarding-entry-action onboarding-entry-import"
            data-onboarding-action="clone"
            tone="neutral"
            disabled={busy || !canCloneRepository}
            aria-haspopup="dialog"
            leadingIcon={<Download aria-hidden="true" />}
            onClick={onCloneRepository}
          >
            <span className="onboarding-entry-import-label">{t("onboarding.action.importFromApps")}</span>
            <span className="onboarding-entry-import-source-preview">
              <span className="onboarding-entry-import-brands">
                {IMPORT_PREVIEW_BRANDS.map((brand) => <ImportSourceMark key={brand} brand={brand} />)}
              </span>
              <Plus className="onboarding-entry-import-more" aria-hidden="true" />
            </span>
          </Button>
        </div>

      </div>
      {footer}
    </div>
  );
}
