import { getFileSemanticKind, type DocumentDataNode, type ReferenceDataTransferSource } from "@puppyone/shared-ui";
import { isWorkspaceResourceReference } from "../../../../shared/workspace-resource-reference.mjs";
import { resolveResourceDropSource } from "../../../platform/resourceDragSession";

/** Legacy HTML drags are scoped locally; native Files require a Main receipt.
 * Preview, filenames, file URLs and OS paths never grant Editor resource access.
 */
export function editorDropDocument(source: ReferenceDataTransferSource, workspaceId: string): DocumentDataNode | null {
  if (source.kind !== "workspace-entries" || !source.typed || source.entries.length !== 1) return null;
  const [entry] = source.entries;
  if (source.workspaceId === null
    ? !isWorkspaceResourceReference(entry.path)
    : source.workspaceId !== workspaceId) return null;
  if (entry.entryType !== "file") return null;
  const type = getFileSemanticKind(entry.name, "file");
  return type === "folder" ? null : { id: entry.path, path: entry.path, name: entry.name, type };
}

export async function claimEditorDropDocument(source: ReferenceDataTransferSource): Promise<DocumentDataNode | null> {
  const admitted = await resolveResourceDropSource(source, "editor-open");
  return editorDropDocument(admitted, "");
}
