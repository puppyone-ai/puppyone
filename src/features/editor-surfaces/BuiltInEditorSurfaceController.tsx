import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import type { PresetViewerContribution, PresetViewerRenderContext } from "@puppyone/shared-ui";
import { PageLoading } from "../../components/loading";
import {
  measureNativeSurfaceBounds,
  useNativeSurfaceGeometry,
  type NativeSurfaceGeometry,
} from "../native-surfaces";
import "./editor-surfaces.css";

type SurfaceStatus = "activating" | "loading" | "ready" | "unresponsive" | "crashed" | "error";
const FALLBACK_GEOMETRY: NativeSurfaceGeometry = Object.freeze({
  bounds: Object.freeze({ x: 0, y: 0, width: 640, height: 480 }),
  revision: 0,
  visible: true,
});

const APPEARANCE_ATTRIBUTES = [
  "data-root-theme-id",
  "data-interface-style",
  "data-interface-style-family",
  "data-interface-style-variant",
  "data-interface-style-palette",
  "data-appearance-token-set",
  "data-shell-composition",
  "data-titlebar-composition",
  "data-navigation-composition",
  "data-location-bar-composition",
  "data-scrollbar-composition",
  "data-icon-pack",
  "data-sub-theme-id",
  "data-theme-mode",
  "data-content-text-size",
  "data-loading-animation-preset",
  "data-pointer-cursors",
  "data-diff-markers",
  "data-font-ui",
  "data-font-ui-category",
  "data-font-content",
  "data-font-content-category",
  "data-font-editor-content-mode",
  "data-font-editor-content",
  "data-font-code",
  "data-font-code-category",
  "data-font-terminal",
  "data-font-terminal-category",
] as const;

const APPEARANCE_VARIABLES = [
  "--po-canvas",
  "--po-surface-editor",
  "--po-editor-bg",
  "--po-panel",
  "--po-panel-raised",
  "--po-text",
  "--po-text-muted",
  "--po-text-subtle",
  "--po-danger",
  "--po-border",
  "--po-border-subtle",
  "--po-divider",
  "--po-focus-ring",
  "--po-scrollbar-thumb",
  "--po-scrollbar-thumb-hover",
  "--po-font-sans",
  "--po-font-mono",
  "--po-font-ui-primary",
  "--po-font-content-primary",
  "--po-font-code-primary",
  "--po-font-terminal-primary",
  "--po-font-editor-content-user",
  "--po-text-size-body",
  "--po-line-height-body",
] as const;

export function BuiltInEditorSurfaceController({
  viewer,
  context,
}: {
  viewer: PresetViewerContribution;
  context: PresetViewerRenderContext;
}) {
  const { direction, t } = useLocalization();
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const latestGeometryRef = useRef<NativeSurfaceGeometry>(FALLBACK_GEOMETRY);
  const [status, setStatus] = useState<SurfaceStatus>("activating");
  const [error, setError] = useState<string | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [safeMode, setSafeMode] = useState(false);
  const bridge = window.puppyoneDesktop?.editorSurfaces ?? null;

  const collectAppearance = useCallback(() => {
    const root = document.documentElement;
    const surface = hostElement?.closest(".po-viewer-surface-boundary") ?? root;
    const computed = getComputedStyle(surface);
    return {
      dark: root.classList.contains("dark"),
      direction: direction === "rtl" ? "rtl" as const : "ltr" as const,
      attributes: Object.fromEntries(APPEARANCE_ATTRIBUTES.flatMap((name) => {
        const value = root.getAttribute(name);
        return value == null ? [] : [[name, value]];
      })),
      variables: Object.fromEntries(APPEARANCE_VARIABLES.flatMap((name) => {
        const value = computed.getPropertyValue(name).trim();
        return value ? [[name, value]] : [];
      })),
    };
  }, [direction, hostElement]);

  const publishGeometry = useCallback((geometry: NativeSurfaceGeometry) => {
    latestGeometryRef.current = geometry;
    const sessionId = sessionIdRef.current;
    if (!bridge || !sessionId) return;
    void bridge.setBounds({
      sessionId,
      bounds: geometry.bounds,
      geometryRevision: geometry.revision,
      visible: geometry.visible,
    }).catch(() => undefined);
  }, [bridge]);
  useNativeSurfaceGeometry(hostElement, publishGeometry);

  useEffect(() => {
    if (!bridge?.onState) return undefined;
    return bridge.onState((event) => {
      if (event.sessionId !== sessionIdRef.current) return;
      if (event.status === "ready") {
        setStatus("ready");
        setError(null);
      } else if (
        event.status === "unresponsive"
        || event.status === "crashed"
        || event.status === "error"
      ) {
        setStatus(event.status);
        setError(event.message ?? event.reason ?? null);
      } else if (event.status === "loading") {
        setStatus("loading");
      }
    });
  }, [bridge]);

  useEffect(() => {
    if (!bridge || !context.fileUrl || !hostElement) return undefined;
    let cancelled = false;
    const measuredGeometry = {
      ...latestGeometryRef.current,
      bounds: measureNativeSurfaceBounds(hostElement),
    };
    latestGeometryRef.current = measuredGeometry;
    setStatus("activating");
    setError(null);

    void bridge.activate({
      viewerId: viewer.id,
      documentPath: context.document.path,
      documentRevision: context.document.version ?? null,
      resourceUrl: context.fileUrl,
      title: context.document.name,
      safeMode,
      bounds: measuredGeometry.bounds,
      geometryRevision: measuredGeometry.revision,
      visible: measuredGeometry.visible,
      appearance: collectAppearance(),
    }).then(async (session) => {
      if (cancelled) {
        await bridge.destroy({ sessionId: session.sessionId });
        return;
      }
      sessionIdRef.current = session.sessionId;
      setStatus(session.status === "ready" ? "ready" : "loading");
      const currentGeometry = latestGeometryRef.current;
      await bridge.setBounds({
        sessionId: session.sessionId,
        bounds: currentGeometry.bounds,
        geometryRevision: currentGeometry.revision,
        visible: currentGeometry.visible,
      });
    }).catch((reason) => {
      if (cancelled) return;
      setStatus("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    });

    return () => {
      cancelled = true;
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) void bridge.destroy({ sessionId }).catch(() => undefined);
    };
  }, [
    bridge,
    collectAppearance,
    context.document.name,
    context.document.path,
    context.document.version,
    context.fileUrl,
    hostElement,
    retryGeneration,
    safeMode,
    viewer.id,
  ]);

  useEffect(() => {
    if (!bridge) return undefined;
    const observer = new MutationObserver(() => {
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void bridge.updateAppearance({ sessionId, appearance: collectAppearance() });
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", ...APPEARANCE_ATTRIBUTES],
    });
    return () => observer.disconnect();
  }, [bridge, collectAppearance]);

  if (context.fileUrlLoading) {
    return (
      <div className="built-in-editor-surface-state" aria-busy="true">
        <PageLoading variant="fill" label={null} ariaLabel={t("editor.loadingFile")} />
      </div>
    );
  }

  if (!context.fileUrl) {
    return (
      <div className="built-in-editor-surface-state built-in-editor-surface-state--failed" role="alert">
        <strong>{t("editor.unavailable.title")}</strong>
        {context.fileUrlError ? <span dir="auto">{context.fileUrlError}</span> : null}
        {context.openExternalFile ? (
          <div className="built-in-editor-surface-actions">
            <button type="button" onClick={() => void context.openExternalFile?.(context.document.path)}>
              {t("editor.openDefaultApp")}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const failed = status === "crashed" || status === "error" || status === "unresponsive";
  return (
    <div
      className="built-in-editor-surface"
      data-preview-state={status === "ready" ? "ready" : "loading"}
      data-surface-status={status}
      data-safe-mode={safeMode ? "true" : undefined}
      aria-busy={status !== "ready"}
    >
      <div ref={setHostElement} className="built-in-editor-surface-host" />
      {(status === "activating" || status === "loading") && (
        <div className="built-in-editor-surface-state">
          <PageLoading variant="fill" label={null} ariaLabel={t("editor.loadingViewer")} />
        </div>
      )}
      {failed && (
        <div className="built-in-editor-surface-state built-in-editor-surface-state--failed" role="alert">
          <strong>{t("shared-ui.preview.crashed")}</strong>
          {error ? <span dir="auto">{error}</span> : null}
          <div className="built-in-editor-surface-actions">
            <button
              type="button"
              onClick={() => {
                setSafeMode(viewer.recoveryPolicy.supportsSafeMode);
                setRetryGeneration((current) => current + 1);
              }}
            >
              {t("common.action.retry")}
            </button>
            {context.openExternalFile ? (
              <button type="button" onClick={() => void context.openExternalFile?.(context.document.path)}>
                {t("editor.openDefaultApp")}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
