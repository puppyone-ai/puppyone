import { assertAgentHistoryReadResult } from "../../runtime/agent-history-read-result.mjs";
import { resolveAgentSessionHistoryPort } from "../../runtime/agent-session-history-port.mjs";
import { isAgentProviderSessionUnavailableError } from "../../runtime/agent-runtime-port.mjs";

/** Opening a conversation uses its existing Actor and its own adapter connection. */
export async function hydrateAgentSession(session, emit, { timeoutMs = 30000 } = {}) {
  const history = resolveAgentSessionHistoryPort(session.adapter);
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Opening native history timed out.");
      controller.abort(error);
      reject(error);
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    const read = typeof history?.hydrate === "function"
      ? assertAgentHistoryReadResult(await Promise.race([history.hydrate({ signal: controller.signal }), timeout]), session.providerSessionId)
      : { events: [], coverage: "unknown", reason: "unsupported" };
    if (session.closing || !session.adapter) throw new Error("The Agent session closed while opening history.");
    for (const event of read.events) emit(session, event);
    session.historyCoverage = read.coverage;
    session.actor.dispatch({ type: "history.loaded", coverage: read.coverage, reason: read.reason });
  } catch (error) {
    if (isAgentProviderSessionUnavailableError(error)) throw error;
    throw Object.assign(new Error(error instanceof Error ? error.message : String(error), { cause: error }), {
      code: error?.code ?? "HISTORY_READ_FAILED", stage: "history-read", retryable: true,
    });
  } finally { clearTimeout(timer); }
}
