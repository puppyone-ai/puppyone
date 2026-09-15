import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Workspace } from "@puppyone/shared-ui";
import { Plus } from "lucide-react";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import {
  getProjectAppearanceIdentity,
  useProjectAppearanceCatalog,
} from "../project-appearance/useProjectAppearanceCatalog";
import {
  ProjectContextAssetMark,
  resolveProjectContextAssetKind,
  type ProjectContextAssetKind,
} from "./ProjectContextAssetMark";
import { ProjectDetailsDialog } from "./ProjectDetailsDialog";
import { DesktopSidebarSettingsButton } from "./navigation/DesktopNavigationItems";
import type { DesktopView } from "../../components/DesktopCloudShell";
import { beginProjectRootDrag } from "./projectRootDrag";
export {
  DEFAULT_PROJECT_SWITCHER_EXPANDED_WIDTH,
  MAX_PROJECT_SWITCHER_EXPANDED_WIDTH,
  MIN_PROJECT_SWITCHER_EXPANDED_WIDTH,
  PROJECT_SWITCHER_RAIL_COLLAPSED_WIDTH,
  resolveProjectSwitcherCompactWidth,
  resolveProjectSwitcherRailWidth,
} from "./projectSwitcherRailGeometry";
import type { RecentWorkspaceHomeItem } from "./workspaceHomeModel";

export type ProjectSwitcherRailItem = Readonly<{
  workspace: Workspace;
  initial: string;
  appearanceIdentity: string | null;
}>;

type ProjectDetailsState = Readonly<{
  initial: string;
  path: string;
  projectIdentity: string;
  projectName: string;
}>;

type ProjectSwitcherRailProps = Readonly<{
  activeView?: DesktopView;
  activeWorkspace: Workspace;
  expanded?: boolean;
  recentWorkspaces: readonly RecentWorkspaceHomeItem[];
  onCreateNew: () => void;
  onOpenSettings?: () => void;
  settingsOpen?: boolean;
  onSelectProject: (path: string) => void | Promise<void>;
  utilitySlot?: ReactNode;
}>;

/**
 * Shell-owned, cross-Project navigation. The rail consumes the existing recent
 * Project registry and never owns Workspace lifecycle or persistence itself.
 */
export function ProjectSwitcherRail({
  activeView = "data",
  activeWorkspace,
  expanded = false,
  recentWorkspaces,
  onCreateNew,
  onOpenSettings,
  settingsOpen = false,
  onSelectProject,
  utilitySlot,
}: ProjectSwitcherRailProps) {
  const { t } = useLocalization();
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const queuedProjectRef = useRef<Workspace | null>(null);
  const switchInFlightRef = useRef(false);
  const projectCatalog = useMemo(
    () => resolveProjectSwitcherRailItems(activeWorkspace, recentWorkspaces),
    [activeWorkspace, recentWorkspaces],
  );
  const [projectOrder, setProjectOrder] = useState<readonly string[]>(
    () => projectCatalog.map(({ workspace }) => workspace.path),
  );
  const nextProjectOrder = useMemo(
    () => mergeProjectSwitcherRailOrder(projectOrder, projectCatalog),
    [projectCatalog, projectOrder],
  );
  const projects = useMemo(() => {
    const projectsByPath = new Map(
      projectCatalog.map((project) => [project.workspace.path, project]),
    );
    return nextProjectOrder.flatMap((path) => {
      const project = projectsByPath.get(path);
      return project ? [project] : [];
    });
  }, [nextProjectOrder, projectCatalog]);
  const appearanceWorkspaces = useMemo(
    () => projectCatalog.map(({ workspace }) => workspace),
    [projectCatalog],
  );
  const appearanceCatalog = useProjectAppearanceCatalog(appearanceWorkspaces);
  const [projectDetails, setProjectDetails] = useState<ProjectDetailsState | null>(null);

  useEffect(() => {
    if (nextProjectOrder !== projectOrder) setProjectOrder(nextProjectOrder);
  }, [nextProjectOrder, projectOrder]);

  const selectProject = async (project: Workspace) => {
    if (
      (project.path === activeWorkspace.path && activeView !== "settings")
      || project.path === pendingPath
    ) return;
    queuedProjectRef.current = project;
    setPendingPath(project.path);
    if (switchInFlightRef.current) return;

    switchInFlightRef.current = true;
    try {
      while (queuedProjectRef.current) {
        const nextProject = queuedProjectRef.current;
        queuedProjectRef.current = null;
        await onSelectProject(nextProject.path);
      }
    } finally {
      switchInFlightRef.current = false;
      setPendingPath(null);
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
        {projects.map(({ workspace, initial, appearanceIdentity }) => {
          const active = activeView !== "settings" && workspace.path === activeWorkspace.path;
          const contextAssetKind = resolveProjectContextAssetKind(workspace);
          const contextAssetLabel = t(contextAssetKind === "cloud"
            ? "shell.workspaceSwitcher.contextAssetCloud"
            : "shell.workspaceSwitcher.contextAssetLocal");
          const appearance = appearanceIdentity
            ? appearanceCatalog.appearances.get(appearanceIdentity)
            : null;
          const label = `${t("shell.workspaceSwitcher.projectTitle", {
            project: bidiIsolate(workspace.name),
          })} · ${contextAssetLabel}`;
          return (
            <button
              className={`desktop-project-switcher-rail-button desktop-project-switcher-rail-project ${expanded ? "desktop-project-switcher-rail-expanded-project po-sidebar-row" : "desktop-project-switcher-rail-compact-project"}${active ? " active" : ""}`}
              type="button"
              aria-current={active ? "page" : undefined}
              aria-label={label}
              aria-haspopup={appearanceIdentity ? "dialog" : undefined}
              aria-expanded={projectDetails?.projectIdentity === appearanceIdentity ? true : undefined}
              aria-busy={pendingPath === workspace.path || undefined}
              data-avatar-kind={expanded
                ? `context-${contextAssetKind}`
                : appearance?.icon?.kind ?? "initial"}
              data-context-asset-kind={contextAssetKind}
              data-pending={pendingPath === workspace.path ? "true" : undefined}
              data-po-interaction="navigation"
              draggable={Boolean(workspace.path.trim())}
              key={workspace.path}
              title={label}
              onClick={() => void selectProject(workspace)}
              onDragStart={(event) => beginProjectRootDrag(event, workspace.path)}
              onContextMenu={appearanceIdentity ? (event) => {
                event.preventDefault();
                appearanceCatalog.clearMutationError();
                setProjectDetails({
                  initial,
                  path: workspace.path,
                  projectIdentity: appearanceIdentity,
                  projectName: workspace.name,
                });
              } : undefined}
              onKeyDown={appearanceIdentity ? (event) => {
                if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
                event.preventDefault();
                appearanceCatalog.clearMutationError();
                setProjectDetails({
                  initial,
                  path: workspace.path,
                  projectIdentity: appearanceIdentity,
                  projectName: workspace.name,
                });
              } : undefined}
            >
              <ProjectSwitcherAvatar
                imageUrl={appearance?.icon?.kind === "asset" ? appearance.icon.url : null}
                emoji={appearance?.icon?.kind === "emoji" ? appearance.icon.value : null}
                initial={initial}
                contextAssetKind={contextAssetKind}
                compact={!expanded}
              />
              {expanded && (
                <span className="desktop-project-switcher-rail-label po-sidebar-row__label">
                  {workspace.name}
                </span>
              )}
            </button>
          );
        })}
        <button
          className={`desktop-project-switcher-rail-button desktop-project-switcher-rail-create ${expanded ? "desktop-project-switcher-rail-expanded-create po-sidebar-row" : "desktop-project-switcher-rail-compact-create"}`}
          type="button"
          aria-label={t("shell.workspaceSwitcher.createNew")}
          disabled={Boolean(pendingPath)}
          title={t("shell.workspaceSwitcher.createNew")}
          onClick={() => {
            setProjectDetails(null);
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
        </button>
      </div>
      {(onOpenSettings || utilitySlot) && (
        <div
          className="desktop-project-switcher-rail-utilities desktop-sidebar-navigation-surface"
          data-placement="bottom"
        >
          <div className="desktop-sidebar-footer-actions">
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
      {projectDetails && (
        <ProjectDetailsDialog
          appearance={appearanceCatalog.appearances.get(projectDetails.projectIdentity) ?? null}
          error={appearanceCatalog.mutationError}
          initial={projectDetails.initial}
          name={projectDetails.projectName}
          path={projectDetails.path}
          pending={appearanceCatalog.pendingIdentity === projectDetails.projectIdentity}
          onChooseImage={() => appearanceCatalog.chooseIcon(projectDetails.projectIdentity)}
          onClose={() => {
            appearanceCatalog.clearMutationError();
            setProjectDetails(null);
          }}
          onResetIcon={() => appearanceCatalog.resetIcon(projectDetails.projectIdentity)}
          onSelectEmoji={(emoji) => appearanceCatalog.setEmoji(projectDetails.projectIdentity, emoji)}
        />
      )}
    </nav>
  );
}

function ProjectSwitcherAvatar({
  imageUrl,
  emoji,
  initial,
  contextAssetKind,
  compact,
}: Readonly<{
  imageUrl: string | null;
  emoji: string | null;
  initial: string;
  contextAssetKind: ProjectContextAssetKind;
  compact: boolean;
}>) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const showImage = Boolean(imageUrl && imageUrl !== failedImageUrl);
  if (!compact) {
    return (
      <span
        className="desktop-project-switcher-rail-avatar desktop-project-switcher-rail-context-avatar"
        aria-hidden="true"
      >
        <ProjectContextAssetMark kind={contextAssetKind} size={15} />
      </span>
    );
  }
  return (
    <span className="desktop-project-switcher-rail-avatar-stack" aria-hidden="true">
      <span
        className="desktop-project-switcher-rail-avatar desktop-project-switcher-rail-context-avatar desktop-project-switcher-rail-compact-context-avatar"
      >
        <ProjectContextAssetMark kind={contextAssetKind} size={17} />
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
            onError={() => setFailedImageUrl(imageUrl)}
          />
        ) : emoji ?? initial}
      </bdi>
    </span>
  );
}

export function resolveProjectSwitcherRailItems(
  activeWorkspace: Workspace,
  recentWorkspaces: readonly RecentWorkspaceHomeItem[],
): readonly ProjectSwitcherRailItem[] {
  const workspaces = new Map<string, Workspace>();
  workspaces.set(activeWorkspace.path, activeWorkspace);
  for (const item of recentWorkspaces) {
    if (!workspaces.has(item.workspace.path)) {
      workspaces.set(item.workspace.path, item.workspace);
    }
  }
  return Array.from(workspaces.values(), (workspace) => Object.freeze({
    workspace,
    initial: getProjectSwitcherInitial(workspace.name, workspace.path),
    appearanceIdentity: getProjectAppearanceIdentity(workspace),
  }));
}

export function mergeProjectSwitcherRailOrder(
  previousOrder: readonly string[],
  projects: readonly ProjectSwitcherRailItem[],
): readonly string[] {
  const availablePaths = new Set(projects.map(({ workspace }) => workspace.path));
  const nextOrder = previousOrder.filter((path) => availablePaths.has(path));
  const seenPaths = new Set(nextOrder);

  for (const { workspace } of projects) {
    if (seenPaths.has(workspace.path)) continue;
    nextOrder.push(workspace.path);
    seenPaths.add(workspace.path);
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
