import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { Tooltip, LocalIcon, CloudIcon, LoadingMark } from "@puppyone/shared-ui";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { DesktopMenuItem } from "./DesktopMenu";
import { useDesktopPreference } from "../preferencesStore";
import { useDesktopPlatformCapabilities } from "../platform";
import { DesktopTitlebarMenuLayer } from "./DesktopTitlebarMenuLayer";

export type DesktopProjectLocation = Readonly<{
  /** The project surface currently displayed; a remote alone does not select Cloud. */
  current: "local" | "cloud";
  /** Immediate user selection while the committed provider prepares. */
  requested?: "local" | "cloud";
  /** Header destination after entry gates, which may precede the provider commit. */
  headerLocation?: "local" | "cloud";
  loading?: boolean;
  /** The requested computer could not be opened; the workspace surface owns recovery. */
  failed?: boolean;
  localAvailable: boolean;
  cloudState: "unavailable" | "available" | "signed-out" | "resolving" | "attention";
}>;

export type DesktopProjectCloudCopy = Readonly<{ id: string; name?: string | null }>;

/** A computer that is not ready yet says so in its icon slot. */
export type ProjectComputerStatus = "ready" | "opening" | "failed";

/**
 * The computer whose screen is in front of the user, and whether it is ready.
 *
 * The screen, and the Header's tint with it, moves the moment the user
 * chooses a computer, before that computer can show files. The name moves
 * with the screen: naming the computer the user just left while its tint and
 * its loading surface are on screen would contradict everything around it.
 * Readiness is a status on the name (a spinner while it opens, a warning when
 * it could not), never a reason to keep the old name.
 *
 * A destination that has not moved the screen yet (sign-in or setup in a
 * dialog first) leaves the user where they are, so the name stays too.
 */
export function resolveProjectComputerPresence(location: DesktopProjectLocation): Readonly<{
  at: "local" | "cloud";
  status: ProjectComputerStatus;
}> {
  const at = location.headerLocation ?? location.current;
  const arriving = at !== location.current || (at === "cloud" && location.requested === "cloud");
  if (!arriving) return { at, status: "ready" };
  return { at, status: location.failed ? "failed" : "opening" };
}

/** What stands in a computer's icon slot while it is not ready, at the slot's own size and weight. */
export function ProjectComputerStatusGlyph({ status, size, strokeWidth }: {
  status: Exclude<ProjectComputerStatus, "ready">;
  size: number;
  strokeWidth: number;
}) {
  return status === "opening"
    ? <LoaderCircle className="desktop-project-computer-spinner animate-spin" size={size} strokeWidth={strokeWidth} />
    : <TriangleAlert className="desktop-project-computer-warning" size={size} strokeWidth={strokeWidth} />;
}

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
  const { at: location, status } = resolveProjectComputerPresence(projectLocation);
  const locationLabel = t(location === "local" ? "shell.workspaceSwitcher.location.local" : "shell.projectRuntime.label");
  const statedLabel = status === "ready" ? locationLabel
    : t(`shell.projectComputers.status.${status}`, { computer: locationLabel });
  const controls = <DesktopProjectLocationControls presentation={inline ? "header-icons" : "popover"}
    projectLocation={projectLocation} cloudProject={cloudProject} onViewLocal={onViewLocal} onViewCloud={onViewCloud} />;
  return <div className="desktop-titlebar-location-wrap" data-location-presentation={inline ? "header-icons" : "popover"}>
    {inline ? controls : <>
      <button ref={anchor} type="button" className="desktop-titlebar-location-button"
        aria-haspopup="dialog" aria-expanded={open} aria-busy={status === "opening" || undefined}
        aria-label={`${statedLabel}, ${t("shell.workspaceSwitcher.projectDetails")}`}
        onClick={() => { if (!open) onOpen?.(); setOpen(value => !value); }}>
        <ProjectLocationMark className="desktop-titlebar-workspace-mark" kind={location} status={status} size={16} />
        <span>{locationLabel}</span>
      </button>
      <DesktopTitlebarMenuLayer anchorRef={anchor} open={open} onDismiss={() => setOpen(false)}
        dismissOnFocusExit={false} className="desktop-project-location-menu" gap={2}
        preferredWidth={200} preferredMaxHeight={160} widthMode="content" alignment="start" role="dialog"
        ariaLabel={t("shell.workspaceSwitcher.projectDetails")}>
        {controls}
      </DesktopTitlebarMenuLayer>
    </>}
  </div>;
}

/** One selection controller serves the default menu and optional Header segments. */
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
  const current = projectLocation?.current;
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
        {presentation === "header-icons" && <span className="desktop-project-location-indicator" aria-hidden="true" />}
        {presentation === "header-icons" && <span className="desktop-project-location-label-size" aria-hidden="true">
          <span>{t("shell.workspaceSwitcher.location.local")}</span>
          <span>{t("shell.projectRuntime.label")}</span>
        </span>}
        {(["local", "cloud"] as const).map(location =>
          <ProjectLocationTab
            key={location}
            location={location} current={current} selection={selection} createCloud={createCloud}
            localDeviceLabel={localDeviceLabel} projectLocation={projectLocation}
            presentation={presentation}
            onViewLocal={onViewLocal} onViewCloud={onViewCloud} />
        )}
      </div>
    </div>
  );
}

/** The project has never been opened on the Cloud Computer, so opening it there sets it up first. */
export function shouldCreateCloud(location: DesktopProjectLocation | undefined, cloudProject: DesktopProjectCloudCopy | undefined, canNavigate: boolean) {
  const linked = location?.current === "cloud" || Boolean(cloudProject?.id)
    || location?.cloudState === "available" || location?.cloudState === "signed-out";
  return !linked && canNavigate && (!location || location.cloudState === "unavailable");
}

type LocationTabProps = Pick<Parameters<typeof DesktopProjectLocationControls>[0], "projectLocation" | "onViewLocal" | "onViewCloud"> & {
  location: "local" | "cloud";
  current: "local" | "cloud" | undefined;
  selection: "local" | "cloud" | undefined;
  createCloud: boolean;
  localDeviceLabel: string;
  presentation: "popover" | "header-icons";
};

function ProjectLocationTab(props: LocationTabProps) {
  const { t } = useLocalization();
  const { location, current, selection, createCloud, projectLocation, onViewLocal, onViewCloud, presentation } = props;
  const inHeader = presentation === "header-icons";
  const creating = location === "cloud" && createCloud;
  const loading = location === "cloud" && Boolean(projectLocation?.loading || projectLocation?.cloudState === "resolving");
  const selected = location === selection;
  const navigate = location === "local" ? onViewLocal : onViewCloud;
  const disabled = !selected && (!navigate || (location === "local" && projectLocation?.localAvailable === false));
  const { label, visibleLabel, iconOnly } = useProjectLocationTabLabels(props, creating, selected);
  const mark = <ProjectLocationTabMark location={location} loading={loading} inHeader={inHeader} />;
  const buttonProps: ButtonHTMLAttributes<HTMLButtonElement> = {
    "aria-label": label, ...getLocationSelectionAttributes(props, creating),
    disabled, onClick: selected ? undefined : navigate,
  };
  const locationAttributes = {
    "data-project-location": location, "data-cloud-action": creating ? "create" : undefined,
    "data-cloud-pending": loading || undefined,
  };
  const selectedRow = location === current && !creating;
  if (!inHeader) return <DesktopMenuItem className="desktop-project-location-option" role="button"
    icon={mark} label={visibleLabel} selected={selectedRow}
    trailing={selectedRow ? <Check size={14} aria-hidden="true" /> : undefined}
    {...locationAttributes} {...buttonProps} />;
  return <Tooltip content={iconOnly ? t(getLocationTabTooltip(props)) : undefined}><button
    className="desktop-project-location-tab" type="button" {...locationAttributes} {...buttonProps}>
    {mark}
    {!iconOnly && <span>{visibleLabel}</span>}
  </button></Tooltip>;
}

function getLocationSelectionAttributes({ location, current, selection }: LocationTabProps, creating: boolean): ButtonHTMLAttributes<HTMLButtonElement> {
  return {
    "aria-pressed": creating ? undefined : location === selection,
    "aria-current": location === current ? "true" : undefined,
  };
}

function ProjectLocationTabMark({ location, loading, inHeader }: {
  location: DesktopProjectLocation["current"]; loading: boolean; inHeader: boolean;
}) {
  if (loading) return <span className="desktop-project-location-tab-mark" aria-hidden="true"><LoadingMark size="xs" ariaHidden /></span>;
  return <ProjectLocationMark className={inHeader ? "desktop-project-location-tab-mark" : "desktop-project-location-option-mark"}
    kind={location} size={inHeader ? 16 : 15} />;
}

function useProjectLocationTabLabels({ location, presentation, localDeviceLabel }: LocationTabProps, creating: boolean, selected: boolean) {
  const { t } = useLocalization();
  const label = useProjectLocationLabel(location, localDeviceLabel);
  if (presentation !== "header-icons") return { label, visibleLabel: label, iconOnly: false };
  const visibleLabel = t(location === "local" ? "shell.workspaceSwitcher.location.local" : "shell.projectRuntime.label");
  return { label: creating ? label : visibleLabel, visibleLabel, iconOnly: !selected };
}

function useProjectLocationLabel(location: "local" | "cloud", deviceLabel: string) {
  const { t } = useLocalization();
  return location === "local" ? deviceLabel : t("shell.projectOpen.inCloud");
}

function getLocationTabTooltip({ location, selection, projectLocation, createCloud }: LocationTabProps) {
  if (location === selection) {
    if (projectLocation?.loading) return "shell.workspaceSwitcher.location.checking";
    return "shell.workspaceSwitcher.current";
  }
  if (location === "local") return "shell.surface.switchToLocal";
  if (createCloud) return "shell.projectOpen.inCloud";
  if (projectLocation?.cloudState === "signed-out") return "shell.workspaceSwitcher.location.signInToAccess";
  return "shell.projectOpen.inCloud";
}

function useProjectDeviceLabel() {
  const { t } = useLocalization();
  const capabilities = useDesktopPlatformCapabilities();
  return t(capabilities?.platform === "macos"
    ? "shell.projectOpen.onMac"
    : "shell.projectOpen.onComputer");
}

function ProjectLocationMark({
  className,
  kind,
  status = "ready",
  size = 15,
  strokeWidth = 1.75,
}: {
  className: string;
  kind: DesktopProjectLocation["current"];
  status?: ProjectComputerStatus;
  size?: number;
  strokeWidth?: number;
}) {
  let glyph = kind === "cloud" ? <CloudIcon size={size} strokeWidth={strokeWidth} /> : <LocalIcon size={size} strokeWidth={strokeWidth} />;
  if (status !== "ready") glyph = <ProjectComputerStatusGlyph status={status} size={size} strokeWidth={strokeWidth} />;
  return (
    <span
      className={`desktop-project-location-mark ${className}`}
      data-project-location={kind}
      data-computer-status={status === "ready" ? undefined : status}
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
}
