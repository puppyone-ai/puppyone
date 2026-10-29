import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createWorkspaceFolder, HomeIcon, type Workspace, type WorkspaceFolder } from "@puppyone/shared-ui";
import {
  ArrowLeft,
  Plus,
  FolderPlus,
} from "lucide-react";
import { DesktopMenuItem, DesktopMenuSeparator } from "../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../../components/DesktopTitlebarMenuLayer";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import {
  ProjectContextAssetMark,
  resolveProjectContextAssetKind,
} from "./ProjectContextAssetMark";
import { getWorkspaceParentPathForDisplay, type ProjectHomeItem } from "../../lib/workspaceHomeModel";
import { projectMatchesTarget, type ProjectNavigationTarget } from "./projectNavigation";
import { DesktopProjectMenuItem } from "./DesktopProjectMenuItem";

export type DesktopWorkspaceSwitcherProps = {
  open: boolean;
  refObject: RefObject<HTMLDivElement>;
  titlebarLabel: string;
  menuAlignment?: "start" | "center";
  workspace: Workspace;
  workspaceFolders: readonly WorkspaceFolder[];
  multiRootWorkspacesEnabled: boolean;
  availableProjects?: readonly Workspace[];
  projectItems?: readonly ProjectHomeItem[];
  pendingProject?: ProjectNavigationTarget | null;
  onAddExistingProject?: (folderPath: string) => void;
  onOpenFolder?: () => void;
  onClose: () => void;
  onToggle: () => void;
  onSelectProject?: (path: string) => void;
  onSelectCloudProject?: (projectId: string) => void;
  onCreateProject?: () => void;
  onHome?: () => void;
};

export function DesktopWorkspaceSwitcher({
  open,
  refObject,
  titlebarLabel,
  menuAlignment = "start",
  workspace,
  workspaceFolders,
  multiRootWorkspacesEnabled,
  availableProjects = [],
  projectItems,
  pendingProject,
  onAddExistingProject,
  onOpenFolder,
  onClose,
  onToggle,
  onSelectProject,
  onSelectCloudProject,
  onCreateProject,
  onHome,
}: DesktopWorkspaceSwitcherProps) {
  const { t } = useLocalization();
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
  // Without the account catalog, every entry is the project it names: a local
  // folder, or a Cloud project. A folder's Git remote never merges the two.
  const projects = useMemo<readonly ProjectHomeItem[]>(() => projectItems
    ?? [...new Map(availableProjects.map(project => [project.path, project])).values()].map(project => {
      const hosted = project.path.startsWith("puppyone-cloud:");
      return { id: project.id, label: project.name, localPath: hosted ? "" : project.path,
        ...(hosted && project.projectId ? { cloudProjectId: project.projectId } : {}) };
    }), [availableProjects, projectItems]);
  const currentCloudProjectId = workspace.path.startsWith("puppyone-cloud:") ? workspace.projectId : null;
  useEffect(() => {
    if (!open || (view === "add" && !multiRootWorkspacesEnabled)) setView("projects");
  }, [multiRootWorkspacesEnabled, open, view]);
  useEffect(() => {
    setView("projects");
  }, [workspace.path]);
  return (
    <div className="desktop-titlebar-workspace-wrap" ref={refObject}>
      <button
        type="button" ref={triggerRef} className="desktop-titlebar-workspace-button"
        aria-label={t("shell.workspaceSwitcher.openMenu", { workspace: bidiIsolate(workspace.name) })}
        aria-expanded={open} aria-haspopup="menu" onClick={() => { setView("projects"); onToggle(); }}>
        <HomeIcon className="desktop-titlebar-workspace-mark" size={16} strokeWidth={1.65} aria-hidden="true" />
        <bdi className="desktop-titlebar-workspace-name">{titlebarLabel}</bdi>
      </button>
      <DesktopTitlebarMenuLayer
        anchorRef={triggerRef}
        className="desktop-project-menu"
        gap={2}
        onDismiss={onClose}
        dismissOnFocusExit={false}
        open={open}
        preferredMaxHeight={520}
        preferredWidth={240}
        widthMode="fixed"
        alignment={menuAlignment}
        role="menu"
        ariaLabel={t("shell.workspaceSwitcher.projects")}
      >
        {view !== "add" ? (
          <>
            {onHome && <>
              <DesktopMenuItem icon={<ArrowLeft className="po-directional-icon" size={15} />} label={t("shell.workspaceSwitcher.home")}
                onClick={() => { onClose(); onHome(); }} />
              {projects.length > 0 && <DesktopMenuSeparator />}
            </>}
            <div className="desktop-project-list desktop-project-switcher-list" data-po-scrollbar="menu">
              {projects.map(project => {
                const selected = project.localPath === workspace.path
                  || Boolean(currentCloudProjectId && project.cloudProjectId === currentCloudProjectId);
                return <DesktopProjectMenuItem key={`${project.id}:${project.localPath}`}
                  project={project} selected={selected}
                  pending={projectMatchesTarget(project, pendingProject ?? null)}
                  onSelect={() => {
                    onClose();
                    if (selected && !pendingProject) return;
                    if (project.localPath) onSelectProject?.(project.localPath);
                    else if (project.cloudProjectId) onSelectCloudProject?.(project.cloudProjectId);
                  }} />;
              })}
            </div>
            {onCreateProject && <>
              {projects.length > 0 && <DesktopMenuSeparator />}
              <DesktopMenuItem icon={<Plus size={15} />} label={t("shell.workspaceSwitcher.createNew")}
                onClick={() => { onClose(); onCreateProject(); }} />
            </>}
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
                    <bdi dir="ltr">{getWorkspaceParentPathForDisplay(project.path)}</bdi>
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
            <bdi
              className="desktop-menu-item-detail"
              dir="ltr"
            >
              {detail}
            </bdi>
          ) : null}
        </span>
      </div>
    </div>
  );
}
