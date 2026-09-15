import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  createWorkspaceFolder,
  type Workspace,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";
import { ArrowLeft, FolderPlus } from "lucide-react";
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
  availableProjects?: readonly Workspace[];
  cloudEnabled?: boolean;
  cloudOpen?: boolean;
  onAddExistingProject?: (folderPath: string) => void;
  onOpenCloud?: () => void;
  onOpenFolder?: () => void;
  onClose: () => void;
  onGoHome: () => void;
  onToggle: () => void;
};

export function DesktopWorkspaceSwitcher({
  open,
  refObject,
  titlebarLabel,
  workspace,
  workspaceFolders,
  multiRootWorkspacesEnabled,
  availableProjects = [],
  cloudEnabled = false,
  cloudOpen = false,
  onAddExistingProject,
  onOpenCloud,
  onOpenFolder,
  onClose,
  onGoHome,
  onToggle,
}: DesktopWorkspaceSwitcherProps) {
  const { t } = useLocalization();
  const [view, setView] = useState<"projects" | "add">("projects");
  const workspaceContextAssetKind = resolveProjectContextAssetKind(workspace);
  const workspaceContextAssetLabel = t(workspaceContextAssetKind === "cloud"
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
      <button
        className="desktop-titlebar-workspace-button local"
        type="button"
        aria-label={t("shell.workspaceSwitcher.openMenu", {
          workspace: bidiIsolate(workspace.name),
        }) + ` · ${workspaceContextAssetLabel}`}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t("shell.workspaceSwitcher.projectTitle", {
          project: bidiIsolate(workspace.name),
        }) + ` · ${workspaceContextAssetLabel}`}
        onClick={onToggle}
      >
        <ProjectContextAssetMark
          className="desktop-titlebar-workspace-mark"
          kind={workspaceContextAssetKind}
          size={14}
        />
        <bdi className="desktop-titlebar-workspace-name">{titlebarLabel}</bdi>
      </button>

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
              {attachedFolders.map((folder) => (
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
              {cloudEnabled && onOpenCloud && (
                <DesktopMenuItem
                  className="desktop-project-cloud"
                  icon={<ProjectContextAssetMark kind="cloud" size={15} />}
                  label={t("shell.navigation.cloud")}
                  aria-haspopup="dialog"
                  aria-expanded={cloudOpen}
                  onClick={() => {
                    onClose();
                    onOpenCloud();
                  }}
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
                  detail={getWorkspaceParentPathForDisplay(project.path)}
                  icon={(
                    <ProjectContextAssetMark
                      className="desktop-project-mark"
                      kind={resolveProjectContextAssetKind(project)}
                    />
                  )}
                  key={project.id}
                  label={<bdi>{project.name}</bdi>}
                  onClick={() => onAddExistingProject?.(project.path)}
                  title={`${project.name} - ${project.path}`}
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
        title={`${folder.name} - ${folder.workspace.path}`}
      >
        <span className="desktop-menu-item-icon">
          <ProjectContextAssetMark
            className="desktop-project-mark"
            kind={resolveProjectContextAssetKind(folder.workspace)}
          />
        </span>
        <span className="desktop-menu-item-body">
          <bdi className="desktop-menu-item-label">{folder.name}</bdi>
          {detail && (
            <bdi
              className="desktop-menu-item-detail"
              dir="ltr"
              title={folder.workspace.path}
            >
              {detail}
            </bdi>
          )}
        </span>
      </div>
    </div>
  );
}
