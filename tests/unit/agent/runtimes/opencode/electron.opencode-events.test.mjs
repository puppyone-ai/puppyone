import { describe, expect, it } from "vitest";
import { AcpEventNormalizer } from "../../../../../electron/main/agent/protocols/acp/acp-event-normalizer.mjs";
import {
  resolveAcpEfforts,
  resolveAcpModels,
  resolveAcpModes,
  resolveRequestedAcpEffort,
  resolveRequestedAcpMode,
} from "../../../../../electron/main/agent/protocols/acp/acp-session-config.mjs";

describe("OpenCode ACP normalization", () => {
  it("streams assistant text, working state, tools, diffs, plans and usage", () => {
    const normalizer = new AcpEventNormalizer({ turnId: "opencode:turn-1" });
    const assistant = normalizer.normalize(notification({
      sessionUpdate: "agent_message_chunk",
      messageId: "message-1",
      content: { type: "text", text: "Hello " },
    }));
    const thought = normalizer.normalize(notification({
      sessionUpdate: "agent_thought_chunk",
      messageId: "thought-1",
      content: { type: "text", text: "Checking files" },
    }));
    const started = normalizer.normalize(notification({
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      kind: "execute",
      title: "Run tests",
      status: "in_progress",
      rawInput: { command: "npm test", token: "secret" },
    }));
    const completed = normalizer.normalize(notification({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      kind: "execute",
      status: "completed",
      content: [
        { type: "content", content: { type: "text", text: "passed" } },
        { type: "diff", path: "src/app.ts" },
      ],
    }));
    const plan = normalizer.normalize(notification({
      sessionUpdate: "plan",
      entries: [{ content: "Run tests", status: "completed", priority: "high" }],
    }));
    const usage = normalizer.normalize(notification({ sessionUpdate: "usage_update", size: 128_000, used: 4_096 }));
    normalizer.normalize(notification({
      sessionUpdate: "agent_message_chunk",
      messageId: "message-1",
      content: { type: "text", text: "world" },
    }));

    expect(assistant).toEqual([expect.objectContaining({ type: "assistant.delta", payload: { delta: "Hello " } })]);
    expect(thought).toEqual([expect.objectContaining({
      type: "reasoning.summary.delta",
      payload: { delta: "", boundary: true, status: "working" },
    })]);
    expect(JSON.stringify(thought)).not.toContain("Checking files");
    expect(started).toEqual([expect.objectContaining({ type: "tool.started", payload: expect.objectContaining({ kind: "command", command: "npm test" }) })]);
    expect(JSON.stringify(started)).not.toContain("secret");
    expect(completed.map((event) => event.type)).toEqual(["command.output.delta", "file.change.updated", "tool.completed"]);
    expect(plan[0]).toMatchObject({ type: "plan.updated", payload: { steps: [{ step: "Run tests", status: "completed", priority: "high" }] } });
    expect(usage[0]).toMatchObject({ type: "usage.updated", payload: { contextWindow: { size: 128_000, used: 4_096 } } });
    expect(normalizer.completeAssistant("session-1")).toEqual([
      expect.objectContaining({ type: "assistant.completed", payload: { text: "Hello world" } }),
    ]);
  });

  it("derives stable Read, Write, Edit, Grep and Glob semantics from ACP tool metadata", () => {
    const normalizer = new AcpEventNormalizer({ turnId: "opencode:turn-tools" });
    const cases = [
      { id: "read", kind: "read", title: "Read file", rawInput: { filePath: "src/read.ts" }, tool: "read" },
      { id: "write", kind: "edit", title: "Write file", rawInput: { filePath: "src/write.ts", content: "hello" }, tool: "write" },
      { id: "edit", kind: "edit", title: "Edit file", rawInput: { filePath: "src/edit.ts", oldString: "old", newString: "new" }, tool: "edit" },
      { id: "grep", kind: "search", title: "Grep", rawInput: { pattern: "needle", path: "src" }, tool: "grep" },
      { id: "glob", kind: "search", title: "Glob", rawInput: { pattern: "**/*.ts", path: "src" }, tool: "glob" },
    ];
    const events = cases.flatMap((entry) => normalizer.normalize(notification({
      sessionUpdate: "tool_call",
      toolCallId: entry.id,
      status: "in_progress",
      kind: entry.kind,
      title: entry.title,
      rawInput: entry.rawInput,
    })));

    expect(events.map((entry) => entry.payload.tool)).toEqual(cases.map((entry) => entry.tool));
    expect(events[0].payload).toMatchObject({ path: "src/read.ts", input: { filePath: "src/read.ts" } });
    expect(events[3].payload).toMatchObject({ kind: "search", input: { pattern: "needle" } });
  });

  it("derives model, mode and effort selection from ACP config options", () => {
    const configOptions = [
      select("model", "model", "openai/gpt-5", [
        { value: "openai/gpt-5", name: "GPT-5" },
        { value: "anthropic/claude", name: "Claude" },
      ]),
      select("mode", "mode", "build", [{ value: "build", name: "Build" }, { value: "plan", name: "Plan" }]),
      select("thought", "thought_level", "high", [{ value: "low" }, { value: "high" }]),
    ];

    expect(resolveAcpModels({ configOptions })).toMatchObject({ configId: "model", currentId: "openai/gpt-5" });
    expect(resolveAcpModes({ configOptions })).toMatchObject({ configId: "mode", currentId: "build" });
    expect(resolveAcpEfforts({ configOptions })).toMatchObject({ configId: "thought", currentId: "high" });
    expect(resolveRequestedAcpMode("plan", resolveAcpModes({ configOptions }))).toBe("plan");
    expect(resolveRequestedAcpEffort("low", resolveAcpEfforts({ configOptions }))).toBe("low");
    expect(resolveRequestedAcpEffort("unsupported", resolveAcpEfforts({ configOptions }))).toBeNull();
  });
});

function notification(update) {
  return { sessionId: "session-1", update };
}

function select(id, category, currentValue, options) {
  return { id, category, type: "select", currentValue, options };
}
