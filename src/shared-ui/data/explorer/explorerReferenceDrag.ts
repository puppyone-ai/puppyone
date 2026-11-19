import type { DataNode } from "../../core/types";
import { isDataResourceUri } from "../../core/dataResourcePath";

export const EXPLORER_REFERENCE_DRAG_TYPE = "application/x-puppyone-workspace-entries+json";
export const EXPLORER_REFERENCE_DRAG_VERSION = 2;
export const EXPLORER_TREE_NODE_DRAG_TYPE = "application/x-puppyone-data-node-path";

export type ExplorerReferenceDragEntry = {
  path: string;
  name: string;
  entryType: "file" | "directory";
};

export type ExplorerReferenceDragPayload = {
  version: 1 | 2;
  workspaceId: string;
  entries: ExplorerReferenceDragEntry[];
};

export function serializeExplorerReferenceDrag(workspaceId: string, nodes: DataNode[]) {
  const qualified = nodes.every((node) => isDataResourceUri(node.resourceUri ?? node.path));
  const payload = {
    version: qualified ? EXPLORER_REFERENCE_DRAG_VERSION : 1,
    workspaceId: workspaceId.slice(0, 256),
    entries: nodes.slice(0, 32).map((node) => ({
      ...(qualified ? { resourceUri: node.resourceUri ?? node.path } : { path: node.path }),
      name: node.name.slice(0, 512),
      entryType: node.type === "folder" ? "directory" : "file",
    })),
  };
  return JSON.stringify(payload);
}

export function parseExplorerReferenceDrag(value: string): ExplorerReferenceDragPayload | null {
  if (!value || value.length > 550_000) return null;
  try {
    const payload = JSON.parse(value) as { version?: number; workspaceId?: string; entries?: Array<Partial<ExplorerReferenceDragEntry> & { resourceUri?: string }> };
    if (payload.version !== 1 && payload.version !== EXPLORER_REFERENCE_DRAG_VERSION) return null;
    if (typeof payload.workspaceId !== "string" || payload.workspaceId.length === 0 || payload.workspaceId.length > 256) return null;
    if (!Array.isArray(payload.entries) || payload.entries.length === 0 || payload.entries.length > 32) return null;
    const entries = payload.entries.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const resourcePath = payload.version === 2 ? entry.resourceUri : entry.path;
      if (typeof resourcePath !== "string" || resourcePath.length === 0 || resourcePath.length > 16_384) return [];
      if (payload.version === 2 && !isDataResourceUri(resourcePath)) return [];
      if (typeof entry.name !== "string" || entry.name.length === 0 || entry.name.length > 512) return [];
      if (entry.entryType !== "file" && entry.entryType !== "directory") return [];
      return [{ path: resourcePath, name: entry.name, entryType: entry.entryType }];
    });
    if (entries.length !== payload.entries.length) return null;
    return { version: payload.version, workspaceId: payload.workspaceId, entries };
  } catch {
    return null;
  }
}

export type ReferenceDataTransferSource =
  | { kind: "workspace-entries"; workspaceId: string | null; entries: ExplorerReferenceDragEntry[]; typed: boolean }
  | { kind: "files"; files: File[] }
  | { kind: "text"; text: string }
  | { kind: "none" };

/** Platform-neutral source classification shared by Chat and Terminal. */
export function classifyReferenceDataTransfer(dataTransfer: DataTransfer): ReferenceDataTransferSource {
  const typed = parseExplorerReferenceDrag(dataTransfer.getData(EXPLORER_REFERENCE_DRAG_TYPE));
  if (typed) return { kind: "workspace-entries", workspaceId: typed.workspaceId, entries: typed.entries, typed: true };
  const legacyPaths = splitBoundedPaths(dataTransfer.getData(EXPLORER_TREE_NODE_DRAG_TYPE));
  if (legacyPaths.length > 0) {
    return {
      kind: "workspace-entries",
      workspaceId: null,
      entries: legacyPaths.map((entryPath) => ({
        path: entryPath,
        name: entryPath.split(/[/\\]/).filter(Boolean).at(-1) || entryPath,
        entryType: "file",
      })),
      typed: false,
    };
  }
  const files = Array.from(dataTransfer.files ?? []).slice(0, 32);
  if (files.length > 0) return { kind: "files", files };
  const text = (dataTransfer.getData("text/plain") || dataTransfer.getData("text/uri-list")).trim();
  return text ? { kind: "text", text: text.slice(0, 128 * 1024) } : { kind: "none" };
}

export function hasReferenceDataTransferSource(dataTransfer: DataTransfer) {
  return hasFileReferenceDataTransferSource(dataTransfer)
    || Array.from(dataTransfer.types ?? []).includes("text/plain")
    || Array.from(dataTransfer.types ?? []).includes("text/uri-list");
}

export function hasFileReferenceDataTransferSource(dataTransfer: DataTransfer) {
  const types = Array.from(dataTransfer.types ?? []);
  return types.includes(EXPLORER_REFERENCE_DRAG_TYPE)
    || types.includes(EXPLORER_TREE_NODE_DRAG_TYPE)
    || types.includes("Files")
    || dataTransfer.files.length > 0
    || Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file");
}

function splitBoundedPaths(value: string) {
  return value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).slice(0, 32);
}
