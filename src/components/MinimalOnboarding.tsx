import { useDesktopPlatformCapabilities } from "../platform/useDesktopPlatformCapabilities";
import { useDesktopPreference } from "../preferencesStore";
import { useLocalization } from "@puppyone/localization";
import { AlertTriangle } from "lucide-react";
import type { ComponentProps } from "react";
import {
  useEffect,
  useMemo,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import type { ResolvedSurfaceAppearance } from "../features/appearance/AppearanceRuntime";
import { useWorkspaceFolderDrop } from "../features/app-shell/useWorkspaceFolderDrop";
import type { ProjectEntryFlowController } from "../features/app-shell/ProjectEntryFlow";
import { projectHomeItemLocation, type CloudSpace, type ProjectHomeItem, type RecentWorkspaceHomeItem } from "../lib/workspaceHomeModel";
import { writeClipboardText } from "../features/settings/utils";
import { resolveImportPreviewBrands } from "../features/project-import/importSourceRegistry";
import { DesktopWindowChrome } from "./DesktopWindowChrome";
import { OnboardingBrandLockup, OnboardingHeaderBrand } from "./onboarding/OnboardingBrandLockup";
import { OnboardingEmptyStateIntro } from "./onboarding/OnboardingEmptyStateIntro";
import {
  OnboardingCreateProjectAction,
  OnboardingEntryActions,
} from "./onboarding/OnboardingEntryActions";
import { OnboardingEntryMenu } from "./onboarding/OnboardingEntryMenu";
import { OnboardingProjectToolbar, useHomepageProjectView } from "./onboarding/OnboardingProjectToolbar";
import { useCloudProjectGroups } from "./onboarding/useCloudProjectGroups";
import { OnboardingHomeLayout } from "./onboarding/OnboardingHomeLayout";
import { OnboardingProjectLayoutSwitch } from "./onboarding/OnboardingProjectLayoutSwitch";
import { OnboardingProjectList, type ProjectListSharing } from "./onboarding/OnboardingProjectList";
import { OtherComputersLabel, type CloudCopy, type ProjectAudience } from "./project-audience";
import { onboardingBaseGroups, OnboardingProjectGroups, type OnboardingGroupsBase } from "./onboarding/OnboardingProjectGroups";
import { OnboardingTelemetryDisclosure } from "./onboarding/OnboardingTelemetryDisclosure";
import type { OnboardingHomeState } from "./onboarding/types";

export type { ProjectHomeItem, RecentWorkspaceHomeItem } from "../lib/workspaceHomeModel";

export type OnboardingOperationStatus = {
  title: string;
  detail?: string;
};

export type MinimalOnboardingProps = {
  /** The window owns the flow, which starts from pages this one is gone from. */
  projectEntryController: ProjectEntryFlowController;
  canCreateProject?: boolean;
  canImport?: boolean;
  onChooseWorkspace: () => Promise<void>;
  onOpenWorkspacePath: (path: string) => Promise<void>;
  onOpenDroppedWorkspace: (folder: File) => Promise<void>;
  onRemoveProject?: (path: string) => Promise<void>;
  onRenameProject?: (path: string, name: string) => Promise<void>;
  onRenameCloudProject?: (projectId: string, name: string) => Promise<void>;
  onDeleteCloudProject?: (projectId: string) => Promise<void>;
  recentWorkspaces?: RecentWorkspaceHomeItem[];
  projectItems?: ProjectHomeItem[];
  /** The page is here but its list is not settled, so the mark stands in for it. */
  listHeld?: boolean;
  cloudAccountStatus?: ReactNode;
  /**
   * Adds device folders to the same personal audience as hosted projects.
   * Without a device catalog, recorded sharing still must not imply local-only.
   */
  projectGroups?: (base: OnboardingGroupsBase) => ReactNode;
  cloudSpaces?: readonly CloudSpace[];
  cloudSpacesStatus?: "signed-out" | "loading" | "ready" | "error";
  onRetryCloudSpaces?: () => void;
  onManageSpace?: (spaceId: string) => void;
  onPublishToSpace?: (path: string, spaceId: string) => Promise<void>;
  onShareLocalFolder?: (path: string) => Promise<void>;
  /** Local projects whose folder cannot be opened now, with the few words that say why. */
  unavailableProjects?: ReadonlyMap<string, string>;
  /** Asks what to do about such a project instead of opening it. */
  onOpenUnavailableProject?: (path: string) => void;
  cloudOpening?: boolean;
  onOpenCloudProject?: (projectId: string) => void;
  operationStatus?: OnboardingOperationStatus | null;
  initialError?: string | null;
  appearance: ResolvedSurfaceAppearance;
};

const NO_RECENT_WORKSPACES: RecentWorkspaceHomeItem[] = [];
/** How long a first visit waits for the spaces that group its Cloud projects. */
const SPACES_WAIT_MS = 3000;

/** Homepage project list. Cloud catalog/auth is supplied by the host, not discovered by the view. */
/** Once there are projects, every way to start one moves to the head of the page. */
function onboardingEntrySlots(hasProjects: boolean, {
  draggingFolder,
  ...entry
}: ComponentProps<typeof OnboardingEntryMenu> & { draggingFolder: boolean }) {
  if (hasProjects) return { trailing: <OnboardingEntryMenu {...entry} />, actions: null };
  const { canCreateProject: _canCreateProject, onCreateProject: _onCreateProject, ...actions } = entry;
  return { trailing: null, actions: <OnboardingEntryActions {...actions} draggingFolder={draggingFolder} /> };
}

export function MinimalOnboarding({
  projectEntryController,
  canCreateProject = false,
  canImport = false,
  onChooseWorkspace,
  onOpenWorkspacePath,
  onOpenDroppedWorkspace,
  onRemoveProject,
  onRenameProject,
  onRenameCloudProject,
  onDeleteCloudProject,
  recentWorkspaces = NO_RECENT_WORKSPACES,
  projectItems,
  listHeld = false,
  cloudAccountStatus,
  projectGroups,
  cloudSpaces = [],
  cloudSpacesStatus = "signed-out",
  onRetryCloudSpaces,
  onManageSpace,
  onPublishToSpace,
  onShareLocalFolder,
  unavailableProjects,
  onOpenUnavailableProject,
  cloudOpening = false,
  onOpenCloudProject,
  initialError = null,
  appearance,
}: MinimalOnboardingProps) {
  const { t } = useLocalization();
  const desktopPlatform = useDesktopPlatformCapabilities();
  const [error, setError] = useState<string | null>(initialError);
  // A failure handed down replaces what is shown; the page's own actions clear it.
  const [latestInitialError, setLatestInitialError] = useState(initialError);
  if (latestInitialError !== initialError) {
    setLatestInitialError(initialError);
    setError(initialError);
  }
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const enableOtherAppImports = useDesktopPreference(s => s.experimentalSettings.enableOtherAppImports);
  const projectLayout = useDesktopPreference(s => s.homepageProjectLayout);
  const setProjectLayout = useDesktopPreference(s => s.setHomepageProjectLayout);
  const importPreviewBrands = resolveImportPreviewBrands({ enableOtherAppImports });
  const items = useMemo(
    () => (projectItems ?? recentWorkspaces.map(({ workspace }) => ({
      id: workspace.id,
      label: workspace.name,
      localPath: workspace.path,
      lastModifiedAt: workspace.lastModifiedAt ?? null,
      ...(workspace.hostFolderId ? { hostFolderId: workspace.hostFolderId } : {}),
    }))),
    [projectItems, recentWorkspaces],
  );

  /** One opening at a time; if it fails, the reason stays on the page. */
  const runOpening = async (opening: string, open: () => Promise<void>) => {
    if (openingPath) return;
    setError(null);
    setOpeningPath(opening);
    try {
      await open();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setOpeningPath(null);
    }
  };
  const openPath = (path: string) => runOpening(path, () => onOpenWorkspacePath(path));
  const chooseFolder = () => runOpening("__new__", onChooseWorkspace);
  const openDroppedFolder = (folder: File) => runOpening("__drop__", () => onOpenDroppedWorkspace(folder));

  const busy = [openingPath, cloudOpening].some(Boolean);
  const startProjectDrag = (event: ReactDragEvent<HTMLButtonElement>, item: ProjectHomeItem) => {
    const absolutePath = item.localPath.trim();
    if (busy || !absolutePath) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", absolutePath);
    setDraggingPath(absolutePath);
    void writeClipboardText(absolutePath).catch(() => undefined);
  };
  const folderDrop = useWorkspaceFolderDrop({
    disabled: busy,
    onDropFolder: openDroppedFolder,
    onInvalidDrop: () => setError(t("onboarding.error.dropLocalFolder")),
  });

  // Account/auth controls are page chrome, never synthetic Project rows.
  const hasProjects = items.length > 0 || listHeld || cloudSpaces.length > 0;
  const onboardingState: OnboardingHomeState = hasProjects ? "projects" : "empty";
  const [showEmptyStateIntro, setShowEmptyStateIntro] = useState(!hasProjects);
  // The intro belongs to a page that has just become empty, and ends if it fills.
  const [introHasProjects, setIntroHasProjects] = useState(hasProjects);
  if (introHasProjects !== hasProjects) {
    setIntroHasProjects(hasProjects);
    setShowEmptyStateIntro(!hasProjects);
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;

    const replayEmptyStateIntro = (event: KeyboardEvent) => {
      if (
        showEmptyStateIntro
        || event.code !== "KeyL"
        || !event.altKey
        || !event.shiftKey
        || event.metaKey
        || event.ctrlKey
      ) return;

      event.preventDefault();
      setShowEmptyStateIntro(true);
    };

    window.addEventListener("keydown", replayEmptyStateIntro);
    return () => window.removeEventListener("keydown", replayEmptyStateIntro);
  }, [showEmptyStateIntro]);

  const completeEmptyStateIntro = () => setShowEmptyStateIntro(false);
  const resolvedTheme = appearance.appearance.effectiveColorMode;
  const projectView = useHomepageProjectView(items, listHeld);
  // Which group a Cloud project is in comes from the account's spaces. Until they
  // answer, the groups wait as one, rather than grouping it once provisionally and
  // then moving it. Spaces the account last saw stand in, so this is a first run only.
  // The wait is bounded: a request that never answers must not cost the page its list.
  const awaitingSpaces = cloudSpacesStatus === "loading" && items.some((item) => projectHomeItemLocation(item) === "cloud");
  const [spacesWaitOver, setSpacesWaitOver] = useState(false);
  useEffect(() => {
    if (!awaitingSpaces) return undefined;
    const timer = window.setTimeout(() => setSpacesWaitOver(true), SPACES_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [awaitingSpaces]);
  const groupsHeld = listHeld || (awaitingSpaces && !spacesWaitOver);
  const localItems = projectView.visibleItems.filter((item) => projectHomeItemLocation(item) === "local");
  const cloudItems = projectView.visibleItems.filter((item) => projectHomeItemLocation(item) === "cloud");
  // A folder's menu says who can open it and changes that as dragging it would:
  // opened to my devices directly, or copied to the current Cloud Space.
  const writableSpaces = cloudSpaces.filter((space) => space.canCreateProjects);
  const projectAudience = (sharing: ProjectListSharing | undefined) => (item: ProjectHomeItem): ProjectAudience | null => {
    const path = item.localPath;
    if (!path) return null;
    const folderId = item.hostFolderId;
    const shared = Boolean(folderId && (sharing ? sharing.sharedFolderIds.has(folderId) : true));
    const linked = item.linkedCloudProject;
    const copy: CloudCopy | null = linked
      ? { onOpen: onOpenCloudProject && (() => onOpenCloudProject(linked.id)) } : null;
    const firstSpace = writableSpaces[0];
    return {
      devices: onShareLocalFolder || (shared && folderId) ? {
        on: shared,
        detail: shared && sharing?.otherComputers ? <OtherComputersLabel names={sharing.otherComputers} /> : undefined,
        onTurnOn: onShareLocalFolder && (() => void runOpening(path, () => onShareLocalFolder(path))),
        onStop: shared && folderId && sharing?.onStopSharing ? () => sharing.onStopSharing?.({ folderId, rootPath: path }) : undefined,
        onSettings: shared && folderId && sharing
          ? () => sharing.onSharingSettings({ folderId, name: item.label, rootPath: path }) : undefined,
      } : undefined,
      devicesCopy: null,
      team: firstSpace || copy ? {
        copy,
        onCopy: !linked && firstSpace && onPublishToSpace
          ? () => void runOpening(path, () => onPublishToSpace(path, firstSpace.id)) : undefined,
      } : undefined,
    };
  };
  const projectList = (listItems: ProjectHomeItem[], sharing?: ProjectListSharing) => (
    <OnboardingProjectList
      audience={projectAudience(sharing)}
      held={groupsHeld}
      items={listItems}
      sharing={sharing}
      layout={projectLayout}
      onOpenCloudProject={onOpenCloudProject}
      busy={busy}
      openingPath={openingPath}
      draggingPath={draggingPath}
      onOpen={(path) => void openPath(path)}
      unavailable={unavailableProjects}
      onOpenUnavailable={onOpenUnavailableProject}
      onRename={onRenameProject}
      onRemove={onRemoveProject}
      onRenameCloudProject={onRenameCloudProject}
      onDeleteCloudProject={onDeleteCloudProject}
      onDragStart={startProjectDrag}
      onDragEnd={() => setDraggingPath(null)}
    />
  );
  // This computer stays visible; cloud Space and device-sharing facts keep their own groups.
  const cloudGroups = useCloudProjectGroups({
    spaces: cloudSpaces,
    cloudItems, localItems, renderProjects: projectList, draggingPath, busy,
    onPublish: onPublishToSpace ? (path, spaceId) => runOpening(path, () => onPublishToSpace(path, spaceId)) : undefined,
    onDragEnd: () => setDraggingPath(null),
    onManageSpace,
  });
  const entry = onboardingEntrySlots(hasProjects, {
    busy,
    openingFolder: openingPath === "__new__",
    draggingFolder: folderDrop.dragging,
    canCreateProject,
    canImport,
    importPreviewBrands,
    onCreateProject: projectEntryController.openCreate,
    onOpenFolder: () => void chooseFolder(),
    onImport: projectEntryController.openImport,
  });
  const groupsBase: OnboardingGroupsBase = {
    label: t("onboarding.projects.title"),
    layout: projectLayout,
    cloud: cloudGroups,
    localShare: onShareLocalFolder ? { draggingPath, busy,
      request: (path) => runOpening(path, () => onShareLocalFolder(path)),
      endDrag: () => setDraggingPath(null) } : undefined,
    local: localItems.length > 0 ? {
      title: t(desktopPlatform?.platform === "macos" ? "onboarding.sharing.thisMac" : "onboarding.sharing.localOnly"),
      items: localItems,
      render: projectList,
    } : null,
  };
  let projects: ReactNode = projectList(projectView.visibleItems);
  if (!groupsHeld && projectGroups) projects = projectGroups(groupsBase);
  else if (!groupsHeld) projects = <OnboardingProjectGroups label={groupsBase.label} groups={onboardingBaseGroups(groupsBase)} />;

  return (
    <main
      className={`onboarding-shell onboarding-homepage-shell ${resolvedTheme === "dark" ? "dark" : ""} ${folderDrop.dragging ? "dragging" : ""} ${showEmptyStateIntro ? "is-empty-state-intro" : ""}`}
      data-onboarding-state={onboardingState}
      data-po-scrollbar="content"
      {...appearance.rootProps}
      onDragEnter={folderDrop.onDragEnter}
      onDragOver={folderDrop.onDragOver}
      onDragLeave={folderDrop.onDragLeave}
      onDrop={folderDrop.onDrop}
    >
      <DesktopWindowChrome context={hasProjects ? <OnboardingHeaderBrand /> : undefined} actions={cloudAccountStatus} />
      <section
        className="onboarding-homepage"
        aria-label={t("onboarding.projects.title")}
        aria-hidden={showEmptyStateIntro || undefined}
        {...(showEmptyStateIntro ? { inert: "" } : {})}
      >
        <OnboardingHomeLayout
          brand={<OnboardingBrandLockup state={onboardingState} resolvedTheme={resolvedTheme} toolbar={(
            <OnboardingProjectToolbar view={projectView} disabled={busy}>
              <OnboardingProjectLayoutSwitch layout={projectLayout} disabled={busy} onChange={setProjectLayout} />
            </OnboardingProjectToolbar>
          )} trailing={entry.trailing} />}
          primaryKind={hasProjects ? "projects" : "create"}
          primary={hasProjects ? projects : (
            <OnboardingCreateProjectAction
              busy={busy}
              canCreateProject={canCreateProject}
              prominent
              onCreateProject={projectEntryController.openCreate}
            />
          )}
          actions={entry.actions}
        />
        {!hasProjects && projectGroups?.({ ...groupsBase, cloud: [], local: null })}

        {cloudSpacesStatus === "error" && <p className="onboarding-project-groups-note" role="status">
          {t("onboarding.spaces.unavailable")} {onRetryCloudSpaces && <button type="button" onClick={onRetryCloudSpaces}>
            {t("onboarding.spaces.retry")}</button>}
        </p>}
        {error && <div className="onboarding-error onboarding-homepage-error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
      </section>
      {onboardingState === "empty" && (
        <OnboardingTelemetryDisclosure ready={!showEmptyStateIntro} />
      )}
      {showEmptyStateIntro && (
        <OnboardingEmptyStateIntro onComplete={completeEmptyStateIntro} />
      )}
    </main>
  );
}
