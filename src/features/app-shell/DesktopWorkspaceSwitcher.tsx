import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { CloudIcon, createWorkspaceFolder, FolderIcon, LocalIcon, type Workspace, type WorkspaceFolder } from "@puppyone/shared-ui";
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
import { getWorkspaceParentPathForDisplay, type CloudSpace, type ProjectHomeItem } from "../../lib/workspaceHomeModel";
import { useDesktopPlatformCapabilities } from "../../platform";
import { SpaceMark, useSpaceName } from "../cloud";
import { projectMatchesTarget } from "./window-project/projectNavigation";
import type { ProjectTarget } from "./window-project/windowProjectStore";
import { DesktopProjectMenuItem } from "./DesktopProjectMenuItem";
import { groupProjectsByPlace, projectMenuGroupsInPlace, projectMenuGroupsNeedHeadings, type ProjectMenuGroup, type ProjectMenuPlace } from "./projectMenuGroups";

const NO_SPACES: readonly CloudSpace[] = [];

export type DesktopWorkspaceSwitcherProps = {
  open: boolean;
  refObject: RefObject<HTMLDivElement>;
  titlebarLabel: string;
  workspace: Workspace;
  workspaceFolders: readonly WorkspaceFolder[];
  multiRootWorkspacesEnabled: boolean;
  availableProjects?: readonly Workspace[];
  projectItems?: readonly ProjectHomeItem[];
  /** Every Space this account reaches; the menu lists Cloud projects under the Space that holds them. */
  spaces?: readonly CloudSpace[];
  /** The open folder's place; the menu then lists only its folders. Absent, it lists every place's. */
  place?: ProjectMenuPlace;
  pendingProject?: ProjectTarget | null;
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
  workspace,
  workspaceFolders,
  multiRootWorkspacesEnabled,
  availableProjects = [],
  projectItems,
  spaces = NO_SPACES,
  place,
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
  const groups = useMemo(() => {
    const all = groupProjectsByPlace(projects, spaces);
    return place ? projectMenuGroupsInPlace(all, place) : all;
  }, [place, projects, spaces]);
  const headings = !place && projectMenuGroupsNeedHeadings(groups);
  const listed = groups.some((group) => group.items.length > 0);
  const platform = useDesktopPlatformCapabilities();
  const spaceName = useSpaceName();
  const groupName = (group: ProjectMenuGroup) => {
    if (group.kind === "space") return spaceName(group.space);
    if (group.kind === "cloud") return t("cloud.home.location.cloud");
    return t(platform?.platform === "macos" ? "shell.workspaceSwitcher.location.thisMac" : "shell.workspaceSwitcher.location.thisComputer");
  };
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
        <FolderIcon className="desktop-titlebar-workspace-mark" size={16} strokeWidth={1.65} aria-hidden="true" />
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
        role="menu"
        ariaLabel={t("shell.workspaceSwitcher.projects")}
      >
        {view !== "add" ? (
          <>
            {onHome && <>
              <DesktopMenuItem icon={<ArrowLeft className="po-directional-icon" size={15} />} label={t("shell.workspaceSwitcher.home")}
                onClick={() => { onClose(); onHome(); }} />
              {listed && <DesktopMenuSeparator />}
            </>}
            <div className="desktop-project-list desktop-project-switcher-list" data-po-scrollbar="menu">
              {groups.map(group => {
                const rows = group.items.map(project => {
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
                });
                if (!headings) return rows;
                const key = group.kind === "space" ? `space:${group.space.id}` : group.kind;
                const name = groupName(group);
                return <div key={key} className="desktop-project-menu-group" role="group" aria-label={name}
                  data-project-menu-group={group.kind}>
                  <div className="desktop-project-menu-group-label" aria-hidden="true">
                    {group.kind === "space" && <SpaceMark space={group.space} size="sm" />}
                    {group.kind === "local" && <LocalIcon size={12} strokeWidth={1.8} />}
                    {group.kind === "cloud" && <CloudIcon size={12} strokeWidth={1.8} />}
                    <bdi>{name}</bdi>
                  </div>
                  {rows}
                </div>;
              })}
            </div>
            {onCreateProject && <>
              {listed && <DesktopMenuSeparator />}
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
