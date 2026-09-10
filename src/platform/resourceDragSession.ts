import type { ExplorerReferenceDragEntry, ReferenceDataTransferSource } from "@puppyone/shared-ui";

export type ResourceDragPreview = { id: string; entries: ExplorerReferenceDragEntry[] };
export type ResourceDragState = { id: string; entries: ExplorerReferenceDragEntry[] | null };
export type ResourceDropIntent = "explorer-move" | "editor-split" | "terminal-path" | "agent-reference";

/** File objects must be captured during drop, before the HTML data store closes. */
export async function resolveResourceDropSource(
  source: ReferenceDataTransferSource,
  intent: ResourceDropIntent,
  targetResource?: string,
  sessionId?: string,
): Promise<ReferenceDataTransferSource> {
  if (source.kind !== "files") return source;
  const claimed = await window.puppyoneDesktop?.claimResourceDrop?.({
    files: source.files,
    intent,
    targetResource,
    ...(sessionId ? { sessionId } : {}),
  });
  return claimed
    ? { kind: "workspace-entries", workspaceId: null, typed: true, entries: claimed.entries }
    : source;
}
