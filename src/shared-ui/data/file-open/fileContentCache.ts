import type { FileContent } from "../../core/types";

export const FILE_CONTENT_CACHE_MAX_ENTRIES = 12;
export const FILE_CONTENT_CACHE_MAX_CHARACTERS = 8 * 1024 * 1024;

/**
 * Small MRU cache for user-opened file payloads. Background indexing never
 * writes here. Oversized content remains in the active-file state but is not
 * retained after navigation.
 */
export function putBoundedFileContent(
  current: Readonly<Record<string, FileContent>>,
  content: FileContent,
): Record<string, FileContent> {
  const entries = Object.entries(current).filter(([path]) => path !== content.path);
  const contentCharacters = getContentCharacters(content);
  if (contentCharacters <= FILE_CONTENT_CACHE_MAX_CHARACTERS) {
    entries.push([content.path, content]);
  }

  let retainedCharacters = entries.reduce(
    (total, [, entry]) => total + getContentCharacters(entry),
    0,
  );
  while (
    entries.length > FILE_CONTENT_CACHE_MAX_ENTRIES
    || retainedCharacters > FILE_CONTENT_CACHE_MAX_CHARACTERS
  ) {
    const removed = entries.shift();
    if (!removed) break;
    retainedCharacters -= getContentCharacters(removed[1]);
  }

  return Object.fromEntries(entries);
}

function getContentCharacters(content: FileContent): number {
  return typeof content.content === "string" ? content.content.length : 0;
}
