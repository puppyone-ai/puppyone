import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createWorkspaceFolder, type Workspace, type WorkspaceFolder } from "@puppyone/shared-ui";
import {
  ArrowLeft,
  Plus,
  FolderPlus,
  House,
  Check,
} from "lucide-react";
import { DesktopMenuItem, DesktopMenuSeparator } from "../../components/DesktopMenu";
import { HomeProjectIcon } from "../../components/onboarding/HomeProjectIcon";
import { DesktopTitlebarMenuLayer } from "./DesktopTitlebarMenuLayer";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import {
  ProjectContextAssetMark,
  resolveProjectContextAssetKind,
} from "./ProjectContextAssetMark";
import { getProjectName, getWorkspaceParentPathForDisplay, type ProjectHomeItem } from "./workspaceHomeModel";

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
  const projects = useMemo(() => projectItems ?? [...new Map(availableProjects.map(project => [project.path, project])).values()]
    .map(project => ({ id: project.id, label: project.name,
      localPath: project.path.startsWith("puppyone-cloud:") ? "" : project.path,
      cloudProjectId: project.puppyoneGitRemote?.projectId ?? project.projectId ?? undefined })), [availableProjects, projectItems]);
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
        <House className="desktop-titlebar-workspace-mark" size={16} strokeWidth={1.65} aria-hidden="true" />
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
        preferredWidth={view === "add" ? 240 : 248}
        widthMode={view === "add" ? "fixed" : "content"}
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
                return <DesktopMenuItem key={project.id}
                  icon={<HomeProjectIcon item={project} />}
                  label={<bdi>{getProjectName(project, t("onboarding.projects.untitled"))}</bdi>} selected={selected}
                  aria-current={selected ? "page" : undefined}
                  trailing={selected ? <Check size={14} /> : undefined}
                  onClick={() => {
                    onClose();
                    if (selected) return;
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
