import { getFileSemanticKind, type DataNode, type FileContent } from "@puppyone/shared-ui";
import type { NativeCloudWorkbench } from "../workbench/useNativeCloudWorkbench";

export type CloudWorkspaceShareResource = Readonly<{
  /** Repository-relative path, including the authorized scope prefix. */
  path: string;
  directory: boolean;
  entries?: readonly { name: string; type: string }[];
  file?: Readonly<{ name: string; type: DataNode["type"]; content?: FileContent }>;
}>;

/** Capture only the current provider's accepted resources; Share performs no reads. */
export function captureCloudWorkspaceShareResource(workbench: Pick<NativeCloudWorkbench,
  "service" | "activeNode" | "editorWorkbench">): CloudWorkspaceShareResource | null {
  const { service, activeNode, editorWorkbench } = workbench;
  if (!service) return null;
  const selectedFolder = activeNode?.type === "folder" ? activeNode : null;
  const path = selectedFolder?.path ?? editorWorkbench.activePath ?? service.folder.uri;
  const resolved = service.resolveResource(path);
  if (!resolved) return null;
  const remotePath = service.getPathForCopy(path);
  const directory = Boolean(selectedFolder) || !editorWorkbench.activePath;
  const parent = directory ? resolved.resourceUri : resolved.resourceUri.slice(0, resolved.resourceUri.lastIndexOf("/"));
  const entries = service.dataPort.getCachedChildren?.(parent)?.map(({ name, type }) => ({ name, type }));
  if (directory) return { path: remotePath === "." ? "" : remotePath, directory, entries };
  const name = remotePath.split("/").pop()!;
  return { path: remotePath, directory, entries,
    file: { name, type: getFileSemanticKind(name), content: service.getCachedFileContent?.(path) ?? undefined } };
}
