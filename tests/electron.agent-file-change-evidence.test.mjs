import { describe, expect, it } from "vitest";
import { createAgentFileChangeEvidence } from "../electron/main/agent/runtime/agent-file-change-evidence.mjs";
import { AcpEventNormalizer } from "../electron/main/agent/protocols/acp/acp-event-normalizer.mjs";
import { AgentSessionActor } from "../electron/main/agent/domain/agent-session-actor.mjs";
import { agentFileChangeFixture, fileChangeRuntimeIds } from "./helpers/agentFileChangeFixture.mjs";
import { createPiEventState, normalizePiRpcEvent } from "../electron/main/agent/runtimes/pi/pi-event-normalizer.mjs";
import { legacyFileChangeEvidence } from "../electron/main/agent/migrations/legacy-file-change-evidence.mjs";

describe("Shared edit display evidence", () => {
  it.each(fileChangeRuntimeIds)("preserves %s edits through Main and replay", runtimeId => {
    const { actor, replay } = agentFileChangeFixture(runtimeId);
    for (const display of [actor.display, replay.display]) {
      const edits = display.parts.filter(part => part.kind === "file-change");
      expect(edits).toHaveLength(1);
      expect(edits[0].detail.changes).toEqual([expect.objectContaining({ path: "src/example.ts", additions: 2, deletions: 1 })]);
      expect(edits[0].detail.changes[0].diff).toContain("-old\n+new\n+extra");
      expect(edits[0].detail.changes[0].blocks).toEqual([{ removed: "old", added: "new\nextra" }]);
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
    expect(change.blocks).toEqual([{ removed: "  old", added: "  new" }]);
  });

  it("keeps separate changed regions paired without painting unchanged context", () => {
    const [change] = createAgentFileChangeEvidence([{ path: "file", diff:
      "--- a/file\n+++ b/file\n@@ -1,3 +1,3 @@\n-old\n+new\n context\n-first\n+second\n@@ -90 +90 @@\n-last\n+end" }]);
    expect(change.blocks).toEqual([{ removed: "old", added: "new" }, { removed: "first", added: "second" }, { removed: "last", added: "end" }]);
  });

  it.each([["+", { added: "" }], ["-", { removed: "" }], ["+added", { added: "added" }], ["-removed", { removed: "removed" }]])(
    "distinguishes an edited blank line from an absent side: %s", (diff, block) => {
      expect(createAgentFileChangeEvidence([{ path: "file", diff }])[0].blocks).toEqual([block]);
    });

  it("leaves unknown Write bodies and binary evidence neutral", () => {
    expect(createAgentFileChangeEvidence([{ path: "file", after: "+this is literal file content" }])[0].blocks).toEqual([]);
    const [binary] = createAgentFileChangeEvidence([{ path: "file", diff: "Binary files differ" }]);
    expect(binary.blocks).toEqual([]);
    expect(binary.diff).toBe("Binary files differ");
    expect(binary).not.toHaveProperty("additions");
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
    expect(many.reduce((sum, change) => sum + change.diff.length + change.blocks.reduce((size, block) => size + (block.removed?.length || 0) + (block.added?.length || 0), 0), 0)).toBeLessThanOrEqual(24 * 1024);
    expect(many.at(-1).truncated).toBe(true);
    const blankEdits = createAgentFileChangeEvidence(Array.from({ length: 100 }, () => ({ path: "file", diff: "+\n context\n".repeat(101) })));
    expect(blankEdits.flatMap(change => change.blocks)).toHaveLength(100);
    expect(blankEdits.at(-1).truncated).toBe(true);
  });

  it("redacts secrets in generated previews", () => {
    const [change] = createAgentFileChangeEvidence([{ path: "file", before: "", after: "password=example-private-value\n" }]);
    expect(change.diff).toContain("[redacted]");
    expect(change.diff).not.toContain("example-private-value");
    expect(JSON.stringify(change.blocks)).not.toContain("example-private-value");
  });

  it("accepts Pi batch input and legacy numbered output without leaking display line numbers", () => {
    const state = createPiEventState({ turnId: "turn", providerSessionId: "native" });
    const [start] = normalizePiRpcEvent({ type: "tool_execution_start", toolCallId: "edit", toolName: "edit",
      args: { path: "file", edits: [{ oldText: "old", newText: "new" }, { oldText: "first @@ literal", newText: "second" }] } }, state);
    expect(start.payload.changes).toHaveLength(1);
    expect(start.payload.changes[0]).toMatchObject({ additions: 2, deletions: 2, blocks: [{ removed: "old", added: "new" }, { removed: "first @@ literal", added: "second" }] });
    const [end] = normalizePiRpcEvent({ type: "tool_execution_end", toolCallId: "edit", result: { content: [],
      details: { diff: "  97 context\n- 98 old\n+ 98 new\n     ...\n-102 first @@ literal\n+102 second" } } }, state);
    expect(end.payload.changes[0].blocks).toEqual(start.payload.changes[0].blocks);
    expect(end.payload.changes[0].basis).toBe("native");
  });

  it("enriches older multi-file diffs without changing their counts or clearing semantics", () => {
    const payload = { tool: "edit", changes: [
      { path: "file", diff: "@@\n-old\n+new", additions: 5, deletions: 4, truncated: true },
      { path: "file", diff: "@@\n-other\n+next" },
    ] };
    const result = legacyFileChangeEvidence(payload);
    expect(result[0]).toMatchObject({ additions: 5, deletions: 4, truncated: true, blocks: [{ removed: "old", added: "new" }] });
    expect(result[1].blocks).toEqual([{ removed: "other", added: "next" }]);
    expect(result[1]).not.toHaveProperty("additions");
    expect(payload.changes[0]).not.toHaveProperty("blocks");
    expect(legacyFileChangeEvidence({ ...payload, changes: [] })).toBeNull();
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
