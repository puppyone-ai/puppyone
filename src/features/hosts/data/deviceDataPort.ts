import {
  assertValidDataResourceReference, createWorkspaceResourceUri, getWorkspaceResourcePath,
  getFileSemanticKind, getEditorSourceRequirement, resolveFileFormat,
  isDataResourceUri, type DataNode, type DataPort, type FileContent,
  type ResourceUri, type Workspace, type WorkspaceFolder,
} from "@puppyone/shared-ui";
import { cloudApiRequest, type DesktopCloudSession } from "../../../lib/cloudApi";
import { resolveCloudApiBaseUrl } from "../../../../shared/cloudEndpoint.js";
import { deviceFolderRootUri, type DeviceFolderRef } from "../model/deviceFolderIdentity";
import { decodeWorkspaceBytes, encodeWorkspaceBytes } from "../../cloud/files/cloudWorkspaceClient";
import { statusOf } from "../../cloud/files/contracts";

export type DeviceDataService = Readonly<{
  workspace: Workspace;
  folder: WorkspaceFolder;
  dataPort: DataPort;
  invalidateReads: () => void;
  dispose: () => void;
  resolveResource: (resource: string | null) => { folder: WorkspaceFolder; providerPath: string | null; resourceUri: ResourceUri } | null;
}>;

/** File-only remote provider. No local checkout, Shell, Git or implicit Cloud publication. */
export function createDeviceDataService({ ref, name, writable, session, apiBase, isCurrent = () => true }: {
  ref: DeviceFolderRef; name: string; writable: boolean; session: DesktopCloudSession;
  apiBase: string; isCurrent?: () => boolean;
}): DeviceDataService {
  if (session.user_id !== ref.accountId || resolveCloudApiBaseUrl(apiBase) !== resolveCloudApiBaseUrl(ref.deployment)
      || session.api_base_url !== resolveCloudApiBaseUrl(apiBase)) {
    throw new Error("Remote folder authority changed.");
  }
  const rootUri = deviceFolderRootUri(ref);
  const storageIdentity = `device-files:${rootUri}`;
  const workspace: Workspace = { id: storageIdentity, name, path: rootUri, status: "recording" };
  const folder: WorkspaceFolder = { id: storageIdentity, name, uri: rootUri, index: 0,
    capabilities: { read: true, write: writable, watch: false, execute: false },
    trustState: "untrusted", workspace };
  const endpoint = `/hosts/folders/${encodeURIComponent(ref.folderId)}`;
  const assertCurrent = () => { if (!isCurrent()) throw new Error("Remote folder session changed. Reopen it."); };
  const pathOf = (value: string | null): string => {
    assertCurrent();
    assertValidDataResourceReference(value);
    if (!value) return "";
    if (isDataResourceUri(value)) return getWorkspaceResourcePath(rootUri, value);
    if (value.startsWith("/") || value.includes("\\") || value.includes("\0") ||
        value.split("/").some((part) => part === "." || part === ".." || part.toLowerCase() === ".git")) {
      throw new Error("Invalid remote folder path.");
    }
    return value;
  };
  const uri = (value: string) => createWorkspaceResourceUri(rootUri, value);
  const node = (value: string, type: "file" | "folder"): DataNode => ({
    id: uri(value), path: uri(value), resourceUri: uri(value), name: value.split("/").at(-1) ?? name,
    type: type === "folder" ? "folder" : getFileSemanticKind(value), source: "device",
    workspaceFolderId: folder.id,
  });
  const request = async <T>(suffix: string, init: RequestInit = {}): Promise<T> => {
    assertCurrent();
    const result = await cloudApiRequest<T>(endpoint + suffix, session, undefined, init, apiBase);
    assertCurrent(); return result;
  };
  const read = async (relative: string) => {
    const result = await request<{content_base64: string; revision: string}>(`/file?path=${encodeURIComponent(relative)}`);
    if (!/^[a-f0-9]{64}$/.test(result.revision)) throw new Error("Invalid remote file revision.");
    return { bytes: decodeWorkspaceBytes(result.content_base64), version: result.revision };
  };
  const list = async (relative: string) => {
    const result = await request<{name: string; type: "file" | "folder"}[]>(`/files?path=${encodeURIComponent(relative)}`);
    if (!Array.isArray(result) || result.length > 10_000) throw new Error("Invalid remote directory.");
    return result.map((item) => {
      if (!item || !item.name || item.name.includes("/") || item.name.includes("\\") ||
          item.name === "." || item.name === ".." || item.name.toLowerCase() === ".git" ||
          !["file", "folder"].includes(item.type)) throw new Error("Invalid remote directory entry.");
      return node([relative, item.name].filter(Boolean).join("/"), item.type);
    });
  };
  const urls = new Set<string>();
  const dataPort: DataPort = {
    listChildren: (value) => list(pathOf(value)),
    resolveNode: async (value) => {
      const relative = pathOf(value);
      if (!relative) return { ...node("", "folder"), name, workspaceFolderRoot: true };
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
    ...(writable ? { documentPersistence: {
      kind: "cloud" as const, storageIdentity,
      async persist(input) {
        try {
          const relative = pathOf(input.path);
          if (!relative || !input.baseVersion || !/^[a-f0-9]{64}$/.test(input.baseVersion)) {
            throw new Error("Reload this remote file before saving.");
          }
          const bytes = new TextEncoder().encode(input.content);
          const result = await request<{revision: string}>("/file", { method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: relative, content_base64: encodeWorkspaceBytes(bytes),
              expected_revision: input.baseVersion }) });
          return { ok: true as const, version: result.revision };
        } catch (error) {
          if (statusOf(error) === 409) {
            try {
              const relative = pathOf(input.path);
              const latest = await read(relative);
              return { ok: false as const, kind: "conflict" as const,
                content: new TextDecoder("utf-8", { fatal: true }).decode(latest.bytes), version: latest.version };
            } catch { /* Keep the draft when the device itself is unavailable. */ }
          }
          // Unknown write outcome must not retry. The Document Session keeps its draft.
          return { ok: false as const, kind: "io" as const,
            message: error instanceof Error ? error.message : "Remote save failed." };
        }
      },
    } } : {}),
  };
  return { workspace, folder, dataPort, invalidateReads: () => { assertCurrent(); },
    dispose: () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); },
    resolveResource: (value) => {
      try { const relative = pathOf(value) || null;
        return { folder, providerPath: relative, resourceUri: uri(relative ?? "") }; }
      catch { return null; }
    } };
}
