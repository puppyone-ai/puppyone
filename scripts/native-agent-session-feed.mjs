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
      || !Array.isArray(candidate.events)
    ) {
      fail(new Error("Agent session feed is discontinuous."));
      return;
    }
    revision = candidate.revision;
    for (const event of candidate.events) pending?.accept(event);
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
    waitForTurn(timeoutMs = DEFAULT_TIMEOUT_MS) {
      if (closed) throw new Error("Agent session feed is closed.");
      if (pending) throw new Error("Only one Agent turn may be observed at a time.");
      let text = "";
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
        accept(event) {
          if (event?.sessionId !== sessionId) return;
          if (event.type === "assistant.delta" && typeof event.payload?.delta === "string") {
            text = appendBounded(text, event.payload.delta);
          }
          if (event.type === "assistant.completed" && typeof event.payload?.text === "string") {
            text = appendBounded(text, event.payload.text);
          }
          if (event.type === "turn.completed") settle(() => resolvePromise(text));
          if (event.type === "turn.failed" || event.type === "turn.interrupted") {
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

function appendBounded(previous, value) {
  return `${previous}${value}`.slice(-256 * 1024);
}

function boundedTimeout(value) {
  return Number.isFinite(value) && value >= 1_000
    ? Math.min(Math.floor(value), 10 * 60_000)
    : DEFAULT_TIMEOUT_MS;
}
