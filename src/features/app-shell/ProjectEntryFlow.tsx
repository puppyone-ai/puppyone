import { useDesktopPreference } from "../../preferencesStore";
import { useCloudEnabled } from "../flags";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OnboardingImportDialog } from "../../components/OnboardingImportDialog";
import { OnboardingProjectEntryDialog } from "../../components/OnboardingProjectEntryDialog";
import type {
  WorkspaceImportSourceRequest,
  WorkspaceImportResourcePage,
  WorkspaceImportProgress,
  WorkspaceCreateProjectRequest,
  WorkspaceCreateProjectResult,
  WorkspaceProjectLocationGrant,
} from "../../types/electron";
import { ProjectEntryLauncherDialog } from "./ProjectEntryLauncherDialog";
import {
  resolveImportPreviewBrands,
  resolveVisibleImportSources,
} from "../project-import/importSourceRegistry";

export type ProjectEntryFlowStep = "launcher" | "create" | "import" | null;

export type ProjectEntryFlowController = Readonly<{
  step: ProjectEntryFlowStep;
  openLauncher: () => void;
  openCreate: () => void;
  openTemplate: (url: string) => void;
  templateUrl: string | null;
  openImport: () => void;
  close: () => void;
}>;

/**
 * One state machine for every way into a local Project. Surfaces may expose
 * different entry affordances, but they must hand off to this controller and
 * render the same flow below.
 */
export function useProjectEntryFlow(): ProjectEntryFlowController {
  const [step, setStep] = useState<ProjectEntryFlowStep>(null);
  const [templateUrl, setTemplateUrl] = useState<string | null>(null);
  const openTemplate = useCallback((url: string) => { setTemplateUrl(url); setStep("create"); }, []);
  const openLauncher = useCallback(() => setStep("launcher"), []);
  const openCreate = useCallback(() => { setTemplateUrl(null); setStep("create"); }, []);
  const openImport = useCallback(() => setStep("import"), []);
  const close = useCallback(() => setStep(null), []);

  return useMemo(() => ({
    step,
    openLauncher,
    openCreate,
    openTemplate,
    templateUrl,
    openImport,
    close,
  }), [close, openCreate, openImport, openLauncher, openTemplate, step, templateUrl]);
}

export type ProjectEntryFlowProps = Readonly<{
  controller: ProjectEntryFlowController;
  onOpenFolder: () => void;
  onDefaultLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onChooseLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onCreateProject?: (
    request: WorkspaceCreateProjectRequest,
  ) => Promise<WorkspaceCreateProjectResult>;
  onImportSource?: (request: WorkspaceImportSourceRequest) => Promise<boolean>;
  onConnectSource?: (provider: string) => Promise<{ connectionId: string }>;
  onListResources?: (request: { provider: string; connectionId: string; parentId?: string | null; cursor?: string | null }) => Promise<WorkspaceImportResourcePage>;
  onCancelImport?: (taskId: string) => Promise<{ cancelled: boolean }>;
  onImportProgress?: (listener: (progress: WorkspaceImportProgress) => void) => () => void;
}>;

export function ProjectEntryFlow({
  controller,
  onOpenFolder,
  onDefaultLocation,
  onChooseLocation,
  onCreateProject,
  onImportSource,
  onConnectSource,
  onListResources,
  onCancelImport,
  onImportProgress,
}: ProjectEntryFlowProps) {
  // Marketplace templates download through a PuppyOne account. While Cloud is
  // off, links from the store stay pending in main and are not consumed.
  const templateLinksEnabled = useCloudEnabled();
  useEffect(() => {
    if (!templateLinksEnabled || controller.step !== null || !onCreateProject) return;
    const bridge = window.puppyoneDesktop;
    if (!bridge?.readTemplateImportIntent) return;
    let active = true;
    const consume = async () => {
      const intent = await bridge.readTemplateImportIntent();
      if (active && intent) {
        controller.openTemplate(intent.url);
        await bridge.acknowledgeTemplateImportIntent(intent.id);
      }
    };
    const stop = bridge.onTemplateImportRequested(() => { void consume().catch(() => {}); });
    void consume().catch(() => {});
    return () => { active = false; stop(); };
  }, [controller, onCreateProject, templateLinksEnabled]);
  const enableOtherAppImports = useDesktopPreference(s => s.experimentalSettings.enableOtherAppImports);
  const visibleImportSources = resolveVisibleImportSources({ enableOtherAppImports });
  const importPreviewBrands = resolveImportPreviewBrands({ enableOtherAppImports });

  if (controller.step === "launcher") {
    return (
      <ProjectEntryLauncherDialog
        canCreateProject={Boolean(onCreateProject && onChooseLocation)}
        canImport={Boolean(onImportSource)}
        importPreviewBrands={importPreviewBrands}
        onClose={controller.close}
        onOpenFolder={() => {
          controller.close();
          onOpenFolder();
        }}
        onCreateProject={controller.openCreate}
        onImport={controller.openImport}
      />
    );
  }

  if (controller.step === "create" && onCreateProject && onChooseLocation) {
    return (
      <OnboardingProjectEntryDialog
        templateLinks={templateLinksEnabled}
        initialTemplateUrl={controller.templateUrl}
        onClose={controller.close}
        onDefaultLocation={onDefaultLocation}
        onChooseLocation={onChooseLocation}
        onSubmit={onCreateProject}
      />
    );
  }

  if (controller.step === "import" && onImportSource && onConnectSource && onListResources && onCancelImport && onImportProgress) {
    return (
      <OnboardingImportDialog
        onClose={controller.close}
        onDefaultLocation={onDefaultLocation}
        onChooseLocation={onChooseLocation}
        onImportSource={onImportSource}
        onConnectSource={onConnectSource}
        onListResources={onListResources}
        onCancelImport={onCancelImport}
        onImportProgress={onImportProgress}
        visibleSources={visibleImportSources}
      />
    );
  }

  return null;
}
