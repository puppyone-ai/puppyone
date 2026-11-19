import { runEditorWorker } from "../../runtime/BrowserEditorWorkerHost";
import {
  deserializeOfficeTextFallbackError,
  type ExtractOpenDocumentTextTask,
  type ExtractPresentationTextTask,
  type OfficeTextFallbackResult,
  type OfficeTextFallbackTask,
  type OfficeTextFallbackWorkerRequest,
  type OfficeTextFallbackWorkerResponse,
  type OpenDocumentTextFallbackResult,
  type PresentationTextFallbackResult,
} from "./officeTextFallbackTask";

export const DEFAULT_OFFICE_TEXT_FALLBACK_WORKER_TIMEOUT_MS = 10_000;

type OfficeTextFallbackWorkerControls = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ExtractPresentationTextClientOptions = ExtractPresentationTextTask
  & OfficeTextFallbackWorkerControls;

export type ExtractOpenDocumentTextClientOptions = ExtractOpenDocumentTextTask
  & OfficeTextFallbackWorkerControls;

export type OfficeTextFallbackClientOptions =
  | ExtractPresentationTextClientOptions
  | ExtractOpenDocumentTextClientOptions;

export function extractOfficeTextFallbackInWorker(
  arrayBuffer: ArrayBuffer,
  options: ExtractPresentationTextClientOptions,
): Promise<PresentationTextFallbackResult>;
export function extractOfficeTextFallbackInWorker(
  arrayBuffer: ArrayBuffer,
  options: ExtractOpenDocumentTextClientOptions,
): Promise<OpenDocumentTextFallbackResult>;
export function extractOfficeTextFallbackInWorker(
  arrayBuffer: ArrayBuffer,
  options: OfficeTextFallbackClientOptions,
): Promise<OfficeTextFallbackResult> {
  const { signal, timeoutMs = DEFAULT_OFFICE_TEXT_FALLBACK_WORKER_TIMEOUT_MS, ...task } = options;
  const request: OfficeTextFallbackWorkerRequest = { arrayBuffer, task: task as OfficeTextFallbackTask };
  return runEditorWorker("office-text", {
    signal, timeoutMs, inputBytes: arrayBuffer.byteLength, message: request, transfer: [arrayBuffer],
    decode(message) {
      const response = message as OfficeTextFallbackWorkerResponse;
      if (response.ok) return response.result;
      throw deserializeOfficeTextFallbackError(response.error);
    },
  });
}
