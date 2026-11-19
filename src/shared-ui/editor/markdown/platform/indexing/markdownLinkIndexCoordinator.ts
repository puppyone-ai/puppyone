import { acquireEditorWorker, type EditorWorkerPort } from "../../../runtime/BrowserEditorWorkerHost";
import type { EditorTaskOwner } from "../../../runtime/EditorTaskScheduler";
import {
  type MarkdownLinkGraphDocument,
  type MarkdownLinkGraphIndexSnapshot,
} from "../../core/links/markdownLinkGraph";
import type {
  MarkdownLinkIndexWorkerRequest,
  MarkdownLinkIndexWorkerResponse,
} from "./markdownLinkIndexProtocol";

export type MarkdownLinkIndexDocumentReader = (
  path: string,
  signal: AbortSignal,
) => Promise<MarkdownLinkGraphDocument | null>;

export type MarkdownLinkIndexRequest = {
  revision: number;
  promise: Promise<MarkdownLinkGraphIndexSnapshot>;
  cancel(): void;
};

type PendingOperation = {
  resolve(response: MarkdownLinkIndexWorkerResponse): void;
  reject(error: Error): void;
};

type WorkerRequestPayload = MarkdownLinkIndexWorkerRequest extends infer Request
  ? Request extends MarkdownLinkIndexWorkerRequest
    ? Omit<Request, "requestId" | "operationId">
    : never
  : never;

type ActiveSession = {
  revision: number;
  controller: AbortController;
  worker: EditorWorkerPort | null;
  closeWorker: (() => Promise<void>) | null;
  pending: Map<number, PendingOperation>;
  operationSequence: number;
  initialized: Promise<void>;
  updateChain: Promise<MarkdownLinkGraphIndexSnapshot>;
  failure: Error | null;
};

/**
 * Streams one document at a time through a revision-bound Worker. Full source
 * is never accumulated in React state or cloned as one workspace-sized
 * message. The Worker retains only compact derived backlinks and remains alive
 * for single-document updates after saves.
 */
export class MarkdownLinkIndexCoordinator {
  private revision = 0;
  private current: ActiveSession | null = null;

  constructor(private readonly owner?: EditorTaskOwner) {}

  build(documents: readonly MarkdownLinkGraphDocument[]): MarkdownLinkIndexRequest {
    const byPath = new Map(documents.map((document) => [document.path, document]));
    return this.buildFromReader(
      documents.map(({ path, name }) => ({ path, name, content: null })),
      documents
        .filter((document) => typeof document.content === "string")
        .map((document) => document.path),
      async (path) => byPath.get(path) ?? null,
    );
  }

  buildFromReader(
    metadataDocuments: readonly MarkdownLinkGraphDocument[],
    sourcePaths: readonly string[],
    readDocument: MarkdownLinkIndexDocumentReader,
  ): MarkdownLinkIndexRequest {
    this.cancel();
    const revision = ++this.revision;
    const session = this.createSession(revision, metadataDocuments);
    this.current = session;

    const promise = this.runInitialBuild(session, sourcePaths, readDocument);
    session.updateChain = promise;

    return {
      revision,
      promise,
      cancel: () => {
        if (this.current?.revision === revision) this.cancel();
      },
    };
  }

  updateDocument(document: MarkdownLinkGraphDocument): Promise<MarkdownLinkGraphIndexSnapshot> {
    const session = this.current;
    if (!session) return Promise.reject(createAbortError());
    session.updateChain = session.updateChain.then(async () => {
      this.assertCurrent(session);
      await scheduleBackgroundTurn(session.controller.signal);
      await this.indexDocument(session, document);
      return this.readSnapshot(session);
    });
    return session.updateChain;
  }

  cancel() {
    const session = this.current;
    this.current = null;
    this.revision += 1;
    if (!session) return;
    session.controller.abort(createAbortError());
    void session.closeWorker?.().catch(() => undefined);
    session.worker = null;
    const error = createAbortError();
    for (const pending of session.pending.values()) pending.reject(error);
    session.pending.clear();
  }

  private createSession(
    revision: number,
    metadataDocuments: readonly MarkdownLinkGraphDocument[],
  ): ActiveSession {
    const controller = new AbortController();
    const session: ActiveSession = {
      revision,
      controller,
      worker: null,
      closeWorker: null,
      pending: new Map(),
      operationSequence: 0,
      initialized: Promise.resolve(),
      updateChain: Promise.resolve({ indexedDocumentCount: 0, backlinks: [] }),
      failure: null,
    };

    session.initialized = acquireEditorWorker("markdown-index", {
      signal: controller.signal, owner: this.owner,
      inputBytes: JSON.stringify(metadataDocuments).length * 2,
    }).then(async (lease) => {
      if (controller.signal.aborted) { await lease.close(); throw createAbortError(); }
      session.closeWorker = lease.close;
      const worker = lease.port;
      session.worker = worker;
      const fail = (error: Error) => {
        session.failure = error;
        void lease.close().catch(() => undefined);
        session.worker = null;
        for (const pending of session.pending.values()) pending.reject(error);
        session.pending.clear();
      };
      worker.onmessage = (event: MessageEvent<MarkdownLinkIndexWorkerResponse>) => {
        const response = event.data;
        if (response.requestId !== session.revision) return;
        const pending = session.pending.get(response.operationId);
        if (!pending) return;
        session.pending.delete(response.operationId);
        if (response.type === "error") pending.reject(new Error(response.error ?? "Markdown link indexing failed."));
        else pending.resolve(response);
      };
      worker.onerror = (event) => fail(new Error(event.message || "Markdown link indexing worker failed."));
      worker.onmessageerror = () => fail(new Error("Markdown link indexing returned an unreadable response."));
      await this.send(session, { type: "initialize", documents: [...metadataDocuments] });
    });
    return session;
  }

  private async runInitialBuild(
    session: ActiveSession,
    sourcePaths: readonly string[],
    readDocument: MarkdownLinkIndexDocumentReader,
  ): Promise<MarkdownLinkGraphIndexSnapshot> {
    await session.initialized;
    for (const path of sourcePaths) {
      this.assertCurrent(session);
      await scheduleBackgroundTurn(session.controller.signal);
      let document: MarkdownLinkGraphDocument | null = null;
      try {
        document = await readDocument(path, session.controller.signal);
      } catch (error) {
        if (session.controller.signal.aborted) throw createAbortError();
        continue;
      }
      if (!document || typeof document.content !== "string") continue;
      await this.indexDocument(session, document);
    }
    return this.readSnapshot(session);
  }

  private async indexDocument(session: ActiveSession, document: MarkdownLinkGraphDocument) {
    if ((document.content?.length ?? 0) * 2 > 8 * 1024 * 1024) throw new RangeError("Markdown indexing source exceeds its budget.");
    await this.send(session, { type: "index-document", document });
  }

  private async readSnapshot(session: ActiveSession): Promise<MarkdownLinkGraphIndexSnapshot> {
    const response = await this.send(session, { type: "snapshot" });
    if (!response.index) throw new Error("Markdown link index Worker returned no snapshot.");
    return response.index;
  }

  private send(
    session: ActiveSession,
    request: WorkerRequestPayload,
  ): Promise<MarkdownLinkIndexWorkerResponse> {
    this.assertCurrentOrInitializing(session);
    if (session.failure) return Promise.reject(session.failure);
    const operationId = ++session.operationSequence;
    const message = {
      ...request,
      requestId: session.revision,
      operationId,
    } as MarkdownLinkIndexWorkerRequest;

    if (!session.worker) {
      return Promise.reject(new Error("Markdown link index Worker is unavailable."));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(operationId);
        session.failure = new DOMException("Markdown indexing timed out.", "TimeoutError");
        void session.closeWorker?.().catch(() => undefined);
        reject(session.failure);
      }, 15_000);
      session.pending.set(operationId, {
        resolve: (response) => { clearTimeout(timer); resolve(response); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      try {
        session.worker?.postMessage(message);
      } catch (error) {
        clearTimeout(timer);
        session.pending.delete(operationId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private assertCurrent(session: ActiveSession) {
    if (
      this.current !== session
      || session.revision !== this.revision
      || session.controller.signal.aborted
    ) {
      throw createAbortError();
    }
  }

  private assertCurrentOrInitializing(session: ActiveSession) {
    if (session.controller.signal.aborted) throw createAbortError();
  }
}

function scheduleBackgroundTurn(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const finish = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (idleId !== null) window.cancelIdleCallback(idleId);
      reject(createAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });

    if (typeof window.requestIdleCallback === "function") {
      // Idle callbacks run after rendering opportunities. This prevents a
      // stream of tiny background tasks from starving the preview-ready frame.
      idleId = window.requestIdleCallback(finish, { timeout: 250 });
    } else {
      // One frame-sized delay is a conservative fallback for test/older hosts.
      timeoutId = window.setTimeout(finish, 16);
    }
  });
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("Superseded Markdown link index", "AbortError");
  }
  const error = new Error("Superseded Markdown link index");
  error.name = "AbortError";
  return error;
}
