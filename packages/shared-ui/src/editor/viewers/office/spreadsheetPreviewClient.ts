import { runEditorWorker } from "../../runtime/BrowserEditorWorkerHost";
import type { SpreadsheetArchiveKind, SpreadsheetPreviewResult } from "./spreadsheetPreview";

export const DEFAULT_SPREADSHEET_WORKER_TIMEOUT_MS = 15_000;

type SpreadsheetWorkerResponse =
  | { ok: true; result: SpreadsheetPreviewResult }
  | { ok: false; error: { name: string; message: string; stack?: string } };

export function parseSpreadsheetInWorker(
  arrayBuffer: ArrayBuffer,
  {
    archiveKind,
    signal,
    timeoutMs = DEFAULT_SPREADSHEET_WORKER_TIMEOUT_MS,
  }: {
    archiveKind: SpreadsheetArchiveKind;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<SpreadsheetPreviewResult> {
  return runEditorWorker("spreadsheet", {
    signal, timeoutMs, inputBytes: arrayBuffer.byteLength,
    message: { arrayBuffer, archiveKind }, transfer: [arrayBuffer],
    decode(message) {
      const response = message as SpreadsheetWorkerResponse;
      if (response.ok) return response.result;
      const error = new Error(response.error.message);
      error.name = response.error.name;
      error.stack = response.error.stack;
      throw error;
    },
  });
}
