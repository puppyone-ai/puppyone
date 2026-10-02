import { useEffect, useMemo, useState, type RefObject } from "react";
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
  Cloud,
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
import {
  ProjectContextAssetMark,
  resolveProjectContextAssetKind,
} from "./ProjectContextAssetMark";
import { getWorkspaceParentPathForDisplay } from "./workspaceHomeModel";

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
  const currentProjectLocationKind = projectLocation?.current ?? "local";
  const workspaceContextAssetLabel = t(currentProjectLocationKind === "cloud"
    ? "shell.workspaceSwitcher.location.cloud"
    : "shell.workspaceSwitcher.location.thisMac");
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
        open={open}
        preferredMaxHeight={520}
        preferredWidth={view === "add" ? 240 : 248}
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
}: {
  projectLocation?: DesktopProjectLocation;
  cloudProject?: DesktopProjectCloudCopy;
  backupProviders?: readonly ProjectBackupProvider[];
  backupStatus?: GitStatusSnapshot | null;
  onViewLocal?: () => void;
  onViewCloud?: () => void;
  onDone?: () => void;
}) {
  const { t } = useLocalization();
  const current = projectLocation?.current ?? "local";
  const cloudLinked = current === "cloud" || Boolean(cloudProject?.id)
    || projectLocation?.cloudState === "available" || projectLocation?.cloudState === "signed-out";
  const createCloud = !cloudLinked && Boolean(onViewCloud)
    && (!projectLocation || projectLocation.cloudState === "unavailable");
  const repositoryUrl = backupProviders.includes("github")
    ? getProjectBackupSnapshot(backupStatus, "github").repositoryUrl : null;
  const maskImage = `url("${resolveRendererPublicAssetUrl(RENDERER_ASSET_PATHS.icons.integrations.github)}")`;
  return (
    <div className="desktop-project-location-controls" data-cloud-entry={createCloud ? "create" : "switch"}>
      <div className="desktop-project-location-tabs" role="group"
        aria-label={t("shell.workspaceSwitcher.projectDetails")}>
        {(["local", "cloud"] as const).map((location) => {
          const creating = location === "cloud" && createCloud;
          const selected = location === current;
          const navigate = location === "local" ? onViewLocal : onViewCloud;
          const disabled = !selected && (!navigate || (location === "local"
            ? projectLocation?.localAvailable === false
            : projectLocation?.cloudState === "resolving"));
          const tooltip = selected ? t("shell.workspaceSwitcher.current")
            : creating ? t("shell.workspaceSwitcher.createCloudVersion")
              : location === "cloud" && projectLocation?.cloudState === "resolving"
                ? t("shell.workspaceSwitcher.location.checking")
                : t(location === "local" ? "shell.surface.switchToLocal" : "shell.surface.switchToCloud");
          return <Tooltip content={tooltip} key={location}><button
            className="desktop-project-location-tab"
            type="button"
            data-project-location={location}
            data-cloud-action={creating ? "create" : undefined}
            aria-pressed={creating ? undefined : selected}
            aria-current={selected ? "true" : undefined}
            disabled={disabled}
            onClick={() => {
              onDone?.();
              if (!selected) navigate?.();
            }}
          >
            <ProjectLocationMark className="desktop-project-location-tab-mark" kind={location} size={14} />
            <span>{t(creating ? "shell.workspaceSwitcher.createCloudVersion"
              : location === "local" ? "shell.navigation.local" : "shell.navigation.cloud")}</span>
          </button></Tooltip>;
        })}
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

function ProjectLocationMark({
  className,
  kind,
  size = 15,
  strokeWidth = 1.75,
}: {
  className: string;
  kind: DesktopProjectLocation["current"];
  size?: number;
  strokeWidth?: number;
}) {
  const Icon = kind === "cloud" ? Cloud : Laptop;
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
