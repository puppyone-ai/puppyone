import { Button } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { Download, FilePlus2, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import { InlineLoading } from "../loading";
import {
  IMPORT_SOURCE_BRANDS,
  ImportSourceMark,
  getImportSourceBrandLabel,
  type ImportSourceBrand,
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
  /** Opens the import dialog; a brand jumps straight to that app's path. */
  onCloneRepository: (brand?: ImportSourceBrand) => void;
};

/**
 * Homepage entry actions. "Create an empty project" is the default path because it
 * is the only entry that does not require the user to hunt for an existing
 * folder first. Opening a folder and importing are secondary; import shows the
 * apps it understands as a compact row of independently accessible shortcuts.
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

          <div className="onboarding-entry-import">
            <Button
              className="onboarding-entry-action"
              data-onboarding-action="clone"
              tone="neutral"
              disabled={busy || !canCloneRepository}
              leadingIcon={<Download aria-hidden="true" />}
              onClick={() => onCloneRepository()}
            >
              {t("onboarding.action.cloneRepository")}
            </Button>
            <div
              className="onboarding-entry-import-brands"
              role="group"
              aria-label={t("onboarding.action.cloneRepository")}
            >
              {IMPORT_SOURCE_BRANDS.map((brand) => (
                <button
                  key={brand}
                  className="onboarding-entry-import-brand"
                  type="button"
                  data-import-brand={brand}
                  disabled={busy || !canCloneRepository}
                  aria-label={getImportSourceBrandLabel(brand)}
                  title={getImportSourceBrandLabel(brand)}
                  onClick={() => onCloneRepository(brand)}
                >
                  <ImportSourceMark brand={brand} decorative />
                </button>
              ))}
            </div>
          </div>
        </div>

      </div>
      {footer}
    </div>
  );
}
