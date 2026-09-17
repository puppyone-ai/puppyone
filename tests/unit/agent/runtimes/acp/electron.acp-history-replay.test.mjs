import { describe, expect, it } from "vitest";
import {
  applyAgentEvents,
  createAgentProjection,
} from "../../../../../electron/main/agent/domain/transcript/transcript-reducer.mjs";
import { AcpEventNormalizer } from "../../../../../electron/main/agent/protocols/acp/acp-event-normalizer.mjs";
import { AcpHistoryReplay } from "../../../../../electron/main/agent/protocols/acp/acp-history-replay.mjs";

describe("ACP history replay", () => {
  it("uses the live normalizer for messages, tool patches, output and file changes", () => {
    const notifications = fixtureNotifications();
    const replay = new AcpHistoryReplay();
    for (const notification of notifications) replay.accept(notification);

    const live = new AcpEventNormalizer({ turnId: "history-user-1" });
    const liveEvents = notifications.slice(1).flatMap((notification) => live.normalize(notification));
    liveEvents.push(...live.completeAssistant("session-1"));

    const historyEvents = replay.events("session-1");
    expect(historyEvents[0]).toEqual({
      type: "turn.started",
      providerSessionId: "session-1",
      turnId: "history-user-1",
      itemId: null,
      payload: { prompt: "Inspect the file", restored: true, userMessageId: "user-1" },
    });
    expect(historyEvents.slice(1)).toEqual(liveEvents);
    expect(historyEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool.started", itemId: "search-1" }),
      expect.objectContaining({
        type: "tool.completed",
        itemId: "search-1",
        payload: expect.objectContaining({
          kind: "search",
          input: { query: "needle" },
          outputPreview: "1 match",
        }),
      }),
      expect.objectContaining({ type: "file.change.updated", itemId: "edit-1" }),
      expect.objectContaining({ type: "assistant.completed", itemId: "assistant-1" }),
    ]));

    const projection = applyAgentEvents(createAgentProjection(), historyEvents.map((event, index) => ({
      ...event,
      sequence: index + 1,
      emittedAt: new Date(index * 1_000).toISOString(),
    })));
    expect(projection.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", text: "Inspect the file" }),
      expect.objectContaining({ role: "assistant", text: "Checking.", streaming: false }),
    ]));
    expect(projection.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: "search-1",
        status: "completed",
        detail: expect.objectContaining({ input: { query: "needle" }, outputPreview: "1 match" }),
      }),
      expect.objectContaining({ itemId: "edit-1", kind: "file-change", status: "completed" }),
    ]));
  });

  it("creates stable turn boundaries without inventing terminal turn events", () => {
    const replay = new AcpHistoryReplay();
    for (const notification of [
      update("session-1", { sessionUpdate: "user_message_chunk", messageId: "user-1", content: { type: "text", text: "First" } }),
      update("session-1", { sessionUpdate: "agent_message_chunk", messageId: "assistant-1", content: { type: "text", text: "One" } }),
      update("session-1", { sessionUpdate: "user_message_chunk", messageId: "user-2", content: { type: "text", text: "Second" } }),
      update("session-1", { sessionUpdate: "agent_message_chunk", messageId: "assistant-2", content: { type: "text", text: "Two" } }),
    ]) replay.accept(notification);

    const events = replay.events("session-1");
    expect(events.filter((event) => event.type === "turn.started").map((event) => ({
      turnId: event.turnId,
      prompt: event.payload.prompt,
    }))).toEqual([
      { turnId: "history-user-1", prompt: "First" },
      { turnId: "history-user-2", prompt: "Second" },
    ]);
    expect(events.some((event) => ["turn.completed", "turn.failed", "turn.interrupted"].includes(event.type))).toBe(false);
  });
});

function fixtureNotifications() {
  return [
    update("session-1", {
      sessionUpdate: "user_message_chunk",
      messageId: "user-1",
      content: { type: "text", text: "Inspect the file" },
    }),
    update("session-1", {
      sessionUpdate: "agent_message_chunk",
      messageId: "assistant-1",
      content: { type: "text", text: "Checking." },
    }),
    update("session-1", {
      sessionUpdate: "tool_call",
      toolCallId: "search-1",
      kind: "search",
      title: "Search workspace",
      status: "pending",
      rawInput: { query: "needle" },
    }),
    update("session-1", {
      sessionUpdate: "tool_call_update",
      toolCallId: "search-1",
      status: "completed",
      rawOutput: "1 match",
    }),
    update("session-1", {
      sessionUpdate: "tool_call",
      toolCallId: "edit-1",
      kind: "edit",
      title: "Edit file",
      status: "pending",
      rawInput: { path: "src/example.ts", oldString: "old", newString: "new" },
      content: [{ type: "diff", path: "src/example.ts", oldText: "old", newText: "new" }],
    }),
    update("session-1", {
      sessionUpdate: "tool_call_update",
      toolCallId: "edit-1",
      status: "completed",
    }),
  ];
}

function update(sessionId, value) {
  return { sessionId, update: value };
}
