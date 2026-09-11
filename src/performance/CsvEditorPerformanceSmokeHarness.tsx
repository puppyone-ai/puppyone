import { useEffect, useMemo } from "react";
import type { DataNode, DataPort, Workspace } from "@puppyone/shared-ui";
import { DataWorkspace } from "@puppyone/shared-ui";

const SAMPLE_COUNT = readSampleTarget();
const WARMUP_COUNT = 4;
const FILE_A = "performance-a.csv";
const FILE_B = "performance-b.csv";
const LARGE_FILE = "performance-10000x20.csv";
const WIDE_FILE = "performance-500x100.csv";

type Distribution = Readonly<{
  maximum: number;
  p50: number;
  p95: number;
  samples: number;
}>;

type CsvStructuralResult = Readonly<{
  logicalColumns: number;
  logicalRows: number;
  mountedCells: number;
  mountedColumns: number;
  mountedRows: number;
  rapidScrollCoverageMisses: number;
  rapidScrollPeakMountedCells: number;
  rapidScrollSamples: number;
  virtualColumnStartAfterScroll: number;
  virtualRowStartAfterScroll: number;
}>;

type CsvPerformanceSmokeResult = Readonly<{
  inputTransactions: Distribution;
  longTasks: { over50ms: number; total: number; entries: readonly { startTime: number; duration: number; phase: string }[] };
  openToProjection: Distribution;
  structural: {
    large: CsvStructuralResult;
    wide: CsvStructuralResult;
  };
}>;

declare global {
  interface Window {
    __PUPPYONE_CSV_PERFORMANCE_SMOKE_RESULT__?: CsvPerformanceSmokeResult | { error: string };
  }
}

export function CsvEditorPerformanceSmokeHarness() {
  const fixtures = useMemo(() => new Map([
    [FILE_A, makeCsv(500, 20)],
    [FILE_B, makeCsv(500, 20)],
    [LARGE_FILE, makeCsv(10_000, 20)],
    [WIDE_FILE, makeCsv(500, 100)],
  ]), []);
  const nodes = useMemo<DataNode[]>(() => [...fixtures.keys()].map((path) => ({
    id: path,
    name: path,
    path,
    type: "spreadsheet",
    mimeType: "text/csv",
  })), [fixtures]);
  const workspace = useMemo<Workspace>(() => ({
    id: "csv-performance-smoke",
    name: "CSV performance smoke",
    path: "/csv-performance-smoke",
    status: "recording",
  }), []);
  const dataPort = useMemo<DataPort>(() => {
    const versions = new Map<string, string>();
    return {
    listChildren: async (folderPath) => folderPath ? [] : nodes,
    readFile: async (path) => ({
      path,
      name: path,
      type: "spreadsheet",
      mimeType: "text/csv",
      content: fixtures.get(path) ?? "",
      version: versions.get(path) ?? "fixture-v1",
    }),
    documentPersistence: {
      kind: "local-fs",
      storageIdentity: "csv-performance-smoke",
      persist: async (request) => {
        // The fixture must acknowledge real storage changes: reattachment now
        // revalidates disk, so returning success without writing simulates an
        // external revert and measures a second parse instead of retained open.
        fixtures.set(request.path, request.content);
        versions.set(request.path, request.revision);
        return { ok: true, version: request.revision };
      },
    },
    };
  }, [fixtures, nodes]);

  useEffect(() => {
    let stopped = false;
    const longTasks: { startTime: number; duration: number }[] = [];
    const phases = [{ at: performance.now(), name: "initialization" }];
    const observer = typeof PerformanceObserver === "undefined"
      ? null
      : new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        });
    try {
      observer?.observe({ entryTypes: ["longtask"] });
    } catch {
      // Older Chromium builds may not expose Long Tasks to local file pages.
    }

    const run = async () => {
      const openDurations: number[] = [];
      const inputDurations: number[] = [];
      let nextFile = FILE_A;
      for (let sample = 0; sample < WARMUP_COUNT + SAMPLE_COUNT; sample += 1) {
        nextFile = nextFile === FILE_A ? FILE_B : FILE_A;
        const button = await waitForElement<HTMLButtonElement>(`[data-explorer-path="${nextFile}"]`);
        const openedAt = performance.now();
        phases.push({ at: openedAt, name: `open:${nextFile}` });
        button.click();
        const table = await waitForElement<HTMLTableElement>(
          `.csv-table-editor__table[aria-label="${nextFile}"]`,
        );
        await waitForAnimationFrames(1);
        const openDuration = performance.now() - openedAt;
        const input = table.querySelector<HTMLInputElement>(
          'input[data-csv-row="250"][data-csv-column="10"]',
        ) ?? table.querySelector<HTMLInputElement>("input[data-csv-row][data-csv-column]");
        if (!input || input.readOnly) throw new Error(`Editable CSV input is unavailable for ${nextFile}.`);
        const inputStartedAt = performance.now();
        setNativeInputValue(input, sample % 2 === 0 ? "edited-a" : "edited-b");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const inputDuration = performance.now() - inputStartedAt;
        if (sample >= WARMUP_COUNT) {
          openDurations.push(openDuration);
          inputDurations.push(inputDuration);
        }
      }

      phases.push({ at: performance.now(), name: "large:10000x20" });
      const large = await inspectFixture(LARGE_FILE, "row");
      phases.push({ at: performance.now(), name: "wide:500x100" });
      const wide = await inspectFixture(WIDE_FILE, "column");
      if (stopped) return;
      window.__PUPPYONE_CSV_PERFORMANCE_SMOKE_RESULT__ = {
        inputTransactions: summarize(inputDurations),
        longTasks: {
          over50ms: longTasks.filter(({ duration }) => duration > 50).length,
          total: longTasks.length,
          entries: longTasks.map((entry) => ({ ...entry, phase: phases.findLast((phase) => phase.at <= entry.startTime)?.name ?? "initialization" })),
        },
        openToProjection: summarize(openDurations),
        structural: { large, wide },
      };
    };

    void run().catch((error: unknown) => {
      if (stopped) return;
      window.__PUPPYONE_CSV_PERFORMANCE_SMOKE_RESULT__ = {
        error: error instanceof Error ? error.message : String(error),
      };
    });
    return () => {
      stopped = true;
      observer?.disconnect();
    };
  }, []);

  return (
    <div style={{ width: "1280px", height: "800px" }}>
      <DataWorkspace
        workspace={workspace}
        dataPort={dataPort}
        capabilities={{ write: true }}
        showHeader={false}
        showExplorerRoot={false}
        showExplorerToolbar={false}
        showPreviewHeader={false}
        hidePreviewSourceView
        editorSaveMode="manual"
        defaultExplorerWidth={320}
        enableMarkdownLinkContentIndexing={false}
      />
    </div>
  );
}

async function inspectFixture(path: string, axis: "row" | "column"): Promise<CsvStructuralResult> {
  const button = await waitForElement<HTMLButtonElement>(`[data-explorer-path="${path}"]`);
  button.click();
  const table = await waitForElement<HTMLTableElement>(
    `.csv-table-editor__table[aria-label="${path}"]`,
  );
  await waitForAnimationFrames(2);
  const scroll = table.closest(".csv-table-editor__scroll");
  if (!(scroll instanceof HTMLElement)) throw new Error(`CSV scroll owner is unavailable for ${path}.`);
  const rapidScroll = axis === "row"
    ? await inspectRapidVerticalScroll(table, scroll)
    : { coverageMisses: 0, peakMountedCells: 0, samples: 0 };
  if (axis === "column") {
    scroll.scrollLeft = Math.max(0, scroll.scrollWidth * 0.62);
    scroll.dispatchEvent(new Event("scroll"));
    await waitForAnimationFrames(3);
  }
  return {
    logicalColumns: Number(table.getAttribute("aria-colcount")) - 1,
    logicalRows: Number(table.getAttribute("aria-rowcount")),
    mountedCells: Number(table.dataset.csvMountedCells),
    mountedColumns: Number(table.dataset.csvMountedColumns),
    mountedRows: Number(table.dataset.csvMountedRows),
    rapidScrollCoverageMisses: rapidScroll.coverageMisses,
    rapidScrollPeakMountedCells: rapidScroll.peakMountedCells,
    rapidScrollSamples: rapidScroll.samples,
    virtualColumnStartAfterScroll: Number(table.dataset.csvVirtualColumnStart),
    virtualRowStartAfterScroll: Number(table.dataset.csvVirtualRowStart),
  };
}

async function inspectRapidVerticalScroll(
  table: HTMLTableElement,
  scroll: HTMLElement,
): Promise<{ coverageMisses: number; peakMountedCells: number; samples: number }> {
  const surface = table.closest(".csv-table-editor__surface");
  if (!(surface instanceof HTMLElement)) throw new Error("CSV virtual surface is unavailable.");
  const rowSize = Number.parseFloat(
    getComputedStyle(surface).getPropertyValue("--po-editable-table-row-min-height"),
  ) || 31;
  const hasHeader = surface.hasAttribute("data-header-enabled");
  const headerSize = hasHeader ? rowSize : 0;
  const logicalDataRows = Number(table.getAttribute("aria-rowcount")) - (hasHeader ? 1 : 0);
  const maximumScrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  let coverageMisses = 0;
  let peakMountedCells = 0;
  let samples = 0;

  scroll.scrollTop = 0;
  scroll.dispatchEvent(new Event("scroll"));
  await waitForAnimationFrames(2);
  const rapidRowTargets = [
    ...Array.from({ length: 18 }, (_, index) => (index + 1) * 28),
    ...Array.from({ length: 6 }, (_, index) => (17 - index) * 28),
  ];
  for (const rowTarget of rapidRowTargets) {
    scroll.scrollTop = Math.min(maximumScrollTop, rowTarget * rowSize);
    scroll.dispatchEvent(new Event("scroll"));
    await waitForAnimationFrames(1);

    const rowScrollOffset = Math.max(
      0,
      scroll.scrollTop - surface.offsetTop - headerSize,
    );
    const visibleStart = Math.floor(rowScrollOffset / rowSize);
    const visibleEnd = Math.min(
      logicalDataRows,
      Math.ceil(
        (rowScrollOffset + Math.max(rowSize, scroll.clientHeight - headerSize)) / rowSize,
      ),
    );
    const renderedStart = Number(table.dataset.csvVirtualRowStart);
    const renderedEnd = Number(table.dataset.csvVirtualRowEnd);
    if (renderedStart > visibleStart || renderedEnd < visibleEnd) coverageMisses += 1;
    peakMountedCells = Math.max(
      peakMountedCells,
      Number(table.dataset.csvMountedCells),
    );
    samples += 1;
  }
  await new Promise((resolve) => window.setTimeout(resolve, 170));
  await waitForAnimationFrames(2);
  return { coverageMisses, peakMountedCells, samples };
}

async function waitForElement<ElementType extends Element>(selector: string): Promise<ElementType> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const element = document.querySelector<ElementType>(selector);
    if (element) return element;
    await waitForAnimationFrames(1);
  }
  throw new Error(`Timed out waiting for ${selector}.`);
}

function summarize(values: readonly number[]): Distribution {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    maximum: sorted.at(-1) ?? 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    samples: sorted.length,
  };
}

function percentile(sorted: readonly number[], percentileValue: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
}

function makeCsv(rowCount: number, columnCount: number): string {
  return Array.from({ length: rowCount }, (_, rowIndex) => (
    Array.from({ length: columnCount }, (_, columnIndex) => `r${rowIndex}c${columnIndex}`).join(",")
  )).join("\n");
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
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

function readSampleTarget(): number {
  const requested = Number.parseInt(
    new URLSearchParams(window.location.search).get("csvPerformanceSamples") ?? "",
    10,
  );
  return Number.isFinite(requested) && requested > 0 ? requested : 30;
}
