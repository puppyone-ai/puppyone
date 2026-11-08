/**
 * One-shot "open this document, then reveal this heading" request.
 *
 * The navigation port resolves paths; the Markdown editor owns scrolling. They
 * live on opposite sides of the Viewer boundary, so the request travels through
 * this module store instead of widening every intermediate prop.
 */
export type DocumentAnchorRevealRequest = Readonly<{
  path: string;
  anchor: string;
  id: number;
}>;

let sequence = 0;
let pending: DocumentAnchorRevealRequest | null = null;
const listeners = new Set<(request: DocumentAnchorRevealRequest) => void>();

export function requestDocumentAnchorReveal(path: string, anchor: string): void {
  if (!path || !anchor) return;
  pending = { path, anchor, id: ++sequence };
  for (const listener of listeners) listener(pending);
}

/** A document that mounts after the request still sees it. */
export function consumeDocumentAnchorReveal(): DocumentAnchorRevealRequest | null {
  return pending;
}

export function clearDocumentAnchorReveal(id: number): void {
  if (pending?.id === id) pending = null;
}

export function subscribeDocumentAnchorReveal(
  listener: (request: DocumentAnchorRevealRequest) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
