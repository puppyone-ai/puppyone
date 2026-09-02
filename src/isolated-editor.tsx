import "./styles/cascade.css";
import "./styles/isolated-editor.css";

import React, { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { LocalizationProvider } from "@puppyone/localization/react";
import { PdfDocumentPreview } from "@puppyone/shared-ui/pdf-document-preview";
import { bootstrapRendererLocalization } from "./localization";
import { LoadingAnimationProvider, PageLoading } from "./components/loading";
import { parseLoadingAnimationPreset } from "./preferences";

type SurfaceBootstrap = Readonly<{
  sessionId: string;
  viewerId: "pdf-preview";
  resourceUrl: string;
  title: string;
  safeMode: boolean;
  resourcePolicy: Readonly<{
    memoryClass: "small" | "medium" | "large";
    maxSourceBytes: number;
    maxCanvasPixels: number;
    maxActiveCanvases: number;
    maxWorkers: number;
  }>;
  appearance: SurfaceAppearance;
}>;

type SurfaceAppearance = Readonly<{
  dark: boolean;
  direction: "ltr" | "rtl";
  attributes: Readonly<Record<string, string>>;
  variables: Readonly<Record<string, string>>;
}>;

const bridge = requireEditorSurfaceBridge();
const rootElement = requireRootElement();
const appliedAppearanceAttributes = new Set<string>();
const appliedAppearanceVariables = new Set<string>();

function IsolatedEditorSurface() {
  const [bootstrap, setBootstrap] = useState<SurfaceBootstrap | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void bridge.getBootstrap().then((next) => {
      if (cancelled) return;
      applyAppearance(next.appearance);
      setReady(false);
      setBootstrap(next);
    }).catch((error) => {
      if (cancelled) return;
      bridge.reportError({
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => bridge.onAppearance((appearance) => {
    applyAppearance(appearance);
    setBootstrap((current) => current ? { ...current, appearance } : current);
  }), []);

  useEffect(() => {
    if (!bootstrap) return undefined;
    const root = rootElement;
    let reported = false;
    const reportWhenReady = () => {
      if (reported) return;
      if (root.querySelector('[data-preview-state="ready"]')) {
        reported = true;
        setReady(true);
        bridge.reportReady({ sessionId: bootstrap.sessionId });
      }
    };
    const observer = new MutationObserver(reportWhenReady);
    observer.observe(root, { attributes: true, childList: true, subtree: true });
    reportWhenReady();
    return () => observer.disconnect();
  }, [bootstrap]);

  if (!bootstrap) {
    return (
      <div className="isolated-editor-surface" aria-busy="true">
        <PageLoading variant="fill" label={null} />
      </div>
    );
  }
  if (bootstrap.viewerId !== "pdf-preview") {
    throw new Error(`Unsupported isolated Viewer ${bootstrap.viewerId}.`);
  }
  return (
    <LoadingAnimationProvider preset={parseLoadingAnimationPreset(
      bootstrap.appearance.attributes["data-loading-animation-preset"],
    )}>
      <div className="isolated-editor-surface" data-po-appearance-root>
        <div
          className="po-viewer-surface-boundary isolated-editor-viewer-boundary"
          data-viewer-id="pdf-preview"
          data-viewer-surface-family="document"
          data-viewer-surface-traits="paginated zoomable scrollable"
        >
          <PdfDocumentPreview
            url={bootstrap.resourceUrl}
            title={bootstrap.title}
            safeMode={bootstrap.safeMode}
            resourcePolicy={bootstrap.resourcePolicy}
          />
          {!ready ? (
            <div className="isolated-editor-loading-state">
              <PageLoading variant="fill" label={null} />
            </div>
          ) : null}
        </div>
      </div>
    </LoadingAnimationProvider>
  );
}

class SurfaceErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    bridge.reportError({
      message: error instanceof Error ? error.message : String(error),
      componentStack: info.componentStack?.slice(0, 2_000),
    });
  }

  render() {
    if (this.state.error) return <div className="editor-crash-state" role="alert" />;
    return this.props.children;
  }
}

function applyAppearance(appearance: SurfaceAppearance) {
  const root = document.documentElement;
  root.classList.toggle("dark", appearance.dark);
  root.dir = appearance.direction;
  root.style.colorScheme = appearance.dark ? "dark" : "light";
  root.setAttribute("data-po-appearance-root", "");
  for (const name of appliedAppearanceAttributes) {
    if (!(name in appearance.attributes)) root.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(appearance.attributes)) {
    root.setAttribute(name, value);
    appliedAppearanceAttributes.add(name);
  }
  for (const name of appliedAppearanceVariables) {
    if (!(name in appearance.variables)) root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(appearance.variables)) {
    root.style.setProperty(name, value);
    appliedAppearanceVariables.add(name);
  }
}

async function render() {
  const localization = await bootstrapRendererLocalization();
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <LocalizationProvider
        initialState={localization.state}
        initialCatalog={localization.catalog}
        fallbackCatalog={localization.fallbackCatalog}
        loadCatalog={localization.loadCatalog}
        client={localization.client}
      >
        <SurfaceErrorBoundary>
          <IsolatedEditorSurface />
        </SurfaceErrorBoundary>
      </LocalizationProvider>
    </React.StrictMode>,
  );
}

void render().catch((error) => {
  bridge.reportError({ message: error instanceof Error ? error.message : String(error) });
});

function requireEditorSurfaceBridge(): NonNullable<typeof window.puppyoneEditorSurface> {
  const candidate = window.puppyoneEditorSurface;
  if (!candidate) throw new Error("PuppyOne isolated Editor Surface bridge is unavailable.");
  return candidate;
}

function requireRootElement(): HTMLElement {
  const candidate = document.getElementById("root");
  if (!candidate) throw new Error("PuppyOne isolated Editor Surface root is unavailable.");
  return candidate;
}
