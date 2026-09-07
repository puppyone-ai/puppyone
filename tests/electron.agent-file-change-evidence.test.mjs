import { describe, expect, it } from "vitest";
import { createAgentFileChangeEvidence } from "../electron/main/agent/runtime/agent-file-change-evidence.mjs";
import { AcpEventNormalizer } from "../electron/main/agent/protocols/acp/acp-event-normalizer.mjs";
import { AgentSessionActor } from "../electron/main/agent/domain/agent-session-actor.mjs";
import { agentFileChangeFixture, fileChangeRuntimeIds } from "./helpers/agentFileChangeFixture.mjs";

describe("Shared edit display evidence", () => {
  it.each(fileChangeRuntimeIds)("preserves %s edits through Main and replay", runtimeId => {
    const { actor, replay } = agentFileChangeFixture(runtimeId);
    for (const display of [actor.display, replay.display]) {
      const edits = display.parts.filter(part => part.kind === "file-change");
      expect(edits).toHaveLength(1);
      expect(edits[0].detail.changes).toEqual([expect.objectContaining({ path: "src/example.ts", additions: 2, deletions: 1 })]);
      expect(edits[0].detail.changes[0].diff).toContain("-old\n+new\n+extra");
    }
  });

  it.each([
    ["", "added\n", 1, 0], ["removed\n", "", 0, 1], ["same\n", "same\n", 0, 0],
    ["  old\n\nend\n", "  new\n\nend\n", 1, 1],
  ])("computes real changed lines without counting unchanged context", (before, after, additions, deletions) => {
    const [change] = createAgentFileChangeEvidence([{ path: "file", before, after }]);
    expect(change).toMatchObject({ additions, deletions });
  });

  it("preserves whitespace and does not invent absolute line numbers for fragments", () => {
    const [change] = createAgentFileChangeEvidence([{ path: "file", before: "  old\n", after: "  new\n", scope: "fragment" }]);
    expect(change.diff).toBe("@@\n-  old\n+  new");
  });

  it("distinguishes diff file headers from content beginning with triple signs", () => {
    const [change] = createAgentFileChangeEvidence([{ path: "file", diff: "--- a/file\n+++ b/file\n@@ -1 +1 @@\n--- content\n+++ content" }]);
    expect(change).toMatchObject({ additions: 1, deletions: 1 });
  });

  it("keeps unknown counts absent for path-only, overwritten Write and replace-all requests", () => {
    for (const entry of [{ path: "file" }, { path: "file", after: "new file content" },
      { path: "file", before: "old", after: "new", unknownMultiplicity: true }]) {
      expect(createAgentFileChangeEvidence([entry])[0]).not.toHaveProperty("additions");
    }
  });

  it("bounds large work and marks omitted previews without claiming a partial count as the total", () => {
    const [large] = createAgentFileChangeEvidence([{ path: "file", diff: "+line\n".repeat(30_000) }]);
    expect(large.diff.length).toBeLessThanOrEqual(24 * 1024);
    expect(large.truncated).toBe(true);
    expect(large).not.toHaveProperty("additions");
    const many = createAgentFileChangeEvidence(Array.from({ length: 200 }, (_, i) => ({ path: `file-${i}`, diff: "+line\n".repeat(1000) })));
    expect(many).toHaveLength(100);
    expect(many.reduce((sum, change) => sum + change.diff.length, 0)).toBeLessThanOrEqual(24 * 1024);
    expect(many.at(-1).truncated).toBe(true);
  });

  it("redacts secrets in generated previews", () => {
    const [change] = createAgentFileChangeEvidence([{ path: "file", before: "", after: "password=example-private-value\n" }]);
    expect(change.diff).toContain("[redacted]");
    expect(change.diff).not.toContain("example-private-value");
  });

  it("handles ACP diff creation, omitted fields and explicit clearing", () => {
    const normalizer = new AcpEventNormalizer({ turnId: "turn" });
    const send = update => normalizer.normalize({ sessionId: "native", update: { toolCallId: "edit", ...update } });
    const initial = send({ sessionUpdate: "tool_call", kind: "edit", content: [{ type: "diff", path: "file", oldText: null, newText: "created\n" }] });
    expect(initial[0].payload.changes[0]).toMatchObject({ kind: "add", additions: 1, deletions: 0 });
    expect(send({ sessionUpdate: "tool_call_update", status: "completed" }).at(-1).payload.changes).toEqual(initial[0].payload.changes);
    expect(send({ sessionUpdate: "tool_call_update", content: [] }).at(-1).payload.changes).toEqual([]);
  });

  it("preserves old journal edit fragments in Main without changing the recorded event", () => {
    const event = { schemaVersion: 1, sequence: 1, sessionId: "session", runtimeId: "claude", provider: "claude",
      providerSessionId: "native", turnId: "turn", itemId: "edit", type: "tool.completed", emittedAt: "2026-09-07T00:00:00Z",
      payload: { kind: "file-change", tool: "edit", status: "completed", path: "src/file.ts",
        input: { old_string: "  old", new_string: "  new" } },
    };
    const actor = new AgentSessionActor({ events: [event] });
    expect(actor.display.parts[0].detail.changes[0].diff).toContain("-  old\n+  new");
    expect(actor.events()[0]).toEqual(event);
    const cleared = new AgentSessionActor({ events: [{ ...event, payload: { ...event.payload, changes: [] } }] });
    expect(cleared.display.parts[0].detail.changes).toEqual([]);
  });
});
