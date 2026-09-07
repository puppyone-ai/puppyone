import type { DataPort, DocumentPersistencePort, FileContent } from "../../core/types";
import { createDocumentIdentity, getDocumentIdentityKey } from "./documentIdentity";

type ReadFence = { generation: number; readers: number };
const activeReads = new Map<string, ReadFence>();

/** A storage acknowledgement supersedes every read already in progress for
 * this resource, including reads owned by a different/remounted Pane. */
export function invalidateDocumentStorageReads(
  persistence: DocumentPersistencePort,
  path: string,
): void {
  const fence = activeReads.get(getDocumentIdentityKey(createDocumentIdentity(persistence, path)));
  if (fence) fence.generation += 1;
}

/**
 * Publish reads and save acknowledgements in one resource-scoped order.
 * A read straddling an acknowledgement is ambiguous: read again, rather than
 * guessing whether its bytes are an old echo or a genuine external revert.
 * Publication stays synchronous with the freshness check (no Promise gap).
 */
export async function readDocumentStorageSnapshot(
  dataPort: Pick<DataPort, "readFile" | "documentPersistence">,
  path: string,
  options: { signal: AbortSignal; accept: (content: FileContent) => void },
): Promise<void> {
  const { readFile, documentPersistence } = dataPort;
  if (!readFile) throw new Error("Document content reads are unavailable.");
  const key = documentPersistence
    ? getDocumentIdentityKey(createDocumentIdentity(documentPersistence, path))
    : null;
  const fence = (key && activeReads.get(key)) || { generation: 0, readers: 0 };
  fence.readers += 1;
  if (key) activeReads.set(key, fence);
  try {
    while (true) {
      options.signal.throwIfAborted();
      const generation = fence.generation;
      let content: FileContent;
      try {
        content = await readFile(path, { signal: options.signal });
      } catch (error) {
        options.signal.throwIfAborted();
        if (generation !== fence.generation) continue;
        throw error;
      }
      options.signal.throwIfAborted();
      if (generation !== fence.generation) continue;
      fence.generation += 1;
      options.accept(content);
      return;
    }
  } finally {
    fence.readers -= 1;
    if (key && fence.readers === 0) activeReads.delete(key);
  }
}
