/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentProjection, type AgentPart } from "../../../support/agent/agentDisplayFixture";
import { AgentTranscript } from "../../../../src/features/desktop-agent/ui/AgentTranscript";
import { AgentToolActivityGroup } from "../../../../src/features/desktop-agent/ui/AgentToolActivityGroup";
import {
  AgentToolGlyph,
  agentToolGlyphKind,
} from "../../../../src/features/desktop-agent/ui/activity/AgentToolGlyph";
import {
  AGENT_TOOL_GROUP_LIMIT,
  groupAgentToolRows,
} from "../../../../src/features/desktop-agent/ui/agent-tool-group-presentation";
import {
  AGENT_TOOL_EXPLORATION_FOLD_MIN,
  agentToolStepSegments,
} from "../../../../src/features/desktop-agent/ui/activity/agent-tool-steps";
import { buildAgentTimeline } from "../../../../src/features/desktop-agent/ui/transcript/transcript-rows";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Desktop Agent tool step lists", () => {
  it("uses distinct provider-neutral glyphs and animates only active work", () => {
    expect(agentToolGlyphKind("grep")).toBe("search");
    expect(agentToolGlyphKind("read_file")).toBe("read");
    expect(agentToolGlyphKind("apply_patch")).toBe("edit");
    expect(agentToolGlyphKind("write_file")).toBe("write");

    const container = render(<div>
      <AgentToolGlyph tool="search" status="running" />
      <AgentToolGlyph tool="read" status="in-progress" />
      <AgentToolGlyph tool="edit" status="completed" />
      <AgentToolGlyph tool="write" status="failed" />
    </div>);
    const glyphs = container.querySelectorAll(".desktop-agent-tool-glyph");

    expect(glyphs).toHaveLength(4);
    expect(glyphs[0].matches(".is-search.is-active")).toBe(true);
    expect(glyphs[0].querySelector(".desktop-agent-tool-glyph-motion")).not.toBeNull();
    expect(glyphs[1].matches(".is-read.is-active")).toBe(true);
    expect(glyphs[1].querySelector(".desktop-agent-tool-glyph-scan")).not.toBeNull();
    expect(glyphs[2].matches(".is-edit.is-active")).toBe(false);
    expect(glyphs[3].matches(".is-write.is-active")).toBe(false);
  });

  it("groups only adjacent tools from the same turn without changing their order", () => {
    const projection = fixtureProjection();
    const timeline = buildAgentTimeline(projection);
    const rows = groupAgentToolRows(timeline.rows, timeline.parts);

    expect(rows).toHaveLength(3);
    expect(rows[0].toolGroup).toBe(true);
    expect(rows[0].partIds).toEqual(["tool:bash", "tool:read"]);
    expect(rows[1].partIds).toEqual(["assistant:one"]);
    expect(rows[2].partIds).toEqual(["tool:grep"]);
  });

  it("estimates one application control row per visible step line", () => {
    const projection = fixtureProjection();
    const timeline = buildAgentTimeline(projection, 34);
    const rows = groupAgentToolRows(timeline.rows, timeline.parts, 34);

    expect(rows[0].estimatedHeight).toBe(68);
    expect(rows[2].estimatedHeight).toBe(34);
  });

  it("folds only long runs of settled, successful exploration", () => {
    const explored = [
      toolPart("tool:read-a", "turn:fold", "tool", 1, "read", "src/a.ts", "a"),
      toolPart("tool:read-a-again", "turn:fold", "tool", 2, "read", "src/a.ts", "a"),
      toolPart("tool:read-b", "turn:fold", "tool", 3, "read", "src/b.ts", "b"),
      toolPart("tool:grep", "turn:fold", "tool", 4, "grep", "src", "src/a.ts:1:match"),
      toolPart("tool:rg", "turn:fold", "command", 5, "bash", "rg -n match src", "src/a.ts:1:match"),
    ];
    const edit = toolPart("tool:edit", "turn:fold", "tool", 6, "edit", "src/a.ts", "");
    const segments = agentToolStepSegments([...explored, edit]);

    expect(AGENT_TOOL_EXPLORATION_FOLD_MIN).toBe(4);
    expect(segments.map((segment) => segment.type)).toEqual(["explored", "step"]);
    expect(segments[0]).toMatchObject({ files: 2, searches: 2 });
    expect(segments[0].type === "explored" && segments[0].parts.map((part) => part.id))
      .toEqual(explored.map((part) => part.id));

    // Three steps stay visible; running and failed work is never hidden in a fold.
    expect(agentToolStepSegments(explored.slice(0, 3)).map((segment) => segment.type)).toEqual(["step", "step", "step"]);
    const running = { ...explored[2], status: "running" } as AgentPart;
    const failed = { ...explored[3], status: "failed" } as AgentPart;
    expect(agentToolStepSegments([explored[0], explored[1], running, failed, explored[4]])
      .map((segment) => segment.type)).toEqual(["step", "step", "step", "step", "step"]);
  });

  it("removes resolved approval rows and rejoins the surrounding tool flow", () => {
    const projection = createAgentProjection();
    projection.parts = [
      toolPart("tool:grep-before", "turn:approval", "tool", 1, "grep", "before", "match"),
      {
        id: "permission:search",
        turnId: "turn:approval",
        itemId: "tool:grep-before",
        kind: "permission",
        requestId: "search",
        state: "resolved",
        sequence: 2,
        updatedSequence: 3,
      },
      toolPart("tool:grep-after", "turn:approval", "tool", 4, "grep", "after", "match"),
    ];
    projection.rows = projection.parts.map((part) => ({
      id: `row:${part.id}`,
      partId: part.id,
      turnId: part.turnId,
      kind: part.kind,
      sequence: part.sequence,
      updatedSequence: part.updatedSequence ?? part.sequence,
      estimatedHeight: 34,
    }));

    const timeline = buildAgentTimeline(projection);
    const rows = groupAgentToolRows(timeline.rows, timeline.parts);
    expect(timeline.parts.get("permission:search")).toMatchObject({ state: "resolved" });
    expect(rows).toHaveLength(1);
    expect(rows[0].partIds).toEqual(["tool:grep-before", "tool:grep-after"]);

    const container = render(<AgentTranscript projection={projection} loading={false} />);
    expect(container.textContent).not.toContain("Permission resolved");
    expect(container.querySelectorAll(".desktop-agent-tool-group-item")).toHaveLength(2);
  });

  it.each(["permission", "question"] as const)("keeps %s state available without duplicate transcript rows", (kind) => {
    for (const state of ["pending", "resolved", "unavailable"] as const) {
    const projection = createAgentProjection();
    projection.parts = [{
      id: "interaction",
      turnId: "turn:approval",
      itemId: "tool:grep",
      kind,
      requestId: "pending",
      state,
      sequence: 1,
    }];
    projection.rows = [{
      id: "row:interaction",
      partId: "interaction",
      turnId: "turn:approval",
      kind,
      sequence: 1,
      estimatedHeight: 34,
    }];

    const timeline = buildAgentTimeline(projection);
    expect(timeline.rows).toHaveLength(0);
    expect(timeline.parts.get("interaction")).toMatchObject({ kind, state });
    expect(projection.parts).toHaveLength(1);
    }
  });

  it("bounds each visual group so a very long native tool run stays virtualizable", () => {
    const projection = createAgentProjection();
    projection.parts = Array.from({ length: AGENT_TOOL_GROUP_LIMIT * 2 + 3 }, (_, index) => (
      toolPart(`tool:${index}`, "turn:many", "tool", index + 1, "read", `file-${index}.ts`, "contents")
    ));
    projection.rows = projection.parts.map((part) => ({
      id: `row:${part.id}`,
      partId: part.id,
      turnId: part.turnId,
      kind: part.kind,
      sequence: part.sequence,
      estimatedHeight: 34,
    }));
    const timeline = buildAgentTimeline(projection);
    const rows = groupAgentToolRows(timeline.rows, timeline.parts);

    expect(rows.map((row) => row.partIds.length)).toEqual([
      AGENT_TOOL_GROUP_LIMIT,
      AGENT_TOOL_GROUP_LIMIT,
      3,
    ]);
    expect(rows.flatMap((row) => row.partIds)).toEqual(projection.parts.map((part) => part.id));
  });

  it("renders one line per step and opens one inline detail at a time", () => {
    const container = render(<AgentTranscript projection={fixtureProjection()} loading={false} />);
    const groups = container.querySelectorAll(".desktop-agent-tool-group");
    const firstGroup = groups[0];
    const items = firstGroup.querySelectorAll<HTMLElement>(".desktop-agent-tool-group-item");
    const buttons = firstGroup.querySelectorAll<HTMLButtonElement>(".desktop-agent-tool-row");

    expect(groups).toHaveLength(2);
    expect(items).toHaveLength(2);
    expect(buttons).toHaveLength(2);
    expect([...buttons].map((button) => button.querySelector(".desktop-agent-tool-name")?.textContent))
      .toEqual(["Ran", "Read"]);
    expect(buttons[1].querySelector(".desktop-agent-tool-subject-name")?.textContent).toBe("package.json");
    expect(firstGroup.querySelector(".desktop-agent-tool-branch")).toBeNull();

    act(() => buttons[0].click());
    expect(buttons[0].getAttribute("aria-expanded")).toBe("true");
    expect(buttons[1].getAttribute("aria-expanded")).toBe("false");
    expect(items[0].querySelector(".desktop-agent-tool-branch")?.textContent).toContain("npm test");

    act(() => buttons[1].click());
    expect(buttons[0].getAttribute("aria-expanded")).toBe("false");
    expect(buttons[1].getAttribute("aria-expanded")).toBe("true");
    expect(firstGroup.querySelectorAll(".desktop-agent-tool-branch")).toHaveLength(1);
    expect(items[1].querySelector(".desktop-agent-tool-branch")?.textContent).toContain("contents");
    expect(items[0].querySelector(".desktop-agent-tool-branch")).toBeNull();
  });

  it("shows a long exploration run as one Explored line that opens into its steps", () => {
    const parts = [
      ...Array.from({ length: 3 }, (_, index) => (
        toolPart(`tool:read-${index}`, "turn:fold", "tool", index + 1, "read", `src/file-${index}.ts`, "contents")
      )),
      toolPart("tool:grep", "turn:fold", "tool", 4, "grep", "src", "src/file-0.ts:1:match"),
      toolPart("tool:test", "turn:fold", "command", 5, "bash", "npm test", "passed"),
    ];
    const container = render(
      <AgentToolActivityGroup
        parts={parts}
        rowId="row:fold"
        runtimeLabel="Cursor"
        onRowHeightChange={() => undefined}
      />,
    );

    const fold = container.querySelector<HTMLButtonElement>(".desktop-agent-tool-fold-row")!;
    expect(fold.textContent).toBe("Explored3 files and 1 search");
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll(".desktop-agent-tool-group-item")).toHaveLength(1);

    act(() => fold.click());
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    const folded = container.querySelectorAll(".desktop-agent-tool-fold-body > .desktop-agent-tool-group-item");
    expect(folded).toHaveLength(4);
    expect(container.querySelectorAll(".desktop-agent-tool-group-item")).toHaveLength(5);

    const firstRead = folded[0].querySelector<HTMLButtonElement>(".desktop-agent-tool-row")!;
    act(() => firstRead.click());
    expect(folded[0].querySelector(".desktop-agent-tool-branch")?.textContent).toContain("contents");
  });
});

function fixtureProjection() {
  const projection = createAgentProjection();
  projection.parts = [
    toolPart("tool:bash", "turn:one", "command", 1, "bash", "npm test", "passed"),
    toolPart("tool:read", "turn:one", "tool", 2, "read", "package.json", "contents"),
    {
      id: "assistant:one",
      turnId: "turn:one",
      itemId: "assistant:one",
      kind: "assistant",
      text: "Checked the project.",
      streaming: false,
      terminalState: "completed",
      sequence: 3,
    },
    toolPart("tool:grep", "turn:one", "tool", 4, "grep", "AgentTranscript", "match"),
  ];
  projection.rows = projection.parts.map((part) => ({
    id: `row:${part.id}`,
    partId: part.id,
    turnId: part.turnId,
    kind: part.kind,
    sequence: part.sequence,
    estimatedHeight: part.kind === "assistant" ? 72 : 34,
  }));
  projection.lastSequence = 4;
  return projection;
}

function toolPart(
  id: string,
  turnId: string,
  kind: "tool" | "command",
  sequence: number,
  tool: string,
  commandOrPath: string,
  output: string,
): AgentPart {
  return {
    id,
    turnId,
    itemId: id,
    kind,
    label: tool,
    status: "completed",
    detail: kind === "command"
      ? { tool, command: commandOrPath }
      : { tool, input: tool === "grep" ? { pattern: "match", path: commandOrPath } : { path: commandOrPath } },
    output,
    sequence,
  };
}

function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(node)));
  return container;
}
