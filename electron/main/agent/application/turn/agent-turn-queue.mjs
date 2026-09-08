import { privateReferenceLeaseTokens } from "../agent-reference-policy.mjs";

const MAX_QUEUED_TURNS = 20;

/** Owns private queued payloads and keeps their public SessionActor records settled. */
export function createAgentTurnQueue({ attachmentStore, executeStart }) {
  const contexts = new Map();
  const cleanups = new Map();
  const draining = new Set();

  function enqueue(context) {
    contexts.set(contextKey(context.session, context.commandId), context);
    observe(context.session);
    schedule(context.session);
  }

  function observe(session) {
    const key = sessionKey(session);
    if (cleanups.has(key)) return;
    cleanups.set(key, session.actor.subscribe(() => {
      if (["exited", "disconnected"].includes(session.actor.control.connection.status)) {
        void discardSession(session);
        return;
      }
      void discardSettled(session);
      schedule(session);
    }));
  }

  function schedule(session) {
    const sessionIdentity = sessionKey(session);
    if (draining.has(sessionIdentity)) return;
    const control = session.actor.control;
    if (!queueDispatchable(control)) return;
    draining.add(sessionIdentity);
    queueMicrotask(async () => {
      try {
        const current = session.actor.control;
        const commandId = current.queue[0];
        const key = contextKey(session, commandId);
        const context = contexts.get(key);
        if (!context || context.session !== session) {
          session.actor.dispatch({
            type: "command.cancelled",
            commandId,
            error: "queued-command-payload-unavailable",
          });
          return;
        }
        if (session.providerExited) return;
        const adapterGeneration = session.actor.control.adapterGeneration;
        // Transfer the private payload out of queue ownership before the
        // public reservation commit notifies subscribers. Restore it when the
        // Actor rejects the reservation; no async work occurs in this window.
        contexts.delete(key);
        let reservation;
        try {
          reservation = session.actor.dispatch({
            type: "queue.dispatch-reserved",
            commandId,
            operationId: context.operationId,
            adapterGeneration,
          });
        } catch (error) {
          contexts.set(key, context);
          throw error;
        }
        if (!reservation.changed) {
          contexts.set(key, context);
          return;
        }
        try { await executeStart(context); } catch { /* command settlement is recorded by the coordinator */ }
      } finally {
        draining.delete(sessionIdentity);
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
      contexts.delete(contextKey(session, context.commandId));
      await releaseLease(session, context.request);
    }
    cleanups.get(sessionKey(session))?.();
    cleanups.delete(sessionKey(session));
  }

  async function discardSettled(session) {
    const queuedIds = new Set(session.actor.control.queue);
    const settled = Array.from(contexts.values()).filter((context) => (
      context.session === session && !queuedIds.has(context.commandId)
    ));
    for (const context of settled) {
      contexts.delete(contextKey(session, context.commandId));
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

function contextKey(session, commandId) {
  return `${sessionKey(session)}:${commandId}`;
}

function sessionKey(session) {
  return session.actor.control.sessionEpoch;
}

function queueDispatchable(control) {
  if (control.connection.status !== "connected" || control.queue.length === 0 || control.pendingSubmission) return false;
  if (control.execution.activeTurnId || control.execution.uncertainTurnId
    || control.execution.status === "starting" || control.execution.status === "outcome-unknown") return false;
  return !control.commands.some((entry) => entry.kind === "interrupt" && entry.status === "dispatching");
}

export const agentTurnQueueLimits = Object.freeze({ maxQueuedTurns: MAX_QUEUED_TURNS });
