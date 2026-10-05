import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Tooltip,
  createWorkspaceFolder,
  type Workspace,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";
import {
  ArrowLeft,
  Plus,
  FolderPlus,
  Laptop,
} from "lucide-react";
import { DesktopMenuItem } from "../../components/DesktopMenu";
import { PulseGrid } from "../../components/loading";
import type { ProjectBackupProvider } from "./projectBackupProviders";
import type { GitStatusSnapshot } from "../../types/electron";
import { DesktopTitlebarMenuLayer } from "./DesktopTitlebarMenuLayer";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { CloudIcon as Cloud } from "../../components/icons/CloudIcon";
import {
  ProjectContextAssetMark,
  resolveProjectContextAssetKind,
} from "./ProjectContextAssetMark";
import { getWorkspaceParentPathForDisplay } from "./workspaceHomeModel";
import { useDesktopPlatformCapabilities } from "../../platform/useDesktopPlatformCapabilities";
import { useDesktopPreference } from "../../preferencesStore";

type DesktopWorkspaceSwitcherProps = {
  open: boolean;
  refObject: RefObject<HTMLDivElement>;
  titlebarLabel: string;
  menuAlignment?: "start" | "center";
  workspace: Workspace;
  workspaceFolders: readonly WorkspaceFolder[];
  multiRootWorkspacesEnabled: boolean;
  projectLocation?: DesktopProjectLocation;
  cloudProject?: DesktopProjectCloudCopy;
  backupProviders?: readonly ProjectBackupProvider[];
  backupStatus?: GitStatusSnapshot | null;
  availableProjects?: readonly Workspace[];
  onAddExistingProject?: (folderPath: string) => void;
  onOpenFolder?: () => void;
  onClose: () => void;
  onShare?: () => void;
  onViewLocal?: () => void;
  onViewCloud?: () => void;
  onToggle: () => void;
};

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

export function DesktopWorkspaceSwitcher({
  open,
  refObject,
  titlebarLabel,
  menuAlignment = "start",
  workspace,
  workspaceFolders,
  multiRootWorkspacesEnabled,
  projectLocation,
  cloudProject,
  availableProjects = [],
  onAddExistingProject,
  onOpenFolder,
  onClose,
  onViewLocal,
  onViewCloud,
  onToggle,
}: DesktopWorkspaceSwitcherProps) {
  const { t } = useLocalization();
  const inlineLocations = useDesktopPreference(s => s.experimentalSettings.enableProjectLocationIconsInHeader);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<"projects" | "add">("projects");
  const attachedFolders = useMemo(
    () => workspaceFolders.length > 0
      ? workspaceFolders
      : [createWorkspaceFolder(workspace)],
    [workspace, workspaceFolders],
  );
  const unattachedProjects = useMemo(() => {
    const attachedPaths = new Set(attachedFolders.map((folder) => folder.workspace.path));
    return availableProjects.filter((project) => !attachedPaths.has(project.path));
  }, [attachedFolders, availableProjects]);
  const hasProjectMenu = !inlineLocations || attachedFolders.length > 1 || multiRootWorkspacesEnabled;
  const resolvedCloudProject = resolveProjectCloudCopy(workspace, cloudProject);
  useEffect(() => {
    if (open && !hasProjectMenu) onClose();
  }, [hasProjectMenu, onClose, open]);
  useEffect(() => {
    if (!open || (view === "add" && !multiRootWorkspacesEnabled)) setView("projects");
  }, [multiRootWorkspacesEnabled, open, view]);
  useEffect(() => {
    setView("projects");
  }, [workspace.path]);
  return (
    <div className="desktop-titlebar-workspace-wrap" ref={refObject}
      data-location-presentation={inlineLocations ? "header-icons" : "popover"}>
      <DesktopProjectTitle workspace={workspace} titlebarLabel={titlebarLabel}
        projectLocation={projectLocation} inlineLocations={inlineLocations}
        hasProjectMenu={hasProjectMenu} open={open} triggerRef={triggerRef}
        onToggle={() => { setView("projects"); onToggle(); }} />
      {inlineLocations && <DesktopProjectLocationControls
        presentation="header-icons"
        projectLocation={projectLocation}
        cloudProject={resolvedCloudProject}
        onViewLocal={onViewLocal}
        onViewCloud={onViewCloud}
      />}
      <DesktopTitlebarMenuLayer
        anchorRef={triggerRef}
        className="desktop-project-menu"
        gap={2}
        onDismiss={onClose}
        dismissOnFocusExit={false}
        open={open && hasProjectMenu}
        preferredMaxHeight={520}
        preferredWidth={view === "add" ? 240 : 248}
        widthMode={view === "add" ? "fixed" : "content"}
        alignment={menuAlignment}
        role="dialog"
        ariaLabel={t("shell.workspaceSwitcher.projectDetails")}
      >
        {view !== "add" ? (
          <>
            {!inlineLocations && <DesktopProjectLocationControls
              projectLocation={projectLocation}
              cloudProject={resolvedCloudProject}
              onViewLocal={onViewLocal}
              onViewCloud={onViewCloud}
            />}
            {(attachedFolders.length > 1 || multiRootWorkspacesEnabled) && (
              <div className="desktop-project-list" data-po-scrollbar="menu"
                role="menu" aria-label={t("shell.workspaceSwitcher.projects")}>
                {attachedFolders.slice(1).map((folder) => (
                <DesktopProjectRow
                  key={folder.id}
                  folder={folder}
                />
                ))}
                {multiRootWorkspacesEnabled && (
                  <DesktopMenuItem
                    className="desktop-project-add desktop-project-add-folder"
                    disabled={!onAddExistingProject && !onOpenFolder}
                    icon={<FolderPlus size={15} strokeWidth={1.8} />}
                    label={t("shell.workspaceSwitcher.addProject")}
                    onClick={() => setView("add")}
                  />
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="desktop-project-back-group" role="menu"
              aria-label={t("shell.workspaceSwitcher.projects")}>
              <DesktopMenuItem
                className="desktop-project-add"
                icon={<ArrowLeft className="po-directional-icon" size={15} strokeWidth={1.9} />}
                label={t("shell.workspaceSwitcher.projects")}
                onClick={() => setView("projects")}
              />
            </div>
            <div className="desktop-project-list" data-po-scrollbar="menu"
                role="menu" aria-label={t("shell.workspaceSwitcher.projects")}>
              {unattachedProjects.map((project) => (
                <DesktopMenuItem
                  className="desktop-project-add"
                  detail={(
                    <Tooltip content={project.path} overflowOnly>
                      <bdi dir="ltr">{getWorkspaceParentPathForDisplay(project.path)}</bdi>
                    </Tooltip>
                  )}
                  icon={(
                    <ProjectContextAssetMark
                      className="desktop-project-mark"
                      kind={resolveProjectContextAssetKind(project)}
                    />
                  )}
                  key={project.id}
                  label={<bdi>{project.name}</bdi>}
                  onClick={() => onAddExistingProject?.(project.path)}
                />
              ))}
              <DesktopMenuItem
                className="desktop-project-add desktop-project-add-folder"
                disabled={!onOpenFolder}
                icon={<FolderPlus size={15} strokeWidth={1.8} />}
                label={t("shell.workspaceSwitcher.openFolder")}
                onClick={onOpenFolder}
              />
            </div>
          </>
        )}
      </DesktopTitlebarMenuLayer>
    </div>
  );
}

function resolveProjectCloudCopy(workspace: Workspace, cloudProject?: DesktopProjectCloudCopy) {
  if (cloudProject) return cloudProject;
  const projectId = workspace.puppyoneGitRemote?.projectId;
  return projectId ? { id: projectId } : undefined;
}

function DesktopProjectTitle({ workspace, titlebarLabel, projectLocation, inlineLocations, hasProjectMenu, open, triggerRef, onToggle }: {
  workspace: Workspace;
  titlebarLabel: string;
  projectLocation?: DesktopProjectLocation;
  inlineLocations: boolean;
  hasProjectMenu: boolean;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement>;
  onToggle: () => void;
}) {
  const { t } = useLocalization();
  const deviceLabel = useProjectDeviceLabel();
  const kind = projectLocation?.headerLocation ?? projectLocation?.current ?? "local";
  const contextLabel = kind === "cloud" ? t("shell.workspaceSwitcher.location.cloud") : deviceLabel;
  return <Tooltip content={t("shell.workspaceSwitcher.projectTitle", { project: bidiIsolate(workspace.name) }) + ` · ${contextLabel}`}>
    {hasProjectMenu ? <button className="desktop-titlebar-workspace-button local"
      ref={triggerRef} type="button"
      aria-label={t("shell.workspaceSwitcher.openMenu", { workspace: bidiIsolate(workspace.name) }) + ` · ${contextLabel}`}
      aria-expanded={open} aria-haspopup="dialog" onClick={onToggle}>
      {!inlineLocations && <ProjectLocationMark className="desktop-titlebar-workspace-mark" kind={kind} size={16} />}
      <bdi className="desktop-titlebar-workspace-name">{titlebarLabel}</bdi>
    </button> : <span className="desktop-titlebar-workspace-button desktop-titlebar-workspace-label">
      <bdi className="desktop-titlebar-workspace-name">{titlebarLabel}</bdi>
    </span>}
  </Tooltip>;
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
  return <Tooltip content={t(getLocationTabTooltip(props))}><button
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

function DesktopProjectRow({
  folder,
}: {
  folder: WorkspaceFolder;
}) {
  const detail = getWorkspaceParentPathForDisplay(folder.workspace.path);
  return (
    <div className="desktop-project-option-row">
      <div
        className="desktop-menu-item desktop-project-option"
        role="menuitem"
        aria-disabled="true"
      >
        <span className="desktop-menu-item-icon">
          <ProjectContextAssetMark
            className="desktop-project-mark"
            kind={resolveProjectContextAssetKind(folder.workspace)}
          />
        </span>
        <span className="desktop-menu-item-body">
          <bdi className="desktop-menu-item-label">{folder.name}</bdi>
          {detail ? (
            <Tooltip content={folder.workspace.path} overflowOnly><bdi
              className="desktop-menu-item-detail"
              dir="ltr"
            >
              {detail}
            </bdi></Tooltip>
          ) : null}
        </span>
      </div>
    </div>
  );
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
