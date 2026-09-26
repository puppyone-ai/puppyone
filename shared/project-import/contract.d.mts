/** A source module lives at sources/<source-id>.mjs and exports createImportSource(dependencies). */
export type ImportSourceMode = "repository" | "folder" | "remote";

export type ImportResource = Readonly<{
  id: string;
  name: string;
  kind: "folder" | "document" | "database" | "file";
}>;

export type ImportResourcePage = Readonly<{
  items: readonly ImportResource[];
  nextCursor: string | null;
}>;

export type ImportProgress = Readonly<{
  phase: "preparing" | "reading" | "writing" | "publishing" | "complete";
  filesWritten?: number;
  path?: string;
}>;

export type ImportWriter = Readonly<{
  /** SaaS adapters must use this method for every imported file. */
  writeFile(path: string, content: string | Uint8Array | AsyncIterable<Uint8Array>): Promise<void>;
  /** Available only to local folder and repository adapters. */
  materializeDirectory(run: (stagingPath: string) => Promise<void>): Promise<void>;
}>;

export type ImportSourceAdapter = Readonly<{
  mode: ImportSourceMode;
  /** Remote adapters keep the returned session in Main; it never crosses IPC. */
  connect?: (context: { ownerWindow?: unknown; shell?: unknown }) => Promise<unknown>;
  listResources?: (request: { connection: unknown; parentId: string | null; cursor: string | null }) => Promise<ImportResourcePage>;
  inspect: (source: Record<string, unknown>, context: { connection: unknown }) => Promise<{
    name: string;
    source: unknown;
  }>;
  materialize: (request: {
    source: unknown;
    connection: unknown;
    writer: ImportWriter;
    targetPath: string;
    signal?: AbortSignal;
    onProgress: (progress: ImportProgress) => void;
  }) => Promise<void>;
}>;
