/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentTimeline } from "../../../../src/features/desktop-agent/ui/transcript/transcript-rows";
import { useTranscriptScope } from "../../../../src/features/desktop-agent/ui/transcript/useTranscriptScope";
import { AgentTranscript } from "../../../../src/features/desktop-agent/ui/AgentTranscript";
import { createAgentProjection, type AgentPart } from "../../../support/agent/agentDisplayFixture";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

const pending = { id: "submission:1", prompt: "你好", references: [], promptMentions: [] };
function display(ids: string[]) {
  const value = createAgentProjection();
  value.parts = ids.map((submissionId, index): AgentPart => ({
    id: `native:${index}`, kind: "user", submissionId, text: "你好", turnId: null,
    itemId: null, streaming: false, terminalState: null, sequence: index + 1,
  }));
  value.rows = value.parts.map(part => ({ id: `row:${part.id}`, partId: part.id, kind: part.kind,
    turnId: part.turnId, sequence: part.sequence, estimatedHeight: 64 }));
  return value;
}

describe("Transcript presentation identity", () => {
  it("renders one Main row when admission and preview overlap without mutating the snapshot", () => {
    const main = display([pending.id]);
    const original = structuredClone(main);
    const preview = buildAgentTimeline(createAgentProjection(), 30, pending);
    const accepted = buildAgentTimeline(main, 30, pending);
    expect(accepted.rows).toHaveLength(1);
    expect(accepted.rows[0].id).toBe(preview.rows[0].id);
    expect(accepted.parts.get(accepted.rows[0].partId)?.id).toBe("native:0");
    expect(main).toEqual(original);
  });

  it("does not correlate distinct submissions merely because they contain identical text", () => {
    const rows = buildAgentTimeline(display(["submission:other"]), 30, pending).rows;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(row => row.id)).size).toBe(2);
  });

  it("keeps the preview DOM during first native binding but resets when the conversation or runtime changes", () => {
    const owner = {};
    function Harness({ sessionId, runtimeId }: { sessionId: string | null; runtimeId: string }) {
      const scope = useTranscriptScope(owner, sessionId, runtimeId);
      return <AgentTranscript key={scope} projection={sessionId ? display([pending.id]) : createAgentProjection()}
        loading={false} pendingSubmissionId={pending.id} pendingPrompt={sessionId ? null : pending.prompt} />;
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const render = (sessionId: string | null, runtimeId = "runtime:a") => act(() => root?.render(withTestLocalization(<Harness sessionId={sessionId} runtimeId={runtimeId} />)));
    render(null);
    const preview = host.querySelector(".desktop-agent-message.is-user");
    render("session:a");
    expect(host.querySelector(".desktop-agent-message.is-user")).toBe(preview);
    render("session:b");
    const next = host.querySelector(".desktop-agent-message.is-user");
    expect(next).not.toBe(preview);
    render("session:b", "runtime:b");
    expect(host.querySelector(".desktop-agent-message.is-user")).not.toBe(next);
  });
});
