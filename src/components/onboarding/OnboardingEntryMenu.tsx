import { DesktopMenuItem, DesktopMenuSection } from "../DesktopMenu";
import { FolderIcon } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { Download, Plus } from "lucide-react";
import { InlineLoading } from "../loading";
import { ImportSourcePreview } from "./ImportSourcePreview";
import type { ImportSourceBrand } from "./ImportSourceMark";
import { OnboardingGroupMenu } from "./OnboardingGroupMenu";

type OnboardingEntryMenuProps = {
  busy: boolean;
  openingFolder: boolean;
  canCreateProject: boolean;
  canImport: boolean;
  importPreviewBrands: readonly ImportSourceBrand[];
  onCreateProject: () => void;
  onOpenFolder: () => void;
  onImport: () => void;
};

/**
 * Every way to start a project on this computer, at the head of the group those
 * projects join. A new project stays one click away; opening a folder and importing
 * wait behind the arrow, since a returning user mostly picks from the projects below.
 */
export function OnboardingEntryMenu({
  busy,
  openingFolder,
  canCreateProject,
  canImport,
  importPreviewBrands,
  onCreateProject,
  onOpenFolder,
  onImport,
}: OnboardingEntryMenuProps) {
  const { t } = useLocalization();
  const label = t("onboarding.action.moreEntries");

  return (
    <div className="onboarding-group-split" role="group" aria-label={t("onboarding.projects.title")}>
      <button
        type="button"
        className="onboarding-group-action"
        data-onboarding-action="create"
        disabled={busy || !canCreateProject}
        onClick={onCreateProject}
      >
        <Plus size={14} strokeWidth={1.85} aria-hidden="true" />
        <span>{t("onboarding.action.createLocalProject")}</span>
      </button>
      <OnboardingGroupMenu
        label={label}
        action="more"
        pending={openingFolder}
        disabled={busy}
        icon={openingFolder ? <InlineLoading label={null} size="sm" tone="neutral" /> : undefined}
      >
        {(close) => (
          <DesktopMenuSection>
            <DesktopMenuItem
              role="menuitem"
              data-onboarding-action="open"
              icon={<FolderIcon size={14} strokeWidth={1.85} aria-hidden="true" />}
              label={t("onboarding.action.openFolder")}
              onClick={() => { close(); onOpenFolder(); }}
            />
            <DesktopMenuItem
              role="menuitem"
              data-onboarding-action="import"
              aria-haspopup="dialog"
              disabled={!canImport}
              icon={<Download size={14} strokeWidth={1.85} aria-hidden="true" />}
              label={t("onboarding.action.importFromApps")}
              trailing={<ImportSourcePreview brands={importPreviewBrands} />}
              onClick={() => { close(); onImport(); }}
            />
          </DesktopMenuSection>
        )}
      </OnboardingGroupMenu>
    </div>
  );
}
