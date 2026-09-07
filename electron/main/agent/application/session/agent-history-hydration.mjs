import { assertAgentHistoryReadResult } from "../../runtime/agent-history-read-result.mjs";
import { resolveAgentSessionHistoryPort } from "../../runtime/agent-session-history-port.mjs";

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
      : { events: [], coverage: "unknown" };
    if (session.closing || !session.adapter) throw new Error("The Agent session closed while opening history.");
    for (const event of read.events) emit(session, event);
    session.historyCoverage = read.coverage;
    session.actor.dispatch({ type: "history.loaded", coverage: read.coverage });
  } finally { clearTimeout(timer); }
}
