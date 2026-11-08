import { describe, expect, it } from "vitest";
import { AcpEventNormalizer } from "../../../../../electron/main/agent/protocols/acp/acp-event-normalizer.mjs";
import { AcpHistoryReplay } from "../../../../../electron/main/agent/protocols/acp/acp-history-replay.mjs";
import { applyAgentEvents, createAgentProjection } from "../../../../../electron/main/agent/domain/transcript/transcript-reducer.mjs";
import { acpRequestPermission, acpResolveApproval, acpHandleExtensionRequest, acpResolveQuestion } from "../../../../../electron/main/agent/protocols/acp/acp-interactions.mjs";

const nativeId = "call-read-0\nfc_read_0";
const notification = (update) => ({ sessionId: "session-1", update });
const start = (toolCallId) => notification({
  sessionUpdate: "tool_call", toolCallId, kind: "read", title: "Read README.md",
  status: "in_progress", rawInput: { path: "README.md" },
});

describe("ACP native tool identity", () => {
  it("keeps partial updates on one completed activity with its original details", () => {
    const normalizer = new AcpEventNormalizer({ turnId: "turn-1" });
    const events = [
      start(nativeId),
      notification({ sessionUpdate: "tool_call_update", toolCallId: nativeId, status: "in_progress" }),
      notification({ sessionUpdate: "tool_call_update", toolCallId: nativeId, status: "completed", rawOutput: "file contents" }),
    ].flatMap((entry) => normalizer.normalize(entry));
    expect(events.map((entry) => entry.type)).toEqual(["tool.started", "tool.progress", "tool.completed"]);
    expect(new Set(events.map((entry) => entry.itemId)).size).toBe(1);
    expect(events[0].itemId).toMatch(/^[A-Za-z0-9:._-]{1,256}$/);
    const projection = applyAgentEvents(createAgentProjection(), events.map((entry, index) => ({
      ...entry, sequence: index + 1, emittedAt: new Date(index * 1000).toISOString(),
    })));
    expect(projection.activities).toHaveLength(1);
    expect(projection.activities[0]).toMatchObject({
      status: "completed", detail: { tool: "read", input: { path: "README.md" }, outputPreview: "file contents" },
    });
  });

  it("preserves distinct opaque IDs without trimming or truncating and replays them deterministically", () => {
    const ids = [nativeId, nativeId.replace("\n", " "), `${nativeId}\n`, "x".repeat(300) + "a", "x".repeat(300) + "b", "ordinary-id"];
    const normalizer = new AcpEventNormalizer({ turnId: "turn-1" });
    const mapped = ids.map((id) => normalizer.normalize(start(id))[0].itemId);
    expect(new Set(mapped).size).toBe(ids.length);
    expect(mapped.at(-1)).toBe("ordinary-id");
    // A native ID shaped like a generated ID must not collide with it.
    expect(normalizer.normalize(start(mapped[0]))[0].itemId).not.toBe(mapped[0]);
    const replay = new AcpHistoryReplay();
    [...ids].reverse().forEach((id) => replay.accept(start(id)));
    ids.forEach((id) => replay.accept(notification({
      sessionUpdate: "tool_call_update", toolCallId: id, status: "completed",
    })));
    const history = replay.events("session-1");
    expect(history.filter((entry) => entry.type === "tool.started").map((entry) => entry.itemId)).toEqual([...mapped].reverse());
    const completed = history.filter((entry) => entry.type === "tool.completed");
    expect(completed.map((entry) => entry.itemId)).toEqual(mapped);
    completed.forEach((entry) => expect(entry.payload).toMatchObject({
      tool: "read", status: "completed", input: { path: "README.md" },
    }));
    normalizer.reset("turn-2");
    expect(normalizer.normalize(start(nativeId))[0].itemId).toBe(mapped[0]);
  });

  it("correlates approvals and questions to the same activity while returning native answers", async () => {
    const events = [];
    const adapter = {
      sessionId: "session-1", activeTurn: { turnId: "turn-1" },
      runtimeDescriptor: { id: "cursor", displayName: "Cursor" },
      pendingApprovals: new Map(), pendingQuestions: new Map(),
      questionMethods: new Set(["ask"]), onEvent: (entry) => events.push(entry),
    };
    const normalizer = new AcpEventNormalizer({ turnId: "turn-1" });
    const itemId = normalizer.normalize(start(nativeId))[0].itemId;
    const approval = acpRequestPermission(adapter, {
      sessionId: "session-1", toolCall: { toolCallId: nativeId, title: "Read README.md" },
      options: [{ optionId: "native-allow", kind: "allow_once" }],
    });
    expect(events[0].itemId).toBe(itemId);
    acpResolveApproval(adapter, { requestId: events[0].payload.requestId, turnId: "turn-1", decision: "accept" });
    await expect(approval).resolves.toEqual({ outcome: { outcome: "selected", optionId: "native-allow" } });
    const question = acpHandleExtensionRequest(adapter, "ask", {
      toolCallId: nativeId, questions: [{ id: "choice", question: "Which file?" }],
    });
    expect(events[1].itemId).toBe(itemId);
    acpResolveQuestion(adapter, { requestId: events[1].payload.requestId, turnId: "turn-1", answers: [["README.md"]] });
    await expect(question).resolves.toEqual({ outcome: "answered", answers: { choice: ["README.md"] } });
  });
});
