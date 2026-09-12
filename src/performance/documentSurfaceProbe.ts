/** DOM probes for the built renderer smoke routes, scoped to one document. */
export function findDocumentSurface(documentId: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(".document-surface-slot"))
    .find((slot) => slot.dataset.surfaceKey === documentId) ?? null;
}

export function isDocumentSurfaceCommitted(surface: HTMLElement | null): boolean {
  return Boolean(surface?.isConnected
    && surface.dataset.surfaceState === "committed"
    && surface.dataset.surfaceReady === "true");
}

export function findMarkdownSurfaceEditor(documentId: string): HTMLElement | null {
  return findDocumentSurface(documentId)?.querySelector<HTMLElement>(".markdown-codemirror-editor") ?? null;
}
