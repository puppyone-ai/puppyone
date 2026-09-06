import { randomUUID } from "node:crypto";
import { redactSecretText } from "../../agent-events.mjs";
import { sessionSnapshot } from "../../domain/agent-session-model.mjs";
import { assertAgentSessionFrame } from "../../../../../shared/agent-contract/schema.mjs";

const MAX_PENDING_FRAMES = 512;

/** Versioned snapshot + change feed for disposable Renderer replicas. */
export class AgentSessionFeed {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.subscriptions = new Map();
    this.sessionSubscriptions = new Map();
    this.actorCleanups = new Map();
  }

  attach(session) {
    this.#bind(session);
    const subscriptionId = `subscription-${randomUUID()}`;
    const subscription = {
      id: subscriptionId,
      sessionId: session.id,
      ownerId: session.ownerId,
      sender: session.sender,
      streamId: session.actor.control.streamId,
      sessionEpoch: session.actor.control.sessionEpoch,
      ready: false,
      acknowledgedRevision: session.actor.control.revision,
      initialRevision: session.actor.control.revision,
      bufferedFrames: [],
      unacknowledgedFrames: [],
      needsResync: false,
    };
    this.subscriptions.set(subscriptionId, subscription);
    const ids = this.sessionSubscriptions.get(session.id) ?? new Set();
    ids.add(subscriptionId);
    this.sessionSubscriptions.set(session.id, ids);
    return { subscriptionId, snapshot: sessionSnapshot(session) };
  }

  acknowledge(session, request) {
    const subscription = this.#requireSubscription(session, request?.subscriptionId);
    if (request?.streamId !== subscription.streamId) throw new Error("Agent session feed generation is stale.");
    const revision = Number(request?.revision);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Agent session feed revision is invalid.");
    if (revision > session.actor.control.revision) throw new Error("Agent session feed acknowledgement is ahead of Main.");
    if (!subscription.ready && revision !== subscription.initialRevision) {
      throw new Error("Agent session feed acknowledgement does not match its snapshot revision.");
    }
    if (subscription.ready
      && revision > subscription.acknowledgedRevision
      && !subscription.unacknowledgedFrames.some((frame) => frame.revision === revision)) {
      throw new Error("Agent session feed acknowledgement skips an undelivered revision.");
    }
    subscription.acknowledgedRevision = Math.max(subscription.acknowledgedRevision, revision);
    subscription.unacknowledgedFrames = subscription.unacknowledgedFrames
      .filter((frame) => frame.revision > subscription.acknowledgedRevision);
    const firstAcknowledgement = !subscription.ready;
    subscription.ready = true;
    if (subscription.needsResync) {
      this.#send(subscription, {
        type: "resync-required",
        subscriptionId: subscription.id,
        streamId: subscription.streamId,
        revision: session.actor.control.revision,
      });
      subscription.bufferedFrames = [];
    } else if (firstAcknowledgement) {
      for (const frame of subscription.bufferedFrames) this.#deliverDelta(subscription, frame);
      subscription.bufferedFrames = [];
    }
    return {
      subscriptionId: subscription.id,
      streamId: subscription.streamId,
      revision: session.actor.control.revision,
      synchronized: !subscription.needsResync,
    };
  }

  watermark(session, subscriptionId) {
    const subscription = this.#requireSubscription(session, subscriptionId);
    return {
      subscriptionId: subscription.id,
      streamId: session.actor.control.streamId,
      revision: session.actor.control.revision,
      acknowledgedRevision: subscription.acknowledgedRevision,
      resyncRequired: subscription.needsResync,
    };
  }

  detach(session, subscriptionId) {
    const subscription = this.#requireSubscription(session, subscriptionId);
    this.#remove(subscription);
    return { subscriptionId, detached: true };
  }

  releaseSession(sessionId) {
    for (const subscriptionId of this.sessionSubscriptions.get(sessionId) ?? []) {
      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription) this.#remove(subscription);
    }
    this.actorCleanups.get(sessionId)?.cleanup();
    this.actorCleanups.delete(sessionId);
  }

  releaseAll() {
    for (const sessionId of Array.from(this.actorCleanups.keys())) this.releaseSession(sessionId);
  }

  #bind(session) {
    const existing = this.actorCleanups.get(session.id);
    const sessionEpoch = session.actor.control.sessionEpoch;
    if (existing?.sessionEpoch === sessionEpoch) return;
    if (existing) {
      for (const subscriptionId of this.sessionSubscriptions.get(session.id) ?? []) {
        const subscription = this.subscriptions.get(subscriptionId);
        if (subscription) this.#remove(subscription);
      }
      existing.cleanup();
    }
    this.actorCleanups.set(session.id, {
      sessionEpoch,
      cleanup: session.actor.subscribe((commit) => this.#publish(session, commit)),
    });
  }

  #publish(session, commit) {
    for (const subscriptionId of this.sessionSubscriptions.get(session.id) ?? []) {
      const subscription = this.subscriptions.get(subscriptionId);
      if (!subscription || subscription.streamId !== commit.streamId) continue;
      const frame = Object.freeze({
        type: "delta",
        subscriptionId,
        streamId: commit.streamId,
        baseRevision: commit.baseRevision,
        revision: commit.revision,
        control: commit.control,
        events: commit.events,
      });
      if (subscription.ready) this.#deliverDelta(subscription, frame);
      else if (!subscription.needsResync) {
        subscription.bufferedFrames.push(frame);
        if (subscription.bufferedFrames.length > MAX_PENDING_FRAMES) {
          subscription.bufferedFrames = [];
          subscription.needsResync = true;
        }
      }
    }
  }

  #send(subscription, frame) {
    if (subscription.sender?.isDestroyed?.()) {
      this.#remove(subscription);
      return;
    }
    try {
      subscription.sender.send("agent:session-frame", assertAgentSessionFrame(frame));
    } catch (error) {
      this.logger.warn?.("Unable to deliver Agent session frame:", redactSecretText(error?.message || String(error)));
      this.#remove(subscription);
    }
  }

  #deliverDelta(subscription, frame) {
    if (subscription.needsResync) return;
    subscription.unacknowledgedFrames.push(frame);
    if (subscription.unacknowledgedFrames.length > MAX_PENDING_FRAMES) {
      subscription.unacknowledgedFrames = [];
      subscription.needsResync = true;
      this.#send(subscription, {
        type: "resync-required",
        subscriptionId: subscription.id,
        streamId: subscription.streamId,
        revision: frame.revision,
      });
      return;
    }
    this.#send(subscription, frame);
  }

  #requireSubscription(session, subscriptionId) {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription
      || subscription.sessionId !== session.id
      || subscription.ownerId !== session.ownerId
      || subscription.sessionEpoch !== session.actor.control.sessionEpoch) {
      throw new Error("Agent session subscription is stale or not owned by this window.");
    }
    return subscription;
  }

  #remove(subscription) {
    this.subscriptions.delete(subscription.id);
    const ids = this.sessionSubscriptions.get(subscription.sessionId);
    ids?.delete(subscription.id);
    if (ids?.size === 0) {
      this.sessionSubscriptions.delete(subscription.sessionId);
      this.actorCleanups.get(subscription.sessionId)?.cleanup();
      this.actorCleanups.delete(subscription.sessionId);
    }
  }
}

export const agentSessionFeedLimits = Object.freeze({ maxPendingFrames: MAX_PENDING_FRAMES });
