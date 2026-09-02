import type {
  AppPreviewController,
  DocumentDataNode,
  DocumentPersistencePort,
  FileContent,
  OfficeDocumentConverter,
} from "../../core/types";
import type { ReactNode } from "react";
import type { FileIconThemeId } from "../../file/fileIcons";
import {
  EditorDocumentHost,
  type EditorSaveMode,
} from "./EditorDocumentHost";
import type { AiEditFile } from "../ai-edits/types";
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
import type { ViewerSurfacePreparation } from "../registry/viewerContract";
import type { DocumentPersistedCommit } from "../document-session/types";

export type DataNodeEditorHostProps = {
  node: DocumentDataNode;
  fileContent?: FileContent | null;
  fileUrl?: string | null;
  fileUrlLoading?: boolean;
  fileUrlError?: string | null;
  loading?: boolean;
  loadingIndicator?: ReactNode;
  surfacePreparation?: ViewerSurfacePreparation;
  error?: string | null;
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
  markdownDialect?: MarkdownDialectId | null;
  markdownEnvironment?: MarkdownWorkspaceEnvironment | null;
  documentNavigation?: DocumentNavigationPort | null;
  contextMapEnvironment?: ContextMapWorkspaceEnvironment | null;
  appPreview?: AppPreviewController | null;
  openExternalFile?: (path: string) => Promise<void>;
  convertOfficeDocumentToDocx?: OfficeDocumentConverter;
  resolveOfficeEditorActions?: OfficeEditorActionResolver | null;
  deferFallbackContent?: boolean;
  viewerExtensionAdapter?: ViewerExtensionHostAdapter | null;
  documentSourceKind?: DocumentSourceKind;
  onSurfaceReady?: () => void;
};

export function DataNodeEditorHost({
  node,
  fileContent,
  fileUrl = null,
  fileUrlLoading = false,
  fileUrlError = null,
  loading = false,
  loadingIndicator,
  surfacePreparation,
  error = null,
  documentPersistence = null,
  onDocumentPersisted,
  aiEditFile = null,
  hideSourceView = false,
  fileIconTheme = "default",
  editorInteractionPreferences,
  saveMode = "manual",
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
  deferFallbackContent = false,
  viewerExtensionAdapter = null,
  documentSourceKind = "local",
  onSurfaceReady,
}: DataNodeEditorHostProps) {
  return (
    <EditorDocumentHost
      document={{
        path: node.path,
        name: node.name,
        type: fileContent?.type ?? node.type,
        content: fileContent
          ? fileContent.content
          : (deferFallbackContent ? undefined : node.content),
        preview: deferFallbackContent ? undefined : node.preview,
        mimeType: fileContent?.mimeType ?? node.mimeType ?? null,
        url: fileContent?.url ?? fileUrl,
        version: fileContent?.version ?? null,
        sourceKind: documentSourceKind,
        markdownDialect,
      }}
      viewerExtensionAdapter={viewerExtensionAdapter}
      loading={loading}
      loadingIndicator={loadingIndicator}
      surfacePreparation={surfacePreparation}
      error={error}
      fileUrlLoading={fileUrlLoading}
      fileUrlError={fileUrlError}
      documentPersistence={documentPersistence}
      onDocumentPersisted={onDocumentPersisted}
      aiEditFile={aiEditFile}
      hideSourceView={hideSourceView}
      fileIconTheme={fileIconTheme}
      editorInteractionPreferences={editorInteractionPreferences}
      saveMode={saveMode}
      htmlTrustMode={htmlTrustMode}
      workspaceId={workspaceId}
      workspaceRoot={workspaceRoot}
      markdownEnvironment={markdownEnvironment}
      documentNavigation={documentNavigation}
      contextMapEnvironment={contextMapEnvironment}
      appPreview={appPreview}
      openExternalFile={openExternalFile}
      convertOfficeDocumentToDocx={convertOfficeDocumentToDocx}
      resolveOfficeEditorActions={resolveOfficeEditorActions}
      onSurfaceReady={onSurfaceReady}
    />
  );
}
