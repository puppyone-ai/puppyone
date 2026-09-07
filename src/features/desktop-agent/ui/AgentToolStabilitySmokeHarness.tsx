import { useEffect, useMemo } from "react";
import { createEmptyAgentDisplay as createAgentProjection } from "../../../../shared/agent-contract/display-state.mjs";
import { agentToolEvidenceLimits } from "../domain/agent-tool-evidence";
import { AgentTranscript, agentTimelineLimits } from "./AgentTranscript";
import { registerAgentToolRenderer } from "./AgentToolRendererRegistry";
import "./desktop-agent.css";
import { BUILTIN_SUB_THEMES } from "../../themes/builtinSubThemes";
import { SubThemeStyleHost } from "../../themes/SubThemeStyleHost";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../markdown/markdownPresentation";

const smokeToolId = "fixture-render-crash";
registerAgentToolRenderer(smokeToolId, () => {
  throw new Error("intentional smoke renderer failure");
});

type SmokeResult = {
  passed: boolean;
  durationMs: number;
  fallbackCount: number;
  mountedRows: number;
  maxPreviewChars: number;
  maxSearchRows: number;
  previewCount: number;
  searchContainerCount: number;
  sentinelVisible: boolean;
  toolGroupCount: number;
  toolGroupItems: number;
  maxExpandedDetails: number;
  documentOverflowPx: number;
  maxFollowingRowOverlapPx: number;
  maxRailAlignmentErrorPx: number;
  maxElbowCenterErrorPx: number;
  commandResultGapPx: number;
  uncaughtErrors: string[];
  longTasks: number[];
  error?: string;
};

export function AgentToolStabilitySmokeHarness() {
  const projection = useMemo(createSmokeProjection, []);

  useEffect(() => {
    const uncaughtErrors: string[] = [];
    const longTasks: number[] = [];
    const onError = (event: ErrorEvent) => uncaughtErrors.push(event.message || "window error");
    const onRejection = (event: PromiseRejectionEvent) => uncaughtErrors.push(String(event.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    const observer = typeof PerformanceObserver === "function"
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        })
      : null;
    try {
      observer?.observe({ entryTypes: ["longtask"] });
    } catch {
      // Older Chromium builds may not expose the long-task entry type.
    }

    let cancelled = false;
    void runSmoke().then((result) => {
      if (!cancelled) publish({ ...result, uncaughtErrors, longTasks });
    }).catch((error) => {
      if (!cancelled) publish({
        passed: false,
        durationMs: 0,
        fallbackCount: 0,
        mountedRows: 0,
        maxPreviewChars: 0,
        maxSearchRows: 0,
        previewCount: 0,
        searchContainerCount: 0,
        sentinelVisible: false,
        toolGroupCount: 0,
        toolGroupItems: 0,
        maxExpandedDetails: 0,
        documentOverflowPx: Number.POSITIVE_INFINITY,
        maxFollowingRowOverlapPx: Number.POSITIVE_INFINITY,
        maxRailAlignmentErrorPx: Number.POSITIVE_INFINITY,
        maxElbowCenterErrorPx: Number.POSITIVE_INFINITY,
        commandResultGapPx: Number.POSITIVE_INFINITY,
        uncaughtErrors,
        longTasks,
        error: error instanceof Error ? error.stack || error.message : String(error),
      });
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return <>
    <SubThemeStyleHost subTheme={BUILTIN_SUB_THEMES.find(theme => theme.id === "default.neutral")!}
      colorMode="dark" markdownPresentation={DEFAULT_MARKDOWN_PRESENTATION_SETTINGS} />
    <main className="desktop-agent-visual-smoke dark desktop-agent-tool-stability-smoke"
      data-po-appearance-root="true" data-root-theme-id="default" data-sub-theme-id="default.neutral">
      <section className="desktop-agent-boundary desktop-agent-tool-stability-panel">
        <AgentTranscript projection={projection} loading={false} runtimeLabel="Codex" />
      </section>
    </main>
  </>;
}

async function runSmoke(): Promise<Omit<SmokeResult, "uncaughtErrors" | "longTasks">> {
  await frames(2);
  const start = performance.now();
  const previewTools = new Set<number>();
  const searchTools = new Set<number>();
  let maxPreviewChars = 0;
  let maxSearchRows = 0;
  let maxExpandedDetails = 0;
  let maxFollowingRowOverlapPx = 0;
  const railErrors: number[] = [];
  const elbowErrors: number[] = [];
  const commandResultGaps: number[] = [];
  for (let cycle = 0; cycle < 11; cycle += 1) {
    const disclosures = Array.from(document.querySelectorAll<HTMLButtonElement>(".desktop-agent-tool-row:not(:disabled)"));
    for (const [index, disclosure] of disclosures.entries()) {
      disclosure.click();
      await frames(1);
      const previewLengths = Array.from(document.querySelectorAll<HTMLElement>(".desktop-agent-tool-text-evidence pre"))
        .map((node) => node.textContent?.length ?? 0);
      const searchRows = Array.from(document.querySelectorAll(".desktop-agent-search-results"))
        .map((node) => node.querySelectorAll(":scope > span, :scope > button").length);
      if (previewLengths.length > 0) previewTools.add(index);
      if (searchRows.length > 0) searchTools.add(index);
      maxPreviewChars = Math.max(maxPreviewChars, ...previewLengths);
      maxSearchRows = Math.max(maxSearchRows, ...searchRows);
      maxExpandedDetails = Math.max(
        maxExpandedDetails,
        document.querySelectorAll(".desktop-agent-tool-group-detail > .desktop-agent-tool-branch").length,
      );
      maxFollowingRowOverlapPx = Math.max(maxFollowingRowOverlapPx, followingRowOverlap());
      const geometry = measureVisibleEvidenceGeometry();
      railErrors.push(...geometry.railErrors);
      elbowErrors.push(...geometry.elbowErrors);
      commandResultGaps.push(...geometry.commandResultGaps);
    }
  }
  const durationMs = performance.now() - start;
  // Publish the screenshot after the final disclosure has finished fading in.
  await Promise.allSettled(Array.from(document.querySelectorAll(".desktop-agent-tool-branch"))
    .flatMap(node => node.getAnimations().map(animation => animation.finished)));
  await frames(1);
  const fallbackCount = document.querySelectorAll(".desktop-agent-activity-render-fallback").length;
  const mountedRows = document.querySelectorAll(".desktop-agent-virtual-row").length;
  const sentinelVisible = document.querySelector('.desktop-agent-virtual-row[data-kind="assistant"]') !== null;
  const toolGroupCount = document.querySelectorAll(".desktop-agent-tool-group").length;
  const toolGroupItems = document.querySelectorAll(".desktop-agent-tool-group-item").length;
  const documentOverflowPx = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  const evidenceGeometry = {
    maxRailAlignmentErrorPx: Math.max(0, ...railErrors),
    maxElbowCenterErrorPx: Math.max(0, ...elbowErrors),
    commandResultGapPx: commandResultGaps[0] ?? Number.POSITIVE_INFINITY,
  };
  const passed = fallbackCount === 1
    && sentinelVisible
    && mountedRows <= agentTimelineLimits.maxMountedRows
    && toolGroupCount === 1
    && toolGroupItems === 6
    && maxExpandedDetails === 1
    && maxFollowingRowOverlapPx <= 1
    && previewTools.size >= 3
    && maxPreviewChars <= agentToolEvidenceLimits.maxChars + 256
    && searchTools.size === 1
    && maxSearchRows <= 80
    && documentOverflowPx <= 1
    && evidenceGeometry.maxRailAlignmentErrorPx <= 1
    && evidenceGeometry.maxElbowCenterErrorPx <= 1
    && evidenceGeometry.commandResultGapPx >= 0
    && evidenceGeometry.commandResultGapPx <= 10;
  return {
    passed,
    durationMs,
    fallbackCount,
    mountedRows,
    maxPreviewChars,
    maxSearchRows,
    previewCount: previewTools.size,
    searchContainerCount: searchTools.size,
    sentinelVisible,
    toolGroupCount,
    toolGroupItems,
    maxExpandedDetails,
    documentOverflowPx,
    maxFollowingRowOverlapPx,
    ...evidenceGeometry,
    ...(passed ? {} : { error: "Agent tool stability DOM contract failed." }),
  };
}

function followingRowOverlap() {
  const detail = document.querySelector<HTMLElement>(".desktop-agent-tool-group-detail > .desktop-agent-tool-branch");
  const following = document.querySelector<HTMLElement>('.desktop-agent-virtual-row[data-kind="assistant"]');
  if (!detail || !following) return 0;
  return Math.max(0, detail.getBoundingClientRect().bottom - following.getBoundingClientRect().top);
}

function createSmokeProjection() {
  const projection = createAgentProjection();
  projection.sessionState = "active";
  projection.activities = [
    activity("many-lines", "command", "bash", Array.from({ length: 12_000 }, (_, index) => `line-${index}`).join("\n"), {
      command: "generate-many-lines",
    }),
    activity("long-line", "tool", "read", "x".repeat(64 * 1024), { path: "large-generated.txt" }),
    activity("search", "tool", "grep", Array.from({ length: 2_000 }, (_, index) => `src/file-${index}.ts:${index + 1}:match`).join("\n"), {
      pattern: "match",
    }),
    activity("nested", "tool", "webfetch", "request complete", {
      request: Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`field-${index}`, "x".repeat(4_096)])),
    }),
    activity("crash", "tool", smokeToolId, "ignored", {}),
    {
      id: "activity:file-change",
      turnId: "turn-smoke",
      itemId: "file-change",
      kind: "file-change",
      label: "updated fixture",
      status: "completed" as const,
      detail: {
        tool: "edit",
        path: "src/fixture.ts",
        changes: [{ path: "src/fixture.ts", additions: 2, deletions: 1, diff: "@@ -1,1 +1,2 @@\n-old\n+new\n+extra" }],
      },
      output: "",
      sequence: 6,
    },
  ];
  projection.messages = [{
    id: "assistant-sentinel",
    role: "assistant",
    turnId: "turn-smoke",
    itemId: null,
    text: "TOOL_STABILITY_SENTINEL",
    streaming: false,
    terminalState: "completed",
    sequence: 100,
  }];
  return projection;
}

function measureVisibleEvidenceGeometry() {
  const selectedItem = document.querySelector<HTMLElement>(".desktop-agent-tool-group-item.is-selected");
  const firstItem = document.querySelector<HTMLElement>(".desktop-agent-tool-group-item");
  const detail = document.querySelector<HTMLElement>(".desktop-agent-tool-group-detail");
  const commandNode = detail?.querySelector<HTMLElement>(".desktop-agent-evidence-node.is-command");
  const resultNode = detail?.querySelector<HTMLElement>(".desktop-agent-evidence-node.is-result");
  const fileNode = detail?.querySelector<HTMLElement>(".desktop-agent-tool-file-path")
    ?.closest<HTMLElement>(".desktop-agent-evidence-node.is-result");
  const commandLine = commandNode?.querySelector<HTMLElement>(".desktop-agent-command-line");
  const commandOutput = resultNode?.querySelector<HTMLElement>(".desktop-agent-command-output");
  const commandMarker = commandNode?.querySelector<HTMLElement>(".desktop-agent-evidence-marker");
  const fileRow = fileNode?.querySelector<HTMLElement>(".desktop-agent-tool-file-path");
  return {
    railErrors: selectedItem === firstItem && commandNode
      ? [railAlignmentError(selectedItem, commandNode)]
      : [],
    elbowErrors: [
      commandNode && commandMarker ? elbowCenterError(commandNode, commandMarker) : null,
      fileNode && fileRow ? elbowCenterError(fileNode, fileRow) : null,
    ].filter((value): value is number => value !== null),
    commandResultGaps: commandLine && commandOutput
      ? [commandOutput.getBoundingClientRect().top - commandLine.getBoundingClientRect().bottom]
      : [],
  };
}

function railAlignmentError(tool: HTMLElement | null | undefined, node: HTMLElement | null | undefined) {
  const icon = tool?.querySelector<HTMLElement>(".desktop-agent-tool-icon");
  if (!icon || !node) return Number.POSITIVE_INFINITY;
  const iconRect = icon.getBoundingClientRect();
  return Math.abs(iconRect.left + iconRect.width / 2 - node.getBoundingClientRect().left);
}

function elbowCenterError(node: HTMLElement | null | undefined, row: HTMLElement | null | undefined) {
  if (!node || !row) return Number.POSITIVE_INFINITY;
  const nodeRect = node.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const elbow = getComputedStyle(node, "::before");
  const elbowCenterY = nodeRect.top + Number.parseFloat(elbow.top) + Number.parseFloat(elbow.height);
  return Math.abs(elbowCenterY - (rowRect.top + rowRect.height / 2));
}

function activity(
  id: string,
  kind: "command" | "tool",
  tool: string,
  output: string,
  input: Record<string, unknown>,
) {
  return {
    id: `activity:${id}`,
    turnId: "turn-smoke",
    itemId: id,
    kind,
    label: id,
    status: "completed" as const,
    detail: { tool, input },
    output,
    sequence: ["many-lines", "long-line", "search", "nested", "crash"].indexOf(id) + 1,
  };
}

function frames(count: number): Promise<void> {
  if (count <= 0) return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => void frames(count - 1).then(resolve)));
}

function publish(result: SmokeResult) {
  (window as typeof window & { __PUPPYONE_AGENT_TOOL_STABILITY_SMOKE_RESULT__?: SmokeResult })
    .__PUPPYONE_AGENT_TOOL_STABILITY_SMOKE_RESULT__ = result;
}
