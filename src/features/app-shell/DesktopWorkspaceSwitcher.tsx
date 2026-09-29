import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  Tooltip,
  createWorkspaceFolder,
  type Workspace,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";
import {
  ArrowLeft,
  ChevronRight,
  Cloud,
  FolderPlus,
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
  const [view, setView] = useState<"projects" | "add">("projects");
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
    if (!open || !multiRootWorkspacesEnabled) setView("projects");
  }, [multiRootWorkspacesEnabled, open]);
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
        className="desktop-project-menu"
        gap={4}
        onDismiss={onClose}
        open={open}
        preferredMaxHeight={520}
        preferredWidth={280}
      >
        {view === "projects" ? (
          <>
            <div
              className="desktop-project-overview"
              data-workspace-menu-layout="workspace-composition-v1"
            >
              <DesktopCurrentProjectLocation
                fallbackKind={workspaceContextAssetKind}
                fallbackLabel={workspaceContextAssetLabel}
                location={projectLocation}
                statusLabel={t(currentProjectLocationKind === "local"
                  ? "shell.workspaceSwitcher.location.online"
                  : "shell.workspaceSwitcher.location.available")}
              />
              {projectLocation && (
                <DesktopAlternateLocationAction
                  location={projectLocation}
                  onClose={onClose}
                  onSaveToLocal={onSaveToLocal}
                  onSetupCloud={onSetupCloud}
                  onSwitchToCloud={onSwitchToCloud}
                  onSwitchToLocal={onSwitchToLocal}
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
            <div className="desktop-project-home-group">
              <DesktopMenuItem
                className="desktop-project-add desktop-project-home"
                icon={<ArrowLeft className="po-directional-icon" size={15} strokeWidth={1.9} />}
                label={t("shell.workspaceSwitcher.goHome")}
                onClick={onGoHome}
              />
            </div>
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
  fallbackLabel,
  location,
  statusLabel,
}: {
  fallbackKind: "local" | "cloud";
  fallbackLabel: string;
  location?: DesktopProjectLocation;
  statusLabel: string;
}) {
  const kind = location?.current ?? fallbackKind;
  return (
    <div
      className="desktop-project-current-location"
      data-project-location={kind}
      role="status"
    >
      <ProjectLocationMark
        className="desktop-project-current-location-mark"
        kind={kind}
        size={16}
      />
      <span className="desktop-project-current-location-label">{fallbackLabel}</span>
      <span className="desktop-project-current-location-status">
        <span className="desktop-project-location-dot" aria-hidden="true" />
        <span>{statusLabel}</span>
      </span>
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

  if (location.current === "cloud") {
    const action = location.localAvailable ? onSwitchToLocal : onSaveToLocal;
    return (
      <DesktopMenuItem
        className="desktop-project-location-action"
        data-location-action={location.localAvailable ? "switch" : "save"}
        disabled={!action}
        icon={<Laptop size={16} strokeWidth={1.75} />}
        label={t(location.localAvailable
          ? "shell.workspaceSwitcher.location.thisMac"
          : "shell.workspaceSwitcher.location.saveToMac")}
        detail={location.localAvailable ? (
          <LocationAvailability label={t("shell.workspaceSwitcher.location.available")} />
        ) : undefined}
        trailing={<LocationActionVerb label={t(location.localAvailable
          ? "shell.workspaceSwitcher.location.switch"
          : "shell.workspaceSwitcher.location.save")} />}
        onClick={run(action)}
      />
    );
  }

  const restrainedCloudState = location.cloudState === "unavailable" || location.cloudState === "signed-out";
  const cloudSetupAction = location.cloudState === "unavailable"
    ? onSetupCloud
    : location.cloudState === "signed-out"
      ? onSwitchToCloud
      : undefined;
  if (restrainedCloudState) {
    return (
      <DesktopMenuItem
        className="desktop-project-location-action desktop-project-cloud-setup"
        data-location-action={location.cloudState === "unavailable" ? "setup" : "signed-out"}
        disabled={!cloudSetupAction}
        icon={<Cloud size={14} strokeWidth={1.75} />}
        label={t("shell.workspaceSwitcher.location.keepAvailable")}
        trailing={<ChevronRight className="po-directional-icon" size={12} strokeWidth={1.8} aria-hidden="true" />}
        onClick={run(cloudSetupAction)}
      />
    );
  }

  if (location.cloudState === "resolving") {
    return (
      <DesktopMenuItem
        className="desktop-project-location-action"
        data-location-action="resolving"
        disabled
        icon={<LoaderCircle className="animate-spin" size={16} strokeWidth={1.75} />}
        label={t("shell.workspaceSwitcher.location.cloud")}
        detail={t("shell.workspaceSwitcher.location.checking")}
      />
    );
  }

  const attention = location.cloudState === "attention";
  return (
    <DesktopMenuItem
      className="desktop-project-location-action"
      data-location-action={attention ? "attention" : "switch"}
      disabled={!onSwitchToCloud}
      icon={attention
        ? <TriangleAlert size={16} strokeWidth={1.75} />
        : <Cloud size={16} strokeWidth={1.75} />}
      label={t("shell.workspaceSwitcher.location.cloud")}
      detail={attention
        ? t("shell.workspaceSwitcher.location.needsAttention")
        : <LocationAvailability label={t("shell.workspaceSwitcher.location.available")} />}
      trailing={<LocationActionVerb label={t(attention
        ? "shell.workspaceSwitcher.location.open"
        : "shell.workspaceSwitcher.location.switch")} />}
      onClick={run(onSwitchToCloud)}
    />
  );
}

function LocationAvailability({ label }: { label: string }) {
  return (
    <span className="desktop-project-location-availability">
      <span className="desktop-project-location-dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

function LocationActionVerb({ label }: { label: string }) {
  return (
    <span className="desktop-project-location-action-verb">
      <span>{label}</span>
      <ChevronRight className="po-directional-icon" size={14} strokeWidth={1.8} aria-hidden="true" />
    </span>
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
