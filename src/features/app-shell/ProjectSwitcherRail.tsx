import { Tooltip, CloudIcon } from "@puppyone/shared-ui";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Workspace } from "@puppyone/shared-ui";
import { FolderPlus, Plus } from "lucide-react";
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
import type { ProjectAppearance } from "../../types/electron";
export {
  DEFAULT_PROJECT_SWITCHER_EXPANDED_WIDTH,
  MAX_PROJECT_SWITCHER_EXPANDED_WIDTH,
  MIN_PROJECT_SWITCHER_EXPANDED_WIDTH,
  PROJECT_SWITCHER_RAIL_COLLAPSED_WIDTH,
  resolveProjectSwitcherCompactWidth,
  resolveProjectSwitcherRailWidth,
} from "./projectSwitcherRailGeometry";
import { projectMatchesTarget, type ProjectNavigationTarget } from "./projectNavigation";
import { getProjectName, type ProjectHomeItem, type RecentWorkspaceHomeItem } from "../../lib/workspaceHomeModel";

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
  pendingProject?: ProjectNavigationTarget | null;
  /**
   * The Local / Cloud switch for the open Project. It lives in that Project's
   * own row menu because the rail, not the Header, states where a Project is.
   */
  activeProjectLocationControls?: ReactNode;
  expanded?: boolean;
  recentWorkspaces: readonly RecentWorkspaceHomeItem[];
  projectItems: readonly ProjectHomeItem[];
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
  pendingProject,
  activeProjectLocationControls,
  expanded = false,
  recentWorkspaces,
  projectItems,
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
  const selectionRequest = useRef(0);
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

  // Rename/unlink belong to the expanded rail as a whole, not to any one row.
  const projectActionsAvailable = expanded && Boolean(onRenameProject || onUnlinkProject);
  const currentCloudProjectId = activeCloudProjectId
    ?? (activeWorkspace.path.startsWith("puppyone-cloud:") ? activeWorkspace.projectId : null);
  const isActiveProject = (project: ProjectHomeItem) => currentCloudProjectId
    ? project.cloudProjectId === currentCloudProjectId
    : project.localPath === activeWorkspace.path;
  const selectProject = async (project: ProjectHomeItem) => {
    if (isActiveProject(project) && activeView !== "settings" && !pendingProject && !pendingId) return;
    setProjectActionSession(null);
    const request = ++selectionRequest.current;
    setPendingId(project.id);
    try {
      if (project.localPath) await onSelectProject(project.localPath);
      else if (project.cloudProjectId) await onSelectCloudProject?.(project.cloudProjectId);
    } finally {
      if (request === selectionRequest.current) setPendingId(null);
    }
  };
  const isPending = (project: ProjectHomeItem) => pendingProject === undefined
    ? pendingId === project.id
    : projectMatchesTarget(project, pendingProject);

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
        {/* No way back to Homepage: the rail is the Project list, so leaving
            for a second one would be a detour to the same answer. */}
        {projects.map((project) => {
          const opened = isActiveProject(project.item);
          return (
            <ProjectSwitcherRailRow
              key={project.item.id}
              project={project}
              appearance={project.appearanceIdentity
                ? appearanceCatalog.appearances.get(project.appearanceIdentity) ?? null
                : null}
              failedAvatarUrls={failedAvatarUrls}
              expanded={expanded}
              active={opened && activeView !== "settings"}
              place={resolveProjectRowPlace(project.item, opened && Boolean(currentCloudProjectId))}
              pending={isPending(project.item)}
              actionSurface={projectActionSession?.projectPath === project.item.localPath
                ? projectActionSession.surface
                : null}
              locationControls={opened ? activeProjectLocationControls : undefined}
              onSelect={() => void selectProject(project.item)}
              onAvatarError={(url) => setFailedAvatarUrls((current) => new Set(current).add(url))}
              onSurfaceChange={changeProjectActionSurface}
              onRenameProject={onRenameProject}
              onUnlinkProject={onUnlinkProject}
            />
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

type ProjectSwitcherRailRowProps = Readonly<{
  project: ProjectSwitcherRailItem;
  appearance: ProjectAppearance | null;
  failedAvatarUrls: ReadonlySet<string>;
  expanded: boolean;
  active: boolean;
  place: ProjectRowPlace;
  pending: boolean;
  actionSurface: ProjectActionSurface;
  locationControls?: ReactNode;
  onSelect: () => void;
  onAvatarError: (assetUrl: string) => void;
  onSurfaceChange: (projectPath: string, surface: ProjectActionSurface) => void;
  onRenameProject?: (path: string, name: string) => Promise<void>;
  onUnlinkProject?: (path: string) => Promise<void>;
}>;

/**
 * One Project in the rail: who it is, where it is, and what can be done to it.
 * The trailing slot states the place while the pointer is away and hands
 * itself to the row actions on hover, so a row never carries two trailing
 * controls at once.
 */
function ProjectSwitcherRailRow({
  project: { item, workspace, initial },
  appearance,
  failedAvatarUrls,
  expanded,
  active,
  place,
  pending,
  actionSurface,
  locationControls,
  onSelect,
  onAvatarError,
  onSurfaceChange,
  onRenameProject,
  onUnlinkProject,
}: ProjectSwitcherRailRowProps) {
  const identity = useProjectRowIdentity(item, appearance, failedAvatarUrls);
  const actionable = Boolean(expanded && item.localPath && workspace
    && (onRenameProject || onUnlinkProject));
  return (
    <div
      className="desktop-project-switcher-rail-project-row"
      data-menu-open={actionSurface === "menu" ? "true" : undefined}
    >
      <ProjectSwitcherRailProjectButton
        item={item}
        identity={identity}
        initial={initial}
        expanded={expanded}
        active={active}
        pending={pending}
        onSelect={onSelect}
        onAvatarError={onAvatarError}
      />
      {/* Local needs no mark: a Project is on this device unless the window
          says otherwise. Hover hands the slot to the actions. */}
      {expanded && place === "cloud" && (
        <span className="desktop-project-switcher-rail-place" aria-hidden="true">
          <CloudIcon size={14} />
        </span>
      )}
      {actionable && workspace && (
        <ProjectRowActions
          workspace={workspace}
          locationControls={locationControls}
          surface={actionSurface}
          onSurfaceChange={(surface) => onSurfaceChange(workspace.path, surface)}
          onRenameProject={onRenameProject}
          onUnlinkProject={onUnlinkProject}
        />
      )}
    </div>
  );
}

function ProjectSwitcherRailProjectButton({
  item,
  identity,
  initial,
  expanded,
  active,
  pending,
  onSelect,
  onAvatarError,
}: Readonly<{
  item: ProjectHomeItem;
  identity: ProjectRowIdentity;
  initial: string;
  expanded: boolean;
  active: boolean;
  pending: boolean;
  onSelect: () => void;
  onAvatarError: (assetUrl: string) => void;
}>) {
  const { assetUrl, avatarHasText, contextAssetKind, emoji, iconKind, imageUrl, label, name } = identity;
  const presentation = expanded
    ? "desktop-project-switcher-rail-expanded-project po-sidebar-row"
    : "desktop-project-switcher-rail-compact-project";
  return (
    <Tooltip content={!expanded && !avatarHasText ? name : undefined} placement="right"><button
      className={`desktop-project-switcher-rail-button desktop-project-switcher-rail-project ${presentation}${active ? " active" : ""}`}
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={label}
      aria-busy={pending || undefined}
      data-avatar-kind={expanded ? `context-${contextAssetKind}` : iconKind}
      data-context-asset-kind={contextAssetKind}
      data-pending={pending ? "true" : undefined}
      data-po-interaction="navigation"
      draggable={Boolean(item.localPath.trim())}
      onClick={onSelect}
      onDragStart={item.localPath ? (event) => beginProjectRootDrag(event, item.localPath) : undefined}
      onErrorCapture={() => {
        if (assetUrl) onAvatarError(assetUrl);
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
  );
}

type ProjectRowIdentity = Readonly<{
  name: string;
  label: string;
  contextAssetKind: "cloud" | "linked" | "local";
  iconKind: string;
  assetUrl: string | null;
  imageUrl: string | null;
  emoji: string | null;
  avatarHasText: boolean;
}>;

/** What the row says about the Project, derived once for every rendering. */
function useProjectRowIdentity(
  item: ProjectHomeItem,
  appearance: ProjectAppearance | null,
  failedAvatarUrls: ReadonlySet<string>,
): ProjectRowIdentity {
  const { t } = useLocalization();
  const name = getProjectName(item, t("onboarding.projects.untitled"));
  const contextAssetKind = resolveProjectRowContextAssetKind(item);
  const contextAssetLabel = [
    ...(item.localPath ? [t("shell.workspaceSwitcher.contextAssetLocal")] : []),
    ...(item.cloudProjectId ? [t("shell.workspaceSwitcher.contextAssetCloud")] : []),
  ].join(" + ");
  const assetUrl = appearance?.icon?.kind === "asset" ? appearance.icon.url : null;
  const imageUrl = assetUrl && !failedAvatarUrls.has(assetUrl) ? assetUrl : null;
  const emoji = appearance?.icon?.kind === "emoji" ? appearance.icon.value : null;
  return {
    name,
    label: `${t("shell.workspaceSwitcher.projectTitle", { project: bidiIsolate(name) })} · ${contextAssetLabel}`,
    contextAssetKind,
    iconKind: appearance?.icon?.kind ?? "initial",
    assetUrl,
    imageUrl,
    emoji,
    avatarHasText: !imageUrl && !emoji,
  };
}

function resolveProjectRowContextAssetKind(item: ProjectHomeItem): "cloud" | "linked" | "local" {
  if (!item.localPath) return "cloud";
  return item.cloudProjectId ? "linked" : "local";
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

/** Where a Project is worked on: the fact the Header used to carry. */
export type ProjectRowPlace = "local" | "cloud";

/**
 * Where a row's Project is worked on right now. A Project with no local folder
 * only exists in the Cloud; the open Project follows the surface the window is
 * showing.
 */
export function resolveProjectRowPlace(
  item: ProjectHomeItem,
  openedInCloud: boolean,
): ProjectRowPlace {
  if (openedInCloud) return "cloud";
  return item.localPath ? "local" : "cloud";
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
    const workspace = resolveProjectSwitcherRailWorkspace(item, { activeWorkspace, hosted, workspaces });
    return Object.freeze({ item, workspace,
      initial: getProjectSwitcherInitial(item.label, item.localPath),
      appearanceIdentity: workspace ? getProjectAppearanceIdentity(workspace) : null });
  });
}

/** A row is backed by a local workspace, or by the open hosted one. */
function resolveProjectSwitcherRailWorkspace(
  item: ProjectHomeItem,
  { activeWorkspace, hosted, workspaces }: Readonly<{
    activeWorkspace: Workspace;
    hosted: boolean;
    workspaces: ReadonlyMap<string, Workspace>;
  }>,
): Workspace | null {
  if (item.localPath) return workspaces.get(item.localPath) ?? null;
  return hosted && item.cloudProjectId === activeWorkspace.projectId ? activeWorkspace : null;
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
