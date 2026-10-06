import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@puppyone/shared-ui";
import { Laptop, Plus } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { PulseGrid } from "../../components/loading";
import { CloudIcon as Cloud } from "../../components/icons/CloudIcon";
import { useDesktopPreference } from "../../preferencesStore";
import { useDesktopPlatformCapabilities } from "../../platform/useDesktopPlatformCapabilities";
import { DesktopTitlebarMenuLayer } from "./DesktopTitlebarMenuLayer";

export type DesktopProjectLocation = Readonly<{
  /** The project surface currently displayed; a remote alone does not select Cloud. */
  current: "local" | "cloud";
  /** Immediate user selection while the committed provider prepares. */
  requested?: "local" | "cloud";
  /** Header destination after entry gates, which may precede the provider commit. */
  headerLocation?: "local" | "cloud";
  loading?: boolean;
  localAvailable: boolean;
  cloudState: "unavailable" | "available" | "signed-out" | "resolving" | "attention";
}>;

export type DesktopProjectCloudCopy = Readonly<{ id: string; name?: string | null }>;

/** Owns location presentation only; the caller owns provider switching. */
export function DesktopProjectLocationSwitcher({ projectLocation, cloudProject, onViewLocal, onViewCloud, projectMenuOpen = false, onOpen }: {
  projectLocation?: DesktopProjectLocation;
  cloudProject?: DesktopProjectCloudCopy;
  onViewLocal?: () => void;
  onViewCloud?: () => void;
  projectMenuOpen?: boolean;
  onOpen?: () => void;
}) {
  const { t } = useLocalization();
  const inline = useDesktopPreference(s => s.experimentalSettings.enableProjectLocationIconsInHeader);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const available = Boolean(projectLocation);
  useEffect(() => { if (inline || !available || projectMenuOpen) setOpen(false); }, [inline, available, projectMenuOpen]);
  if (!projectLocation) return null;
  const location = projectLocation.headerLocation ?? projectLocation.current;
  const locationLabel = t(location === "local" ? "shell.workspaceSwitcher.location.local" : "shell.navigation.cloud");
  const controls = <DesktopProjectLocationControls presentation={inline ? "header-icons" : "popover"}
    projectLocation={projectLocation} cloudProject={cloudProject} onViewLocal={onViewLocal} onViewCloud={onViewCloud} />;
  return <div className="desktop-titlebar-location-wrap" data-location-presentation={inline ? "header-icons" : "popover"}>
    {inline ? controls : <>
      <button ref={anchor} type="button" className="desktop-titlebar-location-button"
        aria-haspopup="dialog" aria-expanded={open} aria-label={`${locationLabel}, ${t("shell.workspaceSwitcher.projectDetails")}`}
        onClick={() => { if (!open) onOpen?.(); setOpen(value => !value); }}>
        <ProjectLocationMark className="desktop-titlebar-workspace-mark" kind={location} size={16} />
        <span>{locationLabel}</span>
      </button>
      <DesktopTitlebarMenuLayer anchorRef={anchor} open={open} onDismiss={() => setOpen(false)}
        dismissOnFocusExit={false} className="desktop-project-location-menu" gap={2}
        preferredWidth={248} preferredMaxHeight={160} widthMode="content" alignment="center" role="dialog"
        ariaLabel={t("shell.workspaceSwitcher.projectDetails")}>
        {controls}
      </DesktopTitlebarMenuLayer>
    </>}
  </div>;
}

/** Location controls own selection; CSS owns their shared button/plate geometry. */
export function DesktopProjectLocationControls({
  presentation = "popover",
  projectLocation,
  cloudProject,
  onViewLocal,
  onViewCloud,
}: {
  presentation?: "popover" | "header-icons";
  projectLocation?: DesktopProjectLocation;
  cloudProject?: DesktopProjectCloudCopy;
  onViewLocal?: () => void;
  onViewCloud?: () => void;
}) {
  const { t } = useLocalization();
  const localDeviceLabel = useProjectDeviceLabel();
  const current = projectLocation?.current ?? "local";
  const selection = projectLocation?.requested ?? current;
  const createCloud = shouldCreateCloud(projectLocation, cloudProject, Boolean(onViewCloud));
  return (
    <div className="desktop-project-location-controls"
      data-presentation={presentation}
      data-cloud-entry={createCloud ? "create" : "switch"}>
      <div className="desktop-project-location-tabs" role="group"
        data-location={selection}
        aria-busy={projectLocation?.loading || projectLocation?.cloudState === "resolving" || undefined}
        aria-label={t("shell.workspaceSwitcher.projectDetails")}>
        <span className="desktop-project-location-indicator" aria-hidden="true" />
        {(["local", "cloud"] as const).map(location => <ProjectLocationTab key={location}
          location={location} current={current} selection={selection} createCloud={createCloud}
          localDeviceLabel={localDeviceLabel} projectLocation={projectLocation}
          presentation={presentation}
          onViewLocal={onViewLocal} onViewCloud={onViewCloud} />)}
      </div>
    </div>
  );
}

function shouldCreateCloud(location: DesktopProjectLocation | undefined, cloudProject: DesktopProjectCloudCopy | undefined, canNavigate: boolean) {
  const linked = location?.current === "cloud" || Boolean(cloudProject?.id)
    || location?.cloudState === "available" || location?.cloudState === "signed-out";
  return !linked && canNavigate && (!location || location.cloudState === "unavailable");
}

type LocationTabProps = Pick<Parameters<typeof DesktopProjectLocationControls>[0], "projectLocation" | "onViewLocal" | "onViewCloud"> & {
  location: "local" | "cloud";
  current: "local" | "cloud";
  selection: "local" | "cloud";
  createCloud: boolean;
  localDeviceLabel: string;
  presentation: "popover" | "header-icons";
};

function ProjectLocationTab(props: LocationTabProps) {
  const { t } = useLocalization();
  const { location, current, selection, createCloud, localDeviceLabel, projectLocation, onViewLocal, onViewCloud, presentation } = props;
  const iconOnly = presentation === "header-icons";
  const creating = location === "cloud" && createCloud;
  const loading = location === "cloud" && Boolean(projectLocation?.loading || projectLocation?.cloudState === "resolving");
  const selected = location === selection;
  const navigate = location === "local" ? onViewLocal : onViewCloud;
  const disabled = !selected && (!navigate || (location === "local" && projectLocation?.localAvailable === false));
  const label = useProjectLocationLabel(location, creating, localDeviceLabel);
  return <Tooltip content={iconOnly ? t(getLocationTabTooltip(props)) : undefined}><button
    className="desktop-project-location-tab" type="button" data-project-location={location}
    aria-label={label}
    data-cloud-action={creating ? "create" : undefined}
    aria-pressed={creating ? undefined : selected}
    aria-current={location === current ? "true" : undefined}
    data-cloud-pending={loading || undefined}
    disabled={disabled} onClick={() => { if (!selected) navigate?.(); }}>
    {loading ? <span className="desktop-project-location-tab-mark" aria-hidden="true"><PulseGrid size="xs" ariaHidden /></span>
      : <ProjectLocationMark className="desktop-project-location-tab-mark" kind={location} creating={creating && !iconOnly} size={iconOnly ? 16 : 14} />}
    {!iconOnly && <span>{label}</span>}
  </button></Tooltip>;
}

function useProjectLocationLabel(location: "local" | "cloud", creating: boolean, deviceLabel: string) {
  const { t } = useLocalization();
  if (location === "local") return deviceLabel;
  return t(creating ? "shell.workspaceSwitcher.createCloudVersion" : "shell.navigation.cloud");
}

function getLocationTabTooltip({ location, selection, projectLocation, createCloud }: LocationTabProps) {
  if (location === selection) {
    if (projectLocation?.loading) return "shell.workspaceSwitcher.location.checking";
    return "shell.workspaceSwitcher.current";
  }
  if (location === "local") return "shell.surface.switchToLocal";
  if (createCloud) return "shell.workspaceSwitcher.createCloudVersion";
  if (projectLocation?.cloudState === "signed-out") return "shell.workspaceSwitcher.location.signInToAccess";
  return "shell.surface.switchToCloud";
}

function useProjectDeviceLabel() {
  const { t } = useLocalization();
  const capabilities = useDesktopPlatformCapabilities();
  return t(capabilities?.platform === "macos"
    ? "shell.workspaceSwitcher.location.thisMac"
    : "shell.workspaceSwitcher.location.thisComputer");
}

function ProjectLocationMark({
  className,
  kind,
  creating = false,
  size = 15,
  strokeWidth = 1.75,
}: {
  className: string;
  kind: DesktopProjectLocation["current"];
  creating?: boolean;
  size?: number;
  strokeWidth?: number;
}) {
  const CloudMark = creating ? Plus : Cloud;
  const Icon = kind === "cloud" ? CloudMark : Laptop;
  return (
    <span
      className={`desktop-project-location-mark ${className}`}
      data-project-location={kind}
      aria-hidden="true"
    >
      <Icon size={size} strokeWidth={strokeWidth} />
    </span>
  );
}
