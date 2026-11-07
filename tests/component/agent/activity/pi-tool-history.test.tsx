/** @vitest-environment happy-dom */
import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { AgentSessionActor } from "../../../../electron/main/agent/domain/agent-session-actor.mjs";
import { createPiEventState, normalizePiHistory, normalizePiRpcEvent } from "../../../../electron/main/agent/protocols/pi-rpc/pi-event-normalizer.mjs";
import { AgentTranscript } from "../../../../src/features/desktop-agent/ui/AgentTranscript";
import { AgentToolRenderer } from "../../../../src/features/desktop-agent/ui/AgentToolRendererRegistry";
import { render } from "../../../support/agent/rendererHarness";

describe("Pi tools in the right-side transcript", () => {
  it.each([
    { tool: "find", output: "No files found matching pattern", count: 0 },
    { tool: "ls", output: "(empty directory)", count: 0 },
    { tool: "find", output: "sub/\n\n[1 results limit reached]", count: 1 },
  ])("keeps $tool empty and non-file result text inert", ({ tool, output, count }) => {
    const state = createPiEventState();
    normalizePiRpcEvent({ type: "tool_execution_start", toolCallId: "query", toolName: tool, args: { path: "src" } }, state);
    const events = normalizePiRpcEvent({ type: "tool_execution_end", toolCallId: "query", toolName: tool,
      result: { content: [{ type: "text", text: output }] }, isError: false }, state);
    const actor = new AgentSessionActor();
    for (const event of events) actor.appendEvent({ sessionId: "query", runtimeId: "pi", event });
    const container = render(<AgentTranscript projection={actor.display} loading={false} onOpenFile={vi.fn()} />);
    const row = container.querySelector<HTMLButtonElement>(".desktop-agent-tool-row")!;
    if (tool === "find") expect(row.textContent).toContain(count === 0 ? "No results" : "1 result");
    act(() => row.click());
    expect(container.querySelectorAll(".desktop-agent-search-results button")).toHaveLength(0);
  });

  it.each(["find", "ls"])("keeps old %s output readable without inventing navigation scope", tool => {
    const container = render(<AgentToolRenderer part={{
      id: "old", kind: "tool", turnId: null, itemId: "old", sequence: 1,
      label: tool, status: "completed", detail: { tool, input: { path: "src" } }, output: "a.ts",
    }} onOpenFile={vi.fn()} />);
    act(() => container.querySelector<HTMLButtonElement>(".desktop-agent-tool-row")!.click());
    expect(container.textContent).toContain("a.ts");
    expect(container.querySelectorAll(".desktop-agent-search-results button")).toHaveLength(0);
  });

  it.each(["pi", "puppyone-agent"].flatMap(runtime => ["live", "history"].map(mode => ({ runtime, mode }))))(
    "presents native exploration as file queries in $runtime $mode",
    ({ runtime, mode }) => {
      const calls = [
        { id: "read", name: "read", arguments: { path: "src/a.ts" }, output: "export const value = 1;" },
        { id: "find", name: "find", arguments: { pattern: "*.ts", path: "src" }, output: "a.ts\nb.ts" },
        { id: "ls", name: "ls", arguments: { path: "src" }, output: "a.ts\nb.ts" },
        { id: "grep", name: "grep", arguments: { pattern: "value", path: "src" }, output: "src/a.ts:1:export const value = 1;" },
      ];
      const assistant = { role: "assistant", content: calls.map(call => ({
        type: "toolCall", id: call.id, name: call.name, arguments: call.arguments,
      })), stopReason: "toolUse" };
      const results = calls.map(call => ({ role: "toolResult", toolCallId: call.id, toolName: call.name,
        isError: false, content: [{ type: "text", text: call.output }] }));
      const state = createPiEventState({ turnId: "explore", providerSessionId: "native", namespace: runtime });
      const events = mode === "history"
        ? normalizePiHistory([{ role: "user", content: "Find the source files." }, assistant, ...results], "native", { namespace: runtime })
        : calls.flatMap((call, index) => [
          { type: "tool_execution_start", toolCallId: call.id, toolName: call.name, args: call.arguments },
          { type: "tool_execution_end", toolCallId: call.id, toolName: call.name, result: results[index], isError: false },
        ]).flatMap(event => normalizePiRpcEvent(event, state));
      const actor = new AgentSessionActor();
      for (const event of events) actor.appendEvent({ sessionId: "explore", runtimeId: runtime, providerSessionId: "native", event });
      const onOpenFile = vi.fn();
      const container = render(<AgentTranscript projection={actor.display} loading={false} onOpenFile={onOpenFile} />);
      const fold = container.querySelector<HTMLButtonElement>(".desktop-agent-tool-fold-row")!;
      expect(fold.textContent).toContain("Explored");
      expect(fold.textContent).toContain("1 file");
      expect(fold.textContent).toContain("3 searches");
      expect(fold.getAttribute("aria-expanded")).toBe("false");
      act(() => fold.click());
      expect(container.querySelectorAll(".desktop-agent-file-query")).toHaveLength(4);
      expect(container.querySelector(".desktop-agent-generic-tool")).toBeNull();
      for (const [tool, verb, subject] of [["glob", "Searched", "*.ts"], ["list", "Listed", "src"]]) {
        const query = container.querySelector(`.desktop-agent-file-query.is-${tool}`)!;
        const row = query.querySelector<HTMLButtonElement>(".desktop-agent-tool-row")!;
        expect(row.textContent).toContain(verb);
        expect(row.textContent).toContain(subject);
        expect(query.querySelector(".desktop-agent-tool-glyph.is-list")).not.toBeNull();
        act(() => row.click());
        const result = query.querySelector<HTMLButtonElement>(".desktop-agent-search-results button")!;
        expect(result.textContent).toBe("src/a.ts");
        act(() => result.click());
        expect(onOpenFile).toHaveBeenLastCalledWith("src/a.ts");
      }
    },
  );

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
    // The finished run is one line until the reader opens it.
    const fold = container.querySelector<HTMLButtonElement>(".desktop-agent-tool-fold-row")!;
    expect(fold.textContent).toBe("3 steps done");
    act(() => fold.click());
    const tools = [...container.querySelectorAll<HTMLButtonElement>(".desktop-agent-tool-group-item .desktop-agent-tool-row")];
    expect(tools).toHaveLength(3);
    for (let index = 0; index < tools.length; index++) {
      act(() => tools[index].click());
      expect(tools[index].getAttribute("aria-expanded")).toBe("true");
      expect(container.textContent).toContain(`Result for ${calls[index].name}`);
    }
    expect(container.textContent).not.toContain("Synthetic private reasoning.");
  });
});
