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
import { type DesktopCloudSession } from "../../../lib/cloudApi";
import { resolveCloudApiBaseUrl } from "../../../../shared/cloudEndpoint.js";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import type { ResolvedWorkbenchDataResource } from "../../data-workspace/workbenchDataPort";
import { createCloudNativePreviewPorts } from "../../../platform";
import { waitForCloudRead } from "./cloudFileReads";
import { createCloudWorkspaceClient, encodeWorkspaceBytes } from "./cloudWorkspaceClient";
import { statusOf, type CloudEntry } from "./contracts";
import type { CloudWorkspaceOpeningProgress } from "./cloudWorkspaceOpening";
import type { CloudWorkspaceHandoff } from "./cloudWorkspaceHandoff";

export type NativeCloudDataService = Readonly<{
  workspace: Workspace;
  folder: WorkspaceFolder;
  dataPort: DataPort;
  writable: boolean;
  invalidateReads: () => void;
  watch?: (changed: () => void, failed: (error: Error) => void) => () => void;
  resume?: () => Promise<unknown>;
  openingProgress?: CloudWorkspaceOpeningProgress;
  handoff?: () => CloudWorkspaceHandoff | undefined;
  resolveResource: (path: string | null) => ResolvedWorkbenchDataResource | null;
  getPathForCopy: (path: string) => string;
  /** Last accepted text snapshot; this never loads a resource or exposes draft edits. */
  getCachedFileContent?: (path: string) => FileContent | null;
}>;

/** Cloud owns the bytes. The renderer never mirrors them into a local checkout. */
export function createCloudDataService({
  session,
  context,
  apiBaseUrl,
  isCurrent = () => true,
  prepared,
}: {
  session: DesktopCloudSession;
  context: Extract<ProjectCloudContext, { status: "resolved" }>;
  apiBaseUrl: string;
  /** Revoked on project, host or authenticated session changes, including queued saves. */
  isCurrent?: () => boolean;
  prepared?: CloudWorkspaceHandoff;
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
  const storageIdentity = `cloud-workspace-files:${rootUri}`;
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
    capabilities: { read: true, write: writable, watch: true, execute: false },
    trustState: "untrusted",
    workspace,
  };
  const snapshots = new Map<string, Map<string, string>>();
  const snapshotUrls = new Set<string>();
  let mutationTail: Promise<unknown> = Promise.resolve();
  const assertCurrent = () => {
    if (!isCurrent()) throw new Error("Cloud workspace session changed. Reopen the Cloud workspace.");
  };
  const files = createCloudWorkspaceClient(session, context, apiBaseUrl, assertCurrent, prepared);
  const relativePath = (resource: string | null): string => {
    assertValidDataResourceReference(resource);
    if (!resource) return "";
    return isDataResourceUri(resource)
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
  const list = (path: string | null) => files.list(remotePath(path));
  const remember = (path: string, version: string, content: string) => {
    const versions = snapshots.get(path) ?? new Map<string, string>();
    versions.delete(version);
    versions.set(version, content);
    while (versions.size > 8) versions.delete(versions.keys().next().value!);
    snapshots.set(path, versions);
    while (snapshots.size > 128) snapshots.delete(snapshots.keys().next().value!);
  };
  const readText = async (path: string) => {
    const result = await files.readText(remotePath(path));
    remember(remotePath(path), result.version, result.content);
    return result;
  };
  const stat = async (path: string) => {
    try {
      const entry = await files.stat(remotePath(path));
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
  const move = async (from: string, to: string) => {
    if (!relativePath(from) || !relativePath(to)) throw new Error("The Cloud repository root cannot be moved.");
    const oldPath = remotePath(from);
    const newPath = remotePath(to);
    await files.change("move", oldPath, newPath);
    for (const [path, versions] of [...snapshots]) {
      if (path === oldPath || path.startsWith(`${oldPath}/`)) {
        snapshots.delete(path); snapshots.set(`${newPath}${path.slice(oldPath.length)}`, versions);
      }
    }
  };
  const persist: NonNullable<DataPort["documentPersistence"]>["persist"] = (input) => serializeMutation(async (): Promise<DocumentPersistenceResult> => {
    try {
      if (!relativePath(input.path) || !input.baseVersion) throw new Error("Reload this Cloud file before saving.");
      const result = await files.write(remotePath(input.path), input.content, input.baseVersion);
      remember(remotePath(input.path), result.version, input.content);
      return { ok: true, version: result.version };
    } catch (error) {
      if (statusOf(error) === 409) {
        try {
          const latest = await readText(input.path);
          return { ok: false, kind: "conflict", content: latest.content, version: latest.version };
        } catch { /* Keep the draft when the workspace itself is unavailable. */ }
      }
      let kind: "not-found" | "permission-denied" | "io" = "io";
      if (statusOf(error) === 404) kind = "not-found";
      else if ([401, 403].includes(statusOf(error))) kind = "permission-denied";
      return { ok: false, kind,
        message: error instanceof Error ? error.message : String(error) };
    }
  });
  const bridge = window.puppyoneDesktop;
  const nativePreview = typeof bridge?.openCloudDatabasePreview === "function"
    ? createCloudNativePreviewPorts(bridge, async (path) => ({ apiBaseUrl, projectId: context.projectId,
      path: remotePath(path), workbench: await files.ensure(),
      expectedSession: { userId: session.user_id, generation: session.session_generation } }), assertCurrent)
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
        let projectionBytes = new TextEncoder().encode(content).length;
        return createCloudHtmlProjection(path, content, {
          root: rootUri, readText, sign: async (resource) => {
            // Opaque preview frames cannot access the parent renderer's Blob URLs.
            const { bytes } = await files.read(remotePath(resource));
            projectionBytes += Math.ceil(bytes.length / 3) * 4;
            if (projectionBytes > 4 * 1024 * 1024) throw new Error("HTML preview resources exceed the 4 MiB projection limit.");
            return `data:${previewMime(relativePath(resource))};base64,${encodeWorkspaceBytes(bytes)}`;
          },
          assertCurrent, revokeResource: (url) => dataPort.revokeFileUrl!(url),
          createDocument: (request) => bridge.createSandboxedPreviewDocument(request),
          revokeDocument: (url) => bridge.revokeSandboxedPreviewDocument({ url }),
        }, signal, options);
      } } },
    } : {}),
    getCachedChildren: (path) => {
      assertCurrent();
      return files.peekDirectory(remotePath(path))?.entries.map(mapEntry);
    },
    listChildren: async (path) => {
      assertCurrent();
      const children = (await list(path)).entries.map(mapEntry);
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
      // Share transport reads, not a result bound to another provider's UI lease.
      const result = await waitForCloudRead(
        readCloudFile(relativePath(path), () => stat(path), () => readText(path), mapEntry), options?.signal);
      assertCurrent();
      // Each service owns its own HTML version leases even when the bytes
      // were fetched by a different view of the same authenticated resource.
      if (typeof result.content === "string" && result.version) {
        remember(remotePath(path), result.version, result.content);
      }
      return result;
    },
    getFileUrl: async (path, options) => {
      assertCurrent();
      const name = relativePath(path);
      const format = resolveFileFormat({ name });
      const mime = previewMime(name);
      const cached = options?.expectedVersion && snapshots.get(remotePath(path))?.get(options.expectedVersion);
      let bytes: Uint8Array;
      if (typeof cached === "string") bytes = new TextEncoder().encode(cached);
      else {
        const result = await files.read(remotePath(path));
        if (options?.expectedVersion && options.expectedVersion !== result.version) throw new Error("This file changed. Reload the preview.");
        bytes = result.bytes;
      }
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
      try {
        if (format.defaultViewer === "pdf-preview") {
          if (!bridge?.retainCloudPreviewResource) throw new Error("Secure PDF preview is unavailable.");
          await bridge.retainCloudPreviewResource({ apiBaseUrl, projectId: context.projectId, path: remotePath(path),
            workbench: await files.ensure(), blobUrl: url,
            expectedSession: { userId: session.user_id, generation: session.session_generation } });
        }
        assertCurrent(); snapshotUrls.add(url); return url;
      } catch (error) { URL.revokeObjectURL(url); throw error; }
    },
    revokeFileUrl: async (url) => {
      if (snapshotUrls.delete(url)) { URL.revokeObjectURL(url); await bridge?.revokeCloudPreviewResource?.({ url }); }
    },
    ...(writable ? {
      documentPersistence: { kind: "cloud" as const, storageIdentity, persist },
      createFolder: (path: string) => serializeMutation(async () => {
        if (!relativePath(path)) throw new Error("The Cloud repository root already exists.");
        const remote = remotePath(path);
        await files.change("mkdir", remote);
      }),
      createFile: (path: string, content = "") => serializeMutation(async () => {
        const relative = relativePath(path);
        if (!relative) throw new Error("A Cloud file name is required.");
        const parent = relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : null;
        const directory = await list(parent);
        if (directory.entries.some((entry) => normalizeProviderPath(entry.path) === remotePath(path))) {
          throw new Error("A Cloud file already exists at this path.");
        }
        await files.write(remotePath(path), content, null);
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
        await files.change("remove", remotePath(path));
      }),
    } : {}),
  };
  return { workspace, folder, dataPort, writable, openingProgress: files.openingProgress, watch: files.watch, resume: files.resume, handoff: files.handoff,
    getCachedFileContent: (path) => {
      assertCurrent();
      const versions = snapshots.get(remotePath(path));
      const latest = versions && [...versions.entries()].at(-1);
      if (!latest) return null;
      const name = relativePath(path).split("/").pop()!;
      const type = getFileSemanticKind(name);
      return type === "folder" ? null : { path, name, type, content: latest[1], version: latest[0] };
    },
    getPathForCopy: (path) => { assertCurrent(); return remotePath(path) || "."; },
    invalidateReads: () => { assertCurrent(); files.invalidate(); },
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

/** Known text consumes the pinned cat response directly; other formats first resolve MIME. */
async function readCloudFile(name: string, stat: () => Promise<CloudEntry | null>,
  readText: () => Promise<{ content: string; version: string; entry: CloudEntry }>,
  mapEntry: (entry: CloudEntry) => DataNode): Promise<FileContent> {
  const needsText = (requirement: string) => requirement === "content" || requirement === "content-and-resource";
  const inferred = getEditorSourceRequirement({ name, type: getFileSemanticKind(name) });
  let text: Awaited<ReturnType<typeof readText>> | null = null;
  let entry: CloudEntry | null;
  if (needsText(inferred)) {
    text = await readText(); entry = text.entry;
  } else {
    entry = await stat();
    if (!entry || entry.type === "folder") throw new Error("Cloud file not found.");
    const node = mapEntry(entry);
    if (needsText(getEditorSourceRequirement({ name, type: node.type, mimeType: entry.mime_type }))) {
      text = await readText();
      entry = text.entry;
    }
  }
  const node = mapEntry(entry);
  return { path: node.path, name: node.name, type: node.type as FileContent["type"],
    mimeType: node.mimeType, size: node.size, content: text?.content ?? null, version: text?.version ?? null };
}

function normalizeProviderPath(path: string): string {
  if (path.includes("\\") || path.includes("\0") || /^[A-Za-z]:/.test(path)) throw new Error("Invalid Cloud resource path.");
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (clean.split("/").some((segment) => segment === ".." || segment === ".")) throw new Error("Cloud resource path traversal is not allowed.");
  return clean;
}

function previewMime(name: string) {
  const format = resolveFileFormat({ name }), extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  return format.mimeTypesByExtension?.[extension] ?? format.mimeTypes?.find(type => type.split("/")[1] === extension.slice(1)) ?? format.mimeTypes?.[0] ?? "application/octet-stream";
}
