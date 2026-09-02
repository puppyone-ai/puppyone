"use client";

import { useEffect, useState, type ReactNode } from "react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { preloadPresetViewer, PresetViewerRenderer } from "./PresetViewerRenderer";
import { resolveEditorViewer } from "../registry/viewerRegistry";
import {
  ExternalViewerAdapter,
  resolveViewerRouteForDocument,
} from "../registry/viewerPackAdapter";
import type {
  ContextMapWorkspaceEnvironment,
  DocumentNavigationPort,
  EditorDocument,
  EditorInteractionPreferences,
  EditorSaveMode,
  MarkdownHtmlTrustMode,
  MarkdownWorkspaceEnvironment,
  OfficeEditorActionResolver,
} from "../registry/viewerTypes";
import type { ViewerSurfacePreparation } from "../registry/viewerContract";
import { DEFAULT_EDITOR_INTERACTION_PREFERENCES } from "../registry/viewerTypes";
import type {
  ExternalViewerSurfaceRenderer,
  ViewerExtensionHostAdapter,
} from "../registry/viewerHostAdapters";
import type { ViewerContribution } from "../registry/viewerPackTypes";
import type {
  AppPreviewController,
  DocumentPersistencePort,
  OfficeDocumentConverter,
} from "../../core/types";
import type { FileIconThemeId } from "../../file/fileIcons";
import type { AiEditFile } from "../ai-edits/types";
import { DocumentSessionBoundary } from "../document-session/DocumentSessionBoundary";
import type { DocumentPersistedCommit } from "../document-session/types";
import { resolveEditorAccess } from "../editorAccess";
import { EditorFindHost } from "../find/editorFind";
import {
  DocumentSurfacePending,
  DocumentSurfaceReadinessBoundary,
} from "./DocumentSurfaceHost";
import { exceedsUtf8ByteLimit, formatByteLimit } from "./sourceAdmission";

export type { EditorDocument, EditorDocumentKind, EditorSaveMode, MarkdownHtmlTrustMode } from "../registry/viewerTypes";

export type EditorDocumentHostProps = {
  document: EditorDocument;
  loading?: boolean;
  loadingIndicator?: ReactNode;
  surfacePreparation?: ViewerSurfacePreparation;
  error?: string | null;
  fileUrlLoading?: boolean;
  fileUrlError?: string | null;
  documentPersistence?: DocumentPersistencePort | null;
  onDocumentPersisted?: (commit: DocumentPersistedCommit) => void;
  aiEditFile?: AiEditFile | null;
  hideSourceView?: boolean;
  fileIconTheme?: FileIconThemeId;
  editorInteractionPreferences?: EditorInteractionPreferences;
  saveMode?: EditorSaveMode;
  htmlTrustMode?: MarkdownHtmlTrustMode;
  workspaceId?: string;
  workspaceRoot?: string | null;
  markdownEnvironment?: MarkdownWorkspaceEnvironment | null;
  documentNavigation?: DocumentNavigationPort | null;
  contextMapEnvironment?: ContextMapWorkspaceEnvironment | null;
  appPreview?: AppPreviewController | null;
  openExternalFile?: (path: string) => Promise<void>;
  convertOfficeDocumentToDocx?: OfficeDocumentConverter;
  resolveOfficeEditorActions?: OfficeEditorActionResolver | null;
  /**
   * Optional host composition port for external viewer extensions. The entire
   * port is absent in the default preset-only product profile.
   */
  viewerExtensionAdapter?: ViewerExtensionHostAdapter | null;
  onSurfaceReady?: () => void;
};

export function EditorDocumentHost(props: EditorDocumentHostProps) {
  return (
    <DocumentSurfaceReadinessBoundary
      readinessKey={props.document.path}
      onReady={props.onSurfaceReady}
    >
      <EditorDocumentSurface {...props} />
    </DocumentSurfaceReadinessBoundary>
  );
}

function EditorDocumentSurface({
  document,
  loading = false,
  loadingIndicator,
  surfacePreparation = "hidden-safe",
  error = null,
  fileUrlLoading = false,
  fileUrlError = null,
  documentPersistence = null,
  onDocumentPersisted,
  aiEditFile = null,
  hideSourceView = false,
  fileIconTheme = "default",
  editorInteractionPreferences = DEFAULT_EDITOR_INTERACTION_PREFERENCES,
  saveMode = "manual",
  htmlTrustMode = "safe",
  workspaceId = "",
  workspaceRoot = null,
  markdownEnvironment = null,
  documentNavigation = null,
  contextMapEnvironment = null,
  appPreview = null,
  openExternalFile,
  convertOfficeDocumentToDocx,
  resolveOfficeEditorActions = null,
  viewerExtensionAdapter = null,
}: EditorDocumentHostProps) {
  const { t } = useLocalization();
  const { viewer, format, resolvedExtension } = resolveEditorViewer(document);
  const preloadWhileReading = Boolean(
    !viewerExtensionAdapter
    && viewer.surfaceIsolation !== "isolated-webcontents"
    && loading
    && !document.content
    && !document.preview,
  );
  useEffect(() => {
    if (!preloadWhileReading) return;
    // Begin route-code acquisition while the cancellable file read is in
    // flight, rather than serializing the first viewer download after I/O.
    void preloadPresetViewer(viewer).catch(() => undefined);
  }, [preloadWhileReading, viewer]);

  // Placeholder-grade documents are the plugin-eligible surface. Route them
  // deterministically (§5.1); only a local doc with exactly one (or a chosen)
  // enabled pack activates. The main process is still the sole authority — this
  // only decides which host-provided surface slot to render.
  if (viewerExtensionAdapter) {
    const route = resolveViewerRouteForDocument(document, viewerExtensionAdapter.snapshot);
    if (viewerExtensionAdapter.renderSurface && route.kind === "plugin") {
      return (
        <ExternalViewerAdapter
          document={document}
          contribution={route.contribution}
          renderSurface={viewerExtensionAdapter.renderSurface}
        />
      );
    }
    if (viewerExtensionAdapter.renderSurface && route.kind === "chooser") {
      return (
        <ExternalViewerChooser
          document={document}
          candidates={route.candidates}
          renderSurface={viewerExtensionAdapter.renderSurface}
        />
      );
    }
    if (
      viewerExtensionAdapter.renderInstallFallback &&
      route.kind === "unsupported" &&
      route.reason === "no-match" &&
      document.sourceKind === "local"
    ) {
      return <>{viewerExtensionAdapter.renderInstallFallback({ document })}</>;
    }
  }

  const rawContent = viewer.allowPreviewContent === false
    ? document.content ?? ""
    : document.content ?? document.preview ?? "";
  const content = viewer.normalizeContent?.(rawContent, document) ?? rawContent;
  if (
    (viewer.source === "content" || viewer.source === "content-and-resource")
    && exceedsUtf8ByteLimit(content, viewer.resourcePolicy.maxSourceBytes)
  ) {
    return (
      <EditorUnavailableState
        title={t("editor.unavailable.title")}
        message={t("editor.unavailable.resourceLimit", {
          limit: formatByteLimit(viewer.resourcePolicy.maxSourceBytes),
        })}
        documentPath={document.path}
        openExternalFile={openExternalFile}
        openLabel={t("editor.openDefaultApp")}
      />
    );
  }
  const editorAccess = resolveEditorAccess({
    document,
    format,
    resolvedExtension,
    viewer,
    content,
    persistenceAvailable: Boolean(documentPersistence),
  });
  const canEdit = editorAccess.kind === "editable";

  if (viewer.source !== "resource" && loading && !content) {
    return (
      <DocumentSurfacePending label={t("editor.loadingFile")}>
        {surfacePreparation === "hidden-safe" ? loadingIndicator : null}
      </DocumentSurfacePending>
    );
  }

  if (viewer.source !== "resource" && error && !content) {
    return (
      <EditorUnavailableState
        title={t("editor.unavailable.title")}
        message={error}
        documentPath={document.path}
        openExternalFile={openExternalFile}
        openLabel={t("editor.openDefaultApp")}
      />
    );
  }

  const presetViewer = (
    <PresetViewerRenderer
      viewer={viewer}
      loadingIndicator={surfacePreparation === "hidden-safe" ? loadingIndicator : null}
      context={{
        document,
        format,
        resolvedExtension,
        content,
        resourcePolicy: viewer.resourcePolicy,
        aiEditFile,
        fileUrl: document.url,
        fileUrlLoading,
        fileUrlError,
        loading,
        error,
        canEdit,
        hideSourceView,
        fileIconTheme,
        editorInteractionPreferences,
        htmlTrustMode,
        workspaceId,
        workspaceRoot,
        markdownEnvironment,
        documentNavigation,
        contextMapEnvironment,
        appPreview,
        openExternalFile,
        convertOfficeDocumentToDocx,
        officeEditorActions: resolveOfficeEditorActions?.(document) ?? [],
      }}
    />
  );

  const editor = canEdit && documentPersistence ? (
    <DocumentSessionBoundary
      documentId={document.path}
      initialContent={content}
      initialVersion={document.version}
      saveMode={saveMode}
      persistence={documentPersistence}
      onPersisted={onDocumentPersisted}
      showSaveStatus={editorInteractionPreferences.showSaveStatus}
    >
      {presetViewer}
    </DocumentSessionBoundary>
  ) : presetViewer;

  return (
    <EditorFindHost documentId={document.path}>
      {editor}
    </EditorFindHost>
  );
}

function ExternalViewerChooser({
  document,
  candidates,
  renderSurface,
}: {
  document: EditorDocument;
  candidates: readonly ViewerContribution[];
  renderSurface: ExternalViewerSurfaceRenderer;
}) {
  const { t } = useLocalization();
  const [selected, setSelected] = useState<ViewerContribution | null>(null);

  if (selected) {
    return (
      <ExternalViewerAdapter
        document={document}
        contribution={selected}
        renderSurface={renderSurface}
      />
    );
  }

  return (
    <div className="external-viewer-chooser">
      <strong>{t("editor.viewer.chooseFor", { name: bidiIsolate(document.name) })}</strong>
      <ul>
        {candidates.map((candidate) => (
          <li key={`${candidate.pluginId}@${candidate.version}`}>
            <button type="button" onClick={() => setSelected(candidate)}>
              <span dir="auto">{candidate.label}</span>
              <span dir="auto">{candidate.publisher} · v{candidate.version}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditorUnavailableState({
  title,
  message,
  documentPath,
  openExternalFile,
  openLabel,
}: {
  title: string;
  message: string;
  documentPath: string;
  openExternalFile?: (path: string) => Promise<void>;
  openLabel: string;
}) {
  return (
    <div className="editor-state editor-state--stacked danger">
      <strong>{title}</strong>
      <span dir="auto">{message}</span>
      {openExternalFile && (
        <button type="button" onClick={() => void openExternalFile(documentPath)}>
          {openLabel}
        </button>
      )}
    </div>
  );
}
