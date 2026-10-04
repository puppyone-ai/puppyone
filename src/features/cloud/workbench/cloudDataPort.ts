import {
  assertValidDataResourceReference,
  createResourceUri,
  createWorkspaceResourceUri,
  getWorkspaceResourcePath,
  getFileSemanticKind,
  isDataResourceUri,
  getEditorSourceRequirement,
  resolveFileFormat,
  type DataNode,
  type DataPort,
  type DocumentPersistenceResult,
  type FileContent,
  type ResourceUri,
  type Workspace,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";
import { cloudApiRequest, type DesktopCloudSession } from "../../../lib/cloudApi";
import { resolveCloudApiBaseUrl } from "../../../../shared/cloudEndpoint.js";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import type { ResolvedWorkbenchDataResource } from "../../data-workspace/workbenchDataPort";
import { createCloudNativePreviewPorts } from "../../../platform";
import { createCloudWorkbenchReads, waitForCloudRead } from "./cloudWorkbenchReads";

type CloudEntry = {
  path: string;
  name: string;
  type: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  children_count?: number | null;
  exists?: boolean;
};
type CloudDirectory = { entries: CloudEntry[]; head_commit_id: string };
type CloudContent = { content_text?: string | null; content?: unknown; head_commit_id: string };
type CloudWrite = { path: string; commit_id: string; conflicts?: string[] };
export type NativeCloudDataService = Readonly<{
  workspace: Workspace;
  folder: WorkspaceFolder;
  dataPort: DataPort;
  writable: boolean;
  invalidateReads: () => void;
  resolveResource: (path: string | null) => ResolvedWorkbenchDataResource | null;
}>;

/** Cloud owns the bytes. The renderer never mirrors them into a local checkout. */
export function createCloudDataService({
  session,
  context,
  apiBaseUrl,
  isCurrent = () => true,
}: {
  session: DesktopCloudSession;
  context: Extract<ProjectCloudContext, { status: "resolved" }>;
  apiBaseUrl: string;
  /** Revoked on project, host or authenticated session changes, including queued saves. */
  isCurrent?: () => boolean;
}): NativeCloudDataService {
  apiBaseUrl = resolveCloudApiBaseUrl(apiBaseUrl);
  const base = new URL(apiBaseUrl);
  if (base.username || base.password || context.target.project_id !== context.projectId) {
    throw new Error("Invalid Cloud repository authority.");
  }
  const scopePath = normalizeProviderPath(context.scopePath ?? "");
  if (context.target.kind === "scope" && !context.scopePath) {
    throw new Error("Cloud repository scope has not been resolved.");
  }
  const rootUri = createResourceUri({
    scheme: "puppyone-cloud",
    authority: base.host,
    path: [base.protocol.replace(":", ""), base.pathname.replace(/^\/+|\/+$/g, ""), session.user_id,
      context.projectId, context.target.kind === "scope" ? context.target.scope_id : "root"].join("/"),
  });
  const storageIdentity = `cloud-workbench:${rootUri}`;
  const workspace: Workspace = {
    id: storageIdentity,
    name: context.projectName || context.projectId,
    path: rootUri,
    status: "recording",
    projectId: context.projectId,
  };
  const writable = context.capabilities?.includes("content.write") === true;
  const folder: WorkspaceFolder = {
    id: storageIdentity,
    name: workspace.name,
    uri: rootUri,
    index: 0,
    capabilities: { read: true, write: writable, watch: false, execute: false },
    trustState: "untrusted",
    workspace,
  };
  const apiPath = `/content/${encodeURIComponent(context.projectId)}`;
  const reads = createCloudWorkbenchReads(session, context, apiBaseUrl, scopePath);
  const snapshots = new Map<string, Map<string, string>>();
  const snapshotUrls = new Set<string>();
  let mutationTail: Promise<unknown> = Promise.resolve();
  const assertCurrent = () => {
    if (!isCurrent()) throw new Error("Cloud workspace session changed. Reopen the Cloud workspace.");
  };
  const request = async <T>(endpoint: string, body?: object): Promise<T> => {
    assertCurrent();
    const result = await cloudApiRequest<T>(`${apiPath}/${endpoint}`, session, undefined,
      body ? { method: "POST", body: JSON.stringify(body) } : {}, apiBaseUrl);
    assertCurrent();
    return result;
  };
  const relativePath = (resource: string | null): string => {
    assertValidDataResourceReference(resource);
    return !resource ? "" : isDataResourceUri(resource)
      ? getWorkspaceResourcePath(rootUri, resource)
      : normalizeProviderPath(resource);
  };
  const remotePath = (resource: string | null): string => (
    [scopePath, relativePath(resource)].filter(Boolean).join("/")
  );
  const resourceUri = (path: string): ResourceUri => {
    const cleanPath = normalizeProviderPath(path);
    if (scopePath && cleanPath !== scopePath && !cleanPath.startsWith(`${scopePath}/`)) {
      throw new Error("Cloud response is outside the current repository scope.");
    }
    return createWorkspaceResourceUri(rootUri, scopePath ? cleanPath.slice(scopePath.length).replace(/^\//, "") : cleanPath);
  };
  const mapEntry = (entry: CloudEntry) => mapCloudEntry(entry, resourceUri(entry.path), folder.id);
  const list = (path: string | null) => reads.fetch<CloudDirectory>(`ls?path=${encodeURIComponent(remotePath(path))}`);
  const remember = (path: string, version: string, content: string) => {
    const versions = snapshots.get(path) ?? new Map<string, string>();
    versions.set(version, content);
    while (versions.size > 8) versions.delete(versions.keys().next().value!);
    snapshots.set(path, versions);
    while (snapshots.size > 128) snapshots.delete(snapshots.keys().next().value!);
  };
  const readText = async (path: string) => {
    // The HTTP cat contract reports project HEAD after reading the blob.
    // Bracket that read so a concurrent publication cannot label old bytes
    // with a newer HEAD and defeat the subsequent conditional write.
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await head();
      const result = await reads.fetch<CloudContent>(`cat?path=${encodeURIComponent(remotePath(path))}`);
      if (typeof result.head_commit_id !== "string" || !result.head_commit_id) throw new Error("Cloud response has no storage revision.");
      if (before !== result.head_commit_id) continue;
      const content = typeof result.content_text === "string" ? result.content_text
        : typeof result.content === "string" ? result.content
          : result.content == null ? "" : JSON.stringify(result.content, null, 2);
      remember(remotePath(path), result.head_commit_id, content);
      return { content, version: result.head_commit_id };
    }
    throw new Error("Cloud changed while reading this file. Refresh to retry.");
  };
  const stat = async (path: string): Promise<CloudEntry | null> => {
    try {
      const entry = await reads.load("stat", remotePath(path), () =>
        reads.fetch<CloudEntry>(`stat?path=${encodeURIComponent(remotePath(path))}`));
      return entry.exists === false ? null : entry;
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  };
  const serializeMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = mutationTail.then(() => { assertCurrent(); return operation(); });
    mutationTail = pending.catch(() => undefined);
    return pending;
  };
  const head = async () => {
    const result = await list(null);
    // The existing Cloud contract uses an explicit empty HEAD for a new,
    // empty repository. Missing/null is invalid; "" is a valid CAS baseline.
    if (typeof result.head_commit_id !== "string") throw new Error("Cloud response has no storage revision.");
    return result.head_commit_id;
  };
  const coherentDirectory = async (path: string | null) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await head();
      const directory = await list(path);
      if (directory.head_commit_id === before) return directory;
    }
    throw new Error("Cloud changed while listing this folder. Refresh to retry.");
  };
  const move = async (from: string, to: string) => {
    if (!relativePath(from) || !relativePath(to)) throw new Error("The Cloud repository root cannot be moved.");
    const oldPath = remotePath(from);
    const newPath = remotePath(to);
    await request("mv", { old_path: oldPath, new_path: newPath,
      no_clobber: true, base_commit_id: await head() });
    for (const [path, versions] of [...snapshots]) {
      if (path === oldPath || path.startsWith(`${oldPath}/`)) {
        snapshots.delete(path); snapshots.set(`${newPath}${path.slice(oldPath.length)}`, versions);
      }
    }
  };
  const persist: NonNullable<DataPort["documentPersistence"]>["persist"] = (input) => serializeMutation(async (): Promise<DocumentPersistenceResult> => {
    try {
      if (!relativePath(input.path)) throw new Error("The Cloud repository root is not a document.");
      const original = input.baseVersion == null ? undefined
        : snapshots.get(remotePath(input.path))?.get(input.baseVersion);
      if (!input.baseVersion) {
        return { ok: false, kind: "io", message: "Reload the Cloud file before saving: its base revision is unavailable." };
      }
      let version = input.baseVersion;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await request<CloudWrite>("write", {
            path: remotePath(input.path), content: input.content,
            node_type: nodeType(input.path), base_commit_id: version,
          });
          if (result.conflicts?.length) {
            const latest = await readText(input.path);
            return { ok: false, kind: "conflict", ...latest };
          }
          if (resourceUri(result.path) !== createWorkspaceResourceUri(rootUri, relativePath(input.path))) {
            throw new Error("Cloud saved a different resource.");
          }
          if (typeof result.commit_id !== "string" || !result.commit_id) throw new Error("Cloud save has no storage revision.");
          remember(remotePath(input.path), result.commit_id, input.content);
          return { ok: true, version: result.commit_id };
        } catch (error) {
          if (statusOf(error) !== 409) throw error;
          const latest = await readText(input.path);
          // Another file changed the project HEAD. Retry only when this file's
          // original bytes are still intact; same-file edits stay a conflict.
          if (original === undefined || latest.content !== original) return { ok: false, kind: "conflict", ...latest };
          version = latest.version;
        }
      }
      return { ok: false, kind: "io", message: "Cloud is changing. Retry saving this file." };
    } catch (error) {
      return { ok: false, kind: statusOf(error) === 404 ? "not-found"
        : [401, 403].includes(statusOf(error)) ? "permission-denied" : "io",
      message: error instanceof Error ? error.message : String(error) };
    }
  });
  const bridge = window.puppyoneDesktop;
  const nativePreview = typeof bridge?.openCloudDatabasePreview === "function"
    ? createCloudNativePreviewPorts(bridge, (path) => ({ apiBaseUrl, projectId: context.projectId,
      path: remotePath(path), expectedSession: { userId: session.user_id, generation: session.session_generation } }), assertCurrent)
    : null;
  const dataPort: DataPort = {
    ...(nativePreview ? { previewServices: { database: nativePreview.database },
      convertOfficeDocumentToDocx: nativePreview.convertOfficeDocumentToDocx } : {}),
    ...(typeof window.puppyoneDesktop?.createSandboxedPreviewDocument === "function" ? {
      previewServices: { ...(nativePreview ? { database: nativePreview.database } : {}), documentProjection: { async create(path: string, content: string, signal: AbortSignal,
        options?: { interactive: boolean; baseHref?: string | null }) {
        assertCurrent(); signal.throwIfAborted();
        const bridge = window.puppyoneDesktop!;
        const { createCloudHtmlProjection } = await import("./cloudHtmlProjection");
        return createCloudHtmlProjection(path, content, {
          root: rootUri, readText, sign: async (resource) => dataPort.getFileUrl!(resource),
          assertCurrent, revokeResource: (url) => dataPort.revokeFileUrl!(url),
          createDocument: (request) => bridge.createSandboxedPreviewDocument(request),
          revokeDocument: (url) => bridge.revokeSandboxedPreviewDocument({ url }),
        }, signal, options);
      } } },
    } : {}),
    getCachedChildren: (path) => {
      assertCurrent();
      return reads.peek<DataNode[]>("directory", remotePath(path));
    },
    listChildren: async (path) => {
      assertCurrent();
      const children = await reads.load("directory", remotePath(path), async () => (await list(path)).entries.map(mapEntry), 30_000);
      assertCurrent();
      return children;
    },
    resolveNode: async (path) => {
      assertCurrent();
      if (!relativePath(path)) return { id: rootUri, name: workspace.name, path: rootUri,
        resourceUri: rootUri, type: "folder", source: "cloud", workspaceFolderId: folder.id, workspaceFolderRoot: true };
      const entry = await stat(path);
      assertCurrent();
      return entry ? mapEntry(entry) : null;
    },
    readFile: async (path, options): Promise<FileContent> => {
      assertCurrent();
      options?.signal?.throwIfAborted();
      const result = await waitForCloudRead(reads.load("file", remotePath(path), () =>
        readCloudFile(relativePath(path), () => stat(path), () => readText(path), mapEntry)), options?.signal);
      assertCurrent();
      // Each service owns its own HTML version leases even when the bytes
      // were fetched by a different view of the same authenticated resource.
      if (typeof result.content === "string" && result.version) remember(remotePath(path), result.version, result.content);
      return result;
    },
    getFileUrl: async (path, options) => {
      if (options?.expectedVersion) {
        // Dual-input HTML uses the exact bytes already accepted by readFile.
        // The signed inline API follows HEAD and cannot supply that guarantee.
        const content = snapshots.get(remotePath(path))?.get(options.expectedVersion);
        if (resolveFileFormat({ name: relativePath(path) }).defaultViewer !== "html-artifact" || content === undefined) {
          throw new Error("This Cloud file version is no longer available. Reload the file.");
        }
        const url = URL.createObjectURL(new Blob([content], { type: "text/html" }));
        snapshotUrls.add(url);
        return url;
      }
      assertCurrent();
      const signed = typeof bridge?.retainCloudPreviewResource === "function"
        ? await bridge.retainCloudPreviewResource({ apiBaseUrl, projectId: context.projectId, path: remotePath(path),
          expectedSession: { userId: session.user_id, generation: session.session_generation } })
        : await request<{ url: string }>("inline/sign", { path: remotePath(path) });
      const url = new URL(signed.url, `${apiBaseUrl.replace(/\/+$/, "")}/`);
      const expectedPath = `${base.pathname.replace(/\/+$/, "")}${apiPath}/inline`;
      if (url.origin !== base.origin || url.username || url.password || url.hash
        || url.pathname !== expectedPath || url.searchParams.get("path") !== remotePath(path)
        || !url.searchParams.get("token")) throw new Error("Cloud returned an invalid file preview URL.");
      try { assertCurrent(); } catch (error) { await bridge?.revokeCloudPreviewResource?.({url:url.href}); throw error; }
      return url.toString();
    },
    revokeFileUrl: async (url) => {
      if (snapshotUrls.delete(url)) URL.revokeObjectURL(url);
      else await bridge?.revokeCloudPreviewResource?.({url});
    },
    ...(writable ? {
      documentPersistence: { kind: "cloud" as const, storageIdentity, persist },
      createFolder: (path: string) => serializeMutation(async () => {
        if (!relativePath(path)) throw new Error("The Cloud repository root already exists.");
        await request("mkdir", { path: remotePath(path), base_commit_id: await head() });
      }),
      createFile: (path: string, content = "") => serializeMutation(async () => {
        const relative = relativePath(path);
        if (!relative) throw new Error("A Cloud file name is required.");
        const parent = relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : null;
        const directory = await coherentDirectory(parent);
        if (directory.entries.some((entry) => normalizeProviderPath(entry.path) === remotePath(path))) {
          throw new Error("A Cloud file already exists at this path.");
        }
        if (typeof directory.head_commit_id !== "string") throw new Error("Cloud response has no storage revision.");
        await request("write", { path: remotePath(path), content,
          node_type: nodeType(path), base_commit_id: directory.head_commit_id });
      }),
      renameNode: (path: string, name: string) => serializeMutation(async () => {
        if (!name || name === "." || name === ".." || /[\/\\\0]/.test(name)) throw new Error("Invalid Cloud file name.");
        const relative = relativePath(path);
        const parent = relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "";
        await move(path, createWorkspaceResourceUri(rootUri, [parent, name].filter(Boolean).join("/")));
      }),
      moveNode: (from: string, to: string) => serializeMutation(() => move(from, to)),
      deleteNode: (path: string) => serializeMutation(async () => {
        if (!relativePath(path)) throw new Error("The Cloud repository root cannot be deleted.");
        await request("rm", { path: remotePath(path), recursive: true, base_commit_id: await head() });
      }),
    } : {}),
  };
  return { workspace, folder, dataPort, writable,
    invalidateReads: () => { assertCurrent(); reads.invalidate(); },
    resolveResource: (path) => {
    try {
      const providerPath = relativePath(path) || null;
      return { folder, providerPath, resourceUri: createWorkspaceResourceUri(rootUri, providerPath ?? "") };
    } catch { return null; }
  } };
}

function mapCloudEntry(entry: CloudEntry, uri: ResourceUri, folderId: string): DataNode {
  return {
    id: uri, path: uri, resourceUri: uri, name: entry.name,
    type: entry.type === "folder" ? "folder" : getFileSemanticKind(entry.path, entry.type, entry.mime_type),
    mimeType: entry.mime_type,
    size: entry.size_bytes == null ? undefined : String(entry.size_bytes),
    source: "cloud", workspaceFolderId: folderId,
    hasChildren: entry.type === "folder" ? (entry.children_count ?? 1) > 0 : undefined,
  };
}

/** Keep Web's stat/source parallelism without weakening the source revision check. */
async function readCloudFile(name: string, stat: () => Promise<CloudEntry | null>,
  readText: () => Promise<{ content: string; version: string }>, mapEntry: (entry: CloudEntry) => DataNode): Promise<FileContent> {
  const inferred = getEditorSourceRequirement({ name, type: getFileSemanticKind(name) });
  const needsText = (requirement: string) => requirement === "content" || requirement === "content-and-resource";
  // Known text formats start alongside stat. Unknown formats wait for MIME.
  const [entry, speculative] = await Promise.all([
    stat(), needsText(inferred) ? readText() : Promise.resolve(null),
  ]);
  if (!entry || entry.type === "folder") throw new Error("Cloud file not found.");
  const node = mapEntry(entry);
  const requirement = getEditorSourceRequirement({ name, type: node.type, mimeType: entry.mime_type });
  const text = needsText(requirement) ? speculative ?? await readText() : null;
  return { path: node.path, name: node.name, type: node.type as FileContent["type"],
    mimeType: node.mimeType, size: node.size, content: text?.content ?? null, version: text?.version ?? null };
}

function normalizeProviderPath(path: string): string {
  if (path.includes("\\") || path.includes("\0") || /^[A-Za-z]:/.test(path)) throw new Error("Invalid Cloud resource path.");
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (clean.split("/").some((segment) => segment === ".." || segment === ".")) throw new Error("Cloud resource path traversal is not allowed.");
  return clean;
}
function nodeType(path: string): "json" | "markdown" | "file" {
  // The Cloud writer appends .json/.md for structured types. Use file for
  // alternate extensions so a save can never silently change the file name.
  return path.endsWith(".json") ? "json" : path.endsWith(".md") ? "markdown" : "file";
}
function statusOf(error: unknown): number {
  return error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
}
