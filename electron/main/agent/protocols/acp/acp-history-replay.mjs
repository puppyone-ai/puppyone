import { AcpEventNormalizer } from "./acp-event-normalizer.mjs";

const MAX_HISTORY_TURNS = 128;
const MAX_HISTORY_CONTENT_EVENTS = 9_000;
const MAX_HISTORY_PROMPT_LENGTH = 32 * 1024;

/**
 * Captures `session/load` replay without creating a second ACP content mapper.
 *
 * Replay owns historical turn boundaries, ordering and bounds. Every native
 * content update is still translated by the same AcpEventNormalizer used by
 * live turns. This object is process-local and has no persistence path.
 */
export class AcpHistoryReplay {
  constructor() {
    this.turns = [];
    this.truncated = false;
    this.current = null;
    this.userTurns = new Map();
    this.turnIds = new Set();
    this.acceptingAnonymousUserChunks = false;
    this.contentEventCount = 0;
  }

  accept(notification) {
    const update = notification?.update;
    if (!update || typeof update !== "object") return;
    if (update.sessionUpdate === "user_message_chunk") {
      this.#acceptUserChunk(update);
      return;
    }
    this.acceptingAnonymousUserChunks = false;
    const turn = this.current ?? this.#createTurn(null);
    if (!turn) return;
    this.#appendEvents(turn, turn.normalizer.normalize(notification));
  }

  events(providerSessionId) {
    const result = [];
    for (const turn of this.turns) {
      if (!appendBoundedEvent(result, {
        type: "turn.started",
        providerSessionId,
        turnId: turn.id,
        itemId: null,
        payload: {
          prompt: turn.prompt,
          restored: true,
          ...(turn.userMessageId ? { userMessageId: turn.userMessageId } : {}),
        },
      })) {
        this.truncated = true;
        break;
      }
      for (const historicalEvent of turn.events) {
        if (!appendBoundedEvent(result, historicalEvent)) {
          this.truncated = true;
          break;
        }
      }
      if (result.length >= 10_000) break;
      for (const completion of turn.normalizer.completeAssistant(providerSessionId)) {
        if (!appendBoundedEvent(result, completion)) {
          this.truncated = true;
          break;
        }
      }
      if (result.length >= 10_000) break;
    }
    return result;
  }

  #acceptUserChunk(update) {
    const nativeMessageId = safeId(update.messageId);
    let turn = nativeMessageId ? this.userTurns.get(nativeMessageId) : null;
    if (!turn && !nativeMessageId && this.acceptingAnonymousUserChunks) turn = this.current;
    if (!turn) {
      turn = this.#createTurn(nativeMessageId);
      if (!turn) return;
      if (nativeMessageId) this.userTurns.set(nativeMessageId, turn);
    }
    this.current = turn;
    this.acceptingAnonymousUserChunks = !nativeMessageId;
    const delta = contentText(update.content);
    if (turn.prompt.length + delta.length > MAX_HISTORY_PROMPT_LENGTH) this.truncated = true;
    turn.prompt = appendBounded(turn.prompt, delta, MAX_HISTORY_PROMPT_LENGTH);
  }

  #createTurn(nativeMessageId) {
    if (this.turns.length >= MAX_HISTORY_TURNS) {
      this.truncated = true;
      return null;
    }
    const base = `history-${nativeMessageId ?? this.turns.length + 1}`;
    const id = uniqueId(base, this.turnIds);
    const turn = {
      id,
      userMessageId: nativeMessageId,
      prompt: "",
      events: [],
      normalizer: new AcpEventNormalizer({ turnId: id }),
    };
    this.turnIds.add(id);
    this.turns.push(turn);
    this.current = turn;
    return turn;
  }

  #appendEvents(turn, events) {
    const remaining = MAX_HISTORY_CONTENT_EVENTS - this.contentEventCount;
    if (remaining <= 0) {
      if (events.length > 0) this.truncated = true;
      return;
    }
    const accepted = events.slice(0, remaining);
    turn.events.push(...accepted);
    this.contentEventCount += accepted.length;
    if (accepted.length !== events.length) this.truncated = true;
  }
}

function contentText(content) {
  if (content?.type === "text" && typeof content.text === "string") return content.text;
  if (content?.type === "resource" && typeof content.resource?.text === "string") return content.resource.text;
  if (content?.type === "resource_link") {
    return text(content.title || content.name || content.uri, 4_096);
  }
  return "";
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/.test(value) ? value : null;
}

function uniqueId(base, used) {
  const safeBase = safeId(base) ?? `history-${used.size + 1}`;
  if (!used.has(safeBase)) return safeBase;
  let suffix = 2;
  while (used.has(`${safeBase}-${suffix}`)) suffix += 1;
  return `${safeBase}-${suffix}`;
}

function appendBounded(previous, delta, limit) {
  const remaining = limit - previous.length;
  return remaining > 0 ? `${previous}${delta.slice(0, remaining)}` : previous.slice(0, limit);
}

function appendBoundedEvent(events, value) {
  if (events.length >= 10_000) return false;
  events.push(value);
  return true;
}

function text(value, limit) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}
