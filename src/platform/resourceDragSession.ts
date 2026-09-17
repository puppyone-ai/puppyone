import type { ExplorerReferenceDragEntry, ReferenceDataTransferSource } from "@puppyone/shared-ui";

export type ResourceDragPreview = { id: string; entries: ExplorerReferenceDragEntry[] };
export type ResourceDragState = { id: string; entries: ExplorerReferenceDragEntry[] | null };
export type ResourceDropIntent = "explorer-move" | "terminal-path" | "agent-reference" | "editor-open";
export type LocalResourceDropEntry = {
  file: File;
  path: string;
  name: string;
  entryType: "file" | "directory";
};
export type ResolvedResourceDropSource = ReferenceDataTransferSource | {
  kind: "local-entries";
  entries: LocalResourceDropEntry[];
};

/** File objects must be captured during drop, before the HTML data store closes. */
export async function resolveResourceDropSource(
  source: ReferenceDataTransferSource,
  intent: ResourceDropIntent,
  targetResource?: string,
): Promise<ReferenceDataTransferSource> {
  if (source.kind !== "files") return source;
  const claimed = await window.puppyoneDesktop?.claimResourceDrop?.({ files: source.files, intent, targetResource });
  return claimed
    ? { kind: "workspace-entries", workspaceId: null, typed: true, entries: claimed.entries }
    : source;
}

export async function resolveLocalResourceDropSource(
  source: ReferenceDataTransferSource,
  intent: ResourceDropIntent,
  targetResource?: string,
): Promise<ResolvedResourceDropSource> {
  if (source.kind !== "files") return source;
  const claimed = await window.puppyoneDesktop?.claimResourceDrop?.({ files: source.files, intent, targetResource });
  if (claimed) return { kind: "workspace-entries", workspaceId: null, typed: true, entries: claimed.entries };
  const inspected = await window.puppyoneDesktop?.inspectResourceDrop?.({ files: source.files }).catch(() => null);
  if (!inspected || inspected.entries.length !== source.files.length) return source;
  return {
    kind: "local-entries",
    entries: inspected.entries.map((entry, index) => ({ ...entry, file: source.files[index]! })),
  };
}
