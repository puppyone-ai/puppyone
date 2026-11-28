import type { CloudWorkbench } from "./contracts";

/** Wire shapes of the live workbench file API. Paths are workspace-relative. */
export type WorkspaceEntry = { name: string; kind: string; size: number; modified_ns: string };
export type WorkspaceFileReply = WorkspaceEntry & { content_base64: string; revision: string };
export type WorkspaceVersion = { workspace: string; generation: string; revision: string };
export type WorkspaceOpeningResult = { workspace: CloudWorkbench; entries?: WorkspaceEntry[] };

export const WORKSPACE_FILE_LIMIT = 8 * 1024 * 1024;

export const workspaceFailure = (message: string, status = 409, code?: string, retryable = true) =>
  Object.assign(new Error(message), { status, code, retryable });

export function parseWorkspaceVersion(value: string): WorkspaceVersion {
  if (!value.startsWith("cloud-workspace:")) throw workspaceFailure("Reload this file before saving: its workspace revision is unavailable.");
  const result = JSON.parse(value.slice(16)) as WorkspaceVersion;
  if (typeof result.workspace !== "string" || !result.workspace || typeof result.generation !== "string"
    || !result.generation || !/^[a-f0-9]{64}$/.test(result.revision)) throw workspaceFailure("Invalid workspace revision.");
  return result;
}

export function formatWorkspaceVersion(workspace: Pick<CloudWorkbench, "id" | "generation">, revision: string): string {
  const value = `cloud-workspace:${JSON.stringify({ workspace: workspace.id, generation: workspace.generation, revision })}`;
  parseWorkspaceVersion(value);
  return value;
}

export function decodeWorkspaceBytes(value: string) {
  if (typeof value !== "string" || value.length > Math.ceil(WORKSPACE_FILE_LIMIT / 3) * 4) throw workspaceFailure("File exceeds the 8 MiB workspace preview limit.", 413);
  const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  if (bytes.length > WORKSPACE_FILE_LIMIT) throw workspaceFailure("File exceeds the 8 MiB workspace preview limit.", 413);
  return bytes;
}

export function encodeWorkspaceBytes(bytes: Uint8Array) {
  if (bytes.length > WORKSPACE_FILE_LIMIT) throw workspaceFailure("File exceeds the 8 MiB workspace editor limit.", 413);
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
}

/** Parent directory of a workspace-relative path; the root is "". */
export function workspaceParentPath(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}
