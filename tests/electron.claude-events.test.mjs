import { describe, expect, it } from "vitest";
import {
  createClaudeEventState,
  normalizeClaudeHistory,
  normalizeClaudeMessage,
} from "../electron/main/agent/runtimes/claude/claude-events.mjs";

describe("Claude Code event normalization", () => {
  it("normalizes lifecycle, streaming text, tools, usage and terminal state", () => {
    const state = createClaudeEventState({ turnId: "claude:turn-1" });
    const events = [
      { type: "system", subtype: "init", session_id: "session-1", model: "sonnet", permissionMode: "default", claude_code_version: "2.0.0" },
      { type: "stream_event", uuid: "assistant-1", session_id: "session-1", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } } },
      { type: "assistant", uuid: "assistant-1", session_id: "session-1", message: { content: [
        { type: "text", text: "Hello world" },
        { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "npm test", description: "Run tests" } },
      ] } },
      { type: "user", uuid: "user-tool-1", session_id: "session-1", message: { content: [
        { type: "tool_result", tool_use_id: "tool-1", content: "passed" },
      ] } },
      { type: "result", subtype: "success", session_id: "session-1", usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01, duration_ms: 100, num_turns: 1 },
    ].flatMap((message) => normalizeClaudeMessage(message, state));

    expect(events.map((event) => event.type)).toEqual([
      "session.started",
      "assistant.delta",
      "assistant.completed",
      "tool.started",
      "tool.completed",
      "usage.updated",
      "turn.completed",
    ]);
    expect(events.find((event) => event.type === "tool.started")?.payload).toMatchObject({
      kind: "command",
      tool: "bash",
      label: "Run tests",
      command: "npm test",
      input: { command: "npm test", description: "Run tests" },
    });
    expect(events.find((event) => event.type === "turn.completed")?.payload.durationMs).toBe(100);
  });

  it("preserves native Read, Write, Edit, Grep and Glob identity across tool results", () => {
    const state = createClaudeEventState({ turnId: "claude:turn-tools" });
    const tools = [
      { id: "read-1", name: "Read", input: { file_path: "src/read.ts" } },
      { id: "write-1", name: "Write", input: { file_path: "src/write.ts", content: "hello" } },
      { id: "edit-1", name: "Edit", input: { file_path: "src/edit.ts", old_string: "old", new_string: "new" } },
      { id: "grep-1", name: "Grep", input: { pattern: "needle", path: "src" } },
      { id: "glob-1", name: "Glob", input: { pattern: "**/*.ts", path: "src" } },
    ];
    const started = normalizeClaudeMessage({
      type: "assistant",
      uuid: "assistant-tools",
      session_id: "session-1",
      message: { content: tools.map((tool) => ({ type: "tool_use", ...tool })) },
    }, state);
    const completed = normalizeClaudeMessage({
      type: "user",
      uuid: "tool-results",
      session_id: "session-1",
      message: { content: tools.map((tool) => ({ type: "tool_result", tool_use_id: tool.id, content: `${tool.name} result` })) },
    }, state);

    expect(started.map((entry) => entry.payload.tool)).toEqual(["read", "write", "edit", "grep", "glob"]);
    expect(started.map((entry) => entry.payload.kind)).toEqual(["read", "file-change", "file-change", "search", "search"]);
    expect(started[2].payload).toMatchObject({ path: "src/edit.ts", input: { old_string: "old", new_string: "new" } });
    expect(completed.map((entry) => entry.payload.tool)).toEqual(["read", "write", "edit", "grep", "glob"]);
    expect(completed[3].payload).toMatchObject({ kind: "search", input: { pattern: "needle", path: "src" } });
  });

  it("reconstructs bounded historical turns from native session messages", () => {
    const events = normalizeClaudeHistory([
      { type: "user", uuid: "user-1", message: { content: [{ type: "text", text: "Fix it" }] } },
      { type: "assistant", uuid: "assistant-1", message: { content: [{ type: "text", text: "Done" }] } },
    ], "session-1");

    expect(events.map((event) => event.type)).toEqual(["turn.started", "assistant.completed"]);
    expect(events[0].payload.prompt).toBe("Fix it");
    expect(events[1].payload.text).toBe("Done");
  });

  it("shows a working-state boundary without republishing hidden chain-of-thought", () => {
    const state = createClaudeEventState({ turnId: "claude:turn-1" });
    const first = normalizeClaudeMessage({
      type: "stream_event",
      uuid: "assistant-1",
      session_id: "session-1",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "private reasoning" } },
    }, state);
    const second = normalizeClaudeMessage({
      type: "stream_event",
      uuid: "assistant-1",
      session_id: "session-1",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "more private reasoning" } },
    }, state);

    expect(first).toEqual([expect.objectContaining({
      type: "reasoning.summary.delta",
      payload: { delta: "", boundary: true },
    })]);
    expect(second).toEqual([]);
    expect(JSON.stringify(first)).not.toContain("private reasoning");
  });

  it("normalizes API retries as replaceable connection state instead of transcript warnings", () => {
    const state = createClaudeEventState({ turnId: "claude:turn-retry" });
    const [retry] = normalizeClaudeMessage({
      type: "system",
      subtype: "api_retry",
      session_id: "session-1",
      error: "Connection timed out",
      attempt: 3,
      max_retries: 5,
      retry_delay_ms: 250,
    }, state);

    expect(retry).toMatchObject({
      type: "provider.connection.updated",
      turnId: "claude:turn-retry",
      payload: {
        state: "reconnecting",
        message: "Connection timed out",
        attempt: 3,
        maxAttempts: 5,
        retryDelayMs: 250,
      },
    });
  });
});
