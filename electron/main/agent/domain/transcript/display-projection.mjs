import { projectionIndexes } from "./transcript-indexes.mjs";
import { activityId, pickSafeActivityDetail, pickUsage, readProviderMessage, readString, } from "./content-readers.mjs";
import { isNonDiagnosticProviderStatusMessage, legacyProviderConnectionUpdate, providerActivityIdentity, } from "./provider-notice-policy.mjs";
import { parseAgentEventTime, readAgentTurnDurationMs } from "./turn-timing.mjs";
import { agentTurnTerminalState } from "./turn-lifecycle.mjs";
export function projectTypedPart(projection, event, options = {}) {
    if (event.type === "provider.connection.updated")
        return;
    const turn = updateTurn(projection, event);
    const part = partForEvent(projection, event, options);
    if (!part)
        return;
    const indexes = projectionIndexes(projection);
    const existingIndex = indexes.parts.get(part.id);
    const existingPart = existingIndex === undefined ? null : projection.parts[existingIndex];
    const projectedPart = {
        ...part,
        sequence: existingPart?.sequence ?? part.sequence,
        updatedSequence: event.sequence,
    };
    if (existingIndex !== undefined)
        projection.parts[existingIndex] = projectedPart;
    else {
        indexes.parts.set(projectedPart.id, projection.parts.length);
        projection.parts.push(projectedPart);
    }
    if (turn && !turn.partIds.includes(projectedPart.id)) {
        const turnIndex = indexes.turns.get(turn.id);
        const nextTurn = { ...turn, partIds: [...turn.partIds, projectedPart.id] };
        if (turnIndex !== undefined)
            projection.turns[turnIndex] = nextTurn;
    }
    // Usage is session metadata, not visible transcript content. Keep the typed
    // part for consumers that need it, but never allocate virtual-list geometry.
    if (projectedPart.kind === "usage")
        return;
    const rowId = `row:${projectedPart.id}`;
    const rowIndex = indexes.rows.get(rowId);
    const existingRow = rowIndex === undefined ? null : projection.rows[rowIndex];
    const row = {
        id: rowId,
        partId: projectedPart.id,
        turnId: projectedPart.turnId,
        kind: projectedPart.kind,
        sequence: existingRow?.sequence ?? projectedPart.sequence,
        updatedSequence: event.sequence,
        estimatedHeight: estimatePartHeight(projectedPart),
    };
    if (rowIndex !== undefined)
        projection.rows[rowIndex] = row;
    else {
        indexes.rows.set(row.id, projection.rows.length);
        projection.rows.push(row);
    }
}
function updateTurn(projection, event) {
    if (!event.turnId)
        return null;
    const indexes = projectionIndexes(projection);
    let turnIndex = indexes.turns.get(event.turnId);
    let turn = turnIndex === undefined ? null : projection.turns[turnIndex];
    if (!turn) {
        turn = {
            id: event.turnId,
            status: event.payload?.restored ? "outcome-unknown" : "running",
            startedAtSequence: event.sequence,
            // Main's replay observation time is not native execution time.
            startedAtMs: event.payload?.restored ? null : parseAgentEventTime(event.emittedAt),
            userWaitStartedAtMs: null,
            userWaitDurationMs: 0,
            completedAtSequence: null,
            durationMs: null,
            partIds: [],
        };
        turnIndex = projection.turns.length;
        indexes.turns.set(event.turnId, turnIndex);
        projection.turns.push(turn);
    }
    if (!turn)
        return null;
    const eventAtMs = parseAgentEventTime(event.emittedAt);
    if ((event.type === "approval.requested" || event.type === "question.requested")
        && turn.userWaitStartedAtMs == null
        && eventAtMs !== null) {
        turn = { ...turn, userWaitStartedAtMs: eventAtMs };
    }
    if ((event.type === "approval.resolved" || event.type === "question.resolved")
        && !projection.approvals.some((approval) => approval.turnId === event.turnId)
        && !projection.questions.some((question) => question.turnId === event.turnId)) {
        turn = closeAgentTurnUserWait(turn, eventAtMs);
    }
    if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "turn.interrupted") {
        const terminalState = agentTurnTerminalState(event);
        if (!terminalState)
            return turn;
        turn = closeAgentTurnUserWait(turn, eventAtMs);
        turn = {
            ...turn,
            status: terminalState,
            completedAtSequence: event.sequence,
            durationMs: readAgentTurnDurationMs(event.payload.durationMs, turn.startedAtMs, event.emittedAt),
            ...(terminalState === "completed" ? completedTurnQuality(event.payload) : {}),
        };
    }
    if (turnIndex !== undefined)
        projection.turns[turnIndex] = turn;
    return turn;
}
function completedTurnQuality(payload) {
    if (payload?.completionQuality !== "degraded") {
        return { completionQuality: "complete", recovery: undefined };
    }
    const failureScope = ["child-task", "tool", "upstream-request", "turn"].includes(payload.failureScope)
        ? payload.failureScope : "turn";
    const transportHealth = ["healthy", "recovering", "exited", "unknown"].includes(payload.transportHealth)
        ? payload.transportHealth : "unknown";
    const sideEffects = ["none", "possible", "confirmed", "unknown"].includes(payload.sideEffects)
        ? payload.sideEffects : "unknown";
    const code = readString(payload.failureCode) || "DEGRADED_COMPLETION";
    const diagnostic = readString(payload.diagnostic);
    return {
        completionQuality: "degraded",
        recovery: {
            kind: "degraded-completion",
            failureScope,
            code,
            retryable: typeof payload.retryable === "boolean" ? payload.retryable : null,
            transportHealth,
            sideEffects,
            ...(diagnostic ? { diagnostic } : {}),
        },
    };
}
function closeAgentTurnUserWait(turn, eventAtMs) {
    const waitStartedAtMs = turn.userWaitStartedAtMs ?? null;
    if (waitStartedAtMs === null)
        return turn;
    const elapsed = eventAtMs !== null && eventAtMs >= waitStartedAtMs
        ? eventAtMs - waitStartedAtMs
        : 0;
    return {
        ...turn,
        userWaitStartedAtMs: null,
        userWaitDurationMs: (turn.userWaitDurationMs ?? 0) + elapsed,
    };
}
function partForEvent(projection, event, options) {
    if (event.type === "turn.started") {
        const indexes = projectionIndexes(projection);
        const message = (event.turnId ? indexes.messagesByTurn.get(event.turnId) ?? [] : [])
            .map((index) => projection.messages[index])
            .find((entry) => entry?.role === "user");
        return message ? messagePart(message) : null;
    }
    if (event.type === "assistant.delta" || event.type === "assistant.completed") {
        const baseId = `assistant:${event.itemId ?? event.turnId ?? event.sequence}`;
        const message = [...projection.messages].reverse().find((entry) => (entry.role === "assistant"
            && entry.turnId === event.turnId
            && (event.itemId ? entry.itemId === event.itemId : entry.id === baseId)
            && (entry.updatedSequence ?? entry.sequence) === event.sequence)) ?? null;
        return message ? messagePart(message) : null;
    }
    if (event.type === "user.message") {
        const message = [...projection.messages].reverse().find((entry) => (entry.role === "user"
            && entry.turnId === event.turnId
            && (event.itemId ? entry.itemId === event.itemId : entry.updatedSequence === event.sequence)
            && (entry.updatedSequence ?? entry.sequence) === event.sequence)) ?? null;
        return message ? messagePart(message) : null;
    }
    if (event.type === "reasoning.summary.delta" || event.type === "plan.updated"
        || event.type.startsWith("tool.") || event.type === "command.output.delta"
        || event.type === "file.change.updated" || event.type === "provider.activity") {
        const activityIndex = projectionIndexes(projection).activities.get(activityId(event));
        const activity = activityIndex === undefined ? null : projection.activities[activityIndex];
        return activity ? activityPart(activity) : null;
    }
    if (event.type === "provider.warning" || event.type === "provider.error") {
        const label = readProviderMessage(event.payload.message);
        if (options.legacyProviderConnectionWarnings && legacyProviderConnectionUpdate(event, label))
            return null;
        if (label && isNonDiagnosticProviderStatusMessage(label))
            return null;
        const activityIndex = projectionIndexes(projection).activities.get(providerActivityIdentity(projection, event, label || (event.type === "provider.error" ? "error" : "warning")).id);
        const activity = activityIndex === undefined ? null : projection.activities[activityIndex];
        return activity ? activityPart(activity) : null;
    }
    if (event.type === "usage.updated") {
        return {
            id: "usage:current",
            turnId: event.turnId,
            itemId: event.itemId,
            kind: "usage",
            usage: pickUsage(event.payload),
            sequence: event.sequence,
            updatedSequence: event.sequence,
        };
    }
    if (event.type === "approval.requested" || event.type === "approval.resolved") {
        const requestId = readString(event.payload.requestId);
        if (!requestId)
            return null;
        return {
            id: `permission:${requestId}`,
            turnId: event.turnId,
            itemId: event.itemId,
            kind: "permission",
            requestId,
            state: event.type.endsWith("resolved") ? "resolved" : "pending",
            sequence: event.sequence,
            updatedSequence: event.sequence,
        };
    }
    if (event.type === "question.requested" || event.type === "question.resolved") {
        const requestId = readString(event.payload.requestId);
        if (!requestId)
            return null;
        return {
            id: `question:${requestId}`,
            turnId: event.turnId,
            itemId: event.itemId,
            kind: "question",
            requestId,
            state: event.type.endsWith("resolved") ? "resolved" : "pending",
            sequence: event.sequence,
            updatedSequence: event.sequence,
        };
    }
    if (event.type.startsWith("session.") || event.type.startsWith("turn."))
        return null;
    return {
        id: `unknown:${event.type}:${event.itemId ?? event.sequence}`,
        turnId: event.turnId,
        itemId: event.itemId,
        kind: "unknown",
        eventType: event.type,
        label: "",
        labelCode: "unsupported-event",
        sequence: event.sequence,
        updatedSequence: event.sequence,
    };
}
function messagePart(message) {
    return { ...message, kind: message.role };
}
function activityPart(activity) {
    return { ...activity, detail: pickSafeActivityDetail(activity.detail) };
}
function estimatePartHeight(part) {
    if (part.kind === "user")
        return 64;
    if (part.kind === "assistant")
        return Math.min(640, 50 + Math.ceil(part.text.length / 64) * 20);
    if (part.kind === "turn-summary")
        return 32;
    if (part.kind === "permission" || part.kind === "question" || part.kind === "usage")
        return 36;
    return 42;
}
