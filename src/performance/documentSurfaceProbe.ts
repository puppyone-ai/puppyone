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

/** Observe the actual host handoff without adding a polling animation frame. */
export function waitForCommittedDocumentElement<T extends Element>(
  documentId: string, selector: string, timeoutMs = 15_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(check);
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timed out waiting for committed document ${documentId}: ${selector}.`));
    }, timeoutMs);
    function check() {
      const surface = findDocumentSurface(documentId);
      if (!isDocumentSurfaceCommitted(surface)) return;
      const element = surface?.querySelector<T>(selector);
      if (!element) return;
      clearTimeout(timer);
      observer.disconnect();
      resolve(element);
    }
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    check();
  });
}
