import { useDesktopPreference } from "../preferencesStore";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { AlertTriangle } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import type { ResolvedSurfaceAppearance } from "../features/appearance/AppearanceRuntime";
import { useWorkspaceFolderDrop } from "../features/app-shell/useWorkspaceFolderDrop";
import {
  ProjectEntryFlow,
  useProjectEntryFlow,
  type ProjectEntryFlowController,
} from "../features/app-shell/ProjectEntryFlow";
import {
  getProjectName,
  type ProjectHomeItem,
  type RecentWorkspaceHomeItem,
} from "../features/app-shell/workspaceHomeModel";
import { writeClipboardText } from "../features/settings/utils";
import { resolveImportPreviewBrands } from "../features/project-import/importSourceRegistry";
import type {
  WorkspaceImportSourceRequest,
  WorkspaceImportResourcePage,
  WorkspaceImportProgress,
  WorkspaceCreateProjectRequest,
  WorkspaceCreateProjectResult,
  WorkspaceProjectLocationGrant,
} from "../types/electron";
import { DesktopWindowChrome } from "./DesktopWindowChrome";
import { OnboardingBrandLockup } from "./onboarding/OnboardingBrandLockup";
import { OnboardingEmptyStateIntro } from "./onboarding/OnboardingEmptyStateIntro";
import {
  OnboardingCreateProjectAction,
  OnboardingEntryActions,
} from "./onboarding/OnboardingEntryActions";
import { OnboardingHomeLayout } from "./onboarding/OnboardingHomeLayout";
import { OnboardingProjectList } from "./onboarding/OnboardingProjectList";
import { isHomepageProjectOpening, OnboardingProjectLoading } from "./onboarding/OnboardingProjectLoading";
import { OnboardingTelemetryDisclosure } from "./onboarding/OnboardingTelemetryDisclosure";
import type { OnboardingHomeState } from "./onboarding/types";

export type { ProjectHomeItem, RecentWorkspaceHomeItem } from "../features/app-shell/workspaceHomeModel";

export type OnboardingOperationStatus = {
  title: string;
  detail?: string;
};

export type MinimalOnboardingProps = {
  /** App owns the flow when the retained Homepage shares a Cloud shell. */
  projectEntryController?: ProjectEntryFlowController;
  onChooseWorkspace: () => Promise<void>;
  onChooseProjectLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onDefaultProjectLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onCreateProject?: (request: WorkspaceCreateProjectRequest) => Promise<WorkspaceCreateProjectResult>;
  onImportSource?: (request: WorkspaceImportSourceRequest) => Promise<boolean>;
  onConnectImportSource?: (provider: string) => Promise<{ connectionId: string }>;
  onListImportResources?: (request: { provider: string; connectionId: string; parentId?: string | null; cursor?: string | null }) => Promise<WorkspaceImportResourcePage>;
  onCancelImportSource?: (taskId: string) => Promise<{ cancelled: boolean }>;
  onImportSourceProgress?: (listener: (progress: WorkspaceImportProgress) => void) => () => void;
  onOpenWorkspacePath: (path: string) => Promise<void>;
  onOpenDroppedWorkspace: (folder: File) => Promise<void>;
  onRemoveProject?: (path: string) => Promise<void>;
  recentWorkspaces?: RecentWorkspaceHomeItem[];
  projectItems?: ProjectHomeItem[];
  cloudAccountStatus?: ReactNode;
  cloudOpening?: boolean;
  onCancelCloudOpening?: () => void;
  onOpenCloudProject?: (projectId: string) => void;
  operationStatus?: OnboardingOperationStatus | null;
  initialError?: string | null;
  appearance: ResolvedSurfaceAppearance;
};

/** Homepage project list. Cloud catalog/auth is supplied by the host, not discovered by the view. */
export function MinimalOnboarding({
  projectEntryController,
  onChooseWorkspace,
  onChooseProjectLocation,
  onDefaultProjectLocation,
  onCreateProject,
  onImportSource,
  onConnectImportSource,
  onListImportResources,
  onCancelImportSource,
  onImportSourceProgress,
  onOpenWorkspacePath,
  onOpenDroppedWorkspace,
  onRemoveProject,
  recentWorkspaces = [],
  projectItems,
  cloudAccountStatus,
  cloudOpening = false,
  onCancelCloudOpening,
  onOpenCloudProject,
  initialError = null,
  appearance,
}: MinimalOnboardingProps) {
  const { t } = useLocalization();
  const [error, setError] = useState<string | null>(initialError);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const ownProjectEntryFlow = useProjectEntryFlow();
  const projectEntryFlow = projectEntryController ?? ownProjectEntryFlow;
  const enableOtherAppImports = useDesktopPreference(s => s.experimentalSettings.enableOtherAppImports);
  const importPreviewBrands = resolveImportPreviewBrands({ enableOtherAppImports });
  const items = useMemo(
    () => (projectItems ?? recentWorkspaces.map(({ workspace }) => ({
      id: workspace.id,
      label: workspace.name,
      localPath: workspace.path,
      lastModifiedAt: workspace.lastModifiedAt ?? null,
    }))),
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

  const busy = [openingPath, removingPath, cloudOpening].some(Boolean);
  const openingProject = isHomepageProjectOpening(openingPath, cloudOpening);
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
  const hasProjects = items.length > 0;
  const onboardingState: OnboardingHomeState = hasProjects ? "projects" : "empty";
  const [showEmptyStateIntro, setShowEmptyStateIntro] = useState(() => !hasProjects);
  const homepageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setShowEmptyStateIntro(!hasProjects);
  }, [hasProjects]);

  useEffect(() => {
    if (homepageRef.current) homepageRef.current.inert = showEmptyStateIntro || openingProject;
  }, [showEmptyStateIntro, openingProject]);

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
      <DesktopWindowChrome actions={cloudAccountStatus} />
      <section
        ref={homepageRef}
        className="onboarding-homepage"
        aria-label={t("onboarding.projects.title")}
        aria-hidden={showEmptyStateIntro || undefined}
        aria-busy={openingProject || undefined}
      >
        <OnboardingHomeLayout
          brand={<OnboardingBrandLockup state={onboardingState} resolvedTheme={resolvedTheme} />}
          primaryKind={hasProjects ? "projects" : "create"}
          primary={hasProjects ? (
            <OnboardingProjectList
              items={items}
              onOpenCloudProject={onOpenCloudProject}
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
            canImport={Boolean(onImportSource)}
            importPreviewBrands={importPreviewBrands}
            onOpenFolder={() => void chooseFolder()}
            onCreateProject={projectEntryFlow.openCreate}
            onImport={projectEntryFlow.openImport}
          />}
        />

        {error && <div className="onboarding-error onboarding-homepage-error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
      </section>
      <OnboardingProjectLoading open={openingProject} cloudOpening={cloudOpening} onCancel={onCancelCloudOpening} />
      {onboardingState === "empty" && (
        <OnboardingTelemetryDisclosure ready={!showEmptyStateIntro} />
      )}
      {!projectEntryController && <ProjectEntryFlow
        controller={projectEntryFlow}
        onDefaultLocation={onDefaultProjectLocation}
        onChooseLocation={onChooseProjectLocation}
        onCreateProject={onCreateProject}
        onImportSource={onImportSource}
        onConnectSource={onConnectImportSource}
        onListResources={onListImportResources}
        onCancelImport={onCancelImportSource}
        onImportProgress={onImportSourceProgress}
        onOpenFolder={() => void chooseFolder()}
      />}
      {showEmptyStateIntro && (
        <OnboardingEmptyStateIntro onComplete={completeEmptyStateIntro} />
      )}
    </main>
  );
}
