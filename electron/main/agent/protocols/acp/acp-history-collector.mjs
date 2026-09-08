/**
 * Process-local projection of history replayed by `session/load`.
 *
 * ACP Agents remain the transcript authority. The collector exists only long
 * enough to translate replay notifications into PuppyOne's renderer contract;
 * it has no persistence path and deliberately ignores thoughts and tool data.
 */
export class AcpHistoryCollector {
  constructor() {
    this.turns = [];
    this.truncated = false;
    this.current = null;
    this.messageIndex = new Map();
  }

  accept(notification) {
    const update = notification?.update;
    const role = update?.sessionUpdate === "user_message_chunk"
      ? "user"
      : update?.sessionUpdate === "agent_message_chunk"
        ? "assistant"
        : null;
    if (!role) return;
    const delta = contentText(update.content);
    if (!delta) return;
    const messageId = safeId(update.messageId) ?? `${role}-${this.messageIndex.size + 1}`;
    const existing = this.messageIndex.get(messageId);
    if (existing) {
      if (existing.message.text.length + delta.length > 32 * 1024) this.truncated = true;
      existing.message.text = appendBounded(existing.message.text, delta);
      if (existing.message.role === "user") existing.turn.prompt = existing.message.text;
      return;
    }
    if (this.messageIndex.size >= 256) { this.truncated = true; return; }
    if (role === "user" || !this.current) {
      if (this.turns.length >= 128) { this.truncated = true; return; }
      this.current = { id: `history-${safeId(messageId) ?? this.turns.length + 1}`, prompt: "", answers: [] };
      this.turns.push(this.current);
    }
    const message = { id: messageId, role, text: delta };
    this.messageIndex.set(messageId, { message, turn: this.current });
    if (role === "user") this.current.prompt = delta;
    else this.current.answers.push(message);
  }

  events(providerSessionId) {
    return this.turns.flatMap((turn) => {
      const events = [{
        type: "turn.started",
        providerSessionId,
        turnId: turn.id,
        itemId: null,
        payload: { prompt: turn.prompt, restored: true },
      }];
      for (const answer of turn.answers) events.push({
        type: "assistant.completed",
        providerSessionId,
        turnId: turn.id,
        itemId: answer.id,
        payload: { text: answer.text },
      });
      return events;
    });
  }
}

function contentText(content) {
  if (content?.type === "text" && typeof content.text === "string") return content.text.slice(0, 32 * 1024);
  if (content?.type === "resource" && typeof content.resource?.text === "string") return content.resource.text.slice(0, 32 * 1024);
  return "";
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/.test(value) ? value : null;
}

function appendBounded(previous, delta) {
  return `${previous}${delta}`.slice(0, 32 * 1024);
}
