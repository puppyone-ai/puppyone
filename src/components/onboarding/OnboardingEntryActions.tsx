import { Button } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { FilePlus2, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import { InlineLoading } from "../loading";
import {
  IMPORT_PREVIEW_BRANDS,
  ImportSourceMark,
} from "./ImportSourceMark";
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
  /** Opens the source picker; the marks are only a preview. */
  onCloneRepository: () => void;
};

/**
 * Homepage entry actions. "Create an empty project" is the default path because it
 * is the only entry that does not require the user to hunt for an existing
 * folder first. Opening a folder and importing are secondary; import shows
 * a few sources as one quiet, decorative stack within a single entry point.
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
            className="onboarding-entry-action onboarding-entry-import"
            data-onboarding-action="clone"
            tone="neutral"
            disabled={busy || !canCloneRepository}
            aria-label={t("onboarding.entry.import.title")}
            aria-haspopup="dialog"
            onClick={onCloneRepository}
          >
            <span className="onboarding-entry-import-label">{t("onboarding.action.cloneRepository")}</span>
            <span className="onboarding-entry-import-brands" aria-hidden="true">
              {IMPORT_PREVIEW_BRANDS.map((brand) => (
                <span key={brand} className="onboarding-entry-import-brand">
                  <ImportSourceMark brand={brand} decorative />
                </span>
              ))}
            </span>
            <span className="onboarding-entry-import-more" aria-hidden="true">…</span>
          </Button>
        </div>

      </div>
      {footer}
    </div>
  );
}
