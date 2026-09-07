import { assertAgentDisplay } from "../shared/agent-contract/display-schema.mjs";
import { applyAgentDisplayPatch } from "../shared/agent-contract/display-state.mjs";
import { assertAgentSessionFrame, assertAgentSessionSnapshot } from "../shared/agent-contract/schema.mjs";
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Small, strict client for the Main-owned Agent session feed used by native
 * smoke tests. Keeping smoke on the production protocol prevents a retired
 * delivery path from making end-to-end checks pass accidentally.
 */
export async function attachNativeAgentSessionFeed({
  service,
  sender,
  sessionId,
  workspaceRoot,
}) {
  if (
    typeof service?.attachSession !== "function"
    || typeof service?.acknowledgeSession !== "function"
    || typeof service?.detachSession !== "function"
  ) {
    throw new Error("Agent session feed is unavailable.");
  }

  const receipt = await service.attachSession(sender, { sessionId }, workspaceRoot);
  const subscriptionId = requiredText(receipt?.subscriptionId, "subscription");
  const streamId = requiredText(receipt?.snapshot?.cursor?.streamId, "stream");
  let revision = requiredRevision(receipt?.snapshot?.cursor?.revision);
  let display = assertAgentSessionSnapshot(receipt.snapshot).display;
  let closed = false;
  let pending = null;

  const fail = (error) => {
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    current.reject(error instanceof Error ? error : new Error("Agent session feed failed."));
  };

  const onFrame = (candidate) => {
    if (closed || candidate?.subscriptionId !== subscriptionId) return;
    if (candidate.type === "resync-required") {
      fail(new Error("Agent session feed requires resynchronization."));
      return;
    }
    if (
      candidate.type !== "delta"
      || candidate.streamId !== streamId
      || candidate.baseRevision !== revision
      || !Number.isSafeInteger(candidate.revision)
      || candidate.revision <= revision
    ) {
      fail(new Error("Agent session feed is discontinuous."));
      return;
    }
    try {
      assertAgentSessionFrame(candidate);
      display = assertAgentDisplay(applyAgentDisplayPatch(display, candidate.displayPatch));
    } catch (error) { fail(error); return; }
    revision = candidate.revision;
    pending?.accept(display);
    Promise.resolve(service.acknowledgeSession(sender, {
      sessionId,
      subscriptionId,
      streamId,
      revision,
    }, workspaceRoot)).catch(fail);
  };

  sender.on("agent:session-frame", onFrame);
  try {
    await service.acknowledgeSession(sender, {
      sessionId,
      subscriptionId,
      streamId,
      revision,
    }, workspaceRoot);
  } catch (error) {
    sender.off("agent:session-frame", onFrame);
    throw error;
  }

  return Object.freeze({
    waitForTurn(timeoutMs = DEFAULT_TIMEOUT_MS, { expectedUserMessage = null } = {}) {
      if (closed) throw new Error("Agent session feed is closed.");
      if (pending) throw new Error("Only one Agent turn may be observed at a time.");
      let text = "";
      const baselineSequence = display.lastSequence;
      let resolvePromise;
      let rejectPromise;
      const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      const settle = (finish) => {
        if (!pending) return;
        const current = pending;
        pending = null;
        clearTimeout(current.timer);
        finish();
      };
      const timer = setTimeout(() => {
        settle(() => rejectPromise(new Error("Agent turn timed out.")));
      }, boundedTimeout(timeoutMs));
      pending = {
        timer,
        reject: rejectPromise,
        accept(nextDisplay) {
          const turn = nextDisplay.turns.findLast(entry => entry.startedAtSequence > baselineSequence);
          if (!turn) return;
          const messages = nextDisplay.messages.filter(entry => entry.turnId === turn.id);
          text = messages.filter(entry => entry.role === "assistant").map(entry => entry.text).join("").slice(-256 * 1024);
          if (turn.status === "completed") {
            const inputs = messages.filter(entry => entry.role === "user");
            if (expectedUserMessage !== null && (inputs.length !== 1 || inputs[0].text !== expectedUserMessage)) {
              settle(() => rejectPromise(new Error("Agent user message is missing or duplicated.")));
            } else settle(() => resolvePromise(text));
          } else if (["failed", "interrupted", "outcome-unknown"].includes(turn.status)) {
            settle(() => rejectPromise(new Error("Agent turn did not complete.")));
          }
        },
      };
      return {
        promise,
        cancel: () => settle(() => resolvePromise(text)),
      };
    },
    async detach() {
      if (closed) return;
      closed = true;
      sender.off("agent:session-frame", onFrame);
      fail(new Error("Agent session feed was detached."));
      await service.detachSession(sender, { sessionId, subscriptionId }, workspaceRoot);
    },
  });
}

function requiredText(value, kind) {
  if (typeof value !== "string" || !value) throw new Error(`Agent session ${kind} is invalid.`);
  return value;
}

function requiredRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Agent session revision is invalid.");
  return value;
}

function boundedTimeout(value) {
  return Number.isFinite(value) && value >= 1_000
    ? Math.min(Math.floor(value), 10 * 60_000)
    : DEFAULT_TIMEOUT_MS;
}
