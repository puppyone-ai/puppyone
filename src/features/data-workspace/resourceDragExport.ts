import type { DragEvent } from "react";
import type { DataNode } from "@puppyone/shared-ui";
import type { ResolvedWorkbenchDataResource } from "./workbenchDataPort";
import { localResourceFileUrl, projectLocalResourcePath } from "../../../shared/workspace-resource-reference.mjs";

/** Write export projections synchronously while the browser's drag store is writable. */
export function writeLocalResourceDragData(
  nodes: readonly DataNode[],
  event: DragEvent<HTMLElement>,
  resolveResource: (resource: string) => ResolvedWorkbenchDataResource | null,
) {
  const paths = nodes.map((node) => {
    const resolved = resolveResource(node.resourceUri ?? node.path);
    if (!resolved) throw new Error("The dragged resource is no longer available.");
    return projectLocalResourcePath(resolved.folder.workspace.path, resolved.providerPath ?? ".");
  });
  event.dataTransfer.setData("text/plain", paths.join("\n"));
  event.dataTransfer.setData("text/uri-list", paths.map(localResourceFileUrl).join("\r\n"));
  // Chromium's single-file export preserves the HTML session and its internal MIME.
  // Directories and multi-selection require the native handoff, not a DownloadURL.
  if (nodes.length === 1 && nodes[0]!.type !== "folder") {
    event.dataTransfer.setData("DownloadURL", `application/octet-stream:${nodes[0]!.name.replace(/:/g, "_")}:${localResourceFileUrl(paths[0]!)}`);
  }
}
