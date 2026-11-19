export type DocumentRetirement = Readonly<{ storageIdentity: string; resource: string }>;
const listeners = new Set<(event: DocumentRetirement) => void>();

export function subscribeDocumentRetirements(listener: (event: DocumentRetirement) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishDocumentRetirement(event: DocumentRetirement): void {
  listeners.forEach((listener) => listener(event));
}
