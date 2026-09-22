import { describe, expect, it } from "vitest";
import { deriveAgentSessionControls } from "../../../../src/features/desktop-agent/domain/agent-session-controls";
import {
  nextAgentStreamText,
  splitStreamingMarkdown,
} from "../../../../src/features/desktop-agent/domain/agent-stream-presentation";
import type { AgentCapabilities, AgentRuntimeInspection } from "../../../../src/features/desktop-agent/domain/agent-contract";

describe("Agent session control projection", () => {
  it("projects native model and mode capabilities without inventing effort", () => {
    const controls = deriveAgentSessionControls(inspection({
      models: [
        { id: "auto", model: "auto", displayName: "Auto", description: "", isDefault: true },
        { id: "composer", model: "composer", displayName: "Composer", description: "", isDefault: false },
      ],
      modes: [
        { id: "agent", displayName: "Agent", description: "", isDefault: true },
        { id: "plan", displayName: "Plan", description: "", isDefault: false },
        { id: "ask", displayName: "Ask", description: "", isDefault: false },
      ],
    }), { selectedModel: "auto", selectedEffort: null, selectedMode: "agent" });

    expect(controls.map((control) => control.id)).toEqual(["model", "mode"]);
    expect(controls[0]).toMatchObject({ value: "auto" });
    expect(controls[0].options[0]).toMatchObject({ value: "auto", label: "Auto" });
    expect(controls[1].options.map((option) => option.value)).toEqual(["agent", "plan", "ask"]);
  });

  it("derives effort only from the selected model's native variants", () => {
    const controls = deriveAgentSessionControls(inspection({
      models: [
        { id: "fast", model: "fast", displayName: "Fast", description: "", isDefault: false },
        { id: "deep", model: "deep", displayName: "Deep", description: "", isDefault: true, variants: ["low", "high"] },
      ],
      modes: [],
    }), { selectedModel: "deep", selectedEffort: "high", selectedMode: null });

    expect(controls.map((control) => control.id)).toEqual(["model", "effort"]);
    expect(controls[1]).toEqual({
      id: "effort",
      value: "high",
      options: [{ value: "low", label: "low" }, { value: "high", label: "high" }],
    });
  });
});

describe("Agent streaming presentation policy", () => {
  it("advances by grapheme-safe adaptive frames and converges without rewriting the source", () => {
    const authoritative = "A👨‍👩‍👧‍👦BCDEFGHIJK";
    let displayed = "A";
    for (let frame = 0; frame < 12 && displayed !== authoritative; frame += 1) {
      const next = nextAgentStreamText(displayed, authoritative);
      expect(authoritative.startsWith(next)).toBe(true);
      expect(next.length).toBeGreaterThan(displayed.length);
      displayed = next;
    }
    expect(displayed).toBe(authoritative);
    expect(nextAgentStreamText("stale", "replacement")).toBe("replacement");
  });

  it("keeps an incomplete Markdown block in a stable plain-text tail", () => {
    expect(splitStreamingMarkdown("First paragraph\n\n**still typing")).toEqual({
      stable: "First paragraph\n\n",
      tail: "**still typing",
    });
    expect(splitStreamingMarkdown("```ts\nconst ok = true;\n```\nNext")).toEqual({
      stable: "```ts\nconst ok = true;\n```\n",
      tail: "Next",
    });
    expect(splitStreamingMarkdown("```ts\nconst pending = true;")).toEqual({
      stable: "",
      tail: "```ts\nconst pending = true;",
    });
  });

  it("promotes a validated GFM table one completed row at a time", () => {
    expect(splitStreamingMarkdown([
      "Before",
      "",
      "| Name | State |",
      "| --- | ---: |",
      "| Parser | run",
    ].join("\n"))).toEqual({
      stable: "Before\n\n| Name | State |\n| --- | ---: |\n",
      tail: "| Parser | run",
    });

    expect(splitStreamingMarkdown([
      "Before",
      "",
      "| Name | State |",
      "| --- | ---: |",
      "| Parser | running |",
      "| Renderer | wai",
    ].join("\n"))).toEqual({
      stable: "Before\n\n| Name | State |\n| --- | ---: |\n| Parser | running |\n",
      tail: "| Renderer | wai",
    });

    // GFM accepts pipe-less rows and pads their missing cells. They should
    // receive the same row-by-row streaming treatment as conventional rows.
    expect(splitStreamingMarkdown([
      "| Name | State |",
      "| --- | --- |",
      "Parser",
      "Renderer",
    ].join("\n"))).toEqual({
      stable: "| Name | State |\n| --- | --- |\nParser\n",
      tail: "Renderer",
    });

    expect(splitStreamingMarkdown("| State |\n| --- |\ncomplete\npen")).toEqual({
      stable: "| State |\n| --- |\ncomplete\n",
      tail: "pen",
    });
  });

  it("does not promote malformed or ambiguous pipe text as a streaming table", () => {
    expect(splitStreamingMarkdown("| One | Two |\n| --- |\n| value | other |\n")).toEqual({
      stable: "",
      tail: "| One | Two |\n| --- |\n| value | other |\n",
    });
    expect(splitStreamingMarkdown("Introductory prose\nOne | Two\n--- | ---\n")).toEqual({
      stable: "",
      tail: "Introductory prose\nOne | Two\n--- | ---\n",
    });
  });

  it("ends table streaming before a competing CommonMark flow block", () => {
    expect(splitStreamingMarkdown([
      "| Name | State |",
      "| --- | --- |",
      "| Parser | complete |",
      "# Result",
      "Still streaming",
    ].join("\n"))).toEqual({
      stable: "| Name | State |\n| --- | --- |\n| Parser | complete |\n",
      tail: "# Result\nStill streaming",
    });
  });
});

function inspection({
  models,
  modes,
}: Pick<AgentRuntimeInspection, "models" | "modes">): AgentRuntimeInspection {
  return {
    selectedRuntimeId: "fixture",
    readiness: null,
    account: null,
    models,
    modes,
    capabilities: capabilities(),
    warnings: [],
  };
}

function capabilities(): AgentCapabilities {
  return {
    streamingText: true,
    structuredToolEvents: true,
    commandOutputStreaming: true,
    fileChangeEvents: true,
    manualApprovals: true,
    structuredQuestions: true,
    resume: true,
    fork: true,
    steer: false,
    queue: false,
    attachments: true,
    contextReferences: true,
    modelSelection: true,
    modeSelection: true,
    slashCommands: true,
    sessionHistory: true,
    usage: true,
    accountState: true,
    mcp: true,
    skills: true,
    compaction: true,
  };
}
