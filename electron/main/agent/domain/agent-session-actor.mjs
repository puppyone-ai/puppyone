import { randomUUID } from "node:crypto";
import { countTextBytes, createAgentEventEnvelope } from "../agent-events.mjs";
import { createAgentSessionControl, reduceAgentSessionControl } from "./agent-session-control.mjs";
import { foldAgentEventCheckpoint } from "./agent-event-checkpoint.mjs";
import { assertAgentSessionControl } from "../../../../shared/agent-contract/schema.mjs";

const MAX_REPLAY_EVENTS = 1_000;
const MAX_REPLAY_BYTES = 2 * 1024 * 1024;

/** Single mutable owner of one session's product control state and ledger. */
export class AgentSessionActor {
  #control;
  #events;
  #sequence;
  #replayBytes;
  #checkpointByTurn = new Map();
  #listeners = new Set();

  constructor({ events = [], sequence = 0, terminalState = "idle" } = {}) {
    this.#events = events.map((event) => deepFreeze(clonePlain(event)));
    this.#sequence = Math.max(sequence, ...this.#events.map((event) => event.sequence), 0);
    this.#replayBytes = this.#events.reduce((total, event) => total + countTextBytes(event), 0);
    this.#control = createAgentSessionControl({
      streamId: randomUUID(),
      sessionEpoch: randomUUID(),
      terminalState,
    });
    for (const event of this.#events) {
      this.#control = reduceAgentSessionControl(this.#control, { type: "event.accepted", event });
    }
    if (this.#events.length > 0) {
      this.#control = reduceAgentSessionControl(this.#control, {
        type: "recovery.unconfirmed",
        reason: "native-state-unconfirmed-after-main-restart",
      });
    }
    assertAgentSessionControl(this.#control);
    this.#enforceReplayLimits();
  }

  get control() { return this.#control; }
  get sequence() { return this.#sequence; }
  get replayBytes() { return this.#replayBytes; }
  events() { return [...this.#events]; }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispatch(input) {
    const previous = this.#control;
    const next = reduceAgentSessionControl(previous, input);
    if (next === previous) return { changed: false, control: previous };
    assertAgentSessionControl(next);
    this.#control = next;
    const commit = Object.freeze({
      streamId: next.streamId,
      baseRevision: previous.revision,
      revision: next.revision,
      control: next,
      input,
      events: Object.freeze([]),
    });
    this.#notify(commit);
    return { changed: true, control: next, commit };
  }

  appendEvent({ sessionId, runtimeId, providerSessionId, event }) {
    const envelope = deepFreeze(createAgentEventEnvelope({
      sequence: this.#sequence + 1,
      sessionId,
      runtimeId,
      providerSessionId: event.providerSessionId ?? providerSessionId,
      turnId: event.turnId ?? null,
      itemId: event.itemId ?? null,
      type: event.type,
      payload: event.payload ?? {},
    }));
    const previous = this.#control;
    const next = reduceAgentSessionControl(previous, { type: "event.accepted", event: envelope });
    assertAgentSessionControl(next);
    this.#sequence = envelope.sequence;
    this.#events.push(envelope);
    this.#replayBytes += countTextBytes(envelope);
    this.#enforceReplayLimits();
    this.#control = next;
    const commit = Object.freeze({
      streamId: next.streamId,
      baseRevision: previous.revision,
      revision: next.revision,
      control: next,
      input: Object.freeze({ type: "event.accepted", event: envelope }),
      events: Object.freeze([envelope]),
    });
    this.#notify(commit);
    return envelope;
  }

  snapshot() {
    const events = this.events();
    const retainedSequences = new Set(events.map((event) => event.sequence));
    const materializedPrefix = Array.from(this.#checkpointByTurn.values()).flat();
    const checkpointEvents = [
      ...materializedPrefix,
      ...this.#control.interaction.approvals,
      ...this.#control.interaction.questions,
    ].flatMap((entry) => entry?.event && !retainedSequences.has(entry.event.sequence) ? [entry.event] : entry?.type ? [entry] : [])
      .filter((event, index, values) => values.findIndex((candidate) => candidate.sequence === event.sequence) === index)
      .sort((left, right) => left.sequence - right.sequence)
      .map(deepFreeze);
    return Object.freeze({
      cursor: Object.freeze({ streamId: this.#control.streamId, revision: this.#control.revision }),
      control: this.#control,
      timeline: Object.freeze({
        events: Object.freeze(events),
        checkpointEvents: Object.freeze(checkpointEvents),
        partial: Boolean(events[0] && events[0].sequence > 1),
        firstAvailableSequence: events[0]?.sequence ?? this.#sequence + 1,
        lastSequence: this.#sequence,
      }),
    });
  }

  #notify(commit) {
    for (const listener of this.#listeners) {
      try { listener(commit); } catch { /* subscriber isolation */ }
    }
  }

  #discardExpiredCheckpoints() {
    const retainedTurnIds = new Set(this.#events.map((event) => event.turnId).filter(Boolean));
    if (this.#control.execution.activeTurnId) retainedTurnIds.add(this.#control.execution.activeTurnId);
    for (const turnId of this.#checkpointByTurn.keys()) {
      if (!retainedTurnIds.has(turnId)) this.#checkpointByTurn.delete(turnId);
    }
  }

  #enforceReplayLimits() {
    while (
      this.#events.length > MAX_REPLAY_EVENTS
      || (this.#replayBytes > MAX_REPLAY_BYTES && this.#events.length > 1)
    ) {
      const removed = this.#events.shift();
      this.#replayBytes -= countTextBytes(removed);
      if (removed.turnId) {
        this.#checkpointByTurn.set(
          removed.turnId,
          foldAgentEventCheckpoint(this.#checkpointByTurn.get(removed.turnId) ?? [], removed),
        );
      }
    }
    this.#discardExpiredCheckpoints();
  }
}

export const agentSessionActorLimits = Object.freeze({
  maxReplayEvents: MAX_REPLAY_EVENTS,
  maxReplayBytes: MAX_REPLAY_BYTES,
});

function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clonePlain(entry)]));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}
