import { runEditorWorker } from "../runtime/BrowserEditorWorkerHost";
import {
  deserializeOfficePackageValidationError,
  type OfficePackageValidationOptions,
  type OfficePackageValidationResult,
  type OfficePackageValidationWorkerRequest,
  type OfficePackageValidationWorkerResponse,
} from "./officePackageValidationTask";

export const DEFAULT_OFFICE_PACKAGE_VALIDATION_WORKER_TIMEOUT_MS = 15_000;

export type OfficePackageValidationClientOptions = OfficePackageValidationOptions & {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export function validateOfficePackageInWorker(
  arrayBuffer: ArrayBuffer,
  {
    profile,
    budget,
    signal,
    timeoutMs = DEFAULT_OFFICE_PACKAGE_VALIDATION_WORKER_TIMEOUT_MS,
  }: OfficePackageValidationClientOptions,
): Promise<OfficePackageValidationResult> {
  const request: OfficePackageValidationWorkerRequest = { arrayBuffer, options: { profile, budget } };
  return runEditorWorker("office-validation", {
    signal, timeoutMs, inputBytes: arrayBuffer.byteLength, message: request, transfer: [arrayBuffer],
    decode(message) {
      const response = message as OfficePackageValidationWorkerResponse;
      if (response.ok) return response.result;
      throw deserializeOfficePackageValidationError(response.error);
    },
  });
}
