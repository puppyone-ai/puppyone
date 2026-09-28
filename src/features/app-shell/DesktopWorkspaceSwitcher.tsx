import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  Tooltip,
  createWorkspaceFolder,
  type Workspace,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";
import { ArrowLeft, Cloud, FolderPlus, Laptop } from "lucide-react";
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
  onToggle: () => void;
};

export type DesktopProjectLocation = Readonly<{
  kind: "local" | "cloud";
  label: string;
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
  onToggle,
}: DesktopWorkspaceSwitcherProps) {
  const { t } = useLocalization();
  const [view, setView] = useState<"projects" | "add">("projects");
  const workspaceContextAssetKind = resolveProjectContextAssetKind(workspace);
  const workspaceContextAssetLabel = projectLocation?.label ?? t(workspaceContextAssetKind === "cloud"
    ? "shell.workspaceSwitcher.contextAssetCloud"
    : "shell.workspaceSwitcher.contextAssetLocal");
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
        {projectLocation ? (
          <ProjectLocationMark
            className="desktop-titlebar-workspace-mark"
            kind={projectLocation.kind}
            size={14}
          />
        ) : (
          <ProjectContextAssetMark
            className="desktop-titlebar-workspace-mark"
            kind={workspaceContextAssetKind}
            size={14}
          />
        )}
        <bdi className="desktop-titlebar-workspace-name">{titlebarLabel}</bdi>
      </button></Tooltip>

      <DesktopTitlebarMenuLayer
        anchorRef={refObject}
        className="desktop-project-menu"
        gap={4}
        onDismiss={onClose}
        open={open}
        preferredMaxHeight={520}
      >
        {view === "projects" ? (
          <>
            <div className="desktop-project-home-group">
              <DesktopMenuItem
                className="desktop-project-add desktop-project-home"
                icon={<ArrowLeft className="po-directional-icon" size={15} strokeWidth={1.9} />}
                label={t("shell.workspaceSwitcher.home")}
                onClick={onGoHome}
              />
            </div>
            <div
              className="desktop-project-list"
              data-po-scrollbar="menu"
              data-workspace-menu-layout="workspace-composition-v1"
            >
              {attachedFolders.map((folder, index) => (
                <DesktopProjectRow
                  key={folder.id}
                  folder={folder}
                  projectLocation={index === 0 ? projectLocation : undefined}
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
          </>
        ) : (
          <>
            <div className="desktop-project-home-group">
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
  projectLocation,
}: {
  folder: WorkspaceFolder;
  projectLocation?: DesktopProjectLocation;
}) {
  const detail = getWorkspaceParentPathForDisplay(folder.workspace.path);
  return (
    <div className="desktop-project-option-row">
      <div
        className="desktop-menu-item desktop-project-option"
        role="menuitem"
        aria-disabled="true"
        data-project-location={projectLocation?.kind}
      >
        <span className="desktop-menu-item-icon">
          {projectLocation ? (
            <ProjectLocationMark
              className="desktop-project-mark"
              kind={projectLocation.kind}
            />
          ) : (
            <ProjectContextAssetMark
              className="desktop-project-mark"
              kind={resolveProjectContextAssetKind(folder.workspace)}
            />
          )}
        </span>
        <span className="desktop-menu-item-body">
          <bdi className="desktop-menu-item-label">{folder.name}</bdi>
          {projectLocation ? (
            <span className="desktop-menu-item-detail desktop-project-location-label">
              {projectLocation.label}
            </span>
          ) : detail ? (
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
}: {
  className: string;
  kind: DesktopProjectLocation["kind"];
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
