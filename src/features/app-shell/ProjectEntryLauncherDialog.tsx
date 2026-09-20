import { Download, FilePlus2, FolderOpen, Plus } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { ReactNode } from "react";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../components/DesktopDialog";

export type ProjectEntryLauncherDialogProps = Readonly<{
  canImport: boolean;
  canCreateProject: boolean;
  onImport: () => void;
  onClose: () => void;
  onCreateProject: () => void;
  onOpenFolder: () => void;
}>;

/**
 * Shared Project entry router for the in-workspace Project Rail. The launcher
 * owns presentation only; the App Shell remains the single owner of Workspace
 * creation, cloning, folder selection, and their follow-up dialogs.
 */
export function ProjectEntryLauncherDialog({
  canImport,
  canCreateProject,
  onImport,
  onClose,
  onCreateProject,
  onOpenFolder,
}: ProjectEntryLauncherDialogProps) {
  const { t } = useLocalization();
  const title = t("shell.workspaceSwitcher.createNew");

  return (
    <DesktopDialogRoot onClose={onClose}>
      <DesktopDialogSurface
        width={360}
        className="desktop-project-entry-launcher"
        ariaLabel={title}
      >
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <span className="desktop-dialog-leading file" aria-hidden="true">
              <Plus size={16} strokeWidth={1.8} />
            </span>
            <h2>{title}</h2>
          </div>
          <DesktopDialogCloseButton
            title={t("common.action.close")}
            onClick={onClose}
          />
        </header>

        <div className="desktop-dialog-body desktop-project-entry-launcher-body">
          <div
            className="desktop-project-entry-options"
            role="group"
            aria-label={title}
          >
            <ProjectEntryOption
              icon={<FilePlus2 />}
              label={t("onboarding.action.createLocalProject")}
              initialFocus={canCreateProject}
              disabled={!canCreateProject}
              onClick={onCreateProject}
            />
            <ProjectEntryOption
              icon={<FolderOpen />}
              label={t("onboarding.action.openFolder")}
              initialFocus={!canCreateProject}
              onClick={onOpenFolder}
            />
            <ProjectEntryOption
              icon={<Download />}
              label={t("onboarding.action.cloneRepository")}
              disabled={!canImport}
              onClick={onImport}
            />
          </div>
        </div>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  );
}

function ProjectEntryOption({
  disabled = false,
  icon,
  initialFocus = false,
  label,
  onClick,
}: Readonly<{
  disabled?: boolean;
  icon: ReactNode;
  initialFocus?: boolean;
  label: string;
  onClick: () => void;
}>) {
  return (
    <button
      className="desktop-project-entry-option"
      type="button"
      disabled={disabled}
      data-desktop-dialog-initial-focus={initialFocus ? "true" : undefined}
      onClick={onClick}
    >
      <span className="desktop-project-entry-option-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}
