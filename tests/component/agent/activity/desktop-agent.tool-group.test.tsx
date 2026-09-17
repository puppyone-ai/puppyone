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
  agentToolRailVisibleCount,
  groupAgentToolRows,
} from "../../../../src/features/desktop-agent/ui/agent-tool-group-presentation";
import { buildAgentTimeline } from "../../../../src/features/desktop-agent/ui/transcript/transcript-rows";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Desktop Agent compact tool groups", () => {
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

  it("uses one application control row for a compact tool rail estimate", () => {
    const projection = fixtureProjection();
    const timeline = buildAgentTimeline(projection, 34);
    const rows = groupAgentToolRows(timeline.rows, timeline.parts, 34);

    expect(rows[0].estimatedHeight).toBe(34);
    expect(rows[2].estimatedHeight).toBe(34);
  });

  it("reserves a complete +N slot instead of wrapping overflowing tools", () => {
    expect(agentToolRailVisibleCount({
      total: 12,
      width: 380,
      itemWidth: 28,
      gap: 4,
      overflowWidth: 36,
    })).toBe(12);
    expect(agentToolRailVisibleCount({
      total: 12,
      width: 164,
      itemWidth: 28,
      gap: 4,
      overflowWidth: 36,
    })).toBe(4);
    expect(agentToolRailVisibleCount({
      total: 12,
      width: 36,
      itemWidth: 28,
      gap: 4,
      overflowWidth: 36,
    })).toBe(0);
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

  it("renders compact tool headers in one non-wrapping group and opens one shared detail at a time", () => {
    const container = render(<AgentTranscript projection={fixtureProjection()} loading={false} />);
    const groups = container.querySelectorAll(".desktop-agent-tool-group");
    const firstGroup = groups[0];
    const buttons = firstGroup.querySelectorAll<HTMLButtonElement>(".desktop-agent-tool-row");

    expect(groups).toHaveLength(2);
    expect(firstGroup.querySelectorAll(".desktop-agent-tool-group-item")).toHaveLength(2);
    expect(buttons).toHaveLength(2);
    expect(firstGroup.querySelector(".desktop-agent-tool-group-detail")?.textContent).toBe("");

    act(() => buttons[0].click());
    expect(buttons[0].getAttribute("aria-expanded")).toBe("true");
    expect(buttons[1].getAttribute("aria-expanded")).toBe("false");
    expect(firstGroup.querySelector(".desktop-agent-tool-group-detail")?.textContent).toContain("npm test");

    act(() => buttons[1].click());
    expect(buttons[0].getAttribute("aria-expanded")).toBe("false");
    expect(buttons[1].getAttribute("aria-expanded")).toBe("true");
    expect(firstGroup.querySelectorAll(".desktop-agent-tool-branch")).toHaveLength(1);
    expect(firstGroup.querySelector(".desktop-agent-tool-group-detail")?.textContent).toContain("contents");
    expect(firstGroup.querySelector(".desktop-agent-tool-group-detail")?.textContent).not.toContain("npm test");
  });

  it("renders only fitting icons and exposes hidden tools through a +N disclosure", () => {
    const parts = Array.from({ length: 8 }, (_, index) => (
      toolPart(`tool:${index}`, "turn:rail", "tool", index + 1, index % 2 ? "read" : "bash", `file-${index}.ts`, "contents")
    ));
    const container = render(
      <AgentToolActivityGroup
        parts={parts}
        rowId="row:rail"
        runtimeLabel="Cursor"
        availableWidth={108}
        onRowHeightChange={() => undefined}
      />,
    );

    const rail = container.querySelector(".desktop-agent-tool-rail")!;
    const visibleButtons = rail.querySelectorAll<HTMLButtonElement>(".desktop-agent-tool-row");
    const overflow = rail.querySelector<HTMLButtonElement>(".desktop-agent-tool-overflow")!;
    expect(visibleButtons).toHaveLength(2);
    expect(visibleButtons[0].getAttribute("aria-label")).toBe("Bash");
    expect(visibleButtons[0].title).toBe("Bash");
    expect(overflow.textContent).toBe("+6");
    expect(overflow.getAttribute("aria-expanded")).toBe("false");

    act(() => overflow.click());
    expect(overflow.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll(".desktop-agent-tool-overflow-item > .desktop-agent-tool-call")).toHaveLength(6);
    const hiddenButton = container.querySelector<HTMLButtonElement>(
      ".desktop-agent-tool-overflow-item .desktop-agent-tool-row",
    )!;
    act(() => hiddenButton.click());
    expect(hiddenButton.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".desktop-agent-tool-group-detail")?.textContent).toContain("contents");
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
      : { tool, input: { path: commandOrPath } },
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
