import { describe, expect, it } from "vitest";
import type { AgentSessionControl } from "../src/features/desktop-agent/domain/agent-contract";
import { agentStartCommandNeedsTranscriptFallback } from "../src/features/desktop-agent/domain/agent-command-visibility";
import type { AgentTranscriptMessage } from "../src/features/desktop-agent/domain/agent-projection-types";

describe("Agent command transcript fallback", () => {
  it("keeps a direct outcome-unknown input visible without resending it", () => {
    expect(agentStartCommandNeedsTranscriptFallback(command({
      status: "outcome-unknown",
      wasQueued: false,
    }), [])).toBe(true);
  });

  it("recognizes a native user item for an outcome-unknown command by stable identity", () => {
    const nativeMessage = {
      id: "user:native-user-unknown",
      role: "user",
      turnId: "turn-unconfirmed",
      itemId: "native-user-unknown",
      text: "Prompt",
      streaming: false,
      terminalState: null,
      sequence: 4,
    } satisfies AgentTranscriptMessage;

    expect(agentStartCommandNeedsTranscriptFallback(command({
      status: "outcome-unknown",
      userMessageId: "native-user-unknown",
    }), [nativeMessage])).toBe(false);
  });

  it("defers to a canonical user message once the native turn is represented", () => {
    const nativeMessage = {
      id: "user:native-user",
      role: "user",
      turnId: "turn-1",
      itemId: "native-user",
      text: "Prompt",
      streaming: false,
      terminalState: null,
      sequence: 4,
    } satisfies AgentTranscriptMessage;

    expect(agentStartCommandNeedsTranscriptFallback(command({
      status: "outcome-unknown",
      targetTurnId: "turn-1",
      wasQueued: false,
    }), [nativeMessage])).toBe(false);
  });

  it("does not duplicate the authoritative pending-submission prompt", () => {
    expect(agentStartCommandNeedsTranscriptFallback(command(), [], "command-1")).toBe(false);
  });

  it("bridges an accepted active start until its canonical user item arrives", () => {
    expect(agentStartCommandNeedsTranscriptFallback(command({
      status: "accepted",
      targetTurnId: "turn-1",
    }), [], null, "turn-1")).toBe(true);
    expect(agentStartCommandNeedsTranscriptFallback(command({
      status: "accepted",
      targetTurnId: "turn-old",
    }), [], null, "turn-1")).toBe(false);
  });
});

function command(overrides: Partial<AgentSessionControl["commands"][number]> = {}) {
  return {
    commandId: "command-1",
    operationId: "operation-1",
    kind: "start" as const,
    targetTurnId: null,
    status: "dispatching" as const,
    error: null,
    intentFingerprint: "fingerprint",
    wasQueued: false,
    intent: {
      prompt: "Prompt",
      promptMentions: [],
      referenceDisplays: [],
      model: "gpt-5",
      effort: null,
      mode: null,
    },
    ...overrides,
  } satisfies AgentSessionControl["commands"][number];
}
