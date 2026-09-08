"use client";

import {
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import { useLocalization } from "@puppyone/localization/react";
import { DocumentSurfacePending } from "./DocumentSurfaceHost";
import type {
  LazyPresetViewerContribution,
  PresetViewerContribution,
  PresetViewerRenderContext,
} from "../registry/viewerTypes";
import { usePresetViewerRuntimeHost } from "./PresetViewerRuntimeHost";

const lazyRenderers = new WeakMap<
  LazyPresetViewerContribution,
  LazyExoticComponent<ComponentType<PresetViewerRenderContext>>
>();
const rendererModulePromises = new WeakMap<
  LazyPresetViewerContribution,
  ReturnType<LazyPresetViewerContribution["load"]>
>();

/** Starts a lazy viewer download without mounting it. Module evaluation stays
 * deduplicated and the same promise is later consumed by React.lazy. */
export function preloadPresetViewer(viewer: PresetViewerContribution): Promise<void> {
  if (viewer.surfaceIsolation === "isolated-webcontents") return Promise.resolve();
  if ("render" in viewer && typeof viewer.render === "function") return Promise.resolve();
  return loadRendererModule(viewer as LazyPresetViewerContribution).then(() => undefined);
}

export function PresetViewerRenderer({
  viewer,
  context,
  loadingIndicator,
}: {
  viewer: PresetViewerContribution;
  context: PresetViewerRenderContext;
  loadingIndicator?: ReactNode;
}) {
  const { t } = useLocalization();
  const runtimeHost = usePresetViewerRuntimeHost();
  if (viewer.surfaceIsolation === "isolated-webcontents") {
    return (
      <ViewerSurfaceBoundary viewer={viewer}>
        {runtimeHost ? runtimeHost.renderIsolatedSurface({ viewer, context }) : (
          <div className="editor-state editor-state--stacked danger" role="alert">
            <strong>{t("editor.unavailable.title")}</strong>
            <span>{t("editor.viewer.noHostSurface")}</span>
          </div>
        )}
      </ViewerSurfaceBoundary>
    );
  }
  if ("render" in viewer && typeof viewer.render === "function") {
    return (
      <ViewerSurfaceBoundary viewer={viewer}>
        {viewer.render(context)}
      </ViewerSurfaceBoundary>
    );
  }

  const LazyRenderer = getLazyRenderer(viewer as LazyPresetViewerContribution);
  return (
    <ViewerSurfaceBoundary viewer={viewer}>
      <Suspense fallback={(
        <DocumentSurfacePending label={t("editor.loadingViewer")}>
          {loadingIndicator}
        </DocumentSurfacePending>
      )}>
        <LazyRenderer {...context} />
      </Suspense>
    </ViewerSurfaceBoundary>
  );
}

export function ViewerSurfaceBoundary({
  viewer,
  children,
}: {
  viewer: PresetViewerContribution;
  children: ReactNode;
}) {
  return (
    <div
      className="po-viewer-surface-boundary"
      data-viewer-id={viewer.id}
      data-viewer-surface-family={viewer.surfaceFamily}
      data-viewer-surface-traits={viewer.surfaceTraits.join(" ") || undefined}
      data-viewer-surface-isolation={viewer.surfaceIsolation}
      data-viewer-compute-isolation={viewer.computeIsolation}
      data-viewer-content-sandbox={viewer.contentSandbox}
      data-viewer-memory-class={viewer.resourcePolicy.memoryClass}
    >
      {children}
    </div>
  );
}

function getLazyRenderer(viewer: LazyPresetViewerContribution) {
  const cached = lazyRenderers.get(viewer);
  if (cached) return cached;
  const renderer = lazy(() => loadRendererModule(viewer));
  lazyRenderers.set(viewer, renderer);
  return renderer;
}

function loadRendererModule(viewer: LazyPresetViewerContribution) {
  const cached = rendererModulePromises.get(viewer);
  if (cached) return cached;
  const modulePromise = viewer.load();
  rendererModulePromises.set(viewer, modulePromise);
  void modulePromise.catch(() => {
    if (rendererModulePromises.get(viewer) === modulePromise) {
      rendererModulePromises.delete(viewer);
    }
  });
  return modulePromise;
}
