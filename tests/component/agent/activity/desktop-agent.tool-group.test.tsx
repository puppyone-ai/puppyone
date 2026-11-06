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

  it("estimates one application control row per visible line", () => {
    const projection = fixtureProjection();
    const timeline = buildAgentTimeline(projection, 34);
    const rows = groupAgentToolRows(timeline.rows, timeline.parts, 34);

    // Both settled steps of the first group read as one fold line.
    expect(rows[0].estimatedHeight).toBe(34);
    expect(rows[2].estimatedHeight).toBe(34);
  });

  it("groups ordinary work together and keeps failed work on its own line", () => {
    const explored = [
      toolPart("tool:read-a", "turn:fold", "tool", 1, "read", "src/a.ts", "a"),
      toolPart("tool:read-a-again", "turn:fold", "tool", 2, "read", "src/a.ts", "a"),
      toolPart("tool:read-b", "turn:fold", "tool", 3, "read", "src/b.ts", "b"),
      toolPart("tool:grep", "turn:fold", "tool", 4, "grep", "src", "src/a.ts:1:match"),
      toolPart("tool:rg", "turn:fold", "command", 5, "bash", "rg -n match src", "src/a.ts:1:match"),
    ];
    const edit = toolPart("tool:edit", "turn:fold", "tool", 6, "edit", "src/a.ts", "");

    // A long, purely exploratory run keeps its richer "Explored" summary.
    expect(AGENT_TOOL_EXPLORATION_FOLD_MIN).toBe(4);
    expect(agentToolStepSegments(explored.slice(0, 4)).map((segment) => segment.type)).toEqual(["explored"]);
    const settledRun = agentToolStepSegments([...explored, edit]);
    expect(settledRun.map((segment) => segment.type)).toEqual(["settled"]);
    expect(settledRun[0]).toMatchObject({ steps: 6 });
    expect(settledRun[0].type === "settled" && settledRun[0].parts.map((part) => part.id))
      .toEqual([...explored, edit].map((part) => part.id));

    // Two settled steps already read as one line; a single one stays visible.
    expect(agentToolStepSegments(explored.slice(0, 2)).map((segment) => segment.type)).toEqual(["settled"]);
    expect(agentToolStepSegments(explored.slice(0, 1)).map((segment) => segment.type)).toEqual(["step"]);

    // Active work joins its adjacent history; failures remain visible.
    const running = { ...explored[2], status: "running" } as unknown as AgentPart;
    const failed = { ...explored[3], status: "failed" } as unknown as AgentPart;
    expect(agentToolStepSegments([explored[0], explored[1], running, failed, explored[4]])
      .map((segment) => segment.type)).toEqual(["working", "step", "step"]);
  });

  it("bounds a stream of unfinished tools without pretending they succeeded", () => {
    const parts = Array.from({ length: 12 }, (_, i) => ({ ...toolPart(`tool:${i}`, "turn:live", "tool", i, "read", "file.md", ""), status: "running" }) as AgentPart);
    const segments = agentToolStepSegments(parts);
    expect(segments.map(segment => segment.type)).toEqual(["working"]);
    expect(segments[0]).toMatchObject({ parts });
    expect(parts.every(part => "status" in part && part.status === "running")).toBe(true);
  });

  it("renders unfinished history as one disclosure and keeps failures and user waits visible", () => {
    const parts = Array.from({ length: 10 }, (_, i) => ({ ...toolPart(`tool:${i}`, "turn:live", "tool", i, "read", "file.md", "contents"), status: "running" }) as AgentPart);
    const waiting = { ...toolPart("wait", "turn:live", "tool", 11, "read", "wait.md", ""), status: "waiting-for-user" } as AgentPart;
    const failed = { ...toolPart("failed", "turn:live", "tool", 12, "read", "failed.md", ""), status: "failed" } as AgentPart;
    const container = render(<AgentToolActivityGroup parts={[...parts, waiting, failed]} rowId="row:live" runtimeLabel="Agent" onRowHeightChange={() => {}} />);
    expect(container.querySelectorAll(".desktop-agent-tool-group-item")).toHaveLength(2);
    const fold = container.querySelector<HTMLButtonElement>(".desktop-agent-tool-fold-row")!;
    expect(fold.textContent).toContain("10 steps");
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    act(() => fold.click());
    expect(container.querySelectorAll(".desktop-agent-tool-group-item")).toHaveLength(12);
  });

  it("uses one neutral summary for mixed pending and finished tools without a standalone Tool row", () => {
    const parts = [
      { ...toolPart("old", "turn:live", "tool", 1, "read", "old.md", ""), status: "running" } as AgentPart,
      { ...toolPart("opaque", "turn:live", "tool", 2, "tool", "", ""), status: "running" } as AgentPart,
      toolPart("done-a", "turn:live", "tool", 3, "read", "a.md", "contents"),
      toolPart("done-b", "turn:live", "tool", 4, "read", "b.md", "contents"),
    ];
    const container = render(<AgentToolActivityGroup parts={parts} rowId="row:live" runtimeLabel="Agent" onRowHeightChange={() => {}} />);
    expect(container.querySelectorAll(".desktop-agent-tool-row")).toHaveLength(1);
    expect(container.textContent).toBe("4 steps");
    act(() => container.querySelector<HTMLButtonElement>(".desktop-agent-tool-fold-row")!.click());
    expect(container.querySelectorAll(".desktop-agent-tool-group-item")).toHaveLength(4);
  });

  it("shows the latest concrete activity inline and preserves an open group as work continues", () => {
    const done = toolPart("done", "turn:live", "tool", 1, "read", "old.md", "contents");
    const current = { ...toolPart("current", "turn:live", "tool", 2, "read", "README.md", "contents"), status: "running" } as AgentPart;
    const group = (parts: AgentPart[]) => <AgentToolActivityGroup parts={parts} rowId="row:live" runtimeLabel="Agent" onRowHeightChange={() => {}} />;
    const container = render(group([done, current]));
    const fold = container.querySelector<HTMLButtonElement>(".desktop-agent-tool-fold-row")!;
    expect(container.querySelectorAll(".desktop-agent-tool-row")).toHaveLength(1);
    expect(fold.textContent).toContain("2 steps");
    expect(fold.textContent).toContain("Reading");
    expect(fold.textContent).toContain("README.md");
    act(() => fold.click());
    const next = { ...toolPart("next", "turn:live", "tool", 3, "read", "next.md", "contents"), status: "running" } as AgentPart;
    act(() => root!.render(withTestLocalization(group([done, { ...current, status: "completed" } as AgentPart, next]))));
    expect(container.querySelector(".desktop-agent-tool-fold-body")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-tool-fold-row")?.textContent).toContain("next.md");
  });

  it("keeps a single unnamed tool folded after it finishes", () => {
    const done = toolPart("opaque", "turn:live", "tool", 1, "tool", "", "result");
    const group = (part: AgentPart) => <AgentToolActivityGroup parts={[part]} rowId="row:live" runtimeLabel="Agent" onRowHeightChange={() => {}} />;
    const container = render(group({ ...done, status: "running" } as AgentPart));
    expect(container.textContent).toBe("1 step");
    act(() => root!.render(withTestLocalization(group(done))));
    expect(container.textContent).toBe("1 step done");
    expect(container.querySelector(".desktop-agent-tool-group-item")).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>(".desktop-agent-tool-fold-row")!.click());
    expect(container.querySelector(".desktop-agent-tool-group-item")).not.toBeNull();
  });

  it("automatically closes inspected work when the last tool finishes, then permits reopening", () => {
    const done = Array.from({ length: 3 }, (_, i) => toolPart(`tool:${i}`, "turn:live", "tool", i, "read", "file.md", "contents"));
    const live = [...done.slice(0, 2), { ...done[2], status: "running" } as AgentPart];
    const group = (parts: AgentPart[]) => <AgentToolActivityGroup parts={parts} rowId="row:live" runtimeLabel="Agent" onRowHeightChange={() => {}} />;
    const container = render(group(live));
    act(() => container.querySelector<HTMLButtonElement>(".desktop-agent-tool-fold-row")!.click());
    expect(container.querySelector(".desktop-agent-tool-fold-body")).not.toBeNull();
    act(() => container.querySelector<HTMLButtonElement>(".desktop-agent-tool-group-item .desktop-agent-tool-row")!.click());
    expect(container.querySelector(".desktop-agent-tool-branch")).not.toBeNull();
    act(() => root!.render(withTestLocalization(group(done))));
    expect(container.querySelector(".desktop-agent-tool-fold-body")).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>(".desktop-agent-tool-fold-row")!.click());
    expect(container.querySelectorAll(".desktop-agent-tool-group-item")).toHaveLength(3);
    expect(container.querySelector(".desktop-agent-tool-branch")).toBeNull();
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
    const fold = container.querySelector<HTMLButtonElement>(".desktop-agent-tool-fold-row")!;
    expect(fold.textContent).toBe("2 steps done");
    act(() => fold.click());
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

    expect(groups).toHaveLength(2);
    // Both settled steps of the first group fold into one line until opened.
    const fold = firstGroup.querySelector<HTMLButtonElement>(".desktop-agent-tool-fold-row")!;
    expect(fold.textContent).toBe("2 steps done");
    expect(firstGroup.querySelectorAll(".desktop-agent-tool-group-item")).toHaveLength(0);
    act(() => fold.click());

    const items = firstGroup.querySelectorAll<HTMLElement>(".desktop-agent-tool-group-item");
    const buttons = [...items].map((item) => item.querySelector<HTMLButtonElement>(".desktop-agent-tool-row")!);
    expect(items).toHaveLength(2);
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.querySelector(".desktop-agent-tool-name")?.textContent))
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
    expect(container.querySelectorAll(".desktop-agent-tool-group-item")).toHaveLength(0);

    act(() => fold.click());
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    const folded = container.querySelectorAll(".desktop-agent-tool-fold-body > .desktop-agent-tool-group-item");
    expect(folded).toHaveLength(4);

    const firstRead = folded[0].querySelector<HTMLButtonElement>(".desktop-agent-tool-row")!;
    act(() => firstRead.click());
    expect(folded[0].querySelector(".desktop-agent-tool-branch")?.textContent).toContain("contents");
  });

  it("keeps mixed tool categories in one summary with the current action inline", () => {
    const parts = [
      toolPart("tool:read-a", "turn:fold", "tool", 1, "read", "src/a.ts", "a"),
      toolPart("tool:grep", "turn:fold", "tool", 2, "grep", "src", "src/a.ts:1:match"),
      toolPart("tool:test", "turn:fold", "command", 3, "bash", "npm test", "passed"),
    ];
    const running = { ...toolPart("tool:edit", "turn:fold", "tool", 4, "edit", "src/a.ts", ""), status: "running" as const };
    const container = render(
      <AgentToolActivityGroup
        parts={[...parts, running]}
        rowId="row:mixed"
        runtimeLabel="Cursor"
        onRowHeightChange={() => undefined}
      />,
    );

    const fold = container.querySelector<HTMLButtonElement>(".desktop-agent-tool-fold-row")!;
    expect(fold.textContent).toContain("4 steps");
    expect(fold.textContent).toContain("Editing");
    // The current action is part of the summary, not another full tool row.
    const visibleItems = container.querySelectorAll(".desktop-agent-tool-group-item");
    expect(visibleItems).toHaveLength(0);

    act(() => fold.click());
    expect(container.querySelectorAll(".desktop-agent-tool-group-item")).toHaveLength(4);
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
