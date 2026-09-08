import { describe, expect, it, vi } from "vitest";
import {
  codexHistoryReaderLimits,
  readCodexHistory,
  readCodexPaginatedHistory,
  requestCodexMetadataOnlyThread,
} from "../electron/main/agent/runtimes/codex/codex-history-reader.mjs";

describe("Codex paginated history reader", () => {
  it("falls back to legacy thread/read only when the paginated method is unavailable", async () => {
    const request = vi.fn(async (method) => {
      if (method === "thread/turns/list") {
        throw new Error("thread/turns/list: Method not found (-32601)");
      }
      if (method === "thread/read") {
        return { thread: { id: "legacy", turns: [{ id: "turn-1", items: [] }] } };
      }
      return {};
    });

    await expect(readCodexHistory({ request, threadId: "legacy" })).resolves.toMatchObject({
      id: "legacy",
      turns: [{ id: "turn-1", items: [] }],
    });
    expect(request).toHaveBeenLastCalledWith("thread/read", {
      threadId: "legacy",
      includeTurns: true,
    });
  });

  it("does not downgrade an arbitrary pagination failure to deprecated hydration", async () => {
    const request = vi.fn(async () => {
      throw new Error("thread/turns/list transport closed");
    });
    await expect(readCodexHistory({ request, threadId: "thread-1" }))
      .rejects.toThrow(/transport closed/i);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects repeated cursors instead of looping forever", async () => {
    const request = vi.fn(async () => ({
      data: [{ id: `turn-${request.mock.calls.length}`, items: [], itemsView: "full", status: "completed" }],
      nextCursor: "same-cursor",
    }));

    await expect(readCodexPaginatedHistory({ request, threadId: "thread-1" }))
      .rejects.toThrow(/repeated pagination cursor/i);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("retries resume without excludeTurns only for an older server rejecting that field", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("Invalid params: unknown field `excludeTurns`"))
      .mockResolvedValueOnce({ thread: { id: "thread-1" } });

    await expect(requestCodexMetadataOnlyThread({
      request,
      method: "thread/resume",
      params: { threadId: "thread-1" },
    })).resolves.toEqual({ thread: { id: "thread-1" } });
    expect(request.mock.calls).toEqual([
      ["thread/resume", { threadId: "thread-1", excludeTurns: true }],
      ["thread/resume", { threadId: "thread-1" }],
    ]);
  });

  it("marks an oversized final native page as partial even without a cursor", async () => {
    const request = vi.fn(async () => ({ data: Array.from({ length: codexHistoryReaderLimits.maxTurns + 1 }, (_, i) => ({
      id: `turn-${i}`, items: [], itemsView: "full",
    })), nextCursor: null }));
    const result = await readCodexPaginatedHistory({ request, threadId: "thread-1" });
    expect(result.coverage).toBe("partial");
    expect(result.turns).toHaveLength(codexHistoryReaderLimits.maxTurns);
  });

  it("rejects item pages belonging to another turn", async () => {
    const request = vi.fn(async (method) => method === "thread/turns/list"
      ? { data: [{ id: "turn-1", itemsView: "summary", items: [] }], nextCursor: null }
      : { data: [{ turnId: "wrong-turn", item: { id: "message", type: "agentMessage", text: "Wrong" } }], nextCursor: null });
    await expect(readCodexPaginatedHistory({ request, threadId: "thread-1" })).rejects.toThrow(/item identity/);
  });

  it("keeps the native paging window below the renderer replay event budget", () => {
    expect(codexHistoryReaderLimits.maxProjectedEvents).toBeLessThan(1_000);
    expect(codexHistoryReaderLimits.turnPageSize).toBeLessThanOrEqual(50);
    expect(codexHistoryReaderLimits.itemPageSize).toBeLessThanOrEqual(100);
    expect(codexHistoryReaderLimits.maxTurns).toBeGreaterThanOrEqual(100);
  });

  it("preserves the summary prompt when a very large turn page contains only recent items", async () => {
    const summaryPrompt = {
      id: "prompt-1",
      type: "userMessage",
      content: [{ type: "text", text: "original prompt" }],
    };
    const request = vi.fn(async (method) => {
      if (method === "thread/turns/list") {
        return {
          data: [{
            id: "large-turn",
            status: "completed",
            itemsView: "summary",
            items: [summaryPrompt],
          }],
          nextCursor: null,
        };
      }
      return {
        data: Array.from({ length: codexHistoryReaderLimits.maxItemsPerTurn }, (_, index) => ({
          turnId: "large-turn",
          item: { id: `answer-${index}`, type: "agentMessage", text: `answer ${index}` },
        })),
        nextCursor: null,
      };
    });

    const history = await readCodexPaginatedHistory({ request, threadId: "thread-1" });

    expect(history.turns[0].items).toHaveLength(codexHistoryReaderLimits.maxItemsPerTurn);
    expect(history.turns[0].items[0]).toEqual(summaryPrompt);
  });

  it("keeps the newest whole turns when a long thread exceeds the event budget", async () => {
    const allTurns = Array.from({ length: 200 }, (_, index) => ({
      id: `turn-${199 - index}`,
      status: "completed",
      itemsView: "full",
      items: Array.from({ length: 5 }, (__, itemIndex) => ({
        id: `change-${index}-${itemIndex}`,
        type: "fileChange",
        changes: [],
      })),
    }));
    const request = vi.fn(async (_method, params) => {
      const offset = params.cursor ? Number(params.cursor) : 0;
      const data = allTurns.slice(offset, offset + params.limit);
      const nextOffset = offset + data.length;
      return { data, nextCursor: nextOffset < allTurns.length ? String(nextOffset) : null };
    });

    const history = await readCodexPaginatedHistory({ request, threadId: "long-thread" });

    expect(history.turns.length).toBeGreaterThan(0);
    expect(history.turns.length).toBeLessThan(200);
    expect(history.turns.at(-1).id).toBe("turn-199");
    expect(history.turns[0].id).toBe(`turn-${200 - history.turns.length}`);
    const projectedCost = history.turns.reduce((count, turn) => count + 2 + turn.items.length * 2, 0);
    expect(projectedCost).toBeLessThanOrEqual(codexHistoryReaderLimits.maxProjectedEvents);
  });
});
