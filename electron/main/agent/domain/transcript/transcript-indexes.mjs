const PROJECTION_INDEXES = Symbol("agentProjectionIndexes");
/** Lazily rebuilds non-serializable indexes on replayed or cloned projections. */
export function projectionIndexes(projection) {
    const holder = projection;
    if (holder[PROJECTION_INDEXES])
        return holder[PROJECTION_INDEXES];
    const messagesByTurn = new Map();
    projection.messages.forEach((message, index) => {
        if (message.turnId)
            messagesByTurn.set(message.turnId, [...(messagesByTurn.get(message.turnId) ?? []), index]);
    });
    const indexes = {
        messages: new Map(projection.messages.map((message, index) => [message.id, index])),
        messagesByTurn,
        activities: new Map(projection.activities.map((activity, index) => [activity.id, index])),
        turns: new Map(projection.turns.map((turn, index) => [turn.id, index])),
        parts: new Map(projection.parts.map((part, index) => [part.id, index])),
        rows: new Map(projection.rows.map((row, index) => [row.id, index])),
    };
    Object.defineProperty(holder, PROJECTION_INDEXES, { value: indexes, configurable: true });
    return indexes;
}
export function invalidateProjectionIndexes(projection) {
    const holder = projection;
    Reflect.deleteProperty(holder, PROJECTION_INDEXES);
}
export function cloneAgentProjection(value) {
    return {
        ...value,
        missingRanges: [...value.missingRanges],
        messages: [...value.messages],
        activities: [...value.activities],
        approvals: [...value.approvals],
        questions: [...value.questions],
        turns: [...value.turns],
        parts: [...value.parts],
        rows: [...value.rows],
        connectionStatus: value.connectionStatus ? { ...value.connectionStatus } : null,
    };
}
