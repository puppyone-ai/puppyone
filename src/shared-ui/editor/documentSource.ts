export const DOCUMENT_SOURCE_KINDS = ["local", "cloud", "unknown"] as const;
export type DocumentSourceKind = (typeof DOCUMENT_SOURCE_KINDS)[number];

export function normalizeDocumentSourceKind(
  sourceKind: DocumentSourceKind | null | undefined,
): DocumentSourceKind {
  return sourceKind === "local" || sourceKind === "cloud" ? sourceKind : "unknown";
}
