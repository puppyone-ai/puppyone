import { privateReferenceLeaseTokens } from "../agent-reference-policy.mjs";

const MAX_QUEUED_TURNS = 20;

/** Owns private queued payloads and keeps their public SessionActor records settled. */
export function createAgentTurnQueue({ attachmentStore, executeStart }) {
  const contexts = new Map();
  const cleanups = new Map();
  const draining = new Set();

  function enqueue(context) {
    contexts.set(context.commandId, context);
    observe(context.session);
    schedule(context.session);
  }

  function observe(session) {
    if (cleanups.has(session.id)) return;
    cleanups.set(session.id, session.actor.subscribe(() => {
      if (["exited", "disconnected"].includes(session.actor.control.connection.status)) {
        void discardSession(session);
        return;
      }
      void discardSettled(session);
      schedule(session);
    }));
  }

  function schedule(session) {
    if (draining.has(session.id)) return;
    const control = session.actor.control;
    if (control.execution.activeTurnId || control.execution.status === "starting" || control.queue.length === 0) return;
    draining.add(session.id);
    queueMicrotask(async () => {
      try {
        const commandId = session.actor.control.queue[0];
        const context = contexts.get(commandId);
        if (!context || context.session !== session) {
          session.actor.dispatch({
            type: "command.cancelled",
            commandId,
            error: "queued-command-payload-unavailable",
          });
          return;
        }
        contexts.delete(commandId);
        if (session.providerExited) return;
        try { await executeStart(context); } catch { /* command settlement is recorded by the coordinator */ }
      } finally {
        draining.delete(session.id);
        if (!session.providerExited) schedule(session);
      }
    });
  }

  async function discardSession(session) {
    const abandoned = Array.from(contexts.values()).filter((context) => context.session === session);
    for (const context of abandoned) {
      session.actor.dispatch({
        type: "command.cancelled",
        commandId: context.commandId,
        error: "session-ended-before-command-dispatch",
      });
      contexts.delete(context.commandId);
      await releaseLease(session, context.request);
    }
    cleanups.get(session.id)?.();
    cleanups.delete(session.id);
  }

  async function discardSettled(session) {
    const queuedIds = new Set(session.actor.control.queue);
    const settled = Array.from(contexts.values()).filter((context) => (
      context.session === session && !queuedIds.has(context.commandId)
    ));
    for (const context of settled) {
      contexts.delete(context.commandId);
      await releaseLease(session, context.request);
    }
  }

  async function releaseLease(session, request) {
    const lease = request?.privateReferenceLease;
    const tokens = privateReferenceLeaseTokens(request);
    if (!lease?.leaseId || tokens.length === 0 || typeof attachmentStore?.releaseLease !== "function") return;
    await attachmentStore.releaseLease({
      ownerId: session.ownerId,
      workspaceRoot: session.workspaceRoot,
      tokens,
      leaseId: lease.leaseId,
    }).catch(() => undefined);
  }

  return { enqueue, schedule };
}

export const agentTurnQueueLimits = Object.freeze({ maxQueuedTurns: MAX_QUEUED_TURNS });
