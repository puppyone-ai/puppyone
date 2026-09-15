import { useEffect, useMemo, useState } from "react";
import { EditorView } from "@codemirror/view";
import { findDocumentSurface, findMarkdownSurfaceEditor, isDocumentSurfaceCommitted } from "./documentSurfaceProbe";
import type {
  DataNode,
  DataPort,
  RendererPerformanceSummary,
  Workspace,
} from "@puppyone/shared-ui";
import {
  DataWorkspace,
  getRendererPerformanceTracker,
  MarkdownLinkIndexCoordinator,
} from "@puppyone/shared-ui";

const SAMPLE_COUNT = readSampleTarget();
const COLD_FIRST_OPEN = readBooleanParameter("rendererPerformanceCold");
const ENABLE_LINK_INDEX = readBooleanParameter("rendererPerformanceLinkIndex");
const ENABLE_OVERSIZED_BLOCKS = readBooleanParameter("rendererPerformanceOversizedBlocks");
const WARMUP_COUNT = COLD_FIRST_OPEN ? 0 : 4;
const FILE_A = "performance-a.md";
const FILE_B = "performance-b.md";
const OVERSIZED_TABLE_FILE = "performance-oversized-table.md";

type OversizedTableSmokeResult = {
  logicalRows: number;
  mountedRowsInitial: number;
  mountedRowsAfterScroll: number;
  virtualStartAfterScroll: number;
  anchorCorrections: number;
  scrollSettleMs: number;
};

type RendererPerformanceSmokeResult = RendererPerformanceSummary & {
  structural?: {
    oversizedTable: OversizedTableSmokeResult;
  };
};

declare global {
  interface Window {
    __PUPPYONE_RENDERER_PERFORMANCE_SMOKE_RESULT__?: RendererPerformanceSmokeResult | {
      error: string;
    };
  }
}

export function RendererPerformanceSmokeHarness() {
  const [workspaceMounted, setWorkspaceMounted] = useState(true);
  const nodes = useMemo(() => makeExplorerNodes(1_000), []);
  const source = useMemo(() => makeMarkdown(10_000), []);
  const oversizedTableSource = useMemo(() => makeOversizedTable(1_000), []);
  const workspace = useMemo<Workspace>(() => ({
    id: "renderer-performance-smoke",
    name: "Renderer performance smoke",
    path: "/performance-smoke",
    status: "recording",
  }), []);
  const dataPort = useMemo<DataPort>(() => ({
    listChildren: async (folderPath) => folderPath ? [] : nodes,
    readFile: async (path, options) => {
      await nextTask(options?.signal);
      options?.signal?.throwIfAborted();
      return {
        path,
        name: path,
        type: "markdown",
        content: path === OVERSIZED_TABLE_FILE ? oversizedTableSource : source,
      };
    },
  }), [nodes, oversizedTableSource, source]);

  useEffect(() => {
    const tracker = getRendererPerformanceTracker();
    tracker.reset();
    let stopped = false;
    let nextFile = FILE_A;
    let warmupSamples = 0;
    let measuring = WARMUP_COUNT === 0;
    let timeoutId: number | null = null;
    let oversizedCheckStarted = false;
    let oversizedTableResult: OversizedTableSmokeResult | null = null;

    const finish = () => {
      if (stopped) return;
      stopped = true;
      window.setTimeout(() => {
        // The workspace retains its indexing worker for incremental saves.
        // Retire that measured fixture before allocating the independent worker
        // self-check; the scheduler intentionally admits one background worker.
        setWorkspaceMounted(false);
        window.setTimeout(runWorkerSelfCheck, 0);
      }, ENABLE_LINK_INDEX ? 1_500 : 0);
    };

    const runWorkerSelfCheck = () => {
      const coordinator = new MarkdownLinkIndexCoordinator();
      const workerStartedAt = performance.now();
      const request = coordinator.build([
        { path: "worker-source.md", name: "worker-source.md", content: "[target](worker-target.md)" },
        { path: "worker-target.md", name: "worker-target.md", content: "# Target" },
      ]);
      void request.promise.then((index) => {
        coordinator.cancel();
        if (index.indexedDocumentCount !== 2 || index.backlinks.length !== 1) {
          throw new Error("Markdown link index worker returned an invalid snapshot.");
        }
        tracker.recordOperation("markdown_link_worker_roundtrip", performance.now() - workerStartedAt);
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            const summary = tracker.getSummary();
            window.__PUPPYONE_RENDERER_PERFORMANCE_SMOKE_RESULT__ = oversizedTableResult
              ? { ...summary, structural: { oversizedTable: oversizedTableResult } }
              : summary;
          });
        });
      }).catch((error) => {
        coordinator.cancel();
        window.__PUPPYONE_RENDERER_PERFORMANCE_SMOKE_RESULT__ = {
          ...tracker.getSummary(),
          error: error instanceof Error ? error.message : String(error),
        };
      });
    };

    const selectNextFile = () => {
      if (stopped) return;
      const button = document.querySelector<HTMLButtonElement>(
        `[data-explorer-path="${nextFile}"]`,
      );
      if (!button) {
        window.requestAnimationFrame(selectNextFile);
        return;
      }
      nextFile = nextFile === FILE_A ? FILE_B : FILE_A;
      button.click();
    };

    const startOversizedTableCheck = () => {
      if (stopped || oversizedCheckStarted) return;
      const button = document.querySelector<HTMLButtonElement>(
        `[data-explorer-path="${OVERSIZED_TABLE_FILE}"]`,
      );
      if (!button) {
        window.requestAnimationFrame(startOversizedTableCheck);
        return;
      }
      oversizedCheckStarted = true;
      button.click();
    };

    const failPresentationContract = (message: string) => {
      if (stopped) return;
      stopped = true;
      window.__PUPPYONE_RENDERER_PERFORMANCE_SMOKE_RESULT__ = { ...tracker.getSummary(), error: message };
    };

    const verifyPendingPresentation = (documentId: string) => {
      const host = findMarkdownSurfaceEditor(documentId);
      const editor = host?.querySelector<HTMLElement>(".cm-editor") ?? null;
      if (!host || !editor) {
        failPresentationContract("Markdown base readiness did not expose an EditorView for presentation verification.");
        return false;
      }
      if (host.dataset.livePreview !== "true" || host.dataset.previewState !== "pending") {
        failPresentationContract(`Markdown source exposure gate was not pending at base readiness (${host.dataset.previewState ?? "missing"}).`);
        return false;
      }
      if (getComputedStyle(editor).visibility !== "hidden") {
        failPresentationContract("Markdown canonical source was visible before Live Preview committed.");
        return false;
      }
      return true;
    };

    const verifyReadyPresentation = (documentId: string) => {
      const host = findMarkdownSurfaceEditor(documentId);
      const editor = host?.querySelector<HTMLElement>(".cm-editor") ?? null;
      if (!host || !editor) {
        failPresentationContract("Markdown preview readiness did not retain an EditorView.");
        return false;
      }
      if (host.dataset.previewState !== "ready") {
        failPresentationContract(`Markdown preview did not atomically commit (${host.dataset.previewState ?? "missing"}).`);
        return false;
      }
      if (getComputedStyle(editor).visibility === "hidden") {
        failPresentationContract("Markdown Live Preview remained hidden after readiness committed.");
        return false;
      }
      return true;
    };

    const verifyOversizedTable = async () => {
      const editorElement = findMarkdownSurfaceEditor(OVERSIZED_TABLE_FILE);
      const editorView = editorElement ? EditorView.findFromDOM(editorElement) : null;
      const wrapper = editorElement?.querySelector<HTMLElement>(
        '.cm-md-table-widget-wrap[data-md-table-execution="windowed"]',
      ) ?? null;
      const table = wrapper?.querySelector<HTMLTableElement>(".cm-md-table-widget") ?? null;
      if (!editorView || !wrapper || !table) {
        throw new Error("Oversized table did not mount the windowed Markdown adapter.");
      }

      const logicalRows = Number(table.getAttribute("aria-rowcount"));
      const mountedRowsInitial = countMountedTableRows(table);
      if (logicalRows !== 1_001 || mountedRowsInitial <= 0 || mountedRowsInitial > 80) {
        throw new Error(
          `Oversized table initial bound failed (logical=${logicalRows}, mounted=${mountedRowsInitial}).`,
        );
      }

      const scrollRect = editorView.scrollDOM.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const tableTop = tableRect.top - scrollRect.top + editorView.scrollDOM.scrollTop;
      const startedAt = performance.now();
      editorView.scrollDOM.scrollTop = tableTop + tableRect.height * 0.62;
      editorView.scrollDOM.dispatchEvent(new Event("scroll"));
      await waitForAnimationFrames(2);
      await waitForDelay(180);
      await waitForAnimationFrames(1);

      const mountedRowsAfterScroll = countMountedTableRows(table);
      const virtualStartAfterScroll = Number(table.dataset.mdVirtualStart ?? "0");
      if (mountedRowsAfterScroll <= 0 || mountedRowsAfterScroll > 80 || virtualStartAfterScroll <= 0) {
        throw new Error(
          `Oversized table scroll bound failed (start=${virtualStartAfterScroll}, mounted=${mountedRowsAfterScroll}).`,
        );
      }
      oversizedTableResult = {
        logicalRows,
        mountedRowsInitial,
        mountedRowsAfterScroll,
        virtualStartAfterScroll,
        anchorCorrections: Number(table.dataset.mdAnchorCorrections ?? "0"),
        scrollSettleMs: performance.now() - startedAt,
      };
    };

    const waitForCommittedSurface = async (documentId: string) => {
      // preview_ready is emitted by the editor. The document host subsequently
      // commits its staged surface; inspect that exact surface after its handoff.
      const deadline = performance.now() + 2_000;
      while (!stopped) {
        await waitForAnimationFrames(1);
        if (isDocumentSurfaceCommitted(findDocumentSurface(documentId))) return true;
        if (performance.now() >= deadline) {
          failPresentationContract(`Document surface did not commit for ${documentId}.`);
          return false;
        }
      }
      return false;
    };

    const onPerformance = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId?: string; stage?: string }>).detail;
      if (!detail?.documentId) return;
      const documentId = detail.documentId;
      if (detail.stage === "editor_base_ready" && !verifyPendingPresentation(documentId)) return;
      if (detail.stage !== "preview_ready") return;
      if (detail.documentId === OVERSIZED_TABLE_FILE) {
        void waitForCommittedSurface(documentId)
          .then((committed) => committed ? verifyOversizedTable() : undefined)
          .then(() => { if (!stopped) finish(); })
          .catch((error: unknown) => failPresentationContract(
            error instanceof Error ? error.message : String(error),
          ));
        return;
      }
      void waitForCommittedSurface(documentId).then((committed) => {
        if (!committed || stopped || !verifyReadyPresentation(documentId)) return;
        if (!measuring) {
          warmupSamples += 1;
          if (warmupSamples >= WARMUP_COUNT) {
            tracker.reset();
            measuring = true;
          }
          window.requestAnimationFrame(selectNextFile);
          return;
        }
        const editorElement = findMarkdownSurfaceEditor(documentId);
        const editorView = editorElement ? EditorView.findFromDOM(editorElement) : null;
        if (!editorView) {
          failPresentationContract("Unable to resolve the CodeMirror view for input transaction sampling.");
          return;
        }
        editorView.dispatch({ changes: { from: 0, insert: "x" } });
        const summary = tracker.getSummary();
        if (summary.completedSamples >= SAMPLE_COUNT) {
          if (ENABLE_OVERSIZED_BLOCKS) window.requestAnimationFrame(startOversizedTableCheck);
          else finish();
          return;
        }
        window.requestAnimationFrame(selectNextFile);
      }).catch((error: unknown) => failPresentationContract(
        error instanceof Error ? error.message : String(error),
      ));
    };

    window.addEventListener("puppyone:renderer-performance", onPerformance);
    window.requestAnimationFrame(selectNextFile);
    timeoutId = window.setTimeout(() => {
      if (stopped) return;
      stopped = true;
      window.__PUPPYONE_RENDERER_PERFORMANCE_SMOKE_RESULT__ = {
        ...tracker.getSummary(),
        error: `Renderer performance smoke timed out after ${tracker.getSummary().completedSamples} samples.`,
      };
    }, 60_000);

    return () => {
      stopped = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      window.removeEventListener("puppyone:renderer-performance", onPerformance);
    };
  }, []);

  return (
    <div style={{ width: "1280px", height: "800px" }}>
      {workspaceMounted && <DataWorkspace
        workspace={workspace}
        dataPort={dataPort}
        showHeader={false}
        showExplorerRoot={false}
        showExplorerToolbar={false}
        showPreviewHeader={false}
        hidePreviewSourceView
        editorSaveMode="manual"
        defaultExplorerWidth={320}
        enableMarkdownLinkContentIndexing={ENABLE_LINK_INDEX}
      />}
    </div>
  );
}

function makeExplorerNodes(count: number): DataNode[] {
  return Array.from({ length: count }, (_, index) => {
    const path = index === 0
      ? FILE_A
      : index === 1
        ? FILE_B
        : index === 2
          ? OVERSIZED_TABLE_FILE
          : `document-${index}.md`;
    return {
      id: path,
      name: path,
      path,
      type: "markdown" as const,
    };
  });
}

function makeMarkdown(lineCount: number): string {
  const lines: string[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    if (index % 100 === 0) lines.push(`# Heading ${index}`);
    else if (index % 43 === 0) lines.push(`| row ${index} | **value** |`);
    else lines.push(`Paragraph ${index} with **bold**, _emphasis_, and [link](note-${index % 30}.md).`);
  }
  return lines.join("\n");
}

function makeOversizedTable(bodyRowCount: number): string {
  return [
    "| Name | Value |",
    "| --- | ---: |",
    ...Array.from({ length: bodyRowCount }, (_, index) => `| row ${index} | ${index} |`),
  ].join("\n");
}

function countMountedTableRows(table: HTMLTableElement): number {
  return table.querySelectorAll("tbody tr[data-md-table-body-index]").length;
}

function waitForAnimationFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const next = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      window.requestAnimationFrame(() => next(remaining - 1));
    };
    next(count);
  });
}

function waitForDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function nextTask(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timeoutId = window.setTimeout(resolve, 0);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timeoutId);
      reject(signal.reason);
    }, { once: true });
  });
}

function readSampleTarget(): number {
  const requested = Number.parseInt(
    new URLSearchParams(window.location.search).get("rendererPerformanceSamples") ?? "",
    10,
  );
  return Number.isFinite(requested) && requested > 0 ? requested : 30;
}

function readBooleanParameter(name: string): boolean {
  return new URLSearchParams(window.location.search).get(name) === "true";
}
