export type FileOpenRequestToken = {
  id: number;
  documentId: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
  commit: (callback: () => void) => boolean;
  cancel: () => void;
};

/**
 * Owns the single in-flight content acquisition for a workspace preview.
 * Completion is revision/generation-bound: an aborted A request can never
 * publish after B becomes current, even when the underlying data port cannot
 * physically cancel its IPC/network operation.
 */
export class FileOpenRequestCoordinator {
  private generation = 0;
  private current: {
    id: number;
    documentId: string;
    controller: AbortController;
  } | null = null;
  private readonly onStaleCommit?: () => void;

  constructor(options: { onStaleCommit?: () => void } = {}) {
    this.onStaleCommit = options.onStaleCommit;
  }

  begin(documentId: string): FileOpenRequestToken {
    this.cancelCurrent();
    this.generation += 1;
    const request = {
      id: this.generation,
      documentId,
      controller: new AbortController(),
    };
    this.current = request;

    const isCurrent = () => (
      this.current?.id === request.id
      && this.current.documentId === request.documentId
      && !request.controller.signal.aborted
    );
    return {
      id: request.id,
      documentId,
      signal: request.controller.signal,
      isCurrent,
      commit: (callback) => {
        if (!isCurrent()) {
          this.onStaleCommit?.();
          return false;
        }
        callback();
        return true;
      },
      cancel: () => {
        if (this.current?.id !== request.id) return;
        this.cancelCurrent();
      },
    };
  }

  cancelCurrent() {
    this.current?.controller.abort(new DOMException("Superseded file open", "AbortError"));
    this.current = null;
  }
}
