import { deriveCloudInitializationState } from "./cloud-initialization/state-derivation.mjs";

/** Observational progress channel. Listener failures never affect the durable saga. */
export function createCloudPublishProgressChannel({ rootPath, now, onProgress = null }) {
  const listeners = new Set(typeof onProgress === "function" ? [onProgress] : []);
  let lastProgress = null;

  function add(listener) {
    if (typeof listener !== "function") return;
    listeners.add(listener);
    if (lastProgress) safelyReport(listener, lastProgress);
  }

  /** `transfer`: bytes sent and rate while uploading; see `cloud-publish-transfer.mjs`. */
  function report(stage, record = null, transfer = null) {
    const progress = {
      rootPath,
      operationId: record?.operation_id ?? null,
      stage,
      state: record ? deriveCloudInitializationState(record) : null,
      updatedAt: new Date(now()).toISOString(),
      ...(transfer ? { transfer } : {}),
    };
    lastProgress = progress;
    for (const listener of listeners) safelyReport(listener, progress);
  }

  return { add, report };
}

function safelyReport(listener, progress) {
  try {
    listener(progress);
  } catch {
    // Renderer progress is observational and must never affect the durable saga.
  }
}
