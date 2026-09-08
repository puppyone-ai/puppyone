import { stringOrNull } from "./codex-native-values.mjs";
import { readCodexUserMessageText, normalizeItemLifecycle, normalizeTurnStatus } from "./codex-events.mjs";

export function normalizeHistoricalThread(thread) {
  const events = [];
  if (!thread || !Array.isArray(thread.turns)) return events;
  for (const turn of thread.turns) {
    const turnId = stringOrNull(turn?.id);
    const items = Array.isArray(turn?.items) ? turn.items : [];
    // turn.started retains the first prompt for older projection consumers.
    // Every native user item is also normalized below with its own identity;
    // follow-ups must never be flattened into the initial turn prompt.
    const firstUserMessage = items.find((item) => item?.type === "userMessage");
    const prompt = readCodexUserMessageText(firstUserMessage);
    const userMessageId = stringOrNull(firstUserMessage?.id);
    events.push({
      type: "turn.started",
      providerSessionId: thread.id,
      turnId,
      payload: {
        status: "running",
        restored: true,
        ...(prompt ? { prompt } : {}),
        ...(userMessageId ? { userMessageId } : {}),
      },
    });
    for (const item of items) {
      events.push(...normalizeItemLifecycle(item, "completed", thread.id, turnId));
    }
    const type = historicalTerminalEventType(turn.status);
    if (type) {
      events.push({ type, providerSessionId: thread.id, turnId, payload: { status: normalizeTurnStatus(turn.status), restored: true } });
    }
  }
  return events;
}

export function historicalTerminalEventType(status) {
  if (status === "completed") return "turn.completed";
  if (status === "failed") return "turn.failed";
  if (status === "interrupted") return "turn.interrupted";
  return null;
}
