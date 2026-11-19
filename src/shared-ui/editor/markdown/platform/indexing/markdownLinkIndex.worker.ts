import {
  createMarkdownLinkGraphIndexer,
  type MarkdownLinkGraphIndexer,
} from "../../core/links/markdownLinkGraph";
import type {
  MarkdownLinkIndexWorkerRequest,
  MarkdownLinkIndexWorkerResponse,
} from "./markdownLinkIndexProtocol";

type WorkerScope = {
  onmessage: ((event: MessageEvent<MarkdownLinkIndexWorkerRequest>) => void) | null;
  postMessage(message: MarkdownLinkIndexWorkerResponse): void;
};

const workerScope = self as unknown as WorkerScope;
let activeRequestId = -1;
let indexer: MarkdownLinkGraphIndexer | null = null;

workerScope.onmessage = (event) => {
  const request = event.data;
  try {
    if (request.type === "initialize") {
      activeRequestId = request.requestId;
      indexer = createMarkdownLinkGraphIndexer(request.documents);
      respond(request, { type: "ack" });
      return;
    }

    if (request.requestId !== activeRequestId || !indexer) {
      throw new Error("Markdown link index session is no longer current.");
    }
    if (request.type === "index-document") {
      indexer.indexDocument(request.document);
      respond(request, { type: "ack" });
      return;
    }
    respond(request, { type: "snapshot", index: indexer.createSnapshot() });
  } catch (error) {
    respond(request, {
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

function respond(
  request: MarkdownLinkIndexWorkerRequest,
  response: Pick<MarkdownLinkIndexWorkerResponse, "type" | "index" | "error">,
) {
  workerScope.postMessage({
    requestId: request.requestId,
    operationId: request.operationId,
    ...response,
  });
}
