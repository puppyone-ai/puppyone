/** @vitest-environment happy-dom */
import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { AgentSessionActor } from "../../../../electron/main/agent/domain/agent-session-actor.mjs";
import { createPiEventState, normalizePiHistory, normalizePiRpcEvent } from "../../../../electron/main/agent/protocols/pi-rpc/pi-event-normalizer.mjs";
import { AgentTranscript } from "../../../../src/features/desktop-agent/ui/AgentTranscript";
import { render } from "../../../support/agent/rendererHarness";

describe("Pi tools in the right-side transcript", () => {
  it.each(["live", "history"])("keeps expandable tool results after a model failure (%s)", (mode) => {
    const calls = [
      { id: "call-read", name: "read", arguments: { path: "fixture.txt" } },
      { id: "call-list", name: "ls", arguments: { path: "." } },
      { id: "call-bash", name: "bash", arguments: { command: "pwd" } },
    ];
    const assistant = { role: "assistant", content: [
      { type: "thinking", thinking: "Synthetic private reasoning." },
      ...calls.map((call) => ({ type: "toolCall", ...call })),
    ], stopReason: "toolUse" };
    const results = calls.map((call) => ({ role: "toolResult", toolCallId: call.id, toolName: call.name,
      isError: false, content: [{ type: "text", text: `Result for ${call.name}` }] }));
    const failure = { role: "assistant", content: [], stopReason: "error", errorMessage: "422 status code (no body)" };
    const state = createPiEventState({ turnId: "turn-tools", providerSessionId: "native-tools", namespace: "puppyone-agent" });
    const events = mode === "history"
      ? normalizePiHistory([{ role: "user", content: "Inspect the fixture." }, assistant, ...results, failure], "native-tools", { namespace: "puppyone-agent" })
      : [
        { type: "message_end", message: assistant },
        ...calls.flatMap((call, index) => [
          { type: "tool_execution_start", toolCallId: call.id, toolName: call.name, args: call.arguments },
          { type: "tool_execution_end", toolCallId: call.id, toolName: call.name, result: results[index], isError: false },
        ]),
        { type: "message_end", message: failure },
        { type: "agent_settled" },
      ].flatMap((event) => normalizePiRpcEvent(event, state));
    const actor = new AgentSessionActor();
    for (const event of events) actor.appendEvent({ sessionId: "session-tools", runtimeId: "puppyone-agent", providerSessionId: "native-tools", event });
    const container = render(<AgentTranscript projection={actor.display} loading={false} />);
    const tools = [...container.querySelectorAll<HTMLButtonElement>(".desktop-agent-tool-row")];
    expect(tools).toHaveLength(3);
    for (let index = 0; index < tools.length; index++) {
      act(() => tools[index].click());
      expect(tools[index].getAttribute("aria-expanded")).toBe("true");
      expect(container.textContent).toContain(`Result for ${calls[index].name}`);
    }
    expect(container.textContent).not.toContain("Synthetic private reasoning.");
  });
});
