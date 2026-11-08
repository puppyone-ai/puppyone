export type DatabaseCell = Readonly<{ kind: string; text: string; truncated: boolean; bytes?: number }>;
export type DatabaseColumn = Readonly<{ id: string; name: string; type: string; primaryKey: boolean }>;
export type DatabaseObjectUnavailableReason = "unsupported-object-kind" | "too-many-columns" | "generated-or-hidden-columns";
export type DatabaseObject = Readonly<{
  id: string; name: string; kind: string; readable: boolean;
  unavailableReason?: DatabaseObjectUnavailableReason;
}>;
export type DatabaseInfo = Readonly<{
  adapterVersion: 1; binding: string; dataModel: "relational"; consistency: "read-transaction";
  capabilities: Readonly<{ metadata: true; browse: true; filter: false; sort: false; count: false; sql: false }>;
  engine: string; engineVersion: string; objects: readonly DatabaseObject[];
  snapshotEpoch: string; pageRows: number; pageColumns: number;
  /** Native connection deadline, not the validity of an already rendered page. */
  expiresAt: number;
}>;
export type DatabasePage = Readonly<{
  rows: readonly (readonly DatabaseCell[])[]; columns?: readonly DatabaseColumn[];
  visibleColumns?: readonly DatabaseColumn[]; cursor: string | null; hasMore: boolean; snapshotEpoch: string; expiresAt: number;
}>;
export type DatabasePageRequest = { objectId?: string; columnOffset?: number; cursor?: string };
export type DatabasePreviewSession = Readonly<{
  /** Allocation is available before ready, so failed or cancelled startup still
   * has a retriable close handle registered in the common document barrier. */
  ready: Promise<DatabaseInfo>;
  readPage: (request: DatabasePageRequest, signal: AbortSignal) => Promise<DatabasePage>;
  close: () => Promise<void>;
}>;
export type DatabasePreviewPort = Readonly<{
  open: (path: string, signal: AbortSignal) => Promise<DatabasePreviewSession>;
}>;
/** Narrow format service ports, not a DataPort or arbitrary IPC locator. */
export type DocumentProjectionLease = Readonly<{ url: string; close: () => Promise<void> }>;
export type DocumentProjectionPort = Readonly<{
  /** `offline` projections are served with a no-network policy and may not navigate away. */
  create: (path: string, content: string, signal: AbortSignal, options?: { interactive: boolean; baseHref?: string | null; offline?: boolean }) => Promise<DocumentProjectionLease>;
}>;
export type HtmlFolderFile = Readonly<{ name: string; modified: number | null }>;
/**
 * Text files directly inside the folder that holds one HTML page. Callers pass
 * bare file names; the folder itself is fixed when the session is opened.
 */
export type HtmlFolderAccessSession = Readonly<{
  folderName: string;
  list: () => Promise<readonly HtmlFolderFile[]>;
  read: (name: string) => Promise<{ content: string; version: string | null; modified: number | null }>;
  write: (name: string, content: string, expectedVersion: string | null) => Promise<{ version: string | null }>;
  create: (name: string) => Promise<void>;
}>;
export type HtmlFolderAccessPort = Readonly<{
  /** Null for a page at a project root or a provider without folder access. */
  open: (documentPath: string) => HtmlFolderAccessSession | null;
}>;
export type EditorPreviewServices = Readonly<{
  database?: DatabasePreviewPort; documentProjection?: DocumentProjectionPort; htmlFolderAccess?: HtmlFolderAccessPort;
}>;
