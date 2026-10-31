import type {
  EditorDocument,
  EditorViewerMatch,
  PresetViewerContribution,
} from "./registry/viewerTypes";

export type EditorAccessReadOnlyReason =
  | "viewer-capability"
  | "format-policy"
  | "source-unavailable"
  | "persistence-unavailable"
  | "viewer-policy";

export type EditorAccessDecision =
  | Readonly<{ kind: "editable" }>
  | Readonly<{ kind: "read-only"; reason: EditorAccessReadOnlyReason }>;

export type ResolveEditorAccessInput = EditorViewerMatch & Readonly<{
  viewer: PresetViewerContribution;
  content: string;
  persistenceAvailable: boolean;
}>;

/**
 * Resolves editing authority at the host/router boundary.
 *
 * Format metadata, Viewer capability, canonical source readiness, and the
 * host persistence capability are independent gates. Leaf editors receive the
 * resulting boolean and never infer authority from a semantic node type.
 */
export function resolveEditorAccess({
  document,
  format,
  resolvedExtension,
  viewer,
  content,
  persistenceAvailable,
}: ResolveEditorAccessInput): EditorAccessDecision {
  if (viewer.capability !== "edit") {
    return readOnly("viewer-capability");
  }
  if (!format.editable) {
    return readOnly("format-policy");
  }
  if (!hasCanonicalTextSource(document)) {
    return readOnly("source-unavailable");
  }
  if (!persistenceAvailable) {
    return readOnly("persistence-unavailable");
  }
  if (!viewer.isEditable?.({ document, format, resolvedExtension, content })) {
    return readOnly("viewer-policy");
  }
  return Object.freeze({ kind: "editable" });
}

function hasCanonicalTextSource(document: EditorDocument): boolean {
  return typeof document.content === "string";
}

function readOnly(reason: EditorAccessReadOnlyReason): EditorAccessDecision {
  return Object.freeze({ kind: "read-only", reason });
}
