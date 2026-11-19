import type { SessionConnectionResult } from "../../../shared/session-transport/types";

/** Reconstruct errors in the Renderer, after both Electron serialization boundaries. */
export function unwrapSessionConnection(result: SessionConnectionResult) {
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.value;
}
