/** @vitest-environment happy-dom */
import React, { act } from "react";
import { expect, it } from "vitest";
import { AgentSessionActor } from "../../../../electron/main/agent/domain/agent-session-actor.mjs";
import { AcpEventNormalizer } from "../../../../electron/main/agent/protocols/acp/acp-event-normalizer.mjs";
import { createClaudeEventState, normalizeClaudeMessage } from "../../../../electron/main/agent/runtimes/claude/claude-events.mjs";
import { normalizeItemLifecycle } from "../../../../electron/main/agent/runtimes/codex/codex-events.mjs";
import { createPiEventState, normalizePiRpcEvent } from "../../../../electron/main/agent/protocols/pi-rpc/pi-event-normalizer.mjs";
import { AgentTranscript } from "../../../../src/features/desktop-agent/ui/AgentTranscript";
import { render } from "../../../support/agent/rendererHarness";

const runtimes = ["cursor", "hermes", "claude", "codex", "pi", "puppyone-agent"] as const;

it.each(runtimes)("folds %s native searches into the shared exploration presentation", runtime => {
  const actor = new AgentSessionActor();
  for (const event of searchEvents(runtime)) {
    actor.appendEvent({ sessionId: "searches", runtimeId: runtime, providerSessionId: "native", event });
  }
  const container = render(<AgentTranscript projection={actor.display} loading={false} />);
  const fold = container.querySelector<HTMLButtonElement>(".desktop-agent-tool-fold-row")!;
  expect(fold.textContent).toContain("Explored");
  expect(fold.textContent).toContain("4 searches");
  expect(fold.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelectorAll(".desktop-agent-tool-group-item")).toHaveLength(0);
  act(() => fold.click());
  const rows = container.querySelectorAll<HTMLButtonElement>(".desktop-agent-tool-group-item .desktop-agent-tool-row");
  expect(rows).toHaveLength(4);
  expect(container.querySelectorAll(".desktop-agent-tool-glyph.is-search")).toHaveLength(4);
  act(() => rows[0].click());
  expect(container.textContent).toContain("src/a.ts:1:needle");
});

function searchEvents(runtime: typeof runtimes[number]) {
  const ids = ["search-1", "search-2", "search-3", "search-4"];
  const input = { pattern: "needle", path: "src" };
  const output = "src/a.ts:1:needle";
  if (runtime === "cursor" || runtime === "hermes") {
    const normalizer = new AcpEventNormalizer();
    normalizer.reset("turn");
    return ids.flatMap(id => normalizer.normalize({ sessionId: "native", update: {
      sessionUpdate: "tool_call", toolCallId: id, kind: "search", title: "Grep needle",
      status: "completed", rawInput: input, rawOutput: output,
    } }));
  }
  if (runtime === "claude") {
    // The JS factory's null default is narrower than the native string turn ID.
    const state = Reflect.apply(createClaudeEventState, undefined, [{ turnId: "turn" }]);
    return ids.flatMap(id => [
      { type: "assistant", session_id: "native", message: { content: [{ type: "tool_use", id, name: "Grep", input }] } },
      { type: "user", session_id: "native", message: { content: [{ type: "tool_result", tool_use_id: id, content: output }] } },
    ].flatMap(message => normalizeClaudeMessage(message, state)));
  }
  if (runtime === "codex") {
    return ids.flatMap(id => normalizeItemLifecycle({
      id, type: "commandExecution", command: "rg needle src", status: "completed", aggregatedOutput: output, exitCode: 0,
    }, "completed", "native", "turn"));
  }
  const state = createPiEventState({ turnId: "turn", providerSessionId: "native", namespace: runtime });
  return ids.flatMap(id => [
    { type: "tool_execution_start", toolCallId: id, toolName: "grep", args: input },
    { type: "tool_execution_end", toolCallId: id, toolName: "grep", result: { content: [{ type: "text", text: output }] }, isError: false },
  ].flatMap(message => normalizePiRpcEvent(message, state)));
}
