import { Button, FolderIcon } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { Download, FilePlus2 } from "lucide-react";
import { InlineLoading } from "../loading";
import { ImportSourcePreview } from "./ImportSourcePreview";
import type { ImportSourceBrand } from "./ImportSourceMark";

type OnboardingEntryActionsProps = {
  busy: boolean;
  openingFolder: boolean;
  draggingFolder: boolean;
  canImport: boolean;
  importPreviewBrands: readonly ImportSourceBrand[];
  onOpenFolder: () => void;
  /** Opens the source picker. */
  onImport: () => void;
};

/**
 * First-run entry actions, under "New empty project", which is the default path
 * because it is the only entry that does not require the user to hunt for an
 * existing folder first. Once there are projects, these move into the entry menu.
 */
export function OnboardingEntryActions({
  busy,
  openingFolder,
  draggingFolder,
  canImport,
  importPreviewBrands,
  onOpenFolder,
  onImport,
}: OnboardingEntryActionsProps) {
  const { t } = useLocalization();

  return (
    <div className="onboarding-entry-actions" role="group" aria-label={t("onboarding.projects.title")}>
      <OpenFolderAction
        busy={busy}
        openingFolder={openingFolder}
        draggingFolder={draggingFolder}
        onOpenFolder={onOpenFolder}
      />

      <ImportAction
        busy={busy}
        canImport={canImport}
        importPreviewBrands={importPreviewBrands}
        onImport={onImport}
      />
    </div>
  );
}

export function OnboardingCreateProjectAction({
  busy,
  canCreateProject,
  prominent = false,
  onCreateProject,
}: Pick<OnboardingEntryActionsProps, "busy"> & {
  canCreateProject: boolean;
  onCreateProject: () => void;
  prominent?: boolean;
}) {
  const { t } = useLocalization();

  return (
    <Button
      className={`onboarding-entry-action ${prominent ? "onboarding-entry-action-default" : ""}`}
      data-onboarding-action="create"
      tone={prominent ? "primary" : "neutral"}
      disabled={busy || !canCreateProject}
      leadingIcon={<FilePlus2 className="onboarding-entry-create-icon" size={14} strokeWidth={1.85} aria-hidden="true" />}
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
        : <FolderIcon size={14} strokeWidth={1.85} aria-hidden="true" />}
      onClick={onOpenFolder}
    >
      {t("onboarding.action.openFolder")}
    </Button>
  );
}

function ImportAction({
  busy,
  canImport,
  importPreviewBrands,
  onImport,
}: Pick<OnboardingEntryActionsProps, "busy" | "canImport" | "importPreviewBrands" | "onImport">) {
  const { t } = useLocalization();

  return (
    <div className="onboarding-entry-import-area">
      <Button
        className="onboarding-entry-action onboarding-entry-import"
        data-onboarding-action="import"
        tone="neutral"
        disabled={busy || !canImport}
        aria-haspopup="dialog"
        leadingIcon={<Download size={14} strokeWidth={1.85} aria-hidden="true" />}
        onClick={onImport}
      >
        <span className="onboarding-entry-import-label">{t("onboarding.action.importFromApps")}</span>
        <ImportSourcePreview brands={importPreviewBrands} />
      </Button>
    </div>
  );
}
