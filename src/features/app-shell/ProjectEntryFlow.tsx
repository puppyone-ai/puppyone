import { useLocalization } from "@puppyone/localization";
import { useDesktopPreference } from "../../preferencesStore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OnboardingImportDialog } from "../../components/OnboardingImportDialog";
import { OnboardingProjectEntryDialog } from "../../components/OnboardingProjectEntryDialog";
import { TemplateImportCard } from "../../components/TemplateImportCard";
import { looksLikeTemplateLink } from "../../../shared/desktop/template-link.mjs";
import type {
  WorkspaceImportSourceRequest,
  WorkspaceImportSourceResult,
  WorkspaceImportResourcePage,
  WorkspaceImportProgress,
  WorkspaceAppFolder,
  WorkspaceCreateProjectRequest,
  WorkspaceCreateProjectResult,
  WorkspaceProjectLocationGrant,
} from "../../types/electron";
import { ProjectEntryLauncherDialog } from "./ProjectEntryLauncherDialog";
import { ProjectNavigationFailure } from "./ProjectNavigationFailure";
import type { CloudSpace } from "../../lib/workspaceHomeModel";
import {
  resolveImportPreviewBrands,
  resolveVisibleImportSources,
} from "../project-import/importSourceRegistry";

export type ProjectEntryFlowStep = "launcher" | "create" | "template" | "import" | null;

export type ProjectEntryFlowController = Readonly<{
  step: ProjectEntryFlowStep;
  openLauncher: () => void;
  openCreate: () => void;
  /** `copied` says the link came from the clipboard rather than the store. */
  openTemplate: (url: string, options?: { copied?: boolean }) => void;
  templateUrl: string | null;
  templateCopied: boolean;
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
  const [templateCopied, setTemplateCopied] = useState(false);
  const openTemplate = useCallback((url: string, options?: { copied?: boolean }) => {
    setTemplateUrl(url);
    setTemplateCopied(options?.copied === true);
    setStep("template");
  }, []);
  const openLauncher = useCallback(() => setStep("launcher"), []);
  const openCreate = useCallback(() => setStep("create"), []);
  const openImport = useCallback(() => setStep("import"), []);
  const close = useCallback(() => { setTemplateUrl(null); setTemplateCopied(false); setStep(null); }, []);

  return useMemo(() => ({
    step,
    openLauncher,
    openCreate,
    openTemplate,
    templateUrl,
    templateCopied,
    openImport,
    close,
  }), [close, openCreate, openImport, openLauncher, openTemplate, step, templateCopied, templateUrl]);
}

export type ProjectEntryFlowProps = Readonly<{
  controller: ProjectEntryFlowController;
  onOpenFolder: () => void;
  onDefaultLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onChooseLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onCreateProject?: (
    request: WorkspaceCreateProjectRequest,
  ) => Promise<WorkspaceCreateProjectResult>;
  /** Cloud spaces a new project may be started in instead of this computer. */
  cloudSpaces?: readonly CloudSpace[];
  /** Starts an empty Cloud project in a space and opens it. */
  onCreateCloudProject?: (spaceId: string, name: string, operationId: string) => Promise<void>;
  /** Offers a project just created and opened here to the owner's other computers. */
  onShareWithMyDevices?: (path: string) => Promise<void>;
  onImportSource?: (request: WorkspaceImportSourceRequest) => Promise<WorkspaceImportSourceResult | null>;
  onConnectSource?: (provider: string) => Promise<{ connectionId: string }>;
  onListResources?: (request: { provider: string; connectionId: string; parentId?: string | null; cursor?: string | null }) => Promise<WorkspaceImportResourcePage>;
  onCancelImport?: (taskId: string) => Promise<{ cancelled: boolean }>;
  onImportProgress?: (listener: (progress: WorkspaceImportProgress) => void) => () => void;
  onListAppFolders?: (app: string) => Promise<WorkspaceAppFolder[]>;
  onAddAppFolders?: (request: { app: string; paths: string[] }) => Promise<{ added: number }>;
  /** A Project is open in this window; a template must not take its place. */
  projectIsOpen?: boolean;
  /**
   * A first launch with no projects yet. Someone who came from the store page
   * installed with its link copied, so it is offered once without a paste.
   */
  offerCopiedTemplate?: boolean;
}>;

const COPIED_TEMPLATE_CHECKED_KEY = "puppyone.desktop.copiedTemplateChecked.v1";

/** The clipboard is looked at once per profile, and never when that cannot be remembered. */
async function claimCopiedTemplateOnce(bridge: NonNullable<Window["puppyoneDesktop"]>) {
  try {
    if (window.localStorage.getItem(COPIED_TEMPLATE_CHECKED_KEY) === "true") return;
    window.localStorage.setItem(COPIED_TEMPLATE_CHECKED_KEY, "true");
  } catch {
    return;
  }
  await bridge.claimCopiedTemplateLink?.().catch((error: unknown) => {
    console.warn("Unable to look for a copied template link:", error);
  });
}

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
  cloudSpaces,
  onCreateCloudProject,
  onShareWithMyDevices,
  onImportSource,
  onConnectSource,
  onListResources,
  onCancelImport,
  onImportProgress,
  onListAppFolders,
  onAddAppFolders,
  projectIsOpen = false,
  offerCopiedTemplate = false,
}: ProjectEntryFlowProps) {
  const { t } = useLocalization();
  const [templateLinkFailed, setTemplateLinkFailed] = useState(false);
  const [templateLinkAttempt, setTemplateLinkAttempt] = useState(0);
  // A link from the store waits in Main until this window can show it, so someone
  // who followed one is told if it cannot be read, and it stays there for a retry.
  useEffect(() => {
    if (controller.step !== null || !onCreateProject) return;
    const bridge = window.puppyoneDesktop;
    if (!bridge?.readTemplateImportIntent) return;
    let active = true;
    const consume = async () => {
      try {
        if (offerCopiedTemplate) await claimCopiedTemplateOnce(bridge);
        const intent = await bridge.readTemplateImportIntent();
        if (!active || !intent) return;
        controller.openTemplate(intent.url, { copied: intent.copied === true });
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
  }, [controller, offerCopiedTemplate, onCreateProject, templateLinkAttempt]);
  // Apart from the one look on a first launch above, the clipboard is read only
  // when someone pastes, and only a template link is acted on. Anything else
  // keeps its usual paste.
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
  const importPreviewBrands = resolveImportPreviewBrands({ enableOtherAppImports });

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

  if (controller.step === "template" && controller.templateUrl && onCreateProject) {
    return (
      <TemplateImportCard
        key={controller.templateUrl}
        url={controller.templateUrl}
        copied={controller.templateCopied}
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
        cloudSpaces={cloudSpaces}
        onCreateCloudProject={onCreateCloudProject}
        // A project open here means a new one opens in its own window, which this
        // window cannot offer to the other computers.
        onShareWithMyDevices={projectIsOpen ? undefined : onShareWithMyDevices}
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
        onListAppFolders={onListAppFolders}
        onAddAppFolders={onAddAppFolders}
        visibleSources={visibleImportSources}
      />
    );
  }

  return null;
}
