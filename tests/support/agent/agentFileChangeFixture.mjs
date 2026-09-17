import { AgentSessionActor } from "../../../electron/main/agent/domain/agent-session-actor.mjs";
import { normalizeAgentEventWorkspacePaths } from "../../../electron/main/agent/domain/agent-event-workspace-paths.mjs";
import { normalizeItemLifecycle } from "../../../electron/main/agent/runtimes/codex/codex-events.mjs";
import { createClaudeEventState, normalizeClaudeMessage } from "../../../electron/main/agent/runtimes/claude/claude-events.mjs";
import { createPiEventState, normalizePiRpcEvent } from "../../../electron/main/agent/runtimes/pi/pi-event-normalizer.mjs";
import { AcpEventNormalizer } from "../../../electron/main/agent/protocols/acp/acp-event-normalizer.mjs";

export const fileChangeRuntimeIds = ["codex", "claude", "pi", "cursor", "opencode-native", "workbuddy", "puppyone-agent"];
export const editBefore = "source\nold\nend\n";
export const editAfter = "source\nnew\nextra\nend\n";
export const editDiff = "@@ -1,3 +1,4 @@\n source\n-old\n+new\n+extra\n end\n";

/** Native protocol fixtures pass through real edge translation, Main admission,
 * workspace path normalization, display projection and persisted replay. */
export function agentFileChangeFixture(runtimeId) {
  const path = "/workspace/src/example.ts";
  let events;
  if (runtimeId === "codex") {
    events = normalizeItemLifecycle({ id: "edit", type: "fileChange", status: "completed",
      changes: [{ path, kind: "update", diff: editDiff }] }, "completed", "native", "turn");
  } else if (runtimeId === "claude") {
    const state = createClaudeEventState({ turnId: "turn" });
    events = [
      { type: "assistant", message: { content: [{ type: "tool_use", id: "edit", name: "Edit",
        input: { file_path: path, old_string: editBefore, new_string: editAfter } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "edit", content: "Updated" }] } },
    ].flatMap(message => normalizeClaudeMessage(message, state));
  } else if (runtimeId === "pi") {
    const state = createPiEventState({ turnId: "turn", providerSessionId: "native" });
    events = [
      { type: "tool_execution_start", toolCallId: "edit", toolName: "edit", args: { path, edits: [{ oldText: editBefore, newText: editAfter }] } },
      { type: "tool_execution_end", toolCallId: "edit", isError: false, result: { content: [{ type: "text", text: "Updated" }],
        details: { patch: editDiff, diff: " 1 source\n-2 old\n+2 new\n+3 extra\n 4 end", firstChangedLine: 2 } } },
    ].flatMap(message => normalizePiRpcEvent(message, state));
  } else {
    const normalizer = new AcpEventNormalizer({ turnId: "turn" });
    events = [
      { sessionUpdate: "tool_call", toolCallId: "edit", title: "Edit", kind: "edit", status: "in_progress",
        content: [{ type: "diff", path, oldText: editBefore, newText: editAfter }] },
      { sessionUpdate: "tool_call_update", toolCallId: "edit", status: "completed" },
    ].flatMap(update => normalizer.normalize({ sessionId: "native", update }));
  }
  const actor = new AgentSessionActor();
  for (const event of events) actor.appendEvent({ sessionId: "session", runtimeId, providerSessionId: "native",
    event: normalizeAgentEventWorkspacePaths(event, "/workspace") });
  return { actor, replay: new AgentSessionActor({ events: actor.events() }) };
}
