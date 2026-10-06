import { Tooltip } from "@puppyone/shared-ui";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Workspace } from "@puppyone/shared-ui";
import { ArrowLeft, FolderPlus, Plus } from "lucide-react";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import {
  getProjectAppearanceIdentity,
  useProjectAppearanceCatalog,
} from "../project-appearance/useProjectAppearanceCatalog";
import { HomeProjectIcon } from "../../components/onboarding/HomeProjectIcon";
import {
  DesktopSidebarPluginsButton,
  DesktopSidebarSettingsButton,
} from "./navigation/DesktopNavigationItems";
import type { DesktopView } from "../../components/DesktopCloudShell";
import { beginProjectRootDrag } from "./projectRootDrag";
import {
  ProjectRowActions,
  type ProjectActionSurface,
} from "./ProjectRowActions";
export {
  DEFAULT_PROJECT_SWITCHER_EXPANDED_WIDTH,
  MAX_PROJECT_SWITCHER_EXPANDED_WIDTH,
  MIN_PROJECT_SWITCHER_EXPANDED_WIDTH,
  PROJECT_SWITCHER_RAIL_COLLAPSED_WIDTH,
  resolveProjectSwitcherCompactWidth,
  resolveProjectSwitcherRailWidth,
} from "./projectSwitcherRailGeometry";
import { getProjectName, type ProjectHomeItem, type RecentWorkspaceHomeItem } from "./workspaceHomeModel";

export type ProjectSwitcherRailItem = Readonly<{
  item: ProjectHomeItem;
  workspace: Workspace | null;
  initial: string;
  appearanceIdentity: string | null;
}>;

type ProjectActionSession = Readonly<{
  projectPath: string;
  surface: Exclude<ProjectActionSurface, null>;
}>;

type ProjectSwitcherRailProps = Readonly<{
  activeView?: DesktopView;
  activeWorkspace: Workspace;
  activeCloudProjectId?: string | null;
  expanded?: boolean;
  recentWorkspaces: readonly RecentWorkspaceHomeItem[];
  projectItems: readonly ProjectHomeItem[];
  onHome?: () => void;
  onAddProject?: () => void;
  onCreateNew: () => void;
  onOpenPlugins?: () => void;
  onOpenSettings?: () => void;
  onRenameProject?: (path: string, name: string) => Promise<void>;
  pluginsOpen?: boolean;
  settingsOpen?: boolean;
  onSelectProject: (path: string) => void | Promise<void>;
  onSelectCloudProject?: (projectId: string) => void | Promise<void>;
  onUnlinkProject?: (path: string) => Promise<void>;
  utilitySlot?: ReactNode;
}>;

/**
 * Shell-owned navigation over the same account-scoped catalog as Homepage.
 * Local workspace DTOs supply appearance/actions, never hosted-only paths.
 */
export function ProjectSwitcherRail({
  activeView = "data",
  activeWorkspace,
  activeCloudProjectId,
  expanded = false,
  recentWorkspaces,
  projectItems,
  onHome,
  onAddProject,
  onCreateNew,
  onOpenPlugins,
  onOpenSettings,
  onRenameProject,
  pluginsOpen = false,
  settingsOpen = false,
  onSelectProject,
  onSelectCloudProject,
  onUnlinkProject,
  utilitySlot,
}: ProjectSwitcherRailProps) {
  const { t } = useLocalization();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failedAvatarUrls, setFailedAvatarUrls] = useState<ReadonlySet<string>>(() => new Set());
  const [projectActionSession, setProjectActionSession] = useState<ProjectActionSession | null>(null);
  const queuedProjectRef = useRef<ProjectHomeItem | null>(null);
  const switchInFlightRef = useRef(false);
  const projectCatalog = useMemo(
    () => resolveProjectSwitcherRailItems(activeWorkspace, recentWorkspaces, projectItems),
    [activeWorkspace, recentWorkspaces, projectItems],
  );
  const [projectOrder, setProjectOrder] = useState<readonly string[]>(
    () => projectCatalog.map(({ item }) => item.id),
  );
  const nextProjectOrder = useMemo(
    () => mergeProjectSwitcherRailOrder(projectOrder, projectCatalog),
    [projectCatalog, projectOrder],
  );
  const projects = useMemo(() => {
    const projectsById = new Map(
      projectCatalog.map((project) => [project.item.id, project]),
    );
    return nextProjectOrder.flatMap((id) => {
      const project = projectsById.get(id);
      return project ? [project] : [];
    });
  }, [nextProjectOrder, projectCatalog]);
  const appearanceWorkspaces = useMemo(
    () => projectCatalog.flatMap(({ workspace }) => workspace ? [workspace] : []),
    [projectCatalog],
  );
  const appearanceCatalog = useProjectAppearanceCatalog(appearanceWorkspaces);

  useEffect(() => {
    if (nextProjectOrder !== projectOrder) setProjectOrder(nextProjectOrder);
  }, [nextProjectOrder, projectOrder]);

  useEffect(() => {
    setProjectActionSession((current) => {
      if (!current) return null;
      if (!expanded) return null;
      return projects.some(({ item }) => item.localPath === current.projectPath)
        ? current
        : null;
    });
  }, [expanded, projects]);

  const changeProjectActionSurface = (
    projectPath: string,
    surface: ProjectActionSurface,
  ) => {
    setProjectActionSession((current) => {
      if (surface === null) {
        return current?.projectPath === projectPath ? null : current;
      }
      return { projectPath, surface };
    });
  };

  const currentCloudProjectId = activeCloudProjectId
    ?? (activeWorkspace.path.startsWith("puppyone-cloud:") ? activeWorkspace.projectId : null);
  const isActiveProject = (project: ProjectHomeItem) => currentCloudProjectId
    ? project.cloudProjectId === currentCloudProjectId
    : project.localPath === activeWorkspace.path;
  const selectProject = async (project: ProjectHomeItem) => {
    if (
      (isActiveProject(project) && activeView !== "settings")
      || project.id === pendingId
    ) return;
    setProjectActionSession(null);
    queuedProjectRef.current = project;
    setPendingId(project.id);
    if (switchInFlightRef.current) return;

    switchInFlightRef.current = true;
    try {
      while (queuedProjectRef.current) {
        const nextProject = queuedProjectRef.current;
        queuedProjectRef.current = null;
        if (nextProject.localPath) await onSelectProject(nextProject.localPath);
        else if (nextProject.cloudProjectId) await onSelectCloudProject?.(nextProject.cloudProjectId);
      }
    } finally {
      switchInFlightRef.current = false;
      setPendingId(null);
    }
  };

  return (
    <nav
      className="desktop-project-switcher-rail"
      aria-label={t("shell.workspaceSwitcher.projects")}
      data-expanded={expanded ? "true" : "false"}
      data-window-no-drag="true"
    >
      <div
        className="desktop-project-switcher-rail-list po-sidebar-list"
        data-po-scrollbar="sidebar"
      >
        {onHome && <Tooltip content={expanded ? undefined : t("shell.workspaceSwitcher.home")} placement="right"><button
          className={`desktop-project-switcher-rail-button desktop-project-switcher-rail-home${expanded ? " po-sidebar-row" : ""}`}
          type="button"
          aria-label={t("shell.workspaceSwitcher.home")}
          onClick={() => { setProjectActionSession(null); onHome(); }}
        >
          <span className="desktop-project-switcher-rail-avatar desktop-project-switcher-rail-context-avatar" aria-hidden="true">
            <ArrowLeft className="po-directional-icon" size={15} />
          </span>
          {expanded && <span className="desktop-project-switcher-rail-label po-sidebar-row__label">{t("shell.workspaceSwitcher.home")}</span>}
        </button></Tooltip>}
        {projects.map(({ item, workspace, initial, appearanceIdentity }) => {
          const active = activeView !== "settings" && isActiveProject(item);
          const name = getProjectName(item, t("onboarding.projects.untitled"));
          const contextAssetKind = item.localPath ? item.cloudProjectId ? "linked" : "local" : "cloud";
          const contextAssetLabel = [
            ...(item.localPath ? [t("shell.workspaceSwitcher.contextAssetLocal")] : []),
            ...(item.cloudProjectId ? [t("shell.workspaceSwitcher.contextAssetCloud")] : []),
          ].join(" + ");
          const appearance = appearanceIdentity
            ? appearanceCatalog.appearances.get(appearanceIdentity)
            : null;
          const assetUrl = appearance?.icon?.kind === "asset" ? appearance.icon.url : null;
          const imageUrl = assetUrl && !failedAvatarUrls.has(assetUrl) ? assetUrl : null;
          const emoji = appearance?.icon?.kind === "emoji" ? appearance.icon.value : null;
          const avatarHasText = !imageUrl && !emoji;
          const label = `${t("shell.workspaceSwitcher.projectTitle", {
            project: bidiIsolate(name),
          })} · ${contextAssetLabel}`;
          return (
            <div
              className="desktop-project-switcher-rail-project-row"
              data-menu-open={projectActionSession?.projectPath === item.localPath
                && projectActionSession.surface === "menu"
                ? "true"
                : undefined}
              key={item.id}
            >
              <Tooltip content={!expanded && !avatarHasText ? name : undefined} placement="right"><button
                className={`desktop-project-switcher-rail-button desktop-project-switcher-rail-project ${expanded ? "desktop-project-switcher-rail-expanded-project po-sidebar-row" : "desktop-project-switcher-rail-compact-project"}${active ? " active" : ""}`}
                type="button"
                aria-current={active ? "page" : undefined}
                aria-label={label}
                aria-busy={pendingId === item.id || undefined}
                data-avatar-kind={expanded
                  ? `context-${contextAssetKind}`
                  : appearance?.icon?.kind ?? "initial"}
                data-context-asset-kind={contextAssetKind}
                data-pending={pendingId === item.id ? "true" : undefined}
                data-po-interaction="navigation"
                draggable={Boolean(item.localPath.trim())}
                onClick={() => void selectProject(item)}
                onDragStart={item.localPath ? (event) => beginProjectRootDrag(event, item.localPath) : undefined}
                onErrorCapture={() => {
                  if (assetUrl) setFailedAvatarUrls((current) => new Set(current).add(assetUrl));
                }}
              >
                <ProjectSwitcherAvatar
                  imageUrl={imageUrl}
                  emoji={emoji}
                  initial={initial}
                  item={item}
                  compact={!expanded}
                />
                {expanded && (
                  <span className="desktop-project-switcher-rail-label po-sidebar-row__label">
                    <bdi>{name}</bdi>
                  </span>
                )}
              </button></Tooltip>
              {expanded && item.localPath && workspace && (onRenameProject || onUnlinkProject) && (
                <ProjectRowActions
                  workspace={workspace}
                  surface={projectActionSession?.projectPath === workspace.path
                    ? projectActionSession.surface
                    : null}
                  onSurfaceChange={(surface) => changeProjectActionSurface(workspace.path, surface)}
                  onRenameProject={onRenameProject}
                  onUnlinkProject={onUnlinkProject}
                />
              )}
            </div>
          );
        })}
        <Tooltip content={expanded ? undefined : t("shell.workspaceSwitcher.createNew")} placement={expanded ? "bottom" : "right"}><button
          className={`desktop-project-switcher-rail-button desktop-project-switcher-rail-create ${expanded ? "desktop-project-switcher-rail-expanded-create po-sidebar-row" : "desktop-project-switcher-rail-compact-create"}`}
          type="button"
          aria-label={t("shell.workspaceSwitcher.createNew")}
          onClick={() => {
            setProjectActionSession(null);
            onCreateNew();
          }}
        >
          <span
            className={expanded
              ? "desktop-project-switcher-rail-avatar"
              : "desktop-project-switcher-rail-compact-create-icon"}
            aria-hidden="true"
          >
            <Plus size={14} strokeWidth={2.2} />
          </span>
          {expanded && (
            <span className="desktop-project-switcher-rail-label po-sidebar-row__label">
              {t("shell.workspaceSwitcher.createNew")}
            </span>
          )}
        </button></Tooltip>
        {onAddProject && <Tooltip content={expanded ? undefined : t("shell.workspaceSwitcher.addProject")} placement="right"><button
          className={`desktop-project-switcher-rail-button${expanded ? " po-sidebar-row" : ""}`}
          type="button"
          aria-label={t("shell.workspaceSwitcher.addProject")}
          onClick={() => { setProjectActionSession(null); onAddProject(); }}
        >
          <span className="desktop-project-switcher-rail-avatar desktop-project-switcher-rail-context-avatar" aria-hidden="true">
            <FolderPlus size={15} strokeWidth={1.8} />
          </span>
          {expanded && <span className="desktop-project-switcher-rail-label po-sidebar-row__label">{t("shell.workspaceSwitcher.addProject")}</span>}
        </button></Tooltip>}
      </div>
      {(onOpenPlugins || onOpenSettings || utilitySlot) && (
        <div
          className="desktop-project-switcher-rail-utilities desktop-sidebar-navigation-surface"
          data-placement="bottom"
        >
          <div className="desktop-sidebar-footer-actions">
            {onOpenPlugins && (
              <DesktopSidebarPluginsButton
                buttonClassName="desktop-sidebar-footer-button"
                onOpenPlugins={onOpenPlugins}
                pluginsOpen={pluginsOpen}
              />
            )}
            {onOpenSettings && (
              <DesktopSidebarSettingsButton
                buttonClassName="desktop-sidebar-footer-button"
                onOpenSettings={onOpenSettings}
                settingsOpen={settingsOpen}
              />
            )}
            {utilitySlot}
          </div>
        </div>
      )}
    </nav>
  );
}

function ProjectSwitcherAvatar({
  imageUrl,
  emoji,
  initial,
  item,
  compact,
}: Readonly<{
  imageUrl: string | null;
  emoji: string | null;
  initial: string;
  item: ProjectHomeItem;
  compact: boolean;
}>) {
  const showImage = Boolean(imageUrl);
  if (!compact) {
    return (
      <span
        className="desktop-project-switcher-rail-avatar desktop-project-switcher-rail-context-avatar"
        aria-hidden="true"
      >
        <HomeProjectIcon item={item} />
      </span>
    );
  }
  return (
    <span className="desktop-project-switcher-rail-avatar-stack" aria-hidden="true">
      <span
        className="desktop-project-switcher-rail-avatar desktop-project-switcher-rail-context-avatar desktop-project-switcher-rail-compact-context-avatar"
      >
        <HomeProjectIcon item={item} />
      </span>
      <bdi
        className={`desktop-project-switcher-rail-identity-badge${emoji && !showImage ? " desktop-project-switcher-rail-identity-badge-emoji" : ""}${!showImage && !emoji ? " desktop-project-switcher-rail-initial" : ""}`}
      >
        {showImage ? (
          <img
            className="desktop-project-switcher-rail-image"
            src={imageUrl ?? undefined}
            alt=""
            draggable="false"
          />
        ) : emoji ?? initial}
      </bdi>
    </span>
  );
}

export function resolveProjectSwitcherRailItems(
  activeWorkspace: Workspace,
  recentWorkspaces: readonly RecentWorkspaceHomeItem[],
  projectItems: readonly ProjectHomeItem[],
): readonly ProjectSwitcherRailItem[] {
  const hosted = activeWorkspace.path.startsWith("puppyone-cloud:");
  const workspaces = new Map(recentWorkspaces.map(({ workspace }) => [workspace.path, workspace]));
  workspaces.set(activeWorkspace.path, activeWorkspace);
  const items = [...new Map(projectItems.map(item => [item.id, item])).values()];
  // The open project remains visible while its registry/catalog is refreshing.
  if (!items.some(item => hosted
    ? item.cloudProjectId === activeWorkspace.projectId
    : item.localPath === activeWorkspace.path)) {
    items.unshift({ id: hosted ? `cloud:${activeWorkspace.projectId}` : `local:${activeWorkspace.path}`,
      label: activeWorkspace.name, localPath: hosted ? "" : activeWorkspace.path,
      ...(hosted && activeWorkspace.projectId ? { cloudProjectId: activeWorkspace.projectId } : {}) });
  }
  return items.map(item => {
    const workspace = item.localPath ? workspaces.get(item.localPath) ?? null
      : hosted && item.cloudProjectId === activeWorkspace.projectId ? activeWorkspace : null;
    return Object.freeze({ item, workspace,
      initial: getProjectSwitcherInitial(item.label, item.localPath),
      appearanceIdentity: workspace ? getProjectAppearanceIdentity(workspace) : null });
  });
}

export function mergeProjectSwitcherRailOrder(
  previousOrder: readonly string[],
  projects: readonly ProjectSwitcherRailItem[],
): readonly string[] {
  const availableIds = new Set(projects.map(({ item }) => item.id));
  const nextOrder = previousOrder.filter((id) => availableIds.has(id));
  const seenIds = new Set(nextOrder);

  for (const { item } of projects) {
    if (seenIds.has(item.id)) continue;
    nextOrder.push(item.id);
    seenIds.add(item.id);
  }

  return arraysEqual(previousOrder, nextOrder) ? previousOrder : Object.freeze(nextOrder);
}

export function getProjectSwitcherInitial(name: string, path: string): string {
  const value = name.trim() || pathToProjectName(path) || "P";
  const graphemes = segmentGraphemes(value);
  const meaningful = graphemes.find((segment) => (
    /[\p{L}\p{N}]/u.test(segment) || /\p{Extended_Pictographic}/u.test(segment)
  ));
  return (meaningful ?? graphemes[0] ?? "P").toLocaleUpperCase();
}

function segmentGraphemes(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
      ({ segment }) => segment,
    );
  }
  return Array.from(value);
}

function pathToProjectName(path: string): string {
  const normalized = path.trim().replace(/\/+$/, "");
  return normalized.split("/").at(-1) ?? "";
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
