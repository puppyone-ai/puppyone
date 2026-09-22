import type { EditorProviderPolicy } from "./editorProviderPolicy";
import type { ComponentType, ReactNode } from "react";
import type {
  AppPreviewController,
  DataPort,
  DocumentDataNodeKind,
  OfficeDocumentConverter,
} from "../../core/types";
import type { FileFormat } from "../../core/fileFormats";
import type { FileIconThemeId } from "../../file/fileIcons";
import type { AiEditFile } from "../ai-edits/types";
import type { PresetViewerResourcePolicy, PresetViewerSource } from "./viewerContract";
import type { DocumentSourceKind } from "../documentSource";
import type { PresetViewerDefinition } from "./presetViewerManifest";
import type { DocumentNavigationPort } from "../navigation/documentNavigation";

export type {
  DocumentDeniedReference,
  DocumentExternalReference,
  DocumentNavigationPort,
  DocumentReference,
  DocumentReferenceSyntax,
  DocumentWorkspaceReference,
  DocumentWorkspaceReferenceStatus,
} from "../navigation/documentNavigation";

export type { DocumentSourceKind } from "../documentSource";

export type EditorDocumentKind = DocumentDataNodeKind;

export type EditorDocument = {
  path: string;
  name: string;
  type: EditorDocumentKind;
  content?: string | null;
  preview?: string | null;
  mimeType?: string | null;
  url?: string | null;
  version?: string | null;
  /** Explicit project/document Markdown grammar assignment from the Host. */
  markdownDialect?: MarkdownDialectId | null;
  /**
   * Where the document was sourced. Plugin routing fails closed for `cloud`
   * and `unknown`; only explicit `local` documents can activate a Viewer Pack.
   */
  sourceKind?: DocumentSourceKind;
};

export type EditorMode = "live" | "source";
export type EditorSaveMode = "manual" | "auto";
export type EditorInteractionPreferences = Readonly<{
  showSaveStatus: boolean;
  markdownBlockDragEnabled: boolean;
  markdownHeadingOutlineEnabled?: boolean;
}>;
export const DEFAULT_EDITOR_INTERACTION_PREFERENCES: EditorInteractionPreferences = {
  showSaveStatus: false,
  markdownBlockDragEnabled: false,
  markdownHeadingOutlineEnabled: false,
};
export type EditorSourceRequirement = PresetViewerSource;
export type MarkdownHtmlTrustMode = "safe" | "localTrusted";
export type MarkdownDialectId = "puppy-gfm" | "openknowledge-mdx";

export type MarkdownWikiLinkResolvedTarget = {
  exists: boolean;
  ambiguous: boolean;
  path: string | null;
  candidatePaths?: string[];
  name: string;
  displayName: string;
  target: string;
  heading?: string | null;
};

export type MarkdownBacklinkReference = {
  lineNumber: number;
  lineText: string;
  target: string;
  label: string;
};

export type MarkdownBacklink = {
  sourcePath: string;
  sourceName: string;
  count: number;
  references: MarkdownBacklinkReference[];
};

export type MarkdownLinkGraph = Readonly<{
  /** Changes only when link resolution or backlink query semantics change. */
  revision: number;
  documentCount: number;
  indexedDocumentCount: number;
  resolveWikiLink: (sourcePath: string, target: string) => MarkdownWikiLinkResolvedTarget;
  resolveMarkdownLink: (sourcePath: string, href: string) => MarkdownWikiLinkResolvedTarget | null;
  getBacklinks?: (path: string) => MarkdownBacklink[];
}>;

/** Stable workspace command port. It is deliberately separate from queries. */
export type MarkdownLinkCommands = Readonly<{
  openWikiLink?: (target: MarkdownWikiLinkResolvedTarget, sourcePath: string) => void;
  openPath?: (path: string) => void;
  openExternalUrl?: (href: string) => void | Promise<void>;
}>;

export type MarkdownWorkspaceEnvironment = Readonly<{
  linkGraph: MarkdownLinkGraph | null;
  linkCommands: MarkdownLinkCommands;
  assetUrlResolver: MarkdownAssetUrlResolver | null;
  /** Changes only when asset resolution semantics change. */
  assetResolverRevision: number;
}>;

/** Host-authorized query surface for the workspace-aware Context Map Viewer. */
export type ContextMapWorkspaceEnvironment = Readonly<{
  revision: number;
  listChildren: DataPort["listChildren"];
  readFile?: DataPort["readFile"];
}>;

export const EMPTY_MARKDOWN_LINK_COMMANDS: MarkdownLinkCommands = Object.freeze({});

export const EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT: MarkdownWorkspaceEnvironment = Object.freeze({
  linkGraph: null,
  linkCommands: EMPTY_MARKDOWN_LINK_COMMANDS,
  assetUrlResolver: null,
  assetResolverRevision: 0,
});

export type MarkdownResolvedAssetUrl = {
  url: string;
  revoke?: () => void | Promise<void>;
  subscribe?: (listener: (url: string | null) => void) => () => void;
};

export type MarkdownAssetUrlResolver = (
  sourcePath: string,
  href: string,
  signal?: AbortSignal,
) =>
  | string
  | MarkdownResolvedAssetUrl
  | null
  | Promise<string | MarkdownResolvedAssetUrl | null>;

/**
 * Host-owned handoff into an optional Office editor extension. The action is
 * deliberately opaque to shared-ui: plugins keep session, persistence, and
 * native-surface authority outside the built-in read-only preview.
 */
export type OfficeEditorAction = Readonly<{
  id: string;
  label: string;
  activate: () => void | Promise<void>;
}>;

export type OfficeEditorActionResolver = (
  document: EditorDocument,
) => readonly OfficeEditorAction[];

export type EditorViewerMatch = {
  document: EditorDocument;
  format: FileFormat;
  resolvedExtension: string | null;
};

export type PresetViewerRenderContext = EditorViewerMatch & {
  content: string;
  /** Host-admitted immutable budget for this concrete Viewer execution. */
  resourcePolicy: PresetViewerResourcePolicy;
  aiEditFile?: AiEditFile | null;
  fileUrl?: string | null;
  fileUrlLoading: boolean;
  fileUrlError?: string | null;
  loading: boolean;
  error?: string | null;
  canEdit: boolean;
  hideSourceView: boolean;
  fileIconTheme: FileIconThemeId;
  editorInteractionPreferences: EditorInteractionPreferences;
  htmlTrustMode: MarkdownHtmlTrustMode;
  workspaceId?: string;
  workspaceRoot?: string | null;
  markdownEnvironment?: MarkdownWorkspaceEnvironment | null;
  documentNavigation?: DocumentNavigationPort | null;
  contextMapEnvironment?: ContextMapWorkspaceEnvironment | null;
  appPreview?: AppPreviewController | null;
  openExternalFile?: (path: string) => Promise<void>;
  convertOfficeDocumentToDocx?: OfficeDocumentConverter;
  officeEditorActions?: readonly OfficeEditorAction[];
};

/** @deprecated Prefer PresetViewerRenderContext. */
export type EditorViewerContext = PresetViewerRenderContext;

type PresetViewerImplementationBase = Readonly<{
  providerPolicy?: EditorProviderPolicy;
  id: string;
  match: (match: EditorViewerMatch) => boolean;
  allowPreviewContent?: boolean;
  normalizeContent?: (content: string, document: EditorDocument) => string;
  /**
   * Format-specific runtime veto for an edit-capable contribution. This may
   * narrow access only; the Host separately enforces Viewer capability,
   * FileFormat.editable, canonical-source readiness, and persistence authority.
   */
  isEditable?: (match: EditorViewerMatch & { content: string }) => boolean;
}>;

export type EagerPresetViewerImplementation = PresetViewerImplementationBase & Readonly<{
  render: (context: PresetViewerRenderContext) => ReactNode;
  load?: never;
}>;

export type LazyPresetViewerImplementation = PresetViewerImplementationBase & Readonly<{
  load: () => Promise<{ default: ComponentType<PresetViewerRenderContext> }>;
  render?: never;
}>;

/** A surface attached outside the Editor DOM. The renderer Host contributes
 * matching metadata only; a platform adapter owns navigation and presentation. */
export type IsolatedPresetViewerImplementation = PresetViewerImplementationBase & Readonly<{
  load?: never;
  render?: never;
}>;

/** @deprecated Compute isolation does not determine visual containment. */
export type BrowserEnginePresetViewerImplementation = IsolatedPresetViewerImplementation;

export type PresetViewerImplementation =
  | EagerPresetViewerImplementation
  | LazyPresetViewerImplementation
  | IsolatedPresetViewerImplementation;

/**
 * Versioned contract for a viewer that ships with PuppyOne. Contributions are
 * registered in deterministic order and must not embed format-extension data.
 */
export type EagerPresetViewerContribution = PresetViewerDefinition &
  Omit<EagerPresetViewerImplementation, "id">;

export type LazyPresetViewerContribution = PresetViewerDefinition &
  Omit<LazyPresetViewerImplementation, "id">;

export type IsolatedPresetViewerContribution = PresetViewerDefinition &
  Omit<IsolatedPresetViewerImplementation, "id">;

/** @deprecated Compute isolation does not determine visual containment. */
export type BrowserEnginePresetViewerContribution = IsolatedPresetViewerContribution;

export type PresetViewerContribution = Readonly<
  | EagerPresetViewerContribution
  | LazyPresetViewerContribution
  | IsolatedPresetViewerContribution
>;

/** @deprecated Prefer the product-semantic PresetViewerContribution name. */
export type EditorViewer = PresetViewerContribution;
