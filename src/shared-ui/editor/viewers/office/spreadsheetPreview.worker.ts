import { parseSpreadsheetPreview } from "./spreadsheetParser";
import type { SpreadsheetArchiveKind, SpreadsheetPreviewResult } from "./spreadsheetPreview";

type SpreadsheetWorkerRequest = { arrayBuffer: ArrayBuffer; archiveKind: SpreadsheetArchiveKind };
type SpreadsheetWorkerResponse =
  | { ok: true; result: SpreadsheetPreviewResult }
  | { ok: false; error: { name: string; message: string; stack?: string } };

type SpreadsheetWorkerScope = {
  onmessage: ((event: MessageEvent<SpreadsheetWorkerRequest>) => void) | null;
  postMessage: (message: SpreadsheetWorkerResponse) => void;
};

const workerScope = self as unknown as SpreadsheetWorkerScope;

workerScope.onmessage = (event) => {
  void parseSpreadsheetPreview(event.data.arrayBuffer, { archiveKind: event.data.archiveKind })
    .then((result) => {
      workerScope.postMessage({ ok: true, result });
    })
    .catch((error) => {
      workerScope.postMessage({ ok: false, error: serializeError(error) });
    });
};

function serializeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: "Error", message: String(error) };
}
