import {
  isDocumentDataNode,
  qualifyDataResourcePath,
  type DataPort,
  type DocumentDataNode,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";

export type WorkspaceEntryKind = "restored" | "opened" | "created" | "cloned" | "switched";

/**
 * One renderer-owned admission intent for every way a Workspace becomes active.
 * A template may nominate a document, but opening that document and choosing a
 * fallback for ordinary folders are deliberately handled by the same policy.
 */
export type WorkspaceEntryIntent = Readonly<{
  id: string;
  kind: WorkspaceEntryKind;
  workspacePath: string;
  preferredOpenPath: string | null;
}>;

export async function resolveWorkspaceEntryDocument({
  dataPort,
  folders,
  intent,
}: {
  dataPort: Pick<DataPort, "listChildren" | "resolveNode">;
  folders: readonly WorkspaceFolder[];
  intent: WorkspaceEntryIntent;
}): Promise<DocumentDataNode | null> {
  const preferredFolder = folders.find(({ workspace }) => workspace.path === intent.workspacePath)
    ?? folders[0]
    ?? null;
  if (!preferredFolder) return null;

  if (intent.preferredOpenPath) {
    const preferredResource = qualifyDataResourcePath(
      preferredFolder.uri,
      intent.preferredOpenPath,
    );
    const preferred = await dataPort.resolveNode?.(preferredResource).catch(() => null);
    if (isDocumentDataNode(preferred)) return preferred;
  }

  const orderedFolders = [
    preferredFolder,
    ...folders.filter(({ id }) => id !== preferredFolder.id),
  ];
  for (const folder of orderedFolders) {
    const children = await dataPort.listChildren(folder.uri).catch(() => []);
    const documents: DocumentDataNode[] = [];
    for (const node of children) {
      if (isDocumentDataNode(node)) documents.push(node);
    }
    const candidate = documents.sort(compareEntryDocuments)[0];
    if (candidate) return candidate;
  }
  return null;
}

function compareEntryDocuments(left: DocumentDataNode, right: DocumentDataNode): number {
  const priorityDifference = documentPriority(left.name) - documentPriority(right.name);
  if (priorityDifference !== 0) return priorityDifference;
  return left.name.localeCompare(right.name, "en", { numeric: true, sensitivity: "base" });
}

function documentPriority(name: string): number {
  const normalized = name.trim().toLocaleLowerCase("en-US");
  if (normalized === "getting started.md") return 0;
  if (/^readme(?:\.[a-z0-9_-]+)?$/i.test(normalized)) return 1;
  if (/^index(?:\.[a-z0-9_-]+)?$/i.test(normalized)) return 2;
  return 3;
}
