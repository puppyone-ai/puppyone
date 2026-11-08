import { useLocalization } from "@puppyone/localization";
import { useDesktopPreference } from "../../preferencesStore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OnboardingImportDialog } from "../../components/OnboardingImportDialog";
import { OnboardingProjectEntryDialog } from "../../components/OnboardingProjectEntryDialog";
import { LocalTemplateImportCard, TemplateImportCard } from "../../components/TemplateImportCard";
import { looksLikeTemplateLink } from "../../../shared/desktop/template-link.mjs";
import type {
  LocalTemplateDetail,
  WorkspaceImportSourceRequest,
  WorkspaceImportResourcePage,
  WorkspaceImportProgress,
  WorkspaceCreateProjectRequest,
  WorkspaceCreateProjectResult,
  WorkspaceProjectLocationGrant,
} from "../../types/electron";
import { ProjectEntryLauncherDialog } from "./ProjectEntryLauncherDialog";
import { ProjectNavigationFailure } from "./ProjectNavigationFailure";
import {
  IMPORT_SOURCE_REGISTRY,
  resolveImportPreviewBrands,
  resolveVisibleImportSources,
} from "../project-import/importSourceRegistry";

export type ProjectEntryFlowStep = "launcher" | "create" | "template" | "local-template" | "import" | null;

export type ProjectEntryFlowController = Readonly<{
  step: ProjectEntryFlowStep;
  openLauncher: () => void;
  openCreate: () => void;
  openTemplate: (url: string) => void;
  templateUrl: string | null;
  localTemplate?: LocalTemplateDetail | null;
  openLocalTemplate?: (template: LocalTemplateDetail) => void;
  openImport: (provider?: string) => void;
  importSource?: string | null;
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
  const [localTemplate, setLocalTemplate] = useState<LocalTemplateDetail | null>(null);
  const openLocalTemplate = useCallback((template: LocalTemplateDetail) => { setLocalTemplate(template); setStep("local-template"); }, []);
  const openTemplate = useCallback((url: string) => { setTemplateUrl(url); setStep("template"); }, []);
  const openLauncher = useCallback(() => setStep("launcher"), []);
  const openCreate = useCallback(() => setStep("create"), []);
  const [importSource, setImportSource] = useState<string | null>(null);
  const openImport = useCallback((provider?: string) => { setImportSource(typeof provider === "string" ? provider : null); setStep("import"); }, []);
  const close = useCallback(() => { setTemplateUrl(null); setLocalTemplate(null); setStep(null); }, []);

  return useMemo(() => ({
    step,
    openLauncher,
    openCreate,
    openTemplate,
    templateUrl,
    localTemplate,
    openLocalTemplate,
    openImport,
    importSource,
    close,
  }), [close, openCreate, openImport, openLauncher, openTemplate, openLocalTemplate, localTemplate, step, templateUrl, importSource]);
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
  /** A Project is open in this window; a template must not take its place. */
  projectIsOpen?: boolean;
}>;

/** Text being edited keeps its paste, whatever the text happens to be. */
function isEditingText(target: EventTarget | null) {
  return target instanceof Element
    && target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']") !== null;
}

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
  projectIsOpen = false,
}: ProjectEntryFlowProps) {
  const { t } = useLocalization();
  const [templateLinkFailed, setTemplateLinkFailed] = useState(false);
  const [templateLinkAttempt, setTemplateLinkAttempt] = useState(0);
  const [localTemplateError, setLocalTemplateError] = useState<string | null>(null);
  // A link from the store waits in Main until this window can show it, so someone
  // who followed one is told if it cannot be read, and it stays there for a retry.
  useEffect(() => {
    if (controller.step !== null || !onCreateProject) return;
    const bridge = window.puppyoneDesktop;
    if (!bridge?.readTemplateImportIntent) return;
    let active = true;
    const consume = async () => {
      try {
        const intent = await bridge.readTemplateImportIntent();
        if (!active || !intent) return;
        if (intent.kind === "local-template") controller.openLocalTemplate?.(intent.detail);
        else if (intent.kind === "source") controller.openImport(intent.provider);
        else controller.openTemplate(intent.url);
        // The card is up by now. A link left unacknowledged only comes round again.
        await bridge.acknowledgeTemplateImportIntent(intent.id).catch((error: unknown) => {
          console.warn("Unable to acknowledge the template link:", error);
        });
      } catch (error) {
        console.warn("Unable to read the template link:", error);
        if (active) setTemplateLinkFailed(true);
      }
    };
    const stop = bridge.onTemplateImportRequested(() => { void consume(); });
    void consume();
    return () => { active = false; stop(); };
  }, [controller, onCreateProject, templateLinkAttempt]);
  useEffect(() => {
    const bridge = window.puppyoneDesktop;
    if (!onCreateProject || !bridge?.openLocalTemplateFile) return;
    let active = true;
    let latestRequest = 0;
    const onDragOver = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      const file = files.find(item => item.name.toLowerCase().endsWith(".puppyonetemplate"));
      if (!file) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (controller.step !== null || files.length !== 1) return;
      setLocalTemplateError(null);
      const request = ++latestRequest;
      void bridge.openLocalTemplateFile(file).then(detail => {
        if (active && request === latestRequest && controller.step === null) controller.openLocalTemplate?.(detail);
      }).catch((error: unknown) => {
        if (active && request === latestRequest) setLocalTemplateError(error instanceof Error ? error.message : String(error));
      });
    };
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    return () => { active = false; document.removeEventListener("dragover", onDragOver, true); document.removeEventListener("drop", onDrop, true); };
  }, [controller, onCreateProject]);
  // Pasting is the user's own action, so its text is read only then, and only a
  // template link is acted on. Anything else keeps its usual paste.
  useEffect(() => {
    if (controller.step !== null || !onCreateProject) return undefined;
    const onPaste = (event: ClipboardEvent) => {
      if (isEditingText(event.target)) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!looksLikeTemplateLink(text)) return;
      event.preventDefault();
      controller.openTemplate(text.trim());
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [controller, onCreateProject]);
  const enableOtherAppImports = useDesktopPreference(s => s.experimentalSettings.enableOtherAppImports);
  const visibleImportSources = resolveVisibleImportSources({ enableOtherAppImports });
  const requestedSource = IMPORT_SOURCE_REGISTRY.find(source => source.id === controller.importSource && source.operational);
  if (requestedSource && !visibleImportSources.some(source => source.id === requestedSource.id)) visibleImportSources.push(requestedSource);
  const importPreviewBrands = resolveImportPreviewBrands({ enableOtherAppImports });

  if (localTemplateError && controller.step === null) return <ProjectNavigationFailure title={t("onboarding.template.linkFailedTitle")} message={localTemplateError} onClose={() => setLocalTemplateError(null)} />;

  if (templateLinkFailed && controller.step === null) {
    return (
      <ProjectNavigationFailure
        title={t("onboarding.template.linkFailedTitle")}
        message={t("onboarding.template.linkFailed")}
        onClose={() => setTemplateLinkFailed(false)}
        onRetry={() => {
          setTemplateLinkFailed(false);
          setTemplateLinkAttempt((attempt) => attempt + 1);
        }}
      />
    );
  }

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

  if (controller.step === "local-template" && controller.localTemplate && onCreateProject) {
    return <LocalTemplateImportCard key={controller.localTemplate.id} template={controller.localTemplate} openInNewWindow onClose={controller.close} onDefaultLocation={onDefaultLocation} onChooseLocation={onChooseLocation} onSubmit={onCreateProject} />;
  }

  if (controller.step === "template" && controller.templateUrl && onCreateProject) {
    return (
      <TemplateImportCard
        key={controller.templateUrl}
        url={controller.templateUrl}
        openInNewWindow={projectIsOpen}
        onClose={controller.close}
        onDefaultLocation={onDefaultLocation}
        onChooseLocation={onChooseLocation}
        onSubmit={onCreateProject}
      />
    );
  }

  if (controller.step === "create" && onCreateProject && onChooseLocation) {
    return (
      <OnboardingProjectEntryDialog
        onOpenTemplate={controller.openTemplate}
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
        key={controller.importSource ?? "sources"}
        initialSource={controller.importSource}
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
