import { fakeSessionFeed } from "./helpers/nativeSmokeFeed.mjs";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  NativeAgentRoundtripError,
  runNativeAgentRoundtrip,
} from "../scripts/native-agent-roundtrip-runner.mjs";

describe("native Agent round-trip smoke runner", () => {
  it.each(["codex", "claude", "cursor", "opencode-native", "pi"])(
    "verifies the complete %s create, answer, locator, exact resume, follow-up and close contract",
    async (runtimeId) => {
      const sender = smokeSender();
      const feed = fakeSessionFeed(sender);
      let turn = 0;
      const service = {
        ...feed.methods,
        createSession: vi.fn(async () => snapshot("product-session", runtimeId)),
        startTurn: vi.fn(async (_sender, request) => {
          turn += 1;
          const token = request.prompt.match(/PUPPYONE_SMOKE_[A-Z0-9_]+/u)?.[0];
          queueMicrotask(() => {
            feed.publish([
              event(request.sessionId, "user.message", { text: request.prompt }, `turn-${turn}`, runtimeId),
              event(request.sessionId, "assistant.completed", { text: token }, `turn-${turn}`, runtimeId),
              event(request.sessionId, "turn.completed", { status: "completed" }, `turn-${turn}`, runtimeId),
            ]);
          });
          return { sessionId: request.sessionId, turnId: `turn-${turn}` };
        }),
        closeSession: vi.fn(async (_sender, request) => ({ sessionId: request.sessionId, closed: true })),
        listSessions: vi.fn(async () => ({
          sessions: [{ id: "product-session", runtimeId, providerSessionId: "native-thread" }],
          discovery: { status: "not-requested", nextCursor: null, indexed: 0, warnings: [] },
          warnings: [],
        })),
        resumeSession: vi.fn(async () => snapshot("product-session", runtimeId)),
      };

      await expect(runNativeAgentRoundtrip({
        service,
        sender,
        workspaceRoot: "/workspace",
        runtimeId,
        timeoutMs: 1_000,
        tokenFactory: (index) => `PUPPYONE_SMOKE_TEST_${index}`,
      })).resolves.toEqual({
        runtimeId,
        status: "passed",
        checks: ["create", "first-answer", "locator", "resume", "follow-up", "close"],
      });

      expect(service.listSessions).toHaveBeenCalledWith(sender, {
        runtimeId,
        discoverNative: false,
        includeArchived: false,
      }, "/workspace");
      expect(service.resumeSession).toHaveBeenCalledWith(sender, {
        sessionId: "product-session",
        runtimeId,
      }, "/workspace");
      expect(service.startTurn).toHaveBeenCalledTimes(2);
    },
  );

  it("fails closed when a runtime completes without the requested answer token", async () => {
    const sender = smokeSender();
    const feed = fakeSessionFeed(sender);
    const service = {
      ...feed.methods,
      createSession: vi.fn(async () => snapshot("product-session")),
      startTurn: vi.fn(async (_sender, request) => {
        queueMicrotask(() => {
          feed.publish([
            event(request.sessionId, "user.message", { text: request.prompt }, "turn-1"),
            event(request.sessionId, "assistant.completed", { text: "wrong answer" }, "turn-1"),
            event(request.sessionId, "turn.completed", { status: "completed" }, "turn-1"),
          ]);
        });
        return { sessionId: request.sessionId, turnId: "turn-1" };
      }),
      closeSession: vi.fn(async (_sender, request) => ({ sessionId: request.sessionId, closed: true })),
    };

    await expect(runNativeAgentRoundtrip({
      service,
      sender,
      workspaceRoot: "/workspace",
      runtimeId: "codex",
      timeoutMs: 1_000,
      tokenFactory: () => "PUPPYONE_SMOKE_EXPECTED",
    })).rejects.toMatchObject({
      name: NativeAgentRoundtripError.name,
      runtimeId: "codex",
      stage: "first-answer",
      code: "runtime",
    });
    expect(service.closeSession).toHaveBeenCalled();
  });

  it("maps raw provider failures to a bounded code without retaining diagnostics", async () => {
    const sender = smokeSender();
    const service = {
      createSession: vi.fn(async () => {
        throw new Error("authentication failed at /Users/example/private-workspace");
      }),
      closeSession: vi.fn(),
    };

    const failure = await runNativeAgentRoundtrip({
      service,
      sender,
      workspaceRoot: "/workspace",
      runtimeId: "codex",
      timeoutMs: 1_000,
    }).catch((error) => error);

    expect(failure).toMatchObject({
      name: "NativeAgentRoundtripError",
      runtimeId: "codex",
      stage: "create",
      code: "authentication",
    });
    expect(failure).not.toHaveProperty("cause");
    expect(failure.message).not.toContain("private-workspace");
  });

  it("fails closed when the canonical feed omits the submitted user message", async () => {
    const sender = smokeSender();
    const feed = fakeSessionFeed(sender);
    const service = {
      ...feed.methods,
      createSession: vi.fn(async () => snapshot("product-session")),
      startTurn: vi.fn(async (_sender, request) => {
        queueMicrotask(() => feed.publish([
          event(request.sessionId, "assistant.completed", { text: "PUPPYONE_SMOKE_EXPECTED" }, "turn-1"),
          event(request.sessionId, "turn.completed", { status: "completed" }, "turn-1"),
        ]));
        return { sessionId: request.sessionId, turnId: "turn-1" };
      }),
      closeSession: vi.fn(async (_sender, request) => ({ sessionId: request.sessionId, closed: true })),
    };

    await expect(runNativeAgentRoundtrip({
      service,
      sender,
      workspaceRoot: "/workspace",
      runtimeId: "codex",
      timeoutMs: 1_000,
      tokenFactory: () => "PUPPYONE_SMOKE_EXPECTED",
    })).rejects.toMatchObject({ stage: "first-answer", code: "runtime" });
  });
});

function smokeSender() {
  const sender = new EventEmitter();
  sender.id = 1;
  sender.isDestroyed = () => false;
  sender.send = (channel, payload) => sender.emit(channel, payload);
  return sender;
}

function snapshot(id, runtimeId = "codex") {
  return { session: { id, runtimeId, providerSessionId: "native-thread" } };
}

function event(sessionId, type, payload, turnId, runtimeId = "codex") {
  return { sessionId, runtimeId, type, payload, turnId };
}
