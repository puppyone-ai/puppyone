import { describe, expect, it } from "vitest";
import {
  agentRendererValueLimits,
  boundRendererValue,
  createAgentEventEnvelope,
  isAgentEventEnvelope,
  redactSecretText,
  redactSecrets,
} from "../electron/main/agent/agent-events.mjs";

describe("normalized AgentEvent envelopes", () => {
  it("validates a versioned normalized event and rejects unknown vocabulary", () => {
    const event = createAgentEventEnvelope({
      sequence: 1,
      sessionId: "session-1",
      runtimeId: "fake-runtime",
      type: "assistant.delta",
      payload: { delta: "hello" },
    });
    expect(isAgentEventEnvelope(event)).toBe(true);
    expect(() => createAgentEventEnvelope({
      sequence: 2,
      sessionId: "session-1",
      runtimeId: "fake-runtime",
      type: "codex/raw/event",
    })).toThrow(/Agent contract.*not supported/i);
    expect(() => createAgentEventEnvelope({
      sequence: 2,
      sessionId: "session-1",
      runtimeId: "fake-runtime",
      providerSessionId: "x".repeat(257),
      type: "assistant.delta",
    })).toThrow(/invalid normalized/i);
  });

  it("bounds hostile object shapes before renderer delivery", () => {
    const payload = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"label":"ok","unknown":"drop"}');
    const event = createAgentEventEnvelope({
      sequence: 1,
      sessionId: "session-1",
      runtimeId: "fake-runtime",
      type: "tool.completed",
      payload,
    });
    expect(event.payload).toEqual({ label: "ok" });
    expect({}.polluted).toBeUndefined();
  });

  it("applies one aggregate text and node budget across nested renderer payloads", () => {
    const chunk = "x".repeat(32 * 1024);
    const payload = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [
      `branch-${index}`,
      Array.from({ length: 200 }, () => chunk),
    ]));
    const bounded = boundRendererValue(payload);
    const serialized = JSON.stringify(bounded);

    expect(serialized.length).toBeLessThan(agentRendererValueLimits.maxTotalText + 40_000);
    expect(serialized).toContain("truncated");
  });

  it("terminates cyclic provider payloads before IPC delivery", () => {
    const payload = { label: "safe" };
    payload.self = payload;
    payload.children = [payload];

    expect(boundRendererValue(payload)).toEqual({
      label: "safe",
      self: "[circular]",
      children: ["[circular]"],
    });
  });

  it("redacts common credential shapes recursively before renderer delivery", () => {
    const redacted = redactSecrets({
      authorization: "Bearer abcdefghijklmnopqrstuvwxyz",
      nested: { apiKey: "sk-abcdefghijklmnopqrstuvwxyz" },
      message: "refresh_token=secret-value",
    });
    expect(JSON.stringify(redacted)).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(JSON.stringify(redacted)).not.toContain("secret-value");
    expect(redactSecretText("Bearer abcdefghijklmnopqrstuvwxyz")).toBe("Bearer [redacted]");
  });

  it("preserves token usage metrics while redacting common environment secrets", () => {
    const redacted = redactSecrets({
      tokenUsage: {
        inputTokens: 1200,
        cachedInputTokens: 400,
        outputTokens: 88,
        totalTokens: 1288,
      },
      accessToken: "secret-access-token",
    });
    expect(redacted.tokenUsage).toEqual({
      inputTokens: 1200,
      cachedInputTokens: 400,
      outputTokens: 88,
      totalTokens: 1288,
    });
    expect(redacted.accessToken).toBe("[redacted]");
    expect(redactSecretText("AWS_SECRET_ACCESS_KEY=very-secret-value")).toBe("AWS_SECRET_ACCESS_KEY=[redacted]");
    expect(redactSecretText("CLIENT_SECRET=very-secret-value")).toBe("CLIENT_SECRET=[redacted]");
  });
});
