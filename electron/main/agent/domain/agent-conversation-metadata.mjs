/** Projects catalog metadata into list rows without loading a Session actor. */
export function publicSessionRecord(record) {
  const runtimeId = record.runtimeId || record.provider;
  if (typeof runtimeId !== "string" || runtimeId.length === 0) {
    throw new TypeError("A public Agent session record requires a migrated runtime id.");
  }
  const sequence = Number(record.lastSequence);
  return {
    id: record.sessionId,
    runtimeId,
    provider: runtimeId,
    runtime: record.runtime ?? null,
    providerSessionId: record.providerSessionId ?? null,
    workspaceRoot: record.workspaceRoot,
    title: record.title || "Agent session",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.updatedAtKnown === false ? { updatedAtKnown: false } : {}),
    archivedAt: record.archivedAt ?? null,
    terminalState: record.terminalState || "idle",
    selectedModel: record.selectedModel ?? null,
    selectedEffort: record.selectedEffort ?? null,
    selectedMode: record.selectedMode ?? null,
    lastSequence: Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0,
    partial: Boolean(record.partial),
    origin: record.origin === "native-discovery" ? "native-discovery" : "puppyone",
  };
}
