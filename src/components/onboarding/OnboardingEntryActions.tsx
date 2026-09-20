import { Button } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { Download, FilePlus2, FolderOpen } from "lucide-react";
import { InlineLoading } from "../loading";
import { ImportSourceMark } from "./ImportSourceMark";

const IMPORT_PREVIEW_BRANDS = ["github", "notion", "google-drive"] as const;

type OnboardingEntryActionsProps = {
  includeCreateProject: boolean;
  busy: boolean;
  openingFolder: boolean;
  draggingFolder: boolean;
  canCreateProject: boolean;
  canCloneRepository: boolean;
  onOpenFolder: () => void;
  onCreateProject: () => void;
  /** Opens the source picker. */
  onCloneRepository: () => void;
};

/**
 * Homepage entry actions. "New empty project" is the default path because it
 * is the only entry that does not require the user to hunt for an existing
 * folder first. Importing existing work sits below the two direct-start
 * actions as the same compact CTA, with a source preview beside its label.
 */
export function OnboardingEntryActions({
  includeCreateProject,
  busy,
  openingFolder,
  draggingFolder,
  canCreateProject,
  canCloneRepository,
  onOpenFolder,
  onCreateProject,
  onCloneRepository,
}: OnboardingEntryActionsProps) {
  const { t } = useLocalization();

  return (
    <div className="onboarding-entry-actions" role="group" aria-label={t("onboarding.projects.title")}>
      {includeCreateProject && (
        <OnboardingCreateProjectAction
          busy={busy}
          canCreateProject={canCreateProject}
          onCreateProject={onCreateProject}
        />
      )}

      <OpenFolderAction
        busy={busy}
        openingFolder={openingFolder}
        draggingFolder={draggingFolder}
        onOpenFolder={onOpenFolder}
      />

      <ImportAction
        busy={busy}
        canCloneRepository={canCloneRepository}
        onCloneRepository={onCloneRepository}
      />
    </div>
  );
}

export function OnboardingCreateProjectAction({
  busy,
  canCreateProject,
  prominent = false,
  onCreateProject,
}: Pick<OnboardingEntryActionsProps, "busy" | "canCreateProject" | "onCreateProject"> & {
  prominent?: boolean;
}) {
  const { t } = useLocalization();

  return (
    <Button
      className={`onboarding-entry-action ${prominent ? "onboarding-entry-action-default" : ""}`}
      data-onboarding-action="create"
      tone="neutral"
      disabled={busy || !canCreateProject}
      leadingIcon={<FilePlus2 className="onboarding-entry-create-icon" aria-hidden="true" />}
      onClick={onCreateProject}
    >
      {t("onboarding.action.createLocalProject")}
    </Button>
  );
}

function OpenFolderAction({
  busy,
  openingFolder,
  draggingFolder,
  onOpenFolder,
}: Pick<OnboardingEntryActionsProps, "busy" | "openingFolder" | "draggingFolder" | "onOpenFolder">) {
  const { t } = useLocalization();

  return (
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
  );
}

function ImportAction({
  busy,
  canCloneRepository,
  onCloneRepository,
}: Pick<OnboardingEntryActionsProps, "busy" | "canCloneRepository" | "onCloneRepository">) {
  const { t } = useLocalization();

  return (
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
            {IMPORT_PREVIEW_BRANDS.map((brand) => (
              <span className="onboarding-entry-import-brand-badge" key={brand}>
                <ImportSourceMark brand={brand} />
              </span>
            ))}
          </span>
        </span>
      </Button>
    </div>
  );
}
