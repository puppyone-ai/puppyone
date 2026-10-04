import "./styles/cascade.css";
import "./cloud-globals.css";
import "./styles.css";

import React from "react";
import ReactDOM from "react-dom/client";
import {
  flushActiveDocumentSessions,
  retireEditorTasks,
  holdEditorRuntimeAdmission,
  reconcilePendingDocumentOperations,
} from "@puppyone/shared-ui";
import { LocalizationProvider } from "@puppyone/localization/react";
import { App } from "./App";
import { ScrollbarActivity } from "./components/ScrollbarActivity";
import { ApplicationRenderBoundary } from "./components/ApplicationRenderBoundary";
import { DesktopTooltipLayer } from "./components/DesktopTooltipLayer";
import { FeatureFlagsProvider } from "./features/flags";
import { TypographyCatalogProvider } from "./features/typography";
import { bootstrapRendererLocalization } from "./localization";
import { startMarkdownFormatShortcutBridge } from "./lib/markdownFormatShortcutBridge";
import { installNativeTitleSuppression } from "./lib/nativeTitleSuppression";
import { startDesktopMermaidClient } from "./platform/mermaid/desktopMermaidClient";
import { readDesktopPlatformCapabilities } from "./platform/desktopPlatformClient";

const rootElement = document.getElementById("root");
const stopNativeTitleSuppression = installNativeTitleSuppression();
startDesktopMermaidClient();
if (!rootElement) throw new Error("PuppyOne renderer root is unavailable.");

let activeCloseRequestId: string | null = null;
let releaseRuntimeAdmission: (() => void) | null = null;
let previouslyFocusedElement: HTMLElement | null = null;
const setCloseInteractionBarrier = (locked: boolean) => {
  if (locked) {
    releaseRuntimeAdmission ??= holdEditorRuntimeAdmission();
    previouslyFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    rootElement.inert = true;
    rootElement.setAttribute("aria-busy", "true");
    return;
  }
  rootElement.inert = false;
  releaseRuntimeAdmission?.();
  releaseRuntimeAdmission = null;
  rootElement.removeAttribute("aria-busy");
  const focusTarget = previouslyFocusedElement;
  previouslyFocusedElement = null;
  if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
};

const stopDocumentSessionFlushListener = window.puppyoneDesktop
  ?.onDocumentSessionFlushRequested?.(async ({ requestId, reason }) => {
    const closesWindow = reason === "app-close";
    if (closesWindow) {
      activeCloseRequestId = requestId;
      setCloseInteractionBarrier(true);
    }
    try {
      if (closesWindow) await reconcilePendingDocumentOperations();
      await flushActiveDocumentSessions(reason);
      if (closesWindow) await retireEditorTasks();
    } catch (error) {
      if (closesWindow && activeCloseRequestId === requestId) {
        activeCloseRequestId = null;
        setCloseInteractionBarrier(false);
      }
      throw error;
    }
  });
const stopDocumentSessionCloseCancelledListener = window.puppyoneDesktop
  ?.onDocumentSessionCloseCancelled?.(({ requestId }) => {
    if (activeCloseRequestId !== requestId) return;
    activeCloseRequestId = null;
    setCloseInteractionBarrier(false);
  });
const stopMarkdownFormatShortcutBridge = startMarkdownFormatShortcutBridge();
window.addEventListener("pagehide", () => {
  stopDocumentSessionFlushListener?.();
  stopDocumentSessionCloseCancelledListener?.();
  stopMarkdownFormatShortcutBridge();
  stopNativeTitleSuppression();
}, { once: true });

const root = ReactDOM.createRoot(rootElement);

const smokeSurfaces = new Map<string, () => Promise<React.ReactNode>>([
  ["#auxiliary-appearance-smoke", async () => {
    const { AuxiliaryAppearanceSmokeHarness } = await import("./features/appearance/AuxiliaryAppearanceSmokeHarness");
    return <AuxiliaryAppearanceSmokeHarness />;
  }],
  ["#terminal-launcher-visual-smoke", async () => {
    const { TerminalLauncherVisualSmokeHarness } = await import("./features/desktop-terminal/visual-smoke");
    return <TerminalLauncherVisualSmokeHarness />;
  }],
  ["#terminal-split-visual-smoke", async () => {
    const { TerminalSplitVisualSmokeHarness } = await import("./features/desktop-terminal/visual-smoke");
    return <TerminalSplitVisualSmokeHarness />;
  }],
  ["#agent-visual-smoke", async () => {
    const { AgentVisualSmokeHarness } = await import("./features/desktop-agent/visual-smoke");
    return <AgentVisualSmokeHarness />;
  }],
  ["#agent-render-stability-smoke", async () => {
    const { AgentRenderStabilitySmokeHarness } = await import("./features/desktop-agent/visual-smoke");
    return <AgentRenderStabilitySmokeHarness />;
  }],
  ["#agent-tool-stability-smoke", async () => {
    const { AgentToolStabilitySmokeHarness } = await import("./features/desktop-agent/visual-smoke");
    return <AgentToolStabilitySmokeHarness />;
  }],
  ["#renderer-performance-smoke", async () => {
    const { RendererPerformanceSmokeHarness } = await import("./performance/RendererPerformanceSmokeHarness");
    return <RendererPerformanceSmokeHarness />;
  }],
  ["#csv-editor-performance-smoke", async () => {
    const { CsvEditorPerformanceSmokeHarness } = await import("./performance/CsvEditorPerformanceSmokeHarness");
    return <CsvEditorPerformanceSmokeHarness />;
  }],
  ["#markdown-line-geometry-smoke", async () => {
    const { MarkdownLineGeometrySmokeHarness } = await import("./performance/MarkdownLineGeometrySmokeHarness");
    return <MarkdownLineGeometrySmokeHarness />;
  }],
  ["#markdown-theme-inheritance-smoke", async () => {
    const { MarkdownThemeInheritanceSmokeHarness } = await import("./features/appearance/MarkdownThemeInheritanceSmokeHarness");
    return <MarkdownThemeInheritanceSmokeHarness />;
  }],
  ["#appearance-visual-smoke", async () => {
    const { AppearanceVisualSmokeHarness } = await import("./features/appearance/AppearanceVisualSmokeHarness");
    return <AppearanceVisualSmokeHarness />;
  }],
  ["#account-cloud-workbench-smoke", async () => {
    const { AccountCloudWorkbenchSmokeHarness } = await import("./features/cloud/workbench/AccountCloudWorkbenchSmokeHarness");
    return <AccountCloudWorkbenchSmokeHarness />;
  }],
  ["#native-cloud-workbench-smoke", async () => {
    const { NativeCloudWorkbenchSmokeHarness } = await import("./features/cloud/workbench/NativeCloudWorkbenchSmokeHarness");
    return <NativeCloudWorkbenchSmokeHarness />;
  }],
  ["#workspace-menu-visual-smoke", async () => {
    const { WorkspaceMenuVisualSmokeHarness } = await import("./features/app-shell/WorkspaceMenuVisualSmokeHarness");
    return <WorkspaceMenuVisualSmokeHarness />;
  }],
  ["#header-coachmark-visual-smoke", async () => {
    const { HeaderCoachmarkVisualSmokeHarness } = await import("./features/app-shell/HeaderCoachmarkVisualSmokeHarness");
    return <HeaderCoachmarkVisualSmokeHarness />;
  }],
]);

async function renderApplication() {
  const [localization, platformCapabilities] = await Promise.all([
    bootstrapRendererLocalization(),
    readDesktopPlatformCapabilities(),
  ]);
  if (platformCapabilities) {
    document.documentElement.dataset.desktopPlatform = platformCapabilities.platform;
  } else {
    delete document.documentElement.dataset.desktopPlatform;
  }
  const loadSmokeSurface = smokeSurfaces.get(window.location.hash);
  const surface = loadSmokeSurface ? await loadSmokeSurface() : (
    <TypographyCatalogProvider>
      <FeatureFlagsProvider>
        <App />
      </FeatureFlagsProvider>
    </TypographyCatalogProvider>
  );

  root.render(
    <React.StrictMode>
      <LocalizationProvider
        initialState={localization.state}
        initialCatalog={localization.catalog}
        fallbackCatalog={localization.fallbackCatalog}
        loadCatalog={localization.loadCatalog}
        client={localization.client}
      >
        <ApplicationRenderBoundary>
          <ScrollbarActivity />
          {surface}
          <DesktopTooltipLayer />
        </ApplicationRenderBoundary>
      </LocalizationProvider>
    </React.StrictMode>,
  );
}

void renderApplication().catch((error) => {
  console.error("PuppyOne renderer localization bootstrap failed:", error);
});
