import "./styles/cascade.css";
import "./cloud-globals.css";
import "./styles.css";

import React from "react";
import ReactDOM from "react-dom/client";
import {
  flushActiveDocumentSessions,
  PresetViewerRuntimeHostProvider,
} from "@puppyone/shared-ui";
import { LocalizationProvider } from "@puppyone/localization/react";
import { App } from "./App";
import { ScrollbarActivity } from "./components/ScrollbarActivity";
import { ApplicationRenderBoundary } from "./components/ApplicationRenderBoundary";
import { FeatureFlagsProvider } from "./features/flags";
import { TypographyCatalogProvider } from "./features/typography";
import { bootstrapRendererLocalization } from "./localization";
import { startMarkdownFormatShortcutBridge } from "./lib/markdownFormatShortcutBridge";
import { desktopPresetViewerRuntimeHost } from "./features/editor-surfaces";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("PuppyOne renderer root is unavailable.");

let activeCloseRequestId: string | null = null;
let previouslyFocusedElement: HTMLElement | null = null;
const setCloseInteractionBarrier = (locked: boolean) => {
  if (locked) {
    previouslyFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    rootElement.inert = true;
    rootElement.setAttribute("aria-busy", "true");
    return;
  }
  rootElement.inert = false;
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
      await flushActiveDocumentSessions(reason);
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
}, { once: true });

const root = ReactDOM.createRoot(rootElement);

async function renderApplication() {
  const localization = await bootstrapRendererLocalization();
  let surface: React.ReactNode;

  if (window.location.hash === "#auxiliary-appearance-smoke") {
    const { AuxiliaryAppearanceSmokeHarness } = await import("./features/appearance/AuxiliaryAppearanceSmokeHarness");
    surface = <AuxiliaryAppearanceSmokeHarness />;
  } else if (window.location.hash === "#terminal-launcher-visual-smoke") {
    const { TerminalLauncherVisualSmokeHarness } = await import(
      "./features/desktop-terminal/visual-smoke"
    );
    surface = <TerminalLauncherVisualSmokeHarness />;
  } else if (window.location.hash === "#terminal-split-visual-smoke") {
    const { TerminalSplitVisualSmokeHarness } = await import(
      "./features/desktop-terminal/visual-smoke"
    );
    surface = <TerminalSplitVisualSmokeHarness />;
  } else if (window.location.hash === "#agent-visual-smoke") {
    const { AgentVisualSmokeHarness } = await import("./features/desktop-agent/visual-smoke");
    surface = <AgentVisualSmokeHarness />;
  } else if (window.location.hash === "#agent-render-stability-smoke") {
    const { AgentRenderStabilitySmokeHarness } = await import("./features/desktop-agent/visual-smoke");
    surface = <AgentRenderStabilitySmokeHarness />;
  } else if (window.location.hash === "#agent-tool-stability-smoke") {
    const { AgentToolStabilitySmokeHarness } = await import("./features/desktop-agent/visual-smoke");
    surface = <AgentToolStabilitySmokeHarness />;
  } else if (window.location.hash === "#renderer-performance-smoke") {
    const { RendererPerformanceSmokeHarness } = await import("./performance/RendererPerformanceSmokeHarness");
    surface = <RendererPerformanceSmokeHarness />;
  } else if (window.location.hash === "#csv-editor-performance-smoke") {
    const { CsvEditorPerformanceSmokeHarness } = await import("./performance/CsvEditorPerformanceSmokeHarness");
    surface = <CsvEditorPerformanceSmokeHarness />;
  } else if (window.location.hash === "#markdown-line-geometry-smoke") {
    const { MarkdownLineGeometrySmokeHarness } = await import("./performance/MarkdownLineGeometrySmokeHarness");
    surface = <MarkdownLineGeometrySmokeHarness />;
  } else if (window.location.hash === "#markdown-theme-inheritance-smoke") {
    const { MarkdownThemeInheritanceSmokeHarness } = await import(
      "./features/appearance/MarkdownThemeInheritanceSmokeHarness"
    );
    surface = <MarkdownThemeInheritanceSmokeHarness />;
  } else if (window.location.hash === "#appearance-visual-smoke") {
    const { AppearanceVisualSmokeHarness } = await import(
      "./features/appearance/AppearanceVisualSmokeHarness"
    );
    surface = <AppearanceVisualSmokeHarness />;
  } else if (window.location.hash === "#workspace-menu-visual-smoke") {
    const { WorkspaceMenuVisualSmokeHarness } = await import(
      "./features/app-shell/WorkspaceMenuVisualSmokeHarness"
    );
    surface = <WorkspaceMenuVisualSmokeHarness />;
  } else {
    surface = (
      <TypographyCatalogProvider>
        <FeatureFlagsProvider>
          <PresetViewerRuntimeHostProvider
            adapter={window.puppyoneDesktop?.editorSurfaces
              ? desktopPresetViewerRuntimeHost
              : null}
          >
            <App />
          </PresetViewerRuntimeHostProvider>
        </FeatureFlagsProvider>
      </TypographyCatalogProvider>
    );
  }

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
        </ApplicationRenderBoundary>
      </LocalizationProvider>
    </React.StrictMode>,
  );
}

void renderApplication().catch((error) => {
  console.error("PuppyOne renderer localization bootstrap failed:", error);
});
