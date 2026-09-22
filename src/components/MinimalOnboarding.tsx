import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { AlertTriangle } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import type { ResolvedSurfaceAppearance } from "../features/appearance/AppearanceRuntime";
import { useWorkspaceFolderDrop } from "../features/app-shell/useWorkspaceFolderDrop";
import {
  ProjectEntryFlow,
  useProjectEntryFlow,
} from "../features/app-shell/ProjectEntryFlow";
import {
  getProjectName,
  type ProjectHomeItem,
  type RecentWorkspaceHomeItem,
} from "../features/app-shell/workspaceHomeModel";
import { writeClipboardText } from "../features/settings/utils";
import {
  DEFAULT_EXPERIMENTAL_SETTINGS,
  type ExperimentalSettings,
} from "../preferences";
import { resolveImportPreviewBrands } from "../features/project-import/importSourceRegistry";
import type {
  WorkspaceCloneRepositoryRequest,
  WorkspaceCreateProjectRequest,
  WorkspaceCreateProjectResult,
  WorkspaceProjectLocationGrant,
} from "../types/electron";
import { DesktopWindowDragRegion } from "./DesktopWindowChrome";
import { OnboardingBrandLockup } from "./onboarding/OnboardingBrandLockup";
import { OnboardingEmptyStateIntro } from "./onboarding/OnboardingEmptyStateIntro";
import {
  OnboardingCreateProjectAction,
  OnboardingEntryActions,
} from "./onboarding/OnboardingEntryActions";
import { OnboardingHomeLayout } from "./onboarding/OnboardingHomeLayout";
import { OnboardingProjectList } from "./onboarding/OnboardingProjectList";
import { OnboardingTelemetryDisclosure } from "./onboarding/OnboardingTelemetryDisclosure";
import type { OnboardingHomeState } from "./onboarding/types";

export type { ProjectHomeItem, RecentWorkspaceHomeItem } from "../features/app-shell/workspaceHomeModel";

export type OnboardingOperationStatus = {
  title: string;
  detail?: string;
};

export type MinimalOnboardingProps = {
  onChooseWorkspace: () => Promise<void>;
  onChooseProjectLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onDefaultProjectLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onCreateProject?: (request: WorkspaceCreateProjectRequest) => Promise<WorkspaceCreateProjectResult>;
  onCloneRepository?: (request: WorkspaceCloneRepositoryRequest) => Promise<boolean>;
  onOpenWorkspacePath: (path: string) => Promise<void>;
  onOpenDroppedWorkspace: (folder: File) => Promise<void>;
  onRemoveProject?: (path: string) => Promise<void>;
  recentWorkspaces?: RecentWorkspaceHomeItem[];
  projectItems?: ProjectHomeItem[];
  operationStatus?: OnboardingOperationStatus | null;
  initialError?: string | null;
  appearance: ResolvedSurfaceAppearance;
  experimentalSettings?: ExperimentalSettings;
};

/** Local repository entrypoint. Cloud is entered from an open repository only. */
export function MinimalOnboarding({
  onChooseWorkspace,
  onChooseProjectLocation,
  onDefaultProjectLocation,
  onCreateProject,
  onCloneRepository,
  onOpenWorkspacePath,
  onOpenDroppedWorkspace,
  onRemoveProject,
  recentWorkspaces = [],
  projectItems,
  initialError = null,
  appearance,
  experimentalSettings = DEFAULT_EXPERIMENTAL_SETTINGS,
}: MinimalOnboardingProps) {
  const { t } = useLocalization();
  const [error, setError] = useState<string | null>(initialError);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const projectEntryFlow = useProjectEntryFlow();
  const importPreviewBrands = resolveImportPreviewBrands(experimentalSettings);
  const items = useMemo(
    () => (projectItems ?? recentWorkspaces.map(({ workspace, lastOpenedAt }) => ({
      id: workspace.id,
      label: workspace.name,
      localPath: workspace.path,
      lastOpenedAt: lastOpenedAt ?? null,
    }))).slice(0, 40),
    [projectItems, recentWorkspaces],
  );

  useEffect(() => setError(initialError), [initialError]);

  const openPath = async (path: string) => {
    if (openingPath) return;
    setError(null);
    setOpeningPath(path);
    try {
      await onOpenWorkspacePath(path);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setOpeningPath(null);
    }
  };

  const chooseFolder = async () => {
    if (openingPath) return;
    setError(null);
    setOpeningPath("__new__");
    try {
      await onChooseWorkspace();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setOpeningPath(null);
    }
  };

  const openDroppedFolder = async (folder: File) => {
    if (openingPath) return;
    setError(null);
    setOpeningPath("__drop__");
    try {
      await onOpenDroppedWorkspace(folder);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setOpeningPath(null);
    }
  };

  const removeProject = async (item: ProjectHomeItem) => {
    if (!onRemoveProject || openingPath || removingPath) return;
    const projectName = getProjectName(item, t("onboarding.projects.untitled"));
    const confirmed = window.confirm(
      t("settings.localProject.unlink.confirm", { workspace: bidiIsolate(projectName) }),
    );
    if (!confirmed) return;
    setError(null);
    setRemovingPath(item.localPath);
    try {
      await onRemoveProject(item.localPath);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setRemovingPath(null);
    }
  };

  const busy = Boolean(openingPath) || Boolean(removingPath);
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

  const hasProjects = items.length > 0;
  const onboardingState: OnboardingHomeState = hasProjects ? "projects" : "empty";
  const [showEmptyStateIntro, setShowEmptyStateIntro] = useState(() => !hasProjects);
  const homepageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setShowEmptyStateIntro(!hasProjects);
  }, [hasProjects]);

  useEffect(() => {
    if (homepageRef.current) homepageRef.current.inert = showEmptyStateIntro;
  }, [showEmptyStateIntro]);

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
      <DesktopWindowDragRegion className="onboarding-titlebar" />
      <section
        ref={homepageRef}
        className="onboarding-homepage"
        aria-label={t("onboarding.projects.title")}
        aria-hidden={showEmptyStateIntro || undefined}
      >
        <OnboardingHomeLayout
          brand={<OnboardingBrandLockup state={onboardingState} resolvedTheme={resolvedTheme} />}
          primaryKind={hasProjects ? "projects" : "create"}
          primary={hasProjects ? (
            <OnboardingProjectList
              items={items}
              busy={busy}
              openingPath={openingPath}
              removingPath={removingPath}
              draggingPath={draggingPath}
              onOpen={(path) => void openPath(path)}
              onRemove={onRemoveProject ? (item) => void removeProject(item) : undefined}
              onDragStart={startProjectDrag}
              onDragEnd={() => setDraggingPath(null)}
            />
          ) : (
            <OnboardingCreateProjectAction
              busy={busy}
              canCreateProject={Boolean(onCreateProject && onChooseProjectLocation)}
              prominent
              onCreateProject={projectEntryFlow.openCreate}
            />
          )}
          actions={<OnboardingEntryActions
            includeCreateProject={hasProjects}
            busy={busy}
            openingFolder={openingPath === "__new__"}
            draggingFolder={folderDrop.dragging}
            canCreateProject={Boolean(onCreateProject && onChooseProjectLocation)}
            canCloneRepository={Boolean(onCloneRepository)}
            importPreviewBrands={importPreviewBrands}
            onOpenFolder={() => void chooseFolder()}
            onCreateProject={projectEntryFlow.openCreate}
            onCloneRepository={projectEntryFlow.openImport}
          />}
        />

        {error && <div className="onboarding-error onboarding-homepage-error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
      </section>
      {onboardingState === "empty" && (
        <OnboardingTelemetryDisclosure ready={!showEmptyStateIntro} />
      )}
      <ProjectEntryFlow
        controller={projectEntryFlow}
        onDefaultLocation={onDefaultProjectLocation}
        onChooseLocation={onChooseProjectLocation}
        onCreateProject={onCreateProject}
        onImportRepository={onCloneRepository}
        onOpenFolder={() => void chooseFolder()}
        experimentalSettings={experimentalSettings}
      />
      {showEmptyStateIntro && (
        <OnboardingEmptyStateIntro onComplete={completeEmptyStateIntro} />
      )}
    </main>
  );
}
