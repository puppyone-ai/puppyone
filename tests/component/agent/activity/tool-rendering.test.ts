/** @vitest-environment happy-dom */

import { agentFileChangeFixture, fileChangeRuntimeIds } from "../../../support/agent/agentFileChangeFixture.mjs";

import React from "react";

import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { AgentTranscript } from "../../../../src/features/desktop-agent/ui/AgentTranscript";

import { registerAgentToolRenderer } from "../../../../src/features/desktop-agent/ui/AgentToolRendererRegistry";

import { agentToolEvidenceLimits } from "../../../../src/features/desktop-agent/domain/agent-tool-evidence";

import { createAgentProjection } from "../../../support/agent/agentDisplayFixture";

import { render } from "../../../support/agent/rendererHarness";

describe("Desktop Agent renderer surfaces", () => {

  it("renders Bash activity as a compact product row with a bounded expandable transcript", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "command-1",
      turnId: "turn-1",
      itemId: "tool-1",
      kind: "command",
      label: "Run tests",
      status: "completed",
      output: "25 files passed",
      detail: {
        tool: "bash",
        input: { command: "npm test" },
        metadata: { exitCode: 0, duration: 842 },
      },
      sequence: 1,
    });
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    const row = container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement;
    expect(row.textContent).toContain("Bash");
    expect(row.textContent).not.toContain("npm test");
    expect(row.querySelector(".desktop-agent-tool-chevron")).toBeNull();
    expect(row.querySelector(".desktop-agent-tool-summary")).toBeNull();
    expect(row.getAttribute("aria-expanded")).toBe("false");
    act(() => row.click());
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(row.querySelector(".desktop-agent-tool-chevron")).toBeNull();
    expect(row.querySelector(".desktop-agent-tool-summary")).toBeNull();
    expect(row.textContent).not.toContain("npm test");
    const evidence = Array.from(container.querySelectorAll(".desktop-agent-evidence-node"));
    expect(evidence).toHaveLength(2);
    expect(evidence.map((node) => node.getAttribute("data-evidence-kind"))).toEqual(["command", "result"]);
    expect(evidence[0].querySelector(".desktop-agent-evidence-marker")?.textContent).toBe("$");
    expect(container.querySelector(".desktop-agent-command-line")?.textContent).toBe("npm test");
    expect(container.querySelector(".desktop-agent-command-output")?.textContent).toContain("25 files passed");
    expect(row.textContent).not.toContain("Exit 0");
    expect(row.textContent).not.toMatch(/\d+\s*ms/u);
    expect(container.querySelector(".desktop-agent-command-meta")).toBeNull();
    expect(container.querySelector('button[aria-label="Open command in terminal"]')).toBeNull();
    expect(container.querySelector('button[aria-label*="Copy"]')).toBeNull();
  });

  it("presents conservative read-only shell commands semantically without collapsed provenance noise", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "command-search",
      turnId: "turn-1",
      itemId: "tool-search",
      kind: "command",
      label: "Search repository",
      status: "completed",
      output: "src/App.tsx:12:liangyu",
      detail: {
        tool: "bash",
        command: "/bin/zsh -lc \"rg -n -i liangyu src\"",
        exitCode: 0,
      },
      sequence: 1,
    });
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    const row = container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement;
    expect(row.textContent).toContain("Grep");
    expect(row.textContent).not.toContain("rg -n -i liangyu src");
    expect(row.textContent).not.toContain("via Bash");
    expect(row.textContent).not.toContain("Exit 0");
    act(() => row.click());
    expect(row.textContent).not.toContain("rg -n -i liangyu src");
    expect(container.querySelector(".desktop-agent-command-line")?.textContent).toContain("rg -n -i liangyu src");
    expect(container.querySelector(".desktop-agent-command.is-grep")).not.toBeNull();
  });

  it("renders native Grep as a dedicated bounded result disclosure", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "grep-1",
      turnId: "turn-1",
      itemId: "tool-grep",
      kind: "tool",
      label: "Find liangyu",
      status: "completed",
      output: "src/a.ts:3:liangyu\nsrc/b.ts:8:LIANGYU",
      detail: { tool: "grep", input: { pattern: "liangyu", path: "src" } },
      sequence: 1,
    });
    const onOpenFile = vi.fn();
    const container = render(React.createElement(AgentTranscript, { projection, loading: false, onOpenFile }));
    const row = container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement;
    expect(row.textContent).toContain("Grep");
    expect(row.textContent).not.toContain("liangyu");
    act(() => row.click());
    expect(row.textContent).not.toContain("liangyu");
    expect(container.querySelector(".desktop-agent-search-results")?.textContent).toContain("liangyu");
    expect(container.querySelectorAll(".desktop-agent-search-results > button")).toHaveLength(2);
    act(() => (container.querySelector(".desktop-agent-search-results > button") as HTMLButtonElement).click());
    expect(onOpenFile).toHaveBeenCalledWith("src/a.ts");
  });

  it.each(fileChangeRuntimeIds)("uses the same tool detail for %s edits", (runtimeId) => {
    const { actor } = agentFileChangeFixture(runtimeId);
    const container = render(React.createElement(AgentTranscript, { projection: actor.display, loading: false }));
    const row = container.querySelector<HTMLButtonElement>(".desktop-agent-tool-row")!;
    expect(row.querySelector(".desktop-agent-tool-diff-stats")?.textContent).toBe("+2−1");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    act(() => row.click());
    expect(container.querySelector(".desktop-agent-evidence-node.is-deletion pre")?.textContent).toBe("old");
    expect(container.querySelector(".desktop-agent-evidence-node.is-addition pre")?.textContent).toBe("new\nextra");
    expect(container.textContent).not.toContain("@@");
    expect(container.textContent).not.toContain("source");
    expect(container.querySelectorAll(".desktop-agent-tool-diff-stats")).toHaveLength(1);
    expect(container.querySelector(".desktop-agent-inline-diff, .desktop-agent-file-list")).toBeNull();
  });

  it("renders Write/Edit activity through shared evidence without row action clutter", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "edit-1",
      turnId: "turn-1",
      itemId: "tool-2",
      kind: "file-change",
      label: "Updated app.ts",
      status: "completed",
      output: "",
      detail: {
        tool: "edit",
        path: "src/app.ts",
        changes: [{ path: "src/app.ts", additions: 2, deletions: 1, blocks: [{ removed: "old", added: "new\nextra" }], diff: "@@ -1,2 +1,3 @@\n-old\n+new\n+extra\n context" }],
      },
      sequence: 1,
    });
    const onOpenFile = vi.fn();
    const container = render(React.createElement(AgentTranscript, { projection, loading: false, onOpenFile }));
    const row = container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement;
    expect(row.textContent).toContain("Edit");
    expect(row.textContent).not.toContain("src/app.ts");
    act(() => row.click());
    expect(row.textContent).not.toContain("src/app.ts");
    expect(container.querySelector(".desktop-agent-tool-file-path")?.textContent).toContain("src/app.ts");
    expect(container.querySelector(".desktop-agent-evidence-node.is-deletion pre")?.textContent).toBe("old");
    expect(container.querySelector(".desktop-agent-evidence-node.is-addition pre")?.textContent).toBe("new\nextra");
    expect(container.textContent).not.toContain("@@");
    expect(container.querySelector(".desktop-agent-inline-diff, .desktop-agent-file-list")).toBeNull();
    expect(row.querySelector(".desktop-agent-tool-diff-stats")?.textContent).toBe("+2−1");
    expect(container.textContent).toContain("+2");
    expect(container.querySelector('button[aria-label="Review file changes"]')).toBeNull();
    act(() => (container.querySelector('.desktop-agent-tool-file-path button[title="src/app.ts"]') as HTMLButtonElement).click());
    expect(onOpenFile).toHaveBeenCalledWith("src/app.ts");
  });

  it.each([
    { label: "added blank line", blocks: [{ added: "" }], expected: [["addition", ""]] },
    { label: "removed blank line", blocks: [{ removed: "" }], expected: [["deletion", ""]] },
    { label: "separate replacements", blocks: [{ removed: "first", added: "next" }, { removed: "second", added: "last" }],
      expected: [["deletion", "first"], ["addition", "next"], ["deletion", "second"], ["addition", "last"]] },
  ])("preserves $label without inventing an absent side", ({ blocks, expected }) => {
    const projection = createAgentProjection();
    projection.activities.push({ id: "edit-blocks", turnId: "turn", itemId: "edit", kind: "file-change",
      label: "Edit", status: "completed", output: "", sequence: 1,
      detail: { tool: "edit", changes: [{ path: "src/file.ts", blocks, diff: "raw fallback" }] },
    });
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    act(() => container.querySelector<HTMLButtonElement>(".desktop-agent-tool-row")!.click());
    const nodes = [...container.querySelectorAll('.desktop-agent-evidence-node[role="group"]')];
    expect(nodes.map(node => [node.classList.contains("is-deletion") ? "deletion" : "addition", node.querySelector("pre")?.textContent])).toEqual(expected);
    expect(nodes.every(node => Boolean(node.getAttribute("aria-label")))).toBe(true);
    expect(container.textContent).not.toContain("raw fallback");
  });

  it("keeps a failed edit's output visible without inventing zero line counts", () => {
    const projection = createAgentProjection();
    projection.activities.push({ id: "failed-edit", turnId: "turn", itemId: "edit", kind: "file-change",
      label: "Edit", status: "failed", output: "Permission denied", sequence: 1,
      detail: { tool: "edit", changes: [{ path: "src/file.ts", diff: "-old\n+new", blocks: [{ removed: "old", added: "new" }], basis: "request" }] },
    });
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    act(() => container.querySelector<HTMLButtonElement>(".desktop-agent-tool-row")!.click());
    expect(container.textContent).toContain("Permission denied");
    expect(container.querySelector(".desktop-agent-evidence-node.is-deletion pre")?.textContent).toBe("old");
    expect(container.querySelector(".desktop-agent-evidence-node.is-addition pre")?.textContent).toBe("new");
    expect(container.querySelector(".desktop-agent-tool-diff-stats")).toBeNull();
  });

  it("does not render a generic File Change row or Review action without a real change", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "empty-change",
      turnId: "turn-1",
      itemId: "session-diff",
      kind: "file-change",
      label: "File changes",
      status: "completed",
      output: "",
      detail: { changes: [] },
      sequence: 1,
    });
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    expect(container.textContent).not.toContain("File Change");
    expect(container.querySelector('button[aria-label="Review file changes"]')).toBeNull();
  });

  it("keeps Read activity compact and reveals output without a redundant row action", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "read-1",
      turnId: "turn-1",
      itemId: "tool-read",
      kind: "tool",
      label: "Read composer",
      status: "completed",
      output: "export function AgentComposer() {}",
      detail: { tool: "read", input: { path: "src/features/desktop-agent/ui/AgentComposer.tsx" } },
      sequence: 1,
    });
    const onOpenFile = vi.fn();
    const container = render(React.createElement(AgentTranscript, { projection, loading: false, onOpenFile }));
    const row = container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement;
    expect(row.textContent).toContain("Read");
    act(() => row.click());
    expect(container.querySelector(".desktop-agent-evidence-tree")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-evidence-node")?.getAttribute("data-evidence-kind")).toBe("result");
    expect(container.querySelector(".desktop-agent-tool-output")?.textContent).toContain("export function AgentComposer");
    expect(container.querySelector('button[aria-label^="Open"]')).toBeNull();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("mounts a bounded tool preview instead of the complete provider output", () => {
    const projection = createAgentProjection();
    const output = Array.from({ length: 10_000 }, (_, index) => `line-${index}`).join("\n");
    projection.activities.push({
      id: "command-large",
      turnId: "turn-large",
      itemId: "tool-large",
      kind: "command",
      label: "Large output",
      status: "completed",
      output,
      detail: { tool: "bash", command: "generate-output" },
      sequence: 1,
    });
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    act(() => (container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement).click());
    const visibleOutput = container.querySelector(".desktop-agent-command-output") as HTMLElement;
    const evidence = visibleOutput.closest(".desktop-agent-tool-text-evidence") as HTMLElement;
    const visible = visibleOutput.textContent ?? "";

    expect(evidence.dataset.truncated).toBe("true");
    expect(Number(evidence.dataset.sourceLength)).toBe(64 * 1024);
    expect(visible.length).toBeLessThan(agentToolEvidenceLimits.maxChars + 200);
    expect(visible).toContain("omitted");
  });

  it("mounts at most eighty searchable result elements", () => {
    const projection = createAgentProjection();
    projection.activities.push({
      id: "grep-large",
      turnId: "turn-large",
      itemId: "grep-large",
      kind: "tool",
      label: "Large search",
      status: "completed",
      output: Array.from({ length: 1_000 }, (_, index) => `src/file-${index}.ts:${index + 1}:match`).join("\n"),
      detail: { tool: "grep", input: { pattern: "match" } },
      sequence: 1,
    });
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    act(() => (container.querySelector(".desktop-agent-tool-row") as HTMLButtonElement).click());

    expect(container.querySelectorAll(".desktop-agent-search-results > span, .desktop-agent-search-results > button")).toHaveLength(80);
    expect(container.querySelector(".desktop-agent-search-results")?.textContent).toContain("more results");
  });

  it("isolates one crashing tool renderer and preserves following transcript rows", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dispose = registerAgentToolRenderer("fixture-crash", () => {
      throw new Error("fixture tool detail failed");
    });
    const projection = createAgentProjection();
    projection.activities.push({
      id: "broken-tool",
      turnId: "turn-1",
      itemId: "broken-tool",
      kind: "tool",
      label: "Broken tool",
      status: "completed",
      output: "ignored",
      detail: { tool: "fixture-crash" },
      sequence: 1,
    });
    projection.messages.push({
      id: "assistant-after-tool",
      role: "assistant",
      turnId: "turn-1",
      itemId: null,
      text: "The transcript survived.",
      streaming: false,
      terminalState: "completed",
      sequence: 2,
    });

    try {
      const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
      expect(container.querySelector(".desktop-agent-activity-render-fallback")).not.toBeNull();
      expect(container.textContent).toContain("The transcript survived.");
      expect(error).toHaveBeenCalled();
    } finally {
      dispose();
      error.mockRestore();
    }
  });
});
