import { DesktopMenuItem, DesktopMenuSection, DesktopMenuSurface } from "../DesktopMenu";
import { Button, FolderIcon, Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { ChevronDown, Download } from "lucide-react";
import { InlineLoading } from "../loading";
import { ImportSourcePreview } from "./ImportSourcePreview";
import type { ImportSourceBrand } from "./ImportSourceMark";
import { OnboardingCreateProjectAction } from "./OnboardingEntryActions";
import { useOnboardingMenu } from "./useOnboardingMenu";

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
 * Every way to start a project, at the head of a page that already has some. A new
 * project stays one click away; opening a folder and importing wait behind the arrow,
 * since a returning user mostly picks from the projects below.
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
  const menu = useOnboardingMenu();
  const label = t("onboarding.action.moreEntries");

  const choose = (action: () => void) => {
    menu.close();
    action();
  };

  return (
    <div ref={menu.rootRef} className="onboarding-entry-menu-root" role="group" aria-label={t("onboarding.projects.title")}>
      <OnboardingCreateProjectAction
        busy={busy}
        canCreateProject={canCreateProject}
        prominent
        onCreateProject={onCreateProject}
      />
      <Tooltip content={label}>
        <Button
          className="onboarding-entry-action-default onboarding-entry-menu-trigger"
          tone="primary"
          data-onboarding-action="more"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={menu.open}
          aria-busy={openingFolder || undefined}
          disabled={busy}
          onClick={menu.toggle}
        >
          {openingFolder
            ? <InlineLoading label={null} size="sm" tone="neutral" />
            : <ChevronDown size={14} strokeWidth={1.85} aria-hidden="true" />}
        </Button>
      </Tooltip>
      {menu.open && (
        <DesktopMenuSurface ref={menu.menuRef} className="onboarding-entry-menu" ariaLabel={label} elevation="compact" onKeyDown={menu.onKeyDown}>
          <DesktopMenuSection>
            <DesktopMenuItem
              role="menuitem"
              data-onboarding-action="open"
              icon={<FolderIcon size={14} strokeWidth={1.85} aria-hidden="true" />}
              label={t("onboarding.action.openFolder")}
              onClick={() => choose(onOpenFolder)}
            />
            <DesktopMenuItem
              role="menuitem"
              data-onboarding-action="import"
              aria-haspopup="dialog"
              disabled={!canImport}
              icon={<Download size={14} strokeWidth={1.85} aria-hidden="true" />}
              label={t("onboarding.action.importFromApps")}
              trailing={<ImportSourcePreview brands={importPreviewBrands} />}
              onClick={() => choose(onImport)}
            />
          </DesktopMenuSection>
        </DesktopMenuSurface>
      )}
    </div>
  );
}
