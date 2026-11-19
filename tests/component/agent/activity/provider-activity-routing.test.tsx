/** @vitest-environment happy-dom */
import React from "react";
import { describe, expect, it } from "vitest";
import { AgentTranscript } from "../../../../src/features/desktop-agent/ui/AgentTranscript";
import { AgentProviderActivities } from "../../../../src/features/desktop-agent/ui/AgentProviderActivities";
import { AgentToolRenderer, type AgentToolPart } from "../../../../src/features/desktop-agent/ui/AgentToolRendererRegistry";
import { applyAgentEvents, createAgentProjection } from "../../../support/agent/agentDisplayFixture";
import { defineAgentEvent, type AgentEventPayloadMap } from "../../../support/agent/agentEventFixture";
import type { AgentEvent } from "../../../../shared/agent-contract/types";
import { render } from "../../../support/agent/rendererHarness";

function event<T extends AgentEvent["type"]>(sequence: number, type: T, payload: AgentEventPayloadMap[T] & Record<string, unknown>, itemId = "item"): AgentEvent<T> {
  return defineAgentEvent<T>({ schemaVersion: 1, sequence, sessionId: "test-session", provider: "pi", providerSessionId: "native", turnId: "turn", itemId, emittedAt: new Date(sequence * 1000).toISOString(), type, payload });
}

describe("Provider activity presentation", () => {
  it("renders a chat with a quiet notification without tools, text splits or transcript geometry", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "turn.started", { prompt: "Hello" }),
      event(2, "assistant.delta", { delta: "Hello " }),
      event(3, "provider.notification", { message: "Generation statistics", severity: "info", source: "Extension" }, "notice"),
      event(4, "assistant.delta", { delta: "again." }),
      event(5, "turn.completed", { status: "completed" }),
    ]);
    const container = render(<><AgentTranscript projection={projection} loading={false} /><AgentProviderActivities activities={projection.activities} /></>);
    expect(container.querySelectorAll(".desktop-agent-tool-group, .desktop-agent-tool-glyph")).toHaveLength(0);
    expect(container.querySelector(".desktop-agent-transcript")?.textContent ?? container.textContent).toContain("Hello again.");
    expect(projection.rows.some(row => row.kind === "notification")).toBe(false);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("Generation statistics");
  });

  it.each(["warning", "error"] as const)("shows %s notice text without misrepresenting it as a tool", severity => {
    const projection = applyAgentEvents(createAgentProjection(), [event(1, "provider.notification", { severity, message: "Extension needs attention" })]);
    const container = render(<AgentProviderActivities activities={projection.activities} />);
    expect(container.querySelector(severity === "error" ? '[role="alert"]' : '[role="status"]')?.textContent).toBe("Extension needs attention");
    expect(container.querySelector("details, svg")).toBeNull();
  });

  it("keeps a real unknown tool visible and expandable beside a notification", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "tool.completed", { tool: "custom_lookup", status: "completed", outputPreview: "Found the result" }, "tool"),
      event(2, "provider.notification", { message: "Notice", severity: "info" }, "notice"),
    ]);
    const container = render(<AgentTranscript projection={projection} loading={false} />);
    expect(container.querySelectorAll(".desktop-agent-tool-group-item")).toHaveLength(1);
    expect(container.querySelector("button.desktop-agent-tool-row")?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll(".desktop-agent-tool-glyph.is-generic")).toHaveLength(1);
  });

  it("rejects a non-tool passed directly to the tool renderer", () => {
    const projection = applyAgentEvents(createAgentProjection(), [event(1, "provider.notification", { severity: "info", message: "Notice" })]);
    const container = render(<AgentToolRenderer part={projection.activities[0] as unknown as AgentToolPart} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders compaction as a system divider and completed authentication as no current status", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "provider.activity", { category: "compaction", status: "completed" }, "compact"),
      event(2, "provider.activity", { category: "authentication", status: "completed", message: "Signed in" }, "auth"),
    ]);
    const container = render(<><AgentTranscript projection={projection} loading={false} /><AgentProviderActivities activities={projection.activities} /></>);
    expect(container.querySelector(".desktop-agent-context-divider")?.textContent).toBe("Compacted context");
    expect(container.querySelector(".desktop-agent-tool-group, .desktop-agent-provider-activities")).toBeNull();
  });
});
