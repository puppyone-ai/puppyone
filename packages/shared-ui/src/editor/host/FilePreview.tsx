import { EditorTaskBoundary } from "../runtime/EditorTaskContext";
import { DocumentAssetImportBoundary, type DocumentAssetImportPort } from "../resource/DocumentAssetImport";
import { EditorPreviewServicesBoundary } from "../preview-services/EditorPreviewServices";
import type { EditorPreviewServices } from "../preview-services/types";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import type {
  AppPreviewController,
  DocumentDataNode,
  DocumentPersistencePort,
  FileContent,
  OfficeDocumentConverter,
} from "../../core/types";
import { DataNodeEditorHost } from "./DataNodeEditorHost";
import {
  DocumentSurfaceHost,
  DocumentSurfaceReadinessBoundary,
} from "./DocumentSurfaceHost";
import type { EditorSaveMode } from "./EditorDocumentHost";
import type {
  ContextMapWorkspaceEnvironment,
  DocumentNavigationPort,
  DocumentSourceKind,
  EditorInteractionPreferences,
  MarkdownDialectId,
  MarkdownHtmlTrustMode,
  MarkdownWorkspaceEnvironment,
  OfficeEditorActionResolver,
} from "../registry/viewerTypes";
import type { ViewerExtensionHostAdapter } from "../registry/viewerHostAdapters";
import type { AiEditFile } from "../ai-edits/types";
import { FilePreviewIcon, type FileIconThemeId } from "../../file/fileIcons";
import type { DocumentPersistedCommit } from "../document-session/types";
import { resolveViewerSurfacePreparationForDocument } from "../registry/viewerPackAdapter";

export type FilePreviewProps = {
  editorAssets?: DocumentAssetImportPort;
  previewServices?: EditorPreviewServices;
  inputGeneration?: number;
  node: DocumentDataNode | null;
  fileContent?: FileContent | null;
  fileUrl?: string | null;
  fileUrlLoading?: boolean;
  fileUrlError?: string | null;
  loading?: boolean;
  loadingIndicator?: ReactNode;
  error?: string | null;
  aiEditFile?: AiEditFile | null;
  showHeader?: boolean;
  emptySlot?: ReactNode;
  actionSlot?: ReactNode | ((node: DocumentDataNode) => ReactNode);
  documentPersistence?: DocumentPersistencePort | null;
  onDocumentPersisted?: (commit: DocumentPersistedCommit) => void;
  hideSourceView?: boolean;
  fileIconTheme?: FileIconThemeId;
  editorInteractionPreferences?: EditorInteractionPreferences;
  editorSaveMode?: EditorSaveMode;
  htmlTrustMode?: MarkdownHtmlTrustMode;
  workspaceId?: string;
  workspaceRoot?: string | null;
  markdownDialect?: MarkdownDialectId | null;
  markdownEnvironment?: MarkdownWorkspaceEnvironment | null;
  documentNavigation?: DocumentNavigationPort | null;
  contextMapEnvironment?: ContextMapWorkspaceEnvironment | null;
  appPreview?: AppPreviewController | null;
  openExternalFile?: (path: string) => Promise<void>;
  convertOfficeDocumentToDocx?: OfficeDocumentConverter;
  resolveOfficeEditorActions?: OfficeEditorActionResolver | null;
  viewerExtensionAdapter?: ViewerExtensionHostAdapter | null;
  documentSourceKind?: DocumentSourceKind;
};

export function FilePreview({
  editorAssets,
  previewServices,
  inputGeneration,
  node,
  fileContent,
  fileUrl = null,
  fileUrlLoading = false,
  fileUrlError = null,
  loading = false,
  loadingIndicator,
  error = null,
  aiEditFile = null,
  showHeader = true,
  emptySlot,
  actionSlot,
  documentPersistence = null,
  onDocumentPersisted,
  hideSourceView = false,
  fileIconTheme = "default",
  editorInteractionPreferences,
  editorSaveMode = "manual",
  htmlTrustMode = "safe",
  workspaceId = "",
  workspaceRoot = null,
  markdownDialect = null,
  markdownEnvironment = null,
  documentNavigation = null,
  contextMapEnvironment = null,
  appPreview = null,
  openExternalFile,
  convertOfficeDocumentToDocx,
  resolveOfficeEditorActions = null,
  viewerExtensionAdapter = null,
  documentSourceKind = "local",
}: FilePreviewProps) {
  const { t } = useLocalization();
  const surfaceKey = node?.path ?? "file-preview:empty";
  const actions = node
    ? typeof actionSlot === "function" ? actionSlot(node) : actionSlot
    : null;
  const deferFallbackContent = loading && !fileContent;
  const surfacePreparation = node
    ? resolveViewerSurfacePreparationForDocument({
      path: node.path,
      name: node.name,
      type: fileContent?.type ?? node.type,
      mimeType: fileContent?.mimeType ?? node.mimeType ?? null,
      sourceKind: documentSourceKind,
    }, viewerExtensionAdapter)
    : "hidden-safe";

  return (
    <DocumentSurfaceHost
      surfaceKey={surfaceKey}
      surfacePreparation={surfacePreparation}
      pendingIndicator={loadingIndicator}
    >
      {({ onSurfaceReady }) => node ? (
        <div className={`file-preview-shell ${showHeader ? "" : "without-header"}`}>
          {showHeader && (
            <div className="file-preview-header">
              <div className="file-preview-title">
                <FilePreviewIcon
                  name={node.name}
                  type={node.type}
                  size={36}
                  snippet={node.preview}
                  childrenCount={node.children?.length}
                  theme={fileIconTheme}
                />
                <div>
                  <h2 dir="auto">{node.name}</h2>
                  <span dir="ltr">{node.path}</span>
                </div>
              </div>
              <div className="file-preview-actions">
                {node.status && node.status !== "clean" && (
                  <span className={`status-pill ${node.status}`}>
                    {t(`shared-ui.status.${node.status}`, { name: bidiIsolate(node.name) })}
                  </span>
                )}
                {actions}
              </div>
            </div>
          )}

          <div className="file-preview-body">
            <EditorPreviewBoundary
              key={node.path}
              failureTitle={t("shared-ui.preview.crashed")}
              onSurfaceReady={onSurfaceReady}
            >
              <EditorTaskBoundary storageIdentity={documentPersistence?.storageIdentity || workspaceId || "renderer"} resource={node.path}>
              <EditorPreviewServicesBoundary services={previewServices} revision={inputGeneration}>
              <DocumentAssetImportBoundary port={editorAssets}>
              <DataNodeEditorHost
                node={node}
                fileContent={fileContent}
                fileUrl={fileUrl}
                fileUrlLoading={fileUrlLoading}
                fileUrlError={fileUrlError}
                loading={loading}
                loadingIndicator={loadingIndicator}
                surfacePreparation={surfacePreparation}
                error={error}
                aiEditFile={aiEditFile}
                documentPersistence={documentPersistence}
                onDocumentPersisted={onDocumentPersisted}
                hideSourceView={hideSourceView}
                fileIconTheme={fileIconTheme}
                editorInteractionPreferences={editorInteractionPreferences}
                saveMode={editorSaveMode}
                htmlTrustMode={htmlTrustMode}
                workspaceId={workspaceId}
                workspaceRoot={workspaceRoot}
                markdownDialect={markdownDialect}
                markdownEnvironment={markdownEnvironment}
                documentNavigation={documentNavigation}
                contextMapEnvironment={contextMapEnvironment}
                appPreview={appPreview}
                openExternalFile={openExternalFile}
                convertOfficeDocumentToDocx={convertOfficeDocumentToDocx}
                resolveOfficeEditorActions={resolveOfficeEditorActions}
                deferFallbackContent={deferFallbackContent}
                viewerExtensionAdapter={viewerExtensionAdapter}
                documentSourceKind={documentSourceKind}
                onSurfaceReady={onSurfaceReady}
              />
              </DocumentAssetImportBoundary>
              </EditorPreviewServicesBoundary>
              </EditorTaskBoundary>
            </EditorPreviewBoundary>
          </div>
        </div>
      ) : (
        <DocumentSurfaceReadinessBoundary
          readinessKey={surfaceKey}
          onReady={onSurfaceReady}
        >
          {emptySlot ?? (
            <div className="empty-preview">
              <span>{t("shared-ui.preview.selectFile")}</span>
            </div>
          )}
        </DocumentSurfaceReadinessBoundary>
      )}
    </DocumentSurfaceHost>
  );
}

type EditorPreviewBoundaryProps = {
  children: ReactNode;
  failureTitle: string;
  onSurfaceReady?: () => void;
};

type EditorPreviewBoundaryState = {
  error: string | null;
};

class EditorPreviewBoundary extends Component<EditorPreviewBoundaryProps, EditorPreviewBoundaryState> {
  state: EditorPreviewBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: unknown): EditorPreviewBoundaryState {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn("Editor preview crashed:", error, info.componentStack);
    this.props.onSurfaceReady?.();
  }

  render() {
    if (this.state.error) {
      return (
        <div className="editor-crash-state">
          <strong>{this.props.failureTitle}</strong>
          <span dir="ltr">{this.state.error}</span>
        </div>
      );
    }

    return this.props.children;
  }
}
