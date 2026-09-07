import { describe, expect, it, vi } from "vitest";
import { createAgentSessionRepository } from "../electron/main/agent/persistence/agent-session-repository.mjs";

describe("Agent session repository durability boundary", () => {
  it("keeps allocated empty sessions process-local until a durable checkpoint", async () => {
    const eventCache = cacheFixture();
    const conversationCatalog = catalogFixture();
    const repository = createAgentSessionRepository({ eventCache, conversationCatalog });

    await repository.save({ sessionId: "empty" }, { promoteCatalog: false });
    expect(eventCache.save).toHaveBeenCalledWith({ sessionId: "empty" });
    expect(conversationCatalog.save).not.toHaveBeenCalled();

    await repository.save({ sessionId: "durable" }, { promoteCatalog: true });
    expect(conversationCatalog.save).toHaveBeenCalledWith({
      sessionId: "durable",
      availability: "available",
    });
  });

  it("preserves process-local replay when discovery changes catalog availability", async () => {
    const eventCache = cacheFixture();
    const conversationCatalog = catalogFixture();
    conversationCatalog.reconcileNative.mockResolvedValueOnce({ unavailableSessionIds: ["stale-a", "stale-b"] });
    const repository = createAgentSessionRepository({ eventCache, conversationCatalog });

    await repository.reconcileNative({ workspaceRoot: "/workspace", runtimeId: "cursor", providerSessionIds: [] });
    await repository.markUnavailable("stale-a");
    expect(eventCache.remove).not.toHaveBeenCalled();
    await repository.remove("stale-a");
    expect(eventCache.remove).toHaveBeenCalledWith("stale-a");
  });

  it("joins live replay with the catalog's authoritative availability for exact open", async () => {
    const eventCache = cacheFixture();
    const conversationCatalog = catalogFixture();
    eventCache.findById.mockResolvedValueOnce({ sessionId: "durable", events: [{ type: "turn.started" }] });
    conversationCatalog.findById.mockResolvedValueOnce({
      sessionId: "durable",
      providerSessionId: "native-thread",
      availability: "available",
    });
    const repository = createAgentSessionRepository({ eventCache, conversationCatalog });

    await expect(repository.findById("durable", "/workspace")).resolves.toEqual({
      sessionId: "durable",
      providerSessionId: "native-thread",
      events: [{ type: "turn.started" }],
      availability: "available",
    });
  });
});

function cacheFixture() {
  return {
    save: vi.fn(async () => undefined),
    findById: vi.fn(async () => null),
    findLatest: vi.fn(async () => null),
    archive: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    readAll: vi.fn(() => []),
    clear: vi.fn(),
  };
}

function catalogFixture() {
  return {
    save: vi.fn(async () => undefined),
    upsertNative: vi.fn(async () => undefined),
    reconcileNative: vi.fn(async () => ({ unavailableSessionIds: [] })),
    markUnavailable: vi.fn(async () => true),
    findById: vi.fn(async () => null),
    findLatest: vi.fn(async () => null),
    list: vi.fn(async () => []),
    archive: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
}
