const MAX_COMMAND_RECORDS = 128;
const MAX_TERMINAL_TURNS = 128;

export function createAgentSessionControl({
  streamId,
  sessionEpoch,
  terminalState = "idle",
  revision = 0,
} = {}) {
  const outcomeUnknown = terminalState === "provider-exited" || terminalState === "outcome-unknown";
  return Object.freeze({
    schemaVersion: 1,
    streamId,
    revision,
    sessionEpoch,
    adapterGeneration: 0,
    runGeneration: 0,
    connection: Object.freeze({ status: "connecting", reason: null }),
    execution: Object.freeze({
      status: outcomeUnknown ? "outcome-unknown" : "idle",
      activeTurnId: null,
      uncertainTurnId: null,
      startedAtMs: null,
      nativeOutcome: terminalOutcome(terminalState),
      certainty: outcomeUnknown ? "unknown" : "confirmed",
    }),
    interaction: Object.freeze({ approvals: Object.freeze([]), questions: Object.freeze([]) }),
    commands: Object.freeze([]),
    queue: Object.freeze([]),
    terminalTurns: Object.freeze([]),
    pendingSubmission: null,
  });
}

/** Pure reducer. It never performs I/O and is shared by live and hydration paths. */
export function reduceAgentSessionControl(previous, input) {
  const state = mutableCopy(previous);
  const changed = applyInput(state, input);
  if (!changed) return previous;
  state.revision = previous.revision + 1;
  return freezeControl(state);
}

function applyInput(state, input) {
  switch (input?.type) {
    case "adapter.attached":
      if (state.adapterGeneration > 0) settleDispatchingCommands(state, "outcome-unknown", "adapter-generation-changed");
      state.adapterGeneration += 1;
      state.connection = { status: "connected", reason: null };
      return true;
    case "adapter.exited":
      if (input.adapterGeneration != null && input.adapterGeneration !== state.adapterGeneration) return false;
      state.connection = { status: "exited", reason: input.reason || "provider-exited" };
      if (state.execution.activeTurnId) {
        state.execution = {
          status: "outcome-unknown",
          activeTurnId: null,
          uncertainTurnId: state.execution.activeTurnId,
          startedAtMs: state.execution.startedAtMs,
          nativeOutcome: null,
          certainty: "unknown",
        };
      }
      settleDispatchingCommands(state, "outcome-unknown", input.reason || "provider-exited");
      return true;
    case "connection.connecting":
      state.connection = { status: "connecting", reason: input.reason || null };
      return true;
    case "event.accepted":
      return applyCanonicalEvent(state, input.event);
    case "submission.prepared":
      state.pendingSubmission = clonePlain(input.submission);
      if (!state.execution.activeTurnId) {
        state.execution = { status: "starting", activeTurnId: null, uncertainTurnId: null, startedAtMs: input.startedAtMs ?? Date.now(), nativeOutcome: null, certainty: "unknown" };
      }
      return true;
    case "submission.abandoned":
      state.pendingSubmission = null;
      if (!state.execution.activeTurnId && state.execution.status === "starting") {
        state.execution = { status: "idle", activeTurnId: null, uncertainTurnId: null, startedAtMs: null, nativeOutcome: null, certainty: "confirmed" };
      }
      return true;
    case "interrupt.requested":
      if (state.execution.activeTurnId !== input.turnId) return false;
      return upsertCommand(state, {
        commandId: input.commandId,
        kind: "interrupt",
        targetTurnId: input.turnId,
        status: "dispatching",
        error: null,
      });
    case "command.received":
      return receiveCommand(state, input.command);
    case "command.dispatching":
    case "command.accepted":
    case "command.rejected":
    case "command.outcome-unknown":
      return transitionCommand(state, input);
    case "control.hydrated":
      return hydrateControl(state, input.control);
    case "recovery.unconfirmed":
      if (!state.execution.activeTurnId && state.execution.status !== "starting") return false;
      state.execution = {
        status: "outcome-unknown",
        activeTurnId: null,
        uncertainTurnId: state.execution.activeTurnId ?? state.execution.uncertainTurnId ?? null,
        startedAtMs: state.execution.startedAtMs,
        nativeOutcome: null,
        certainty: "unknown",
      };
      settleDispatchingCommands(state, "outcome-unknown", input.reason || "native-state-unconfirmed");
      return true;
    default:
      return false;
  }
}

function applyCanonicalEvent(state, event) {
  const payload = event?.payload ?? {};
  switch (event?.type) {
    case "session.started":
    case "session.resumed":
      state.connection = { status: "connected", reason: null };
      return true;
    case "session.closed":
      state.connection = { status: "disconnected", reason: "session-closed" };
      if (state.execution.activeTurnId || state.execution.status === "starting" || state.execution.status === "outcome-unknown") {
        state.execution = {
          status: "outcome-unknown",
          activeTurnId: null,
          uncertainTurnId: state.execution.activeTurnId ?? state.execution.uncertainTurnId ?? null,
          startedAtMs: state.execution.startedAtMs,
          nativeOutcome: null,
          certainty: "unknown",
        };
      } else {
        state.execution = {
          status: "ended",
          activeTurnId: null,
          uncertainTurnId: null,
          startedAtMs: null,
          nativeOutcome: state.execution.nativeOutcome,
          certainty: "confirmed",
        };
      }
      state.interaction = { approvals: [], questions: [] };
      settleDispatchingCommands(state, "outcome-unknown", "session-closed");
      return true;
    case "turn.started": {
      if (payload.restored === true) return true;
      const turnId = event.turnId;
      if (!turnId || state.terminalTurns.includes(turnId)) return true;
      if (state.execution.activeTurnId !== turnId) state.runGeneration += 1;
      state.execution = {
        status: "active",
        activeTurnId: turnId,
        uncertainTurnId: null,
        startedAtMs: state.execution.status === "starting" && state.execution.startedAtMs != null
          ? state.execution.startedAtMs
          : Date.parse(event.emittedAt) || Date.now(),
        nativeOutcome: null,
        certainty: "confirmed",
      };
      state.pendingSubmission = null;
      return true;
    }
    case "turn.completed":
    case "turn.failed":
    case "turn.interrupted": {
      const turnId = event.turnId;
      rememberTerminal(state, turnId);
      state.interaction = {
        approvals: state.interaction.approvals.filter((entry) => !turnId || entry.turnId !== turnId),
        questions: state.interaction.questions.filter((entry) => !turnId || entry.turnId !== turnId),
      };
      if (!turnId
        || state.execution.activeTurnId === turnId
        || state.execution.uncertainTurnId === turnId
        || state.execution.status === "starting") {
        state.execution = {
          status: "ended",
          activeTurnId: null,
          uncertainTurnId: null,
          startedAtMs: null,
          nativeOutcome: event.type.slice("turn.".length),
          certainty: "confirmed",
        };
        state.pendingSubmission = null;
      }
      return true;
    }
    case "approval.requested":
      return upsertBlocker(state, "approvals", event, payload);
    case "question.requested":
      return upsertBlocker(state, "questions", event, payload);
    case "approval.resolved":
      return removeBlocker(state, "approvals", payload.requestId);
    case "question.resolved":
      return removeBlocker(state, "questions", payload.requestId);
    case "provider.connection.updated":
      state.connection = {
        status: payload.state === "connected" ? "connected" : "recovering",
        reason: typeof payload.message === "string" ? payload.message : null,
      };
      return true;
    default:
      // Content events still advance the control revision, making feed cursors
      // total-order every canonical fact even when control fields are unchanged.
      return true;
  }
}

function receiveCommand(state, command) {
  if (!command?.commandId || state.commands.some((entry) => entry.commandId === command.commandId)) return false;
  const record = {
    commandId: command.commandId,
    kind: command.kind,
    targetTurnId: command.targetTurnId ?? null,
    status: command.status === "queued" ? "queued" : "dispatching",
    operationId: command.operationId ?? null,
    error: null,
  };
  state.commands.push(record);
  if (record.status === "queued") state.queue.push(record.commandId);
  trimCommands(state);
  return true;
}

function transitionCommand(state, input) {
  const status = input.type.slice("command.".length);
  const index = state.commands.findIndex((entry) => entry.commandId === input.commandId);
  if (index < 0) return false;
  const current = state.commands[index];
  if (input.operationId && current.operationId && input.operationId !== current.operationId) return false;
  if (isFinalCommandStatus(current.status)) return false;
  state.commands[index] = {
    ...current,
    status,
    operationId: input.operationId ?? current.operationId,
    targetTurnId: input.turnId ?? current.targetTurnId,
    error: input.error ? String(input.error).slice(0, 1_000) : null,
  };
  if (status !== "queued") state.queue = state.queue.filter((id) => id !== input.commandId);
  if (status === "rejected" && current.kind === "start" && !state.execution.activeTurnId && state.execution.status === "starting") {
    state.execution = { status: "idle", activeTurnId: null, uncertainTurnId: null, startedAtMs: null, nativeOutcome: null, certainty: "confirmed" };
    state.pendingSubmission = null;
  }
  return true;
}

function upsertCommand(state, command) {
  const existing = state.commands.find((entry) => entry.commandId === command.commandId);
  if (existing) return false;
  state.commands.push({ ...command, operationId: command.operationId ?? null });
  trimCommands(state);
  return true;
}

function settleDispatchingCommands(state, status, reason) {
  state.commands = state.commands.map((entry) => (
    entry.status === "dispatching" ? { ...entry, status, error: reason } : entry
  ));
  state.queue = [];
}

function upsertBlocker(state, key, event, payload) {
  const requestId = payload.requestId;
  if (typeof requestId !== "string" || state.interaction[key].some((entry) => entry.requestId === requestId)) return false;
  state.interaction[key].push({
    requestId,
    turnId: event.turnId,
    itemId: event.itemId,
    runtimeId: event.runtimeId ?? event.provider,
    event: clonePlain(event),
    ...(key === "questions" ? { questions: Array.isArray(payload.questions) ? clonePlain(payload.questions) : [] } : {}),
  });
  return true;
}

function removeBlocker(state, key, requestId) {
  const length = state.interaction[key].length;
  state.interaction[key] = state.interaction[key].filter((entry) => entry.requestId !== requestId);
  return state.interaction[key].length !== length;
}

function rememberTerminal(state, turnId) {
  if (typeof turnId !== "string" || !turnId || state.terminalTurns.includes(turnId)) return;
  state.terminalTurns.push(turnId);
  if (state.terminalTurns.length > MAX_TERMINAL_TURNS) state.terminalTurns.splice(0, state.terminalTurns.length - MAX_TERMINAL_TURNS);
}

function hydrateControl(state, control) {
  if (!control || typeof control !== "object") return false;
  const activeTurnId = typeof control.activeTurnId === "string" ? control.activeTurnId : null;
  const terminalState = terminalOutcome(control.terminalState);
  state.execution = activeTurnId
    ? { status: "active", activeTurnId, uncertainTurnId: null, startedAtMs: null, nativeOutcome: null, certainty: "unknown" }
    : { status: terminalState ? "ended" : "idle", activeTurnId: null, uncertainTurnId: null, startedAtMs: null, nativeOutcome: terminalState, certainty: "confirmed" };
  return true;
}

function mutableCopy(state) {
  return {
    ...state,
    connection: { ...state.connection },
    execution: { ...state.execution },
    interaction: {
      approvals: state.interaction.approvals.map(clonePlain),
      questions: state.interaction.questions.map(clonePlain),
    },
    commands: state.commands.map(clonePlain),
    queue: [...state.queue],
    terminalTurns: [...state.terminalTurns],
    pendingSubmission: state.pendingSubmission ? clonePlain(state.pendingSubmission) : null,
  };
}

function freezeControl(state) {
  state.connection = Object.freeze(state.connection);
  state.execution = Object.freeze(state.execution);
  state.interaction = Object.freeze({
    approvals: Object.freeze(state.interaction.approvals.map((entry) => deepFreeze(entry))),
    questions: Object.freeze(state.interaction.questions.map((entry) => deepFreeze(entry))),
  });
  state.commands = Object.freeze(state.commands.map((entry) => Object.freeze(entry)));
  state.queue = Object.freeze([...state.queue]);
  state.terminalTurns = Object.freeze([...state.terminalTurns]);
  if (state.pendingSubmission) state.pendingSubmission = deepFreeze(clonePlain(state.pendingSubmission));
  return Object.freeze(state);
}

function trimCommands(state) {
  if (state.commands.length <= MAX_COMMAND_RECORDS) return;
  const protectedIds = new Set(state.queue);
  while (state.commands.length > MAX_COMMAND_RECORDS) {
    const index = state.commands.findIndex((entry) => !protectedIds.has(entry.commandId) && isFinalCommandStatus(entry.status));
    if (index < 0) break;
    state.commands.splice(index, 1);
  }
}

function isFinalCommandStatus(value) {
  return value === "accepted" || value === "rejected" || value === "outcome-unknown";
}

function terminalOutcome(value) {
  return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
}

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

export const agentSessionControlLimits = Object.freeze({
  maxCommandRecords: MAX_COMMAND_RECORDS,
  maxTerminalTurns: MAX_TERMINAL_TURNS,
});
