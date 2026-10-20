import { useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import { ChevronDown } from "lucide-react";
import { DesktopTitlebarMenuLayer } from "../../features/app-shell/DesktopTitlebarMenuLayer";
import { DesktopProjectLocationControls } from "../../features/app-shell/DesktopProjectLocationSwitcher";
import { projectOpeningLocation, type ProjectHomeItem } from "../../features/app-shell/workspaceHomeModel";
import { useDesktopPlatformCapabilities } from "../../platform/useDesktopPlatformCapabilities";

/** The same two opening actions in both Homepage layouts; no second project identity. */
export function ProjectOpenMenu({ name, projectId, busy, className, onLocal, onCloud }: {
  name: string; projectId: string; busy: boolean; className: string; onLocal?: () => void; onCloud?: () => void;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={anchor} type="button" className={`project-open-menu-button ${className}`}
      disabled={busy} aria-haspopup="dialog" aria-expanded={open && !busy}
      aria-label={t("shell.projectOpen.forProject", { project: name })}
      onClick={() => setOpen(value => !value)}>
      {t("shell.projectOpen.action")}<ChevronDown size={12} aria-hidden="true" />
    </button>
    <DesktopTitlebarMenuLayer anchorRef={anchor} open={open && !busy} onDismiss={() => setOpen(false)}
      className="desktop-project-location-menu" gap={4} preferredWidth={252} preferredMaxHeight={180}
      widthMode="content" alignment="end" role="dialog" ariaLabel={t("shell.projectOpen.title")}>
      <DesktopProjectLocationControls
        cloudProject={{ id: projectId }}
        onViewLocal={onLocal && (() => { setOpen(false); onLocal(); })}
        onViewCloud={onCloud && (() => { setOpen(false); onCloud(); })} />
    </DesktopTitlebarMenuLayer>
  </>;
}

export function ProjectOpenCaption({ item }: { item: ProjectHomeItem }) {
  return <>{useProjectOpenCaption(item)}</>;
}

export function useProjectOpenCaption(item: ProjectHomeItem): string {
  const { t } = useLocalization();
  const platform = useDesktopPlatformCapabilities();
  const isMac = platform?.platform === "macos";
  const device = t(isMac ? "shell.workspaceSwitcher.location.thisMac" : "shell.workspaceSwitcher.location.thisComputer");
  const location = projectOpeningLocation(item);
  if (item.lastOpenedLocation) {
    if (location === "cloud") return t("shell.projectOpen.lastCloud");
    return t(isMac ? "shell.projectOpen.lastMac" : "shell.projectOpen.lastComputer");
  }
  return location === "cloud" ? t("shell.navigation.cloud") : device;
}
