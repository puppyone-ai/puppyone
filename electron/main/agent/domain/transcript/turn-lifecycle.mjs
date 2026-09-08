import { invalidateProjectionIndexes } from "./transcript-indexes.mjs";
const TERMINAL_TURN_EVENTS = Object.freeze({
    "turn.completed": "completed",
    "turn.failed": "failed",
    "turn.interrupted": "interrupted",
});
export const LIVE_AGENT_ACTIVITY_STATUSES = new Set([
    "queued",
    "running",
    "pending",
    "in-progress",
    "waiting-for-user",
]);
export function agentTurnTerminalState(event) {
    return TERMINAL_TURN_EVENTS[event.type] ?? null;
}
export function isLiveAgentActivityStatus(status) {
    return LIVE_AGENT_ACTIVITY_STATUSES.has(status);
}
export function agentActivityTerminalStatus(terminalState) {
    return terminalState === "completed" ? "completed" : terminalState;
}
/**
 * One terminal reconciliation authority for legacy compatibility collections
 * and the canonical typed-part timeline. Native Harnesses may omit a terminal
 * child event, but no live child is allowed to survive its owning turn.
 */
export function reconcileTerminalAgentTurn(projection, event) {
    const terminalState = agentTurnTerminalState(event);
    if (!terminalState)
        return;
    const turnId = event.turnId;
    const endsCurrentTurn = !turnId || projection.runningTurnId === turnId;
    if (endsCurrentTurn) {
        projection.runningTurnId = null;
        projection.terminalState = terminalState;
        projection.connectionStatus = null;
    }
    projection.messages = projection.messages.map((message) => (turnId && message.turnId === turnId && message.role === "assistant"
        ? { ...message, streaming: false, terminalState }
        : message));
    projection.activities = projection.activities.map((activity) => settleActivity(activity, turnId, terminalState));
    projection.parts = projection.parts.map((part) => settlePart(part, turnId, terminalState));
    projection.approvals = projection.approvals.filter((approval) => approval.turnId !== turnId);
    projection.questions = projection.questions.filter((question) => question.turnId !== turnId);
    // Collection replacement invalidates every lazily rebuilt positional index.
    invalidateProjectionIndexes(projection);
}
function settleActivity(activity, turnId, terminalState) {
    if (!turnId || activity.turnId !== turnId || !isLiveAgentActivityStatus(activity.status))
        return activity;
    return { ...activity, status: unconfirmedChildStatus(activity.kind, terminalState) };
}
function settlePart(part, turnId, terminalState) {
    if (!turnId || part.turnId !== turnId)
        return part;
    if (part.kind === "assistant")
        return { ...part, streaming: false, terminalState };
    if (part.kind === "permission" || part.kind === "question") {
        return part.state === "pending" ? { ...part, state: "resolved" } : part;
    }
    if (isAgentActivityPart(part) && isLiveAgentActivityStatus(part.status)) {
        return { ...part, status: unconfirmedChildStatus(part.kind, terminalState) };
    }
    return part;
}
function isAgentActivityPart(part) {
    return part.kind === "reasoning"
        || part.kind === "plan"
        || part.kind === "tool"
        || part.kind === "command"
        || part.kind === "file-change"
        || part.kind === "warning"
        || part.kind === "error";
}

function unconfirmedChildStatus(kind, terminalState) {
    // The parent ending is not proof that an unfinished native tool succeeded.
    return ["tool", "command", "file-change"].includes(kind) ? "unknown" : agentActivityTerminalStatus(terminalState);
}
