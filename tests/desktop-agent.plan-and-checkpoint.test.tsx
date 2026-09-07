import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { foldAgentEventCheckpoint } from "../electron/main/agent/domain/agent-event-checkpoint.mjs";
import { normalizeCodexNotification } from "../electron/main/agent/runtimes/codex/codex-app-server-adapter.mjs";
import { applyAgentEvents, createAgentProjection } from "./helpers/agentDisplayFixture";
import type { AgentEvent } from "../src/features/desktop-agent/domain/agent-contract";
import type { AgentActivity } from "../src/features/desktop-agent/domain/agent-projection-types";
import { AgentPlanActivity } from "../src/features/desktop-agent/ui/activity/AgentPlanActivity";
import { withTestLocalization } from "./testLocalization";

describe("Desktop Agent canonical content update semantics", () => {
  it("renders normalized plan text even when no structured steps exist", () => {
    const normalized = normalizeCodexNotification({
      method: "item/plan/delta",
      params: { threadId: "thread-1", turnId: "A", itemId: "plan-A", delta: "PLAN_BODY_SENTINEL" },
    })[0];
    const activity: AgentActivity = {
      id: "plan-A",
      turnId: "A",
      itemId: "plan-A",
      kind: "plan",
      status: "running",
      label: "Plan",
      detail: normalized.payload,
      output: "",
      sequence: 1,
    };
    const html = renderToStaticMarkup(withTestLocalization(createElement(AgentPlanActivity, { activity })));
    expect(html).toContain("PLAN_BODY_SENTINEL");
  });

  it("uses the same replace semantics in live projection and replay checkpoints", () => {
    const events = [
      reasoningEvent(1, { delta: "Hello ", summaryIndex: 0, updateMode: "append" }),
      reasoningEvent(2, { delta: "world", summaryIndex: 0, updateMode: "append" }),
      reasoningEvent(3, { delta: "Hello world", summaryIndex: 0, updateMode: "replace", completed: true }),
    ];
    const checkpoint = events.reduce(foldAgentEventCheckpoint, []);
    const live = applyAgentEvents(createAgentProjection(), events);
    const restored = applyAgentEvents(createAgentProjection({ partialHistory: true }), checkpoint, { partialHistory: true });
    const read = (projection: ReturnType<typeof createAgentProjection>) => (
      projection.activities.find((activity) => activity.kind === "reasoning")?.detail.delta
    );
    expect(read(live)).toBe("Hello world");
    expect(read(restored)).toBe(read(live));
  });

  it("retains native user-message identity in an active-turn checkpoint", () => {
    const message = {
      ...reasoningEvent(4, { text: "FOLLOWUP_SENTINEL" }),
      itemId: "user-followup",
      type: "user.message",
      payload: { text: "FOLLOWUP_SENTINEL" },
    } as AgentEvent;

    expect(foldAgentEventCheckpoint([], message)).toEqual([message]);
  });
});

function reasoningEvent(sequence: number, payload: Record<string, unknown>): AgentEvent {
  return {
    schemaVersion: 1,
    sequence,
    sessionId: "session-1",
    runtimeId: "codex",
    provider: "codex",
    providerSessionId: "thread-1",
    turnId: "A",
    itemId: "reason-A",
    emittedAt: "2026-09-06T00:00:00.000Z",
    type: "reasoning.summary.delta",
    payload,
  } as AgentEvent;
}
