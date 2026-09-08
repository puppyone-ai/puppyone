"use client";

import {
  Code2,
  ExternalLink,
  Eye,
  RefreshCw,
  RotateCw,
  Settings2,
  Square,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization/react";
import {
  getAppPreviewManifestDisplayName,
  parseAppPreviewManifest,
} from "../../../../../../shared/appPreviewManifest.js";
import { PlainTextEditor } from "../code/PlainTextEditor";
import type { PresetViewerRenderContext } from "../../registry/viewerTypes";
import { AppPreviewSetupView } from "./AppPreviewSetupView";
import { AppPreviewStateView } from "./AppPreviewStateView";
import {
  resolveAppPreviewFrameUrl,
  SandboxedAppFrame,
} from "./SandboxedAppFrame";
import type { AppPreviewMode } from "./types";
import { useAppPreviewSession } from "./useAppPreviewSession";
import { DocumentSurfacePending } from "../../host/DocumentSurfaceHost";
import { useVisibleFrameReadiness } from "../shared/useVisibleFrameReadiness";

export function AppPreviewViewer({
  document,
  content,
  loading,
  error,
  appPreview,
}: Pick<
  PresetViewerRenderContext,
  "document" | "content" | "loading" | "error" | "appPreview"
>) {
  const { t } = useLocalization();
  const [mode, setMode] = useState<AppPreviewMode>("preview");
  const [manifestContent, setManifestContent] = useState(content);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    setManifestContent(content);
    setMode("preview");
  }, [content, document.path]);

  const manifestState = useMemo(() => {
    try {
      return { manifest: parseAppPreviewManifest(manifestContent, { appPath: document.path }), error: null };
    } catch (reason) {
      return { manifest: null, error: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [document.path, manifestContent]);
  const appName = manifestState.manifest?.name ?? getAppPreviewManifestDisplayName(manifestContent, document.path);
  const configured = Boolean(manifestState.manifest?.launch);
  const session = useAppPreviewSession({
    appPreview,
    path: document.path,
    enabled: configured,
  });
  const refreshLogs = session.refreshLogs;

  useEffect(() => {
    if (configured && mode === "logs") void refreshLogs();
  }, [configured, mode, refreshLogs]);

  const { state } = session;
  const runningUrl = state.runtime?.status === "running" ? state.runtime.url : null;
  const frameUrl = resolveAppPreviewFrameUrl(runningUrl);
  const frameKey = frameUrl
    ? [
      state.runtime?.runtimeId ?? frameUrl,
      state.runtime?.generation ?? 0,
      reloadVersion,
    ].join(":")
    : null;
  const frameReadiness = useVisibleFrameReadiness(frameKey);

  if (loading && !manifestContent) return <DocumentSurfacePending label={t("editor.app.loading")} />;
  if (error && !manifestContent) return <div className="editor-state danger" dir="auto">{error}</div>;

  const frameSecurityError = Boolean(runningUrl && !frameUrl);
  const previewState = frameSecurityError
    ? {
      ...state,
      status: "error" as const,
      error: { code: "start-failed" as const, detail: "App Preview URL is not safe to embed." },
    }
    : state;
  const statusLabel = manifestState.error
    ? t("editor.app.status.needsAttention")
    : !configured
      ? t("editor.app.status.notConfigured")
      : previewState.status === "error"
        ? t("editor.app.status.needsAttention")
        : t(`editor.app.status.${previewState.status}`);
  const status = manifestState.error || previewState.status === "error"
    ? "error"
    : configured ? previewState.status : "idle";
  const previewSurfaceBusy = Boolean(
    configured
    && mode === "preview"
    && previewState.status !== "error"
    && previewState.status !== "stopped"
    && (!frameKey || !frameReadiness.ready),
  );

  return (
    <section className="app-preview-shell" data-mode={mode} aria-busy={previewSurfaceBusy}>
      <header className="app-preview-header">
        <div className="app-preview-title">
          <strong dir="auto">{appName}</strong>
          <span data-status={status}>{statusLabel}</span>
        </div>

        <div className="app-preview-toolbar" aria-label={t("editor.app.controls")}>
          <ToolbarButton navigation active={mode === "preview"} label={t("editor.app.preview")} onClick={() => setMode("preview")}>
            <Eye size={14} strokeWidth={2} />
          </ToolbarButton>
          <ToolbarButton navigation active={mode === "source"} label={t("editor.app.manifestSource")} onClick={() => setMode("source")}>
            <Code2 size={14} strokeWidth={2} />
          </ToolbarButton>
          {configured ? (
            <>
              <ToolbarButton navigation active={mode === "logs"} label={t("editor.app.runtimeLogs")} onClick={() => setMode("logs")}>
                <TerminalSquare size={14} strokeWidth={2} />
              </ToolbarButton>
              <ToolbarButton navigation active={mode === "settings"} label={t("editor.app.setup.settingsTitle")} onClick={() => setMode("settings")}>
                <Settings2 size={14} strokeWidth={2} />
              </ToolbarButton>
            </>
          ) : null}
          {configured && mode === "preview" ? (
            <>
              <span className="app-preview-toolbar-separator" aria-hidden="true" />
              <ToolbarButton
                label={t("editor.app.reload")}
                disabled={!frameUrl}
                onClick={() => {
                  setReloadVersion((value) => value + 1);
                }}
              >
                <RefreshCw size={14} strokeWidth={2} />
              </ToolbarButton>
              <span className="app-preview-toolbar-separator" aria-hidden="true" />
              <ToolbarButton label={t("editor.app.restart")} disabled={!appPreview?.restart || state.status === "starting"} onClick={() => session.restart()}>
                <RotateCw size={14} strokeWidth={2} />
              </ToolbarButton>
              <ToolbarButton label={t("editor.app.stop")} disabled={!appPreview?.stop || (state.status !== "running" && state.status !== "starting")} onClick={() => void session.stop()}>
                <Square size={13} strokeWidth={2} />
              </ToolbarButton>
              <ToolbarButton navigation label={t("editor.app.openBrowser")} disabled={!appPreview?.openExternal || !runningUrl} onClick={() => void appPreview?.openExternal?.(document.path)}>
                <ExternalLink size={14} strokeWidth={2} />
              </ToolbarButton>
            </>
          ) : null}
        </div>
      </header>

      <div className="app-preview-body">
        {configured && !manifestState.error ? (
          <div
            className="app-preview-surface-host"
            data-active={mode === "preview" ? "true" : "false"}
            aria-hidden={mode === "preview" ? undefined : true}
          >
            {frameUrl && frameKey ? (
              <SandboxedAppFrame
                key={frameKey}
                url={frameUrl}
                title={appName}
                busy={!frameReadiness.ready}
                onLoad={frameReadiness.onFrameLoad}
              />
            ) : (
              <AppPreviewStateView
                appName={appName}
                state={previewState}
                canRun={Boolean(appPreview?.start)}
                onRun={session.run}
                onEditSetup={() => setMode("settings")}
                onViewLogs={() => setMode("logs")}
                onCancel={() => void session.stop()}
              />
            )}
          </div>
        ) : null}

        {mode === "source" ? (
          <div className="app-preview-source">
            <PlainTextEditor content={manifestContent} nodeName={document.name} readOnly />
          </div>
        ) : manifestState.error ? (
          <div className="app-preview-invalid">
            <strong>{t("editor.app.setup.invalidTitle")}</strong>
            <span>{t("editor.app.setup.invalidDetail")}</span>
            <code>{sanitizeDiagnostic(manifestState.error)}</code>
            <button type="button" onClick={() => setMode("source")}>{t("editor.app.setup.viewSource")}</button>
          </div>
        ) : !configured ? (
          <AppPreviewSetupView
            appName={appName}
            appPath={document.path}
            content={manifestContent}
            controller={appPreview}
            onConfigured={(nextContent) => {
              setManifestContent(nextContent);
              setMode("preview");
            }}
          />
        ) : mode === "settings" ? (
          <AppPreviewSetupView
            settings
            appName={appName}
            appPath={document.path}
            content={manifestContent}
            controller={appPreview}
            onCancel={() => setMode("preview")}
            onConfigured={(nextContent) => {
              setManifestContent(nextContent);
              setMode("preview");
            }}
          />
        ) : mode === "logs" ? (
          <div
            className="app-preview-logs"
            data-po-scrollbar="content"
            role="log"
            aria-label={t("editor.app.logsLabel")}
          >
            <pre dir="ltr">{session.logs || t("editor.app.noLogs")}</pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ToolbarButton({
  active = false,
  navigation = false,
  label,
  disabled = false,
  onClick,
  children,
}: {
  active?: boolean;
  navigation?: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={active ? "active" : ""}
      data-po-interaction={navigation ? "navigation" : undefined}
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function sanitizeDiagnostic(value: string): string {
  return value
    .replace(/Error invoking remote method[^:]*:\s*/gi, "")
    .replace(/\b(?:ipc|rpc)[\w:-]*\b/gi, "preview service")
    .slice(0, 360);
}
