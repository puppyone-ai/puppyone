import { useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import {
  Tooltip,
  createWorkspaceFolder,
  type Workspace,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Cloud,
  FolderPlus,
  GitBranch,
  Laptop,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { DesktopMenuItem } from "../../components/DesktopMenu";
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
  branchMenu?: { label: string; disabled: boolean; content: ReactNode };
  workspace: Workspace;
  workspaceFolders: readonly WorkspaceFolder[];
  multiRootWorkspacesEnabled: boolean;
  projectLocation?: DesktopProjectLocation;
  availableProjects?: readonly Workspace[];
  onAddExistingProject?: (folderPath: string) => void;
  onOpenFolder?: () => void;
  onClose: () => void;
  onGoHome: () => void;
  onSaveToLocal?: () => void;
  onSetupCloud?: () => void;
  onSwitchToCloud?: () => void;
  onSwitchToLocal?: () => void;
  onToggle: () => void;
};

export type DesktopProjectLocation = Readonly<{
  current: "local" | "cloud";
  localAvailable: boolean;
  cloudState: "unavailable" | "available" | "signed-out" | "resolving" | "attention";
}>;

export function DesktopWorkspaceSwitcher({
  open,
  refObject,
  titlebarLabel,
  menuAlignment = "start",
  branchMenu,
  workspace,
  workspaceFolders,
  multiRootWorkspacesEnabled,
  projectLocation,
  availableProjects = [],
  onAddExistingProject,
  onOpenFolder,
  onClose,
  onGoHome,
  onSaveToLocal,
  onSetupCloud,
  onSwitchToCloud,
  onSwitchToLocal,
  onToggle,
}: DesktopWorkspaceSwitcherProps) {
  const { t } = useLocalization();
  const [view, setView] = useState<"projects" | "add" | "branches">("projects");
  const workspaceContextAssetKind = resolveProjectContextAssetKind(workspace);
  const currentProjectLocationKind = projectLocation?.current ?? workspaceContextAssetKind;
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
        aria-haspopup="menu"
        onClick={onToggle}
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
        className={`desktop-project-menu${view === "branches" ? " desktop-branch-menu" : ""}`}
        gap={4}
        onDismiss={onClose}
        open={open}
        preferredMaxHeight={view === "branches" ? 440 : 520}
        preferredWidth={240}
        alignment={menuAlignment}
      >
        {view === "projects" ? (
          <>
            <div className="desktop-project-home-group">
              <DesktopMenuItem
                className="desktop-project-add desktop-project-home"
                icon={<ArrowLeft className="po-directional-icon" size={15} strokeWidth={1.9} />}
                label={t("shell.workspaceSwitcher.goHome")}
                onClick={onGoHome}
              />
            </div>
            <div
              className="desktop-project-overview"
              data-workspace-menu-layout="workspace-composition-v1"
            >
              <DesktopCurrentProjectLocation
                fallbackKind={workspaceContextAssetKind}
                location={projectLocation}
                path={workspace.path}
              />
              {branchMenu && (
                <DesktopMenuItem
                  className="desktop-project-branch"
                  icon={<GitBranch size={15} strokeWidth={1.8} />}
                  aria-label={t("shell.branch.title", { branch: bidiIsolate(branchMenu.label) })}
                  label={<bdi>{branchMenu.label}</bdi>}
                  trailing={<ChevronDown size={12} aria-hidden="true" />}
                  disabled={branchMenu.disabled}
                  onClick={() => setView("branches")}
                />
              )}
            </div>
            {(attachedFolders.length > 1 || multiRootWorkspacesEnabled) && (
              <div className="desktop-project-list" data-po-scrollbar="menu">
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
            {projectLocation && (
              <div className="desktop-project-location-actions">
                <DesktopAlternateLocationAction
                  location={projectLocation}
                  onClose={onClose}
                  onSaveToLocal={onSaveToLocal}
                  onSetupCloud={onSetupCloud}
                  onSwitchToCloud={onSwitchToCloud}
                  onSwitchToLocal={onSwitchToLocal}
                />
              </div>
            )}
          </>
        ) : view === "branches" ? (
          <>
            <div className="desktop-project-back-group">
              <DesktopMenuItem
                icon={<ArrowLeft className="po-directional-icon" size={15} strokeWidth={1.9} />}
                label={<bdi>{titlebarLabel}</bdi>}
                onClick={() => setView("projects")}
              />
            </div>
            {branchMenu?.content}
          </>
        ) : (
          <>
            <div className="desktop-project-back-group">
              <DesktopMenuItem
                className="desktop-project-add desktop-project-home"
                icon={<ArrowLeft className="po-directional-icon" size={15} strokeWidth={1.9} />}
                label={t("shell.workspaceSwitcher.projects")}
                onClick={() => setView("projects")}
              />
            </div>
            <div className="desktop-project-list" data-po-scrollbar="menu">
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

function DesktopCurrentProjectLocation({
  fallbackKind,
  location,
  path,
}: {
  fallbackKind: "local" | "cloud";
  location?: DesktopProjectLocation;
  path: string;
}) {
  const { t } = useLocalization();
  const kind = location?.current ?? fallbackKind;
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const parentPath = separatorIndex > 0 ? path.slice(0, separatorIndex) : "";
  const folderName = separatorIndex > 0 ? path.slice(separatorIndex) : path;
  return (
    <div
      className="desktop-project-current-location"
      data-project-location={kind}
      role="status"
    >
      <span className="desktop-project-current-location-icon">
        <ProjectLocationMark
          className="desktop-project-current-location-mark"
          kind={kind}
          size={24}
        />
        <span className="desktop-project-location-dot" aria-hidden="true" />
      </span>
      {kind === "local" ? (
        <Tooltip content={path}>
          <bdi className="desktop-project-current-location-path" dir="ltr" aria-label={path}>
            <span className="desktop-project-path-parent" aria-hidden="true">{parentPath}</span>
            <span className="desktop-project-path-name" aria-hidden="true">{folderName}</span>
          </bdi>
        </Tooltip>
      ) : (
        <span className="desktop-project-current-location-label">{t("shell.workspaceSwitcher.location.inCloud")}</span>
      )}
    </div>
  );
}

function DesktopAlternateLocationAction({
  location,
  onClose,
  onSaveToLocal,
  onSetupCloud,
  onSwitchToCloud,
  onSwitchToLocal,
}: {
  location: DesktopProjectLocation;
  onClose: () => void;
  onSaveToLocal?: () => void;
  onSetupCloud?: () => void;
  onSwitchToCloud?: () => void;
  onSwitchToLocal?: () => void;
}) {
  const { t } = useLocalization();
  const run = (action?: () => void) => () => {
    if (!action) return;
    onClose();
    action();
  };

  const isCloud = location.current === "cloud";
  const state = isCloud
    ? location.localAvailable ? "switch-local" : "save"
    : location.cloudState === "unavailable" ? "setup"
      : location.cloudState === "available" ? "switch"
        : location.cloudState;
  const action = isCloud
    ? location.localAvailable ? onSwitchToLocal : onSaveToLocal
    : state === "setup" ? onSetupCloud
      : state === "resolving" ? undefined : onSwitchToCloud;
  const label = t(`shell.workspaceSwitcher.location.${{
    "switch-local": "switchToMac",
    save: "saveToMac",
    setup: "deployToCloud",
    switch: "switchToCloud",
    "signed-out": "openCloud",
    attention: "openCloud",
    resolving: "checking",
  }[state]}`);
  const Icon = isCloud ? Laptop
    : state === "resolving" ? LoaderCircle
      : state === "attention" ? TriangleAlert : Cloud;
  return (
    <DesktopMenuItem
      className="desktop-project-location-action"
      data-location-action={state}
      disabled={!action}
      icon={<Icon className={state === "resolving" ? "animate-spin" : undefined} size={14} strokeWidth={1.75} />}
      label={label}
      trailing={<ChevronRight className="po-directional-icon" size={12} aria-hidden="true" />}
      tooltip={state === "attention" ? t("shell.workspaceSwitcher.location.needsAttention") : label}
      onClick={run(action)}
    />
  );
}

function ProjectLocationMark({
  className,
  kind,
  size = 15,
}: {
  className: string;
  kind: DesktopProjectLocation["current"];
  size?: number;
}) {
  const Icon = kind === "cloud" ? Cloud : Laptop;
  return (
    <span
      className={`desktop-project-location-mark ${className}`}
      data-project-location={kind}
      aria-hidden="true"
    >
      <Icon size={size} strokeWidth={1.75} />
    </span>
  );
}
