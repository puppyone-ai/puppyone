import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Tooltip,
  RENDERER_ASSET_PATHS,
  createWorkspaceFolder,
  resolveRendererPublicAssetUrl,
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
import {
  getProjectBackupSnapshot,
  type ProjectBackupProvider,
} from "./projectBackupProviders";
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
import { useProjectLocationMotion } from "./useProjectLocationMotion";

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
  backupProviders = [],
  backupStatus = null,
  availableProjects = [],
  onAddExistingProject,
  onOpenFolder,
  onClose,
  onViewLocal,
  onViewCloud,
  onToggle,
}: DesktopWorkspaceSwitcherProps) {
  const { t } = useLocalization();
  const [view, setView] = useState<"projects" | "add">("projects");
  const [projectMenuWidth, setProjectMenuWidth] = useState(248);
  const reserveProjectMenuWidth = useCallback((width: number) => setProjectMenuWidth(previous => Math.max(previous, width)), []);
  useEffect(() => { if (!open) setProjectMenuWidth(248); }, [open]);
  const localDeviceLabel = useProjectDeviceLabel();
  const currentProjectLocationKind = projectLocation?.current ?? "local";
  const workspaceContextAssetLabel = currentProjectLocationKind === "cloud"
    ? t("shell.workspaceSwitcher.location.cloud") : localDeviceLabel;
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
  useEffect(() => {
    if (!open || (view === "add" && !multiRootWorkspacesEnabled)) setView("projects");
  }, [multiRootWorkspacesEnabled, open, view]);
  useEffect(() => {
    setView("projects");
  }, [workspace.path]);
  return (
    <div className="desktop-titlebar-workspace-wrap" ref={refObject}>
      <Tooltip content={t("shell.workspaceSwitcher.projectTitle", {
          project: bidiIsolate(workspace.name),
        }) + ` · ${workspaceContextAssetLabel}`}><button
        className="desktop-titlebar-workspace-button local"
        type="button"
        aria-label={t("shell.workspaceSwitcher.openMenu", {
          workspace: bidiIsolate(workspace.name),
        }) + ` · ${workspaceContextAssetLabel}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setView("projects");
          onToggle();
        }}
      >
        <ProjectLocationMark
          className="desktop-titlebar-workspace-mark"
          kind={currentProjectLocationKind}
          size={16}
        />
        <bdi className="desktop-titlebar-workspace-name">{titlebarLabel}</bdi>
      </button></Tooltip>
      <DesktopTitlebarMenuLayer
        anchorRef={refObject}
        className="desktop-project-menu"
        gap={4}
        onDismiss={onClose}
        dismissOnFocusExit={false}
        open={open}
        preferredMaxHeight={520}
        preferredWidth={view === "add" ? 240 : projectMenuWidth}
        alignment={menuAlignment}
        role="dialog"
        ariaLabel={t("shell.workspaceSwitcher.projectDetails")}
      >
        {view !== "add" ? (
          <>
            <DesktopProjectLocationControls
              projectLocation={projectLocation}
              cloudProject={cloudProject ?? (workspace.puppyoneGitRemote?.projectId
                ? { id: workspace.puppyoneGitRemote.projectId } : undefined)}
              backupProviders={backupProviders}
              backupStatus={backupStatus}
              onViewLocal={onViewLocal}
              onViewCloud={onViewCloud}
              onDone={onClose}
              onPreferredWidthChange={reserveProjectMenuWidth}
            />
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

/** Shared by the project popover and Cloud header so switching is reversible. */
export function DesktopProjectLocationControls({
  projectLocation,
  cloudProject,
  backupProviders = [],
  backupStatus = null,
  onViewLocal,
  onViewCloud,
  onDone,
  onPreferredWidthChange,
}: {
  projectLocation?: DesktopProjectLocation;
  cloudProject?: DesktopProjectCloudCopy;
  backupProviders?: readonly ProjectBackupProvider[];
  backupStatus?: GitStatusSnapshot | null;
  onViewLocal?: () => void;
  onViewCloud?: () => void;
  onDone?: () => void;
  onPreferredWidthChange?: (width: number) => void;
}) {
  const { t } = useLocalization();
  const localDeviceLabel = useProjectDeviceLabel();
  const controlsRef = useRef<HTMLDivElement>(null);
  const current = projectLocation?.current ?? "local";
  const selection = projectLocation?.requested ?? current;
  const createCloud = shouldCreateCloud(projectLocation, cloudProject, Boolean(onViewCloud));
  const motion = useProjectLocationMotion(selection, `${localDeviceLabel}:${createCloud}:${projectLocation?.cloudState}:${t("shell.navigation.cloud")}`);
  const repositoryUrl = backupProviders.includes("github")
    ? getProjectBackupSnapshot(backupStatus, "github").repositoryUrl : null;
  // Measure translated labels with their actual themed font, preserving the
  // compact height while allowing longer device names to fit beside GitHub.
  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !onPreferredWidthChange) return undefined;
    const track = controls.querySelector<HTMLElement>(".desktop-project-location-tabs");
    const menu = controls.closest<HTMLElement>(".desktop-project-menu");
    if (!track || !menu) return undefined;
    const buttons = [...track.querySelectorAll<HTMLButtonElement>("button")];
    const labels = buttons.map(button => button.querySelector<HTMLElement>("span:last-child")!);
    const measure = () => {
      const pixels = (value: string) => parseFloat(value) || 0;
      const horizontalInsets = (element: HTMLElement) => {
        const style = getComputedStyle(element);
        return pixels(style.paddingLeft) + pixels(style.paddingRight)
          + pixels(style.borderLeftWidth) + pixels(style.borderRightWidth);
      };
      const buttonsWidth = buttons.reduce((width, button, index) => width
        + labels[index].scrollWidth + horizontalInsets(button)
        + (button.querySelector<HTMLElement>(".desktop-project-location-tab-mark")?.getBoundingClientRect().width ?? 0)
        + pixels(getComputedStyle(button).gap), 0);
      const repository = controls.querySelector<HTMLElement>(".desktop-project-repository-link");
      const width = buttonsWidth + horizontalInsets(track)
        + pixels(getComputedStyle(track).gap) * (buttons.length - 1)
        + (repository ? repository.getBoundingClientRect().width + pixels(getComputedStyle(controls).gap) : 0)
        + horizontalInsets(menu);
      onPreferredWidthChange(Math.max(248, Math.ceil(width)));
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    labels.forEach(label => observer?.observe(label));
    return () => observer?.disconnect();
  }, [createCloud, localDeviceLabel, onPreferredWidthChange, repositoryUrl, t]);
  const maskImage = `url("${resolveRendererPublicAssetUrl(RENDERER_ASSET_PATHS.icons.integrations.github)}")`;
  return (
    <div ref={controlsRef} className="desktop-project-location-controls"
      data-cloud-entry={createCloud ? "create" : "switch"}>
      <div ref={motion.trackRef} className="desktop-project-location-tabs" role="group"
        data-location={selection} data-indicator-ready={motion.measured || undefined}
        aria-busy={projectLocation?.loading || undefined}
        aria-label={t("shell.workspaceSwitcher.projectDetails")}>
        <span className="desktop-project-location-indicator" aria-hidden="true" style={motion.indicatorStyle} />
        {(["local", "cloud"] as const).map(location => <ProjectLocationTab key={location}
          location={location} current={current} selection={selection} createCloud={createCloud}
          localDeviceLabel={localDeviceLabel} projectLocation={projectLocation}
          onViewLocal={onViewLocal} onViewCloud={onViewCloud} />)}
      </div>
      {repositoryUrl && <Tooltip content={t("shell.workspaceSwitcher.openGitHubRepository")}><a
        className="desktop-project-repository-link"
        href={repositoryUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("shell.workspaceSwitcher.openGitHubRepository")}
        onClick={onDone}
      >
        <span className="desktop-project-github-mark" aria-hidden="true"
          style={{ maskImage, WebkitMaskImage: maskImage }} />
      </a></Tooltip>}
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
};

function ProjectLocationTab(props: LocationTabProps) {
  const { t } = useLocalization();
  const { location, current, selection, createCloud, localDeviceLabel, projectLocation, onViewLocal, onViewCloud } = props;
  const creating = location === "cloud" && createCloud;
  const selected = location === selection;
  const navigate = location === "local" ? onViewLocal : onViewCloud;
  const disabled = !selected && (!navigate || (location === "local" && projectLocation?.localAvailable === false));
  let label = localDeviceLabel;
  if (location === "cloud") {
    let key = "shell.navigation.cloud";
    if (creating) key = "shell.workspaceSwitcher.createCloudVersion";
    else if (projectLocation?.cloudState === "signed-out") key = "shell.workspaceSwitcher.location.signInToAccess";
    label = t(key);
  }
  return <Tooltip content={t(getLocationTabTooltip(props))}><button
    className="desktop-project-location-tab" type="button" data-project-location={location}
    data-cloud-action={creating ? "create" : undefined}
    aria-pressed={creating ? undefined : selected}
    aria-current={location === current ? "true" : undefined}
    data-cloud-pending={location === "cloud" && projectLocation?.loading || undefined}
    disabled={disabled} onClick={() => { if (!selected) navigate?.(); }}>
    <ProjectLocationMark className="desktop-project-location-tab-mark" kind={location} creating={creating} size={14} />
    <span>{label}</span>
  </button></Tooltip>;
}

function getLocationTabTooltip({ location, selection, projectLocation, createCloud }: LocationTabProps) {
  if (location === selection) {
    if (projectLocation?.loading) return "shell.workspaceSwitcher.location.checking";
    return "shell.workspaceSwitcher.current";
  }
  if (location === "local") return "shell.surface.switchToLocal";
  if (createCloud) return "shell.workspaceSwitcher.createCloudVersion";
  if (projectLocation?.cloudState === "resolving") return "shell.workspaceSwitcher.location.checking";
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
