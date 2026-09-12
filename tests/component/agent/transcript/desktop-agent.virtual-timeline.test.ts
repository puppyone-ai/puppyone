import { finalizeDisplay } from "../../../support/agent/agentDisplayFixture";
/** @vitest-environment happy-dom */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentTranscript, agentTimelineLimits } from "../../../../src/features/desktop-agent/ui/AgentTranscript";
import { SafeMarkdown, safeMarkdownLimits } from "../../../../src/features/desktop-agent/ui/SafeMarkdown";
import { createAgentProjection, type AgentPart } from "../../../support/agent/agentDisplayFixture";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

describe("Desktop Agent virtual transcript", () => {
  it("keeps a 2,000-row fixture below the 120 mounted-row budget", () => {
    const projection = createAgentProjection();
    projection.parts = Array.from({ length: 2_000 }, (_, index): AgentPart => ({
      id: `assistant:${index}`,
      turnId: `turn:${Math.floor(index / 4)}`,
      itemId: `item:${index}`,
      kind: "assistant",
      text: `Row ${index}`,
      streaming: false,
      terminalState: null,
      sequence: index + 1,
    }));
    projection.rows = projection.parts.map((part) => ({
      id: `row:${part.id}`,
      partId: part.id,
      turnId: part.turnId,
      kind: part.kind,
      sequence: part.sequence,
      estimatedHeight: 72,
    }));
    const container = render(React.createElement(AgentTranscript, { projection, loading: false }));
    expect(container.querySelectorAll(".desktop-agent-virtual-row").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".desktop-agent-virtual-row").length).toBeLessThanOrEqual(agentTimelineLimits.maxMountedRows);
    expect(container.querySelectorAll(".desktop-agent-virtual-row").length).toBeLessThanOrEqual(120);
  });

  it("renders Markdown without executing raw HTML or unsafe links", () => {
    const container = render(React.createElement(SafeMarkdown, { text: '# Result\n<script>window.pwned=1</script>\n[bad](javascript:alert(1))\n[good](https://example.com)' }));
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>window.pwned=1</script>");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("a")?.getAttribute("href")).toContain("https://example.com");
  });

  it("renders fenced output with a visible language and an icon-only copy action", () => {
    const container = render(React.createElement(SafeMarkdown, { text: "```text\n项目备注\n```" }));
    const block = container.querySelector(".desktop-agent-code-block");
    const copy = block?.querySelector<HTMLButtonElement>(".desktop-agent-code-copy");
    expect(block?.getAttribute("data-language")).toBe("text");
    expect(block?.querySelector("pre")?.textContent).toBe("项目备注");
    expect(copy?.getAttribute("aria-label")).toBe("Copy");
    expect(copy?.textContent).toBe("");
    expect(block?.querySelector(".desktop-agent-code-language")?.textContent).toBe("text");
  });

  it("progressively discloses long Markdown without mounting an unbounded initial document", () => {
    const text = "Paragraph\n\n".repeat(safeMarkdownLimits.maxInitialBlocks + 20);
    const container = render(React.createElement(SafeMarkdown, { text }));
    expect(container.querySelectorAll(".desktop-agent-markdown p").length)
      .toBeLessThanOrEqual(safeMarkdownLimits.maxInitialBlocks);
    const disclosure = container.querySelector<HTMLButtonElement>(".desktop-agent-markdown-disclosure");
    expect(disclosure?.textContent).toContain("Show full response");
    act(() => disclosure?.click());
    expect(container.querySelectorAll(".desktop-agent-markdown p").length).toBeGreaterThan(safeMarkdownLimits.maxInitialBlocks);
    expect(disclosure?.getAttribute("aria-expanded")).toBe("true");
  });

  it("animates only newly committed parts and does not replay entrance motion after rerender", () => {
    const initial = projectionWithMessages(1);
    const container = render(React.createElement(AgentTranscript, { projection: initial, loading: false }));
    expect(container.querySelectorAll(".desktop-agent-virtual-row.is-new")).toHaveLength(0);

    const next = projectionWithMessages(2);
    act(() => root?.render(withTestLocalization(React.createElement(AgentTranscript, { projection: next, loading: false }))));
    expect(container.querySelectorAll(".desktop-agent-virtual-row.is-new")).toHaveLength(1);
    const animatedRow = container.querySelector(".desktop-agent-virtual-row.is-new");
    act(() => animatedRow?.dispatchEvent(new Event("animationend", { bubbles: true })));
    expect(container.querySelectorAll(".desktop-agent-virtual-row.is-new")).toHaveLength(0);

    act(() => root?.render(withTestLocalization(React.createElement(AgentTranscript, { projection: next, loading: false }))));
    expect(container.querySelectorAll(".desktop-agent-virtual-row.is-new")).toHaveLength(0);
    expect(container.querySelectorAll(".desktop-agent-virtual-row").item(1)).toBe(animatedRow);
  });

  it("hands an optimistic prompt to its committed user row without replaying entrance motion", () => {
    const empty = createAgentProjection();
    const container = render(React.createElement(AgentTranscript, {
      projection: empty,
      loading: false,
      pendingPrompt: "Inspect the first-turn path",
      pendingSubmissionId: "submission:first",
      submissionStage: "starting-turn",
      working: true,
    }));
    const previewNode = container.querySelector(".desktop-agent-virtual-row");
    expect(previewNode?.textContent)
      .toContain("Inspect the first-turn path");

    const committed = createAgentProjection();
    const user: AgentPart = {
      id: "user:turn:first",
      submissionId: "submission:first",
      turnId: "turn:first",
      itemId: null,
      kind: "user",
      text: "Inspect the first-turn path",
      streaming: false,
      terminalState: null,
      sequence: 1,
    };
    committed.parts = [user];
    committed.rows = [{
      id: `row:${user.id}`,
      partId: user.id,
      turnId: user.turnId,
      kind: user.kind,
      sequence: user.sequence,
      estimatedHeight: 64,
    }];
    committed.runningTurnId = "turn:first";

    act(() => root?.render(withTestLocalization(React.createElement(AgentTranscript, {
      projection: committed,
      loading: false,
      working: true,
    }))));

    expect(container.querySelector(".desktop-agent-virtual-row")).toBe(previewNode);
    const committedRow = container.querySelector('[data-row-id="row:submission:submission:first"]');
    expect(committedRow).not.toBeNull();
    expect(committedRow?.classList.contains("is-new")).toBe(false);
    expect(container.querySelector(".desktop-agent-live-tail .desktop-agent-message.is-user")).toBeNull();
    expect(container.querySelectorAll(".desktop-agent-message.is-user")).toHaveLength(1);
  });

  it("measures a newly mounted virtual row before exposing its estimated canvas height", () => {
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 800,
      height: 40,
      top: 0,
      right: 800,
      bottom: 40,
      left: 0,
      toJSON: () => ({}),
    });
    try {
      const container = render(React.createElement(AgentTranscript, {
        projection: projectionWithMessages(1),
        loading: false,
      }));

      expect(container.querySelector<HTMLElement>(".desktop-agent-virtual-canvas")?.style
        .getPropertyValue("--agent-virtual-canvas-height")).toBe("48px");
    } finally {
      measure.mockRestore();
      requestFrame.mockRestore();
    }
  });

  it("keeps the summary-to-user handoff stable when the next turn arrives later", () => {
    const initialMeasurements = {
      "row:assistant:one": 40,
      "row:turn-summary:turn:one": 20,
      "row:user:two": 40,
    };
    const container = render(React.createElement(AgentTranscript, {
      projection: settledTurnProjection(false),
      loading: false,
      initialMeasurements,
    }));
    const summarySelector = '[data-row-id="row:turn-summary:turn:one"]';

    expect(container.querySelector(summarySelector)?.getAttribute("data-gap-after")).toBe("8");

    act(() => root?.render(withTestLocalization(React.createElement(AgentTranscript, {
      projection: settledTurnProjection(true),
      loading: false,
      initialMeasurements,
    }))));

    const summary = container.querySelector(summarySelector);
    const nextUser = container.querySelector<HTMLElement>('[data-row-id="row:user:two"]');
    expect(summary?.getAttribute("data-gap-after")).toBe("24");
    expect(nextUser?.style.getPropertyValue("--agent-virtual-row-offset")).toBe("92px");
  });

  it("observes virtual row border boxes as a defensive measurement fallback", () => {
    const OriginalResizeObserver = globalThis.ResizeObserver;
    const observedBoxes: Array<ResizeObserverOptions["box"]> = [];
    let observerCount = 0;
    class CapturingResizeObserver {
      constructor(_callback: ResizeObserverCallback) { observerCount += 1; }
      observe(_target: Element, options?: ResizeObserverOptions) { observedBoxes.push(options?.box); }
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;
    try {
      render(React.createElement(AgentTranscript, { projection: projectionWithMessages(12), loading: false }));
      // The transcript owns one observer for viewport, rows and live status.
      // The fade shares those measurements; it does not observe the canvas again.
      expect(observerCount).toBe(1);
      expect(observedBoxes).toContain("border-box");
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
    }
  });

  it("commits a width-driven row reflow as one batch and restores one viewport anchor", async () => {
    const OriginalResizeObserver = globalThis.ResizeObserver;
    const observers: CapturedResizeObserver[] = [];
    class CapturedResizeObserver {
      readonly targets = new Set<Element>();
      constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
      observe(target: Element) { this.targets.add(target); }
      unobserve(target: Element) { this.targets.delete(target); }
      disconnect() { this.targets.clear(); }
    }
    globalThis.ResizeObserver = CapturedResizeObserver as unknown as typeof ResizeObserver;
    const onViewportChange = vi.fn();
    try {
      const projection = projectionWithMessages(4);
      const initialMeasurements = Object.fromEntries(
        projection.rows.map((entry) => [entry.id, 40]),
      );
      const container = render(React.createElement(AgentTranscript, {
        projection,
        loading: false,
        initialMeasurements,
        initialPinned: false,
        initialScrollTop: 70,
        onViewportChange,
      }));
      const transcript = container.querySelector<HTMLElement>(".desktop-agent-transcript");
      const canvas = container.querySelector<HTMLElement>(".desktop-agent-virtual-canvas");
      if (!transcript || !canvas) throw new Error("Transcript fixture did not mount.");
      Object.defineProperty(canvas, "offsetTop", { configurable: true, value: 12 });
      Object.defineProperty(transcript, "scrollHeight", { configurable: true, value: 800 });
      Object.defineProperty(transcript, "clientHeight", { configurable: true, value: 200 });
      act(() => {
        transcript.scrollTop = 80;
        transcript.dispatchEvent(new Event("scroll", { bubbles: true }));
        transcript.scrollTop = 70;
        transcript.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      onViewportChange.mockClear();

      const rowObserver = observers.find((observer) => (
        Array.from(observer.targets).some((target) => (target as HTMLElement).dataset.rowId)
      ));
      if (!rowObserver) throw new Error("Shared row observer was not registered.");
      const rows = Array.from(container.querySelectorAll<HTMLElement>(".desktop-agent-virtual-row"));

      await act(async () => {
        rowObserver.callback([
          resizeEntry(rows[0], 68),
          resizeEntry(rows[1], 56),
          resizeEntry(rows[2], 72),
        ], rowObserver as unknown as ResizeObserver);
        await animationFrame();
      });

      expect(onViewportChange).toHaveBeenCalledTimes(1);
      expect(onViewportChange).toHaveBeenLastCalledWith(98, expect.any(Object), false, expect.any(Object));
      expect(transcript.scrollTop).toBe(98);
      expect(rows[1].style.getPropertyValue("--agent-virtual-row-offset")).toBe("76px");
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
    }
  });
});

function resizeEntry(target: Element, blockSize: number): ResizeObserverEntry {
  return {
    target,
    borderBoxSize: [{ blockSize, inlineSize: 400 }],
  } as unknown as ResizeObserverEntry;
}

function animationFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(node)));
  return container;
}

function projectionWithMessages(count: number) {
  const projection = createAgentProjection();
  projection.parts = Array.from({ length: count }, (_, index): AgentPart => ({
    id: `assistant:${index}`,
    turnId: "turn:1",
    itemId: `item:${index}`,
    kind: "assistant",
    text: `Message ${index}`,
    streaming: false,
    terminalState: null,
    sequence: index + 1,
  }));
  projection.rows = projection.parts.map((part) => ({
    id: `row:${part.id}`,
    partId: part.id,
    turnId: part.turnId,
    kind: part.kind,
    sequence: part.sequence,
    estimatedHeight: 72,
  }));
  projection.lastSequence = count;
  return projection;
}

function settledTurnProjection(includeNextUser: boolean) {
  const projection = createAgentProjection();
  const assistant: AgentPart = {
    id: "assistant:one",
    turnId: "turn:one",
    itemId: "message:one",
    kind: "assistant",
    text: "First response",
    streaming: false,
    terminalState: "completed",
    sequence: 1,
  };
  const nextUser: AgentPart = {
    id: "user:two",
    turnId: "turn:two",
    itemId: null,
    kind: "user",
    text: "Next request",
    streaming: false,
    terminalState: null,
    sequence: 4,
  };
  projection.parts = includeNextUser ? [assistant, nextUser] : [assistant];
  projection.rows = projection.parts.map((part) => ({
    id: `row:${part.id}`,
    partId: part.id,
    turnId: part.turnId,
    kind: part.kind,
    sequence: part.sequence,
    estimatedHeight: 40,
  }));
  projection.turns = [{
    id: "turn:one",
    status: "completed",
    startedAtSequence: 1,
    startedAtMs: 0,
    completedAtSequence: 3,
    durationMs: 7_000,
    partIds: [assistant.id],
  }];
  return finalizeDisplay(projection);
}
