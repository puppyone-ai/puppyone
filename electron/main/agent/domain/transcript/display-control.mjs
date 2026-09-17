import { activeAgentRecovery } from '../agent-recovery.mjs';

/** Control and transcript are committed together; no content event votes on current control state. */
export function projectAgentDisplayControl(display, control) {
  const deliveryById = new Map(control.commands.filter(command => command.kind === "start").map(command => [command.commandId, command.status]));
  const delivery = message => deliveryById.has(message.submissionId) && message.deliveryStatus !== deliveryById.get(message.submissionId)
    ? { ...message, deliveryStatus: deliveryById.get(message.submissionId) } : message;
  display = { ...display, messages: display.messages.map(delivery), parts: display.parts.map(delivery) };
  display = withUncertainOutcome(display, control);
  display = withTurnSummaries(display);
  const recovery = activeAgentRecovery(control);
  const activeTurnId = control.execution.activeTurnId;
  return {
    ...display,
    presentation: {
      phase: control.connection.status === "exited" ? "runtime-exited"
        : activeTurnId ? (control.interaction.approvals.length || control.interaction.questions.length ? "waiting" : "running")
          : control.execution.status === "starting" ? "creating" : "ready",
      terminalState: control.connection.status === "exited" ? "provider-exited"
        : activeTurnId ? "running" : control.execution.status === "outcome-unknown" ? "outcome-unknown" : control.execution.nativeOutcome ?? "idle",
      pendingPrompt: null,
      submitting: control.execution.status === "starting",
      stopping: Boolean(activeTurnId && control.commands.some(command => command.kind === "interrupt"
        && command.targetTurnId === activeTurnId && ["dispatching", "accepted"].includes(command.status))),
    },
    runningTurnId: activeTurnId,
    terminalState: activeTurnId ? null : control.execution.nativeOutcome,
    connectionStatus: recovery ? {
      state: recovery.state, message: recovery.message, attempt: recovery.attempt,
      maxAttempts: recovery.maxAttempts, turnId: recovery.turnId, sequence: display.lastSequence,
    } : null,
    approvals: display.approvals.filter(entry => control.interaction.approvals.some(pending => pending.requestId === entry.requestId)).map(entry => withReplyStatus(entry, control)),
    questions: display.questions.filter(entry => control.interaction.questions.some(pending => pending.requestId === entry.requestId)).map(entry => withReplyStatus(entry, control)),
  };
}

/** A summary exists only when the native transcript confirms an outcome and timing. */
function withTurnSummaries(display) {
  const parts = display.parts.filter(part => part.kind !== "turn-summary");
  const rows = [...display.rows];
  const lastRowByTurn = new Map();
  for (const row of rows) if (row.kind !== "turn-summary") lastRowByTurn.set(row.turnId, Math.max(lastRowByTurn.get(row.turnId) ?? 0, row.sequence));
  for (const turn of display.turns) {
    if (!["completed", "failed", "interrupted"].includes(turn.status) || turn.durationMs === null || turn.completedAtSequence === null) continue;
    const id = `turn-summary:${turn.id}`;
    const sequence = Math.max(turn.completedAtSequence, lastRowByTurn.get(turn.id) ?? 0);
    parts.push({ id, kind: "turn-summary", turnId: turn.id, itemId: null, durationMs: turn.durationMs, status: turn.status,
      ...(turn.completionQuality ? { completionQuality: turn.completionQuality } : {}),
      sequence, updatedSequence: turn.completedAtSequence });
    const row = { id: `row:${id}`, partId: id, turnId: turn.id, kind: "turn-summary", sequence, updatedSequence: turn.completedAtSequence, estimatedHeight: 34 };
    const index = rows.findIndex(entry => entry.id === row.id);
    if (index >= 0) rows[index] = row; else rows.push(row);
  }
  rows.sort((left, right) => left.sequence - right.sequence);
  const partIds = new Set(parts.map(part => part.id));
  return { ...display, parts, rows: rows.filter(row => partIds.has(row.partId)) };
}

function withUncertainOutcome(display, control) {
  const turnId = control.execution.status === "outcome-unknown" ? control.execution.uncertainTurnId : null;
  if (!turnId) return display;
  const live = new Set(["queued", "running", "pending", "in-progress", "waiting-for-user"]);
  const settle = part => {
    if (part.turnId !== turnId) return part;
    if (part.kind === "assistant" || part.role === "assistant") return { ...part, streaming: false };
    if ((part.kind === "permission" || part.kind === "question") && part.state === "pending") return { ...part, state: "unavailable" };
    return live.has(part.status) ? { ...part, status: "unknown" } : part;
  };
  return { ...display, messages: display.messages.map(settle), activities: display.activities.map(settle), parts: display.parts.map(settle),
    turns: display.turns.map(turn => turn.id === turnId && turn.status === "running" ? { ...turn, status: "outcome-unknown" } : turn) };
}

function withReplyStatus(entry, control) {
  const command = control.commands.findLast(command => command.requestId === entry.requestId);
  return { ...entry, replyStatus: command?.status ?? null };
}
