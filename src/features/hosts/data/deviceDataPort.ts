import {
  assertValidDataResourceReference, createWorkspaceResourceUri, getWorkspaceResourcePath,
  getFileSemanticKind, getEditorSourceRequirement, resolveFileFormat,
  isDataResourceUri, type DataNode, type DataPort, type DocumentPersistenceResult, type FileContent,
  type ResourceUri, type Workspace, type WorkspaceFolder,
} from "@puppyone/shared-ui";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { resolveCloudApiBaseUrl } from "../../../../shared/cloudEndpoint.js";
import type { HostFileEntry, HostFileOperation, HostFolderEvent, HostFolderResult } from "../../../../shared/host-contract/types";
import { deviceFolderRootUri, type DeviceFolderRef } from "../model/deviceFolderIdentity";
import { decodeWorkspaceBytes, encodeWorkspaceBytes } from "../../cloud/files/cloudWorkspaceClient";

/** Why a remote folder cannot serve right now; the surface words it for the user. */
export type DeviceFolderAvailability = "online" | "offline" | "revoked" | "denied";

export class DeviceFolderError extends Error {
  constructor(readonly code: string, readonly status: number, readonly outcomeUnknown = false) {
    super(code);
  }
}

export function availabilityOf(error: unknown): DeviceFolderAvailability | null {
  if (!(error instanceof DeviceFolderError)) return null;
  if (["device_offline", "device_disconnected", "device_timeout", "device_busy", "network_unavailable"].includes(error.code)) return "offline";
  if (error.status === 403 && error.code === "folder_unavailable") return "revoked";
  if (error.status === 401 || error.status === 403) return "denied";
  return null;
}

export type DeviceDataService = Readonly<{
  workspace: Workspace;
  folder: WorkspaceFolder;
  dataPort: DataPort;
  writable: boolean;
  invalidateReads: () => void;
  dispose: () => void;
  getPathForCopy: (resource: string) => string;
  /** Coalesced changes made on the other computer; `status` reports reachability. */
  watchFolder: (changed: (paths: string[] | null) => void, status: (availability: DeviceFolderAvailability) => void) => () => void;
  /** The shared remote workbench's shape: a change rescans; losing the computer is a failure it can retry. */
  watch: (changed: () => void, failed: (error: Error) => void) => () => void;
  resume: () => void;
  resolveResource: (resource: string | null) => { folder: WorkspaceFolder; providerPath: string | null; resourceUri: ResourceUri } | null;
}>;

/**
 * File-only provider for a folder on another of the owner's computers.
 * Requests go through Main, which holds the Cloud credential; no local checkout,
 * Shell, Git, external app or implicit Cloud publication exists for it.
 */
export function createDeviceDataService({ ref, name, writable, session, apiBase, isCurrent = () => true,
  describeAvailability = (availability) => availability }: {
  ref: DeviceFolderRef; name: string; writable: boolean; session: DesktopCloudSession;
  apiBase: string; isCurrent?: () => boolean;
  /** User-facing words for an unreachable folder, shown by the shared workbench. */
  describeAvailability?: (availability: DeviceFolderAvailability) => string;
}): DeviceDataService {
  if (session.user_id !== ref.accountId || resolveCloudApiBaseUrl(apiBase) !== resolveCloudApiBaseUrl(ref.deployment)
      || session.api_base_url !== resolveCloudApiBaseUrl(apiBase)) {
    throw new Error("Remote folder authority changed.");
  }
  const bridge = window.puppyoneDesktop;
  if (!bridge?.requestHostFolder) throw new Error("Remote folders need the PuppyOne desktop app.");
  const expectedSession = { userId: session.user_id, generation: session.session_generation };
  const rootUri = deviceFolderRootUri(ref);
  const storageIdentity = `device-files:${rootUri}`;
  const workspace: Workspace = { id: storageIdentity, name, path: rootUri, status: "recording" };
  const folder: WorkspaceFolder = { id: storageIdentity, name, uri: rootUri, index: 0,
    capabilities: { read: true, write: writable, watch: true, execute: false },
    trustState: "untrusted", workspace };
  const assertCurrent = () => { if (!isCurrent()) throw new Error("Remote folder session changed. Reopen it."); };
  const pathOf = (value: string | null): string => {
    assertCurrent();
    assertValidDataResourceReference(value);
    if (!value) return "";
    const relative = isDataResourceUri(value) ? getWorkspaceResourcePath(rootUri, value) : value;
    if (relative.startsWith("/") || relative.includes("\\") || relative.includes("\0") ||
        relative.split("/").some((part) => part === "." || part === ".." || part.toLowerCase() === ".git")) {
      throw new Error("Invalid remote folder path.");
    }
    return relative;
  };
  const uri = (value: string) => createWorkspaceResourceUri(rootUri, value);
  const node = (value: string, kind: "file" | "directory"): DataNode => ({
    id: uri(value), path: uri(value), resourceUri: uri(value), name: value.split("/").at(-1) ?? name,
    type: kind === "directory" ? "folder" : getFileSemanticKind(value), source: "device",
    workspaceFolderId: folder.id,
  });
  const call = async <T>(operation: HostFileOperation): Promise<T> => {
    assertCurrent();
    const result = await bridge.requestHostFolder<T>({ folderId: ref.folderId, operation, expectedSession }) as HostFolderResult<T>;
    assertCurrent();
    if (!result.ok) throw new DeviceFolderError(result.code, result.status, result.outcomeUnknown === true);
    return result.result;
  };
  const read = async (relative: string) => {
    const result = await call<{ content_base64: string; revision: string }>({ action: "read", path: relative });
    if (!/^[a-f0-9]{64}$/.test(result.revision)) throw new Error("Invalid remote file revision.");
    return { bytes: decodeWorkspaceBytes(result.content_base64), version: result.revision };
  };
  const listing = new Map<string, DataNode[]>();
  const list = async (relative: string) => {
    const result = await call<{ entries: HostFileEntry[] }>({ action: "list", path: relative });
    if (!Array.isArray(result?.entries) || result.entries.length > 10_000) throw new Error("Invalid remote directory.");
    const nodes = result.entries.map((item) => {
      if (!item || typeof item.name !== "string" || !item.name || item.name.includes("/") || item.name.includes("\\") ||
          item.name === "." || item.name === ".." || item.name.toLowerCase() === ".git" ||
          !["file", "directory"].includes(item.kind)) throw new Error("Invalid remote directory entry.");
      return node([relative, item.name].filter(Boolean).join("/"), item.kind);
    });
    listing.set(relative, nodes);
    return nodes;
  };
  let mutations = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = mutations.catch(() => {}).then(operation);
    mutations = next.then(() => {}, () => {});
    return next;
  };
  const mutationError = (error: unknown) => {
    if (error instanceof DeviceFolderError && error.outcomeUnknown) {
      return new Error("The other computer did not confirm this change. Check the folder before trying again.");
    }
    return error;
  };
  const mutate = (operation: HostFileOperation) => serialize(async () => {
    try { await call(operation); } catch (error) { throw mutationError(error); }
  });
  const urls = new Set<string>();
  const persist = async (input: Parameters<NonNullable<DataPort["documentPersistence"]>["persist"]>[0]): Promise<DocumentPersistenceResult> => {
    try {
      const relative = pathOf(input.path);
      if (!relative || !input.baseVersion || !/^[a-f0-9]{64}$/.test(input.baseVersion)) {
        return { ok: false, kind: "io", message: "Reload this remote file before saving." };
      }
      const bytes = new TextEncoder().encode(input.content);
      const result = await call<{ revision: string }>({ action: "write", path: relative,
        content_base64: encodeWorkspaceBytes(bytes), expected_revision: input.baseVersion });
      return { ok: true, version: result.revision };
    } catch (error) {
      if (error instanceof DeviceFolderError && error.status === 409) {
        try {
          const latest = await read(pathOf(input.path));
          return { ok: false, kind: "conflict",
            content: new TextDecoder("utf-8", { fatal: true }).decode(latest.bytes), version: latest.version };
        } catch { /* Keep the draft when the other computer itself is unavailable. */ }
      }
      if (error instanceof DeviceFolderError && error.status === 404) {
        return { ok: false, kind: "not-found", message: "The file no longer exists on the other computer." };
      }
      if (error instanceof DeviceFolderError && (error.status === 403 || error.status === 401)) {
        return { ok: false, kind: "permission-denied", message: "Editing this folder is no longer allowed." };
      }
      // An unknown outcome is never retried here. The Document Session keeps its draft.
      return { ok: false, kind: "io", message: mutationError(error) instanceof Error
        ? (mutationError(error) as Error).message : "Remote save failed." };
    }
  };
  const dataPort: DataPort = {
    listChildren: (value) => list(pathOf(value)),
    getCachedChildren: (value) => { try { return listing.get(pathOf(value)); } catch { return undefined; } },
    resolveNode: async (value) => {
      const relative = pathOf(value);
      if (!relative) return { ...node("", "directory"), name, workspaceFolderRoot: true };
      const parent = relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "";
      return (await list(parent)).find((item) => item.path === uri(relative)) ?? null;
    },
    readFile: async (value, options): Promise<FileContent> => {
      const relative = pathOf(value);
      if (!relative) throw new Error("Cannot read a folder as a file.");
      options?.signal?.throwIfAborted();
      const result = await read(relative);
      options?.signal?.throwIfAborted();
      const resource = node(relative, "file");
      let content: string | null = null;
      const source = getEditorSourceRequirement({ name: resource.name, type: resource.type });
      if (source === "content" || source === "content-and-resource") {
        content = new TextDecoder("utf-8", { fatal: true }).decode(result.bytes);
      }
      return { path: resource.path, name: resource.name, type: resource.type as FileContent["type"],
        content, version: result.version };
    },
    getFileUrl: async (value, options) => {
      const relative = pathOf(value);
      const result = await read(relative);
      if (options?.expectedVersion && options.expectedVersion !== result.version) throw new Error("Remote file changed.");
      const format = resolveFileFormat({ name: relative });
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)],
        { type: format.mimeTypes?.[0] ?? "application/octet-stream" }));
      urls.add(url); return url;
    },
    revokeFileUrl: (url) => { if (urls.delete(url)) URL.revokeObjectURL(url); },
    ...(writable ? {
      documentPersistence: { kind: "cloud" as const, storageIdentity, persist },
      createFolder: (value: string) => {
        const relative = pathOf(value);
        if (!relative) return Promise.reject(new Error("The folder already exists."));
        return mutate({ action: "mkdir", path: relative });
      },
      createFile: (value: string, content = "") => {
        const relative = pathOf(value);
        if (!relative) return Promise.reject(new Error("A file name is required."));
        return mutate({ action: "write", path: relative,
          content_base64: encodeWorkspaceBytes(new TextEncoder().encode(content)), expected_revision: null });
      },
      renameNode: (value: string, nextName: string) => {
        if (!nextName || nextName === "." || nextName === ".." || /[/\\\0]/.test(nextName) ||
            nextName.toLowerCase() === ".git") return Promise.reject(new Error("Invalid file name."));
        const relative = pathOf(value);
        if (!relative) return Promise.reject(new Error("The folder itself cannot be renamed here."));
        const parent = relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "";
        return mutate({ action: "move", path: relative, destination: [parent, nextName].filter(Boolean).join("/") });
      },
      moveNode: (from: string, to: string) => {
        const source = pathOf(from);
        const destination = pathOf(to);
        if (!source || !destination) return Promise.reject(new Error("The folder itself cannot be moved."));
        return mutate({ action: "move", path: source, destination });
      },
      deleteNode: (value: string) => {
        const relative = pathOf(value);
        if (!relative) return Promise.reject(new Error("The folder itself cannot be deleted here."));
        return mutate({ action: "remove", path: relative });
      },
    } : {}),
  };
  const watchFolder: DeviceDataService["watchFolder"] = (changed, status) => {
    if (!bridge.watchHostFolder || !bridge.onHostFolderEvent) return () => {};
    const id = crypto.randomUUID();
    let closed = false;
    const unsubscribe = bridge.onHostFolderEvent((event: HostFolderEvent) => {
      if (closed || event.id !== id || !isCurrent()) return;
      if (event.type === "change") {
        listing.clear();
        status("online");
        changed(event.reset ? null : event.paths);
      } else if (event.type === "offline") {
        status("offline");
      } else if (event.type === "unavailable" && event.retryable) {
        status("offline");
      } else if (event.type === "unavailable") {
        status(event.code === "folder_unavailable" ? "revoked" : "denied");
      }
    });
    void bridge.watchHostFolder({ id, folderId: ref.folderId, expectedSession }).catch(() => status("offline"));
    return () => {
      closed = true;
      unsubscribe();
      void bridge.stopHostFolderWatch?.({ id }).catch(() => {});
    };
  };
  const watch: DeviceDataService["watch"] = (changed, failed) => watchFolder(() => changed(), (availability) => {
    if (availability !== "online") failed(new Error(describeAvailability(availability)));
  });
  return { workspace, folder, dataPort, watch, watchFolder, writable,
    // The workbench re-arms its watch when it resumes; nothing else to wake.
    resume: () => { listing.clear(); },
    getPathForCopy: (resource) => pathOf(resource) || ".",
    invalidateReads: () => { assertCurrent(); listing.clear(); },
    dispose: () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); listing.clear(); },
    resolveResource: (value) => {
      try { const relative = pathOf(value) || null;
        return { folder, providerPath: relative, resourceUri: uri(relative ?? "") }; }
      catch { return null; }
    } };
}
