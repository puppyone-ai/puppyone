import { createAgentProjection, applyAgentEvents, applyAgentEvent, projectAgentUserSubmission } from "./transcript/transcript-reducer.mjs";
import { associateAgentUserMessage } from "./transcript/message-identity.mjs";
import { projectAgentDisplayControl } from "./transcript/display-control.mjs";
import { boundAgentDisplay } from "./transcript/display-window.mjs";
import { createAgentDisplayPatch } from "../../../../shared/agent-contract/display-state.mjs";
import { assertAgentDisplay } from "../../../../shared/agent-contract/display-schema.mjs";
import { randomUUID } from "node:crypto";
import { countTextBytes, createAgentEventEnvelope } from "../agent-events.mjs";
import { agentSessionControlLimits, createAgentSessionControl, reduceAgentSessionControl } from "./agent-session-control.mjs";
import { foldAgentEventCheckpoint } from "./agent-event-checkpoint.mjs";
import { assertAgentSessionControl } from "../../../../shared/agent-contract/schema.mjs";

const MAX_REPLAY_EVENTS = 1_000;
const MAX_REPLAY_BYTES = 2 * 1024 * 1024;

/** Single mutable owner of one session's product control state and ledger. */
export class AgentSessionActor {
  #mailbox = [];
  #committing = false;
  #control;
  #display;
  #notifications = [];
  #publishing = false;
  #clock;
  #events;
  #sequence;
  #replayBytes;
  #checkpointByTurn = new Map();
  #terminalOutcomeByTurn = new Map();
  #listeners = new Set();

  constructor({ events = [], sequence = 0, terminalState = "idle", clock = Date.now } = {}) {
    this.#clock = clock;
    this.#events = events.map((event) => deepFreeze(clonePlain(event)));
    this.#sequence = Math.max(sequence, ...this.#events.map((event) => event.sequence), 0);
    this.#replayBytes = this.#events.reduce((total, event) => total + countTextBytes(event), 0);
    this.#control = createAgentSessionControl({
      streamId: randomUUID(),
      sessionEpoch: randomUUID(),
      terminalState,
    });
    for (const event of this.#events) {
      this.#rememberTerminalOutcome(event);
      this.#control = reduceAgentSessionControl(this.#control, { type: "event.accepted", event });
    }
    if (this.#events.length > 0) {
      this.#control = reduceAgentSessionControl(this.#control, {
        type: "recovery.unconfirmed",
        reason: "native-state-unconfirmed-after-main-restart",
      });
    }
    const projection = applyAgentEvents(createAgentProjection(), this.#events);
    // A new display starts at the persisted ledger position. Native history
    // will supply its content; old event numbers are not missing messages.
    projection.lastSequence = this.#sequence;
    this.#display = deepFreeze(boundAgentDisplay(projectAgentDisplayControl(projection, this.#control), this.#control));
    assertAgentDisplay(this.#display);
    assertAgentSessionControl(this.#control);
    this.#enforceReplayLimits();
  }

  get display() { return this.#display; }
  get control() { return this.#control; }
  get sequence() { return this.#sequence; }
  get replayBytes() { return this.#replayBytes; }
  events() { return [...this.#events]; }
  terminalOutcome(turnId) { return this.#terminalOutcomeByTurn.get(turnId) ?? null; }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispatch(input) { return this.#accept({ kind: "control", input }); }
  appendEvent(input) { return this.#accept({ kind: "event", input }); }

  // Mailbox transactions are synchronous and contain no native I/O. Effects run
  // in application coordinators after admission; their receipts re-enter here.
  #accept(message) {
    const entry = { message, result: null, error: null };
    if (this.#committing) throw new Error("Agent state reduction cannot re-enter its mailbox.");
    this.#mailbox.push(entry);
    this.#committing = true;
    const commits = [];
    try {
      while (this.#mailbox.length) {
        const current = this.#mailbox.shift();
        try {
          const transaction = current.message.kind === "control"
            ? this.#applyControl(current.message.input) : this.#applyEvent(current.message.input);
          current.result = transaction.result;
          if (transaction.commit) commits.push(transaction.commit);
        } catch (error) { current.error = error; }
      }
    } finally { this.#committing = false; }
    for (const commit of commits) this.#notify(commit);
    if (entry.error) throw entry.error;
    return entry.result;
  }

  #applyControl(input) {
    if (input.type === "command.received" && input.command?.kind === "start" && !input.command.userMessageId) input = { ...input, command: { ...input.command, userMessageId: randomUUID() } };
    if (input.type === "submission.prepared" && input.startedAtMs == null) input = { ...input, startedAtMs: this.#clock() };
    const previous = this.#control;
    const next = reduceAgentSessionControl(previous, input);
    if (next === previous) return { result: { changed: false, control: previous } };
    assertAgentSessionControl(next);
    // Admission is a product display fact, not a fabricated native history event.
    const admitted = input.type === "command.received" && input.command.kind === "start"
      ? projectAgentUserSubmission(this.#display, next.commands.find(command => command.commandId === input.command.commandId))
      : input.type === "history.loaded"
        ? { ...this.#display, history: { coverage: input.coverage,
          reason: input.coverage === "complete" ? null : input.reason ?? "unverified" } } : this.#display;
    const display = deepFreeze(boundAgentDisplay(projectAgentDisplayControl(admitted, next), next));
    assertAgentDisplay(display);
    const displayPatch = deepFreeze(createAgentDisplayPatch(this.#display, display));
    this.#display = display;
    this.#control = next;
    const commit = Object.freeze({
      streamId: next.streamId,
      baseRevision: previous.revision,
      revision: next.revision,
      control: next,
      sequence: this.#sequence,
      input,
      displayPatch,
      events: Object.freeze([]),
    });
    return { result: { changed: true, control: next, commit }, commit };
  }

  #applyEvent({ sessionId, runtimeId, providerSessionId, event }) {
    event = associateAgentUserMessage(event, this.#control);
    const envelope = deepFreeze(createAgentEventEnvelope({
      sequence: this.#sequence + 1,
      emittedAt: event.emittedAt ?? new Date(this.#clock()).toISOString(),
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
    const display = deepFreeze(boundAgentDisplay(projectAgentDisplayControl(applyAgentEvent(this.#display, envelope), next), next));
    assertAgentDisplay(display);
    const displayPatch = deepFreeze(createAgentDisplayPatch(this.#display, display));
    this.#display = display;
    this.#rememberTerminalOutcome(envelope);
    this.#sequence = envelope.sequence;
    this.#events.push(envelope);
    this.#replayBytes += countTextBytes(envelope);
    this.#control = next;
    this.#enforceReplayLimits();
    const commit = Object.freeze({
      streamId: next.streamId,
      baseRevision: previous.revision,
      revision: next.revision,
      control: next,
      sequence: envelope.sequence,
      emittedAt: envelope.emittedAt,
      input: Object.freeze({ type: "event.accepted", event: envelope }),
      displayPatch,
      events: Object.freeze([envelope]),
    });
    return { result: envelope, commit };
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
      display: this.#display,
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
    this.#notifications.push(commit);
    if (this.#publishing) return;
    this.#publishing = true;
    try {
      while (this.#notifications.length) {
        const committed = this.#notifications.shift();
        for (const listener of this.#listeners) {
          try { listener(committed); } catch { /* one subscriber cannot stop later revisions */ }
        }
      }
    } finally { this.#publishing = false; }
  }

  #rememberTerminalOutcome(event) {
    if (!event?.turnId || !["turn.completed", "turn.failed", "turn.interrupted"].includes(event.type)) return;
    this.#terminalOutcomeByTurn.delete(event.turnId);
    this.#terminalOutcomeByTurn.set(event.turnId, event.type.slice("turn.".length));
    while (this.#terminalOutcomeByTurn.size > agentSessionControlLimits.maxTerminalTurns) {
      this.#terminalOutcomeByTurn.delete(this.#terminalOutcomeByTurn.keys().next().value);
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
