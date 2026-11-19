import type { EditorDocument } from "../../registry/viewerTypes";

export function getDelimitedTableDelimiter(document: EditorDocument): "," | "\t" {
  if (
    document.name.toLowerCase().endsWith(".tsv") ||
    document.mimeType?.toLowerCase().startsWith("text/tab-separated-values")
  ) {
    return "\t";
  }
  return ",";
}

export function formatJson(content: string): string {
  if (!content.trim()) return content;
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

export function getDocumentLabel(document: EditorDocument): string {
  return getFileExtension(document.name)?.toUpperCase() ?? document.type.toUpperCase();
}

export function getFileExtension(name: string): string | null {
  const index = name.lastIndexOf(".");
  if (index <= 0 || index === name.length - 1) return null;
  return name.slice(index + 1);
}
