export type RendererPerformanceStage =
  | "file_select"
  | "preview_shell_committed"
  | "content_ready"
  | "editor_base_ready"
  | "markdown_language_ready"
  | "preview_ready";

export type RendererPerformanceTrace = {
  id: string;
  documentId: string;
  startedAt: number;
  status: "active" | "cancelled" | "complete";
  stages: Partial<Record<RendererPerformanceStage, number>>;
};

export type RendererPerformanceSummary = {
  generatedAt: string;
  userAgent: string;
  completedSamples: number;
  staleCommitCount: number;
  longTasks: {
    count: number;
    over50ms: number;
    maxDuration: number;
    entries: Array<{ startTime: number; duration: number }>;
  };
  inputTransactions: {
    samples: number;
    p50: number;
    p95: number;
    max: number;
  };
  operations: Record<string, {
    samples: number;
    p50: number;
    p95: number;
    max: number;
  }>;
  stages: Partial<Record<RendererPerformanceStage, {
    samples: number;
    p50: number;
    p95: number;
    max: number;
  }>>;
  traces: RendererPerformanceTrace[];
};

const MAX_RETAINED_TRACES = 240;
const MAX_RETAINED_LONG_TASKS = 240;
const MAX_RETAINED_METRIC_SAMPLES = 512;
const MAX_RETAINED_OPERATION_NAMES = 64;
const GLOBAL_TRACKER_KEY = "__PUPPYONE_RENDERER_PERFORMANCE__";

export class RendererPerformanceTracker {
  private sequence = 0;
  private activeTraceId: string | null = null;
  private readonly traces = new Map<string, RendererPerformanceTrace>();
  private readonly longTaskEntries: Array<{ startTime: number; duration: number }> = [];
  private readonly inputTransactionDurations = new BoundedNumberSamples(MAX_RETAINED_METRIC_SAMPLES);
  private readonly operationDurations = new Map<string, BoundedNumberSamples>();
  private staleCommitCount = 0;
  private longTaskCount = 0;
  private longTaskOver50msCount = 0;
  private longTaskMaxDuration = 0;
  private observer: PerformanceObserver | null = null;
  private measurementStartedAt = now();

  constructor() {
    this.observeLongTasks();
  }

  beginFileSelection(documentId: string): string {
    if (this.activeTraceId) this.cancel(this.activeTraceId);
    this.sequence += 1;
    const id = `file-open:${this.sequence}`;
    const trace: RendererPerformanceTrace = {
      id,
      documentId,
      startedAt: now(),
      status: "active",
      stages: { file_select: 0 },
    };
    this.traces.set(id, trace);
    this.activeTraceId = id;
    this.trim();
    markBrowserPerformance(id, "file_select", documentId);
    this.emit(trace, "file_select", 0);
    return id;
  }

  mark(traceId: string, stage: Exclude<RendererPerformanceStage, "file_select">): boolean {
    const trace = this.traces.get(traceId);
    // Editing can notify content readiness again after the open has completed.
    // Repeated observations of an already recorded stage keep its first timing;
    // cancelled traces and previously unseen late stages remain stale commits.
    if (trace?.status === "complete" && typeof trace.stages[stage] === "number") return true;
    if (!trace || trace.status !== "active") {
      this.staleCommitCount += 1;
      return false;
    }
    if (typeof trace.stages[stage] === "number") return true;
    const duration = Math.max(0, now() - trace.startedAt);
    trace.stages[stage] = duration;
    if (stage === "preview_ready") {
      trace.status = "complete";
      if (this.activeTraceId === traceId) this.activeTraceId = null;
    }
    markBrowserPerformance(trace.id, stage, trace.documentId);
    this.emit(trace, stage, duration);
    return true;
  }

  markActiveDocument(
    documentId: string,
    stage: Exclude<RendererPerformanceStage, "file_select">,
  ): boolean {
    if (!this.activeTraceId) return false;
    const trace = this.traces.get(this.activeTraceId);
    if (!trace) return false;
    if (trace.documentId !== documentId) {
      this.staleCommitCount += 1;
      return false;
    }
    return this.mark(trace.id, stage);
  }

  cancel(traceId: string) {
    const trace = this.traces.get(traceId);
    if (!trace || trace.status !== "active") return;
    trace.status = "cancelled";
    if (this.activeTraceId === traceId) this.activeTraceId = null;
  }

  recordStaleCommit() {
    this.staleCommitCount += 1;
  }

  recordInputTransaction(duration: number) {
    if (!Number.isFinite(duration) || duration < 0) return;
    this.inputTransactionDurations.push(duration);
  }

  recordOperation(name: string, duration: number) {
    if (!Number.isFinite(duration) || duration < 0) return;
    let samples = this.operationDurations.get(name);
    if (!samples) {
      if (this.operationDurations.size >= MAX_RETAINED_OPERATION_NAMES) {
        const oldestName = this.operationDurations.keys().next().value;
        if (oldestName) this.operationDurations.delete(oldestName);
      }
      samples = new BoundedNumberSamples(MAX_RETAINED_METRIC_SAMPLES);
      this.operationDurations.set(name, samples);
    }
    samples.push(duration);
  }

  reset() {
    this.sequence = 0;
    this.activeTraceId = null;
    this.traces.clear();
    this.longTaskEntries.length = 0;
    this.inputTransactionDurations.clear();
    this.operationDurations.clear();
    this.staleCommitCount = 0;
    this.longTaskCount = 0;
    this.longTaskOver50msCount = 0;
    this.longTaskMaxDuration = 0;
    this.measurementStartedAt = now();
    if (typeof performance !== "undefined") {
      clearBrowserPerformanceEntries();
    }
  }

  getSummary(): RendererPerformanceSummary {
    const traces = [...this.traces.values()].map((trace) => ({
      ...trace,
      stages: { ...trace.stages },
    }));
    const completed = traces.filter((trace) => trace.status === "complete");
    const inputTransactions = this.inputTransactionDurations.values()
      .sort((left, right) => left - right);
    const operations: RendererPerformanceSummary["operations"] = {};
    for (const [name, durations] of this.operationDurations) {
      const samples = durations.values().sort((left, right) => left - right);
      operations[name] = {
        samples: samples.length,
        p50: percentile(samples, 0.5),
        p95: percentile(samples, 0.95),
        max: samples[samples.length - 1] ?? 0,
      };
    }
    const stageSummary: RendererPerformanceSummary["stages"] = {};
    for (const stage of [
      "preview_shell_committed",
      "content_ready",
      "editor_base_ready",
      "markdown_language_ready",
      "preview_ready",
    ] as const) {
      const samples = completed
        .map((trace) => trace.stages[stage])
        .filter((value): value is number => typeof value === "number")
        .sort((left, right) => left - right);
      if (samples.length === 0) continue;
      stageSummary[stage] = {
        samples: samples.length,
        p50: percentile(samples, 0.5),
        p95: percentile(samples, 0.95),
        max: samples[samples.length - 1] ?? 0,
      };
    }

    return {
      generatedAt: new Date().toISOString(),
      userAgent: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
      completedSamples: completed.length,
      staleCommitCount: this.staleCommitCount,
      longTasks: {
        count: this.longTaskCount,
        over50ms: this.longTaskOver50msCount,
        maxDuration: this.longTaskMaxDuration,
        entries: this.longTaskEntries.map((entry) => ({ ...entry })),
      },
      inputTransactions: {
        samples: inputTransactions.length,
        p50: percentile(inputTransactions, 0.5),
        p95: percentile(inputTransactions, 0.95),
        max: inputTransactions[inputTransactions.length - 1] ?? 0,
      },
      operations,
      stages: stageSummary,
      traces,
    };
  }

  dispose() {
    this.observer?.disconnect();
    this.observer = null;
  }

  private observeLongTasks() {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const supported = PerformanceObserver.supportedEntryTypes ?? [];
      if (!supported.includes("longtask")) return;
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime >= this.measurementStartedAt) {
            this.longTaskCount += 1;
            if (entry.duration > 50) this.longTaskOver50msCount += 1;
            this.longTaskMaxDuration = Math.max(this.longTaskMaxDuration, entry.duration);
            this.longTaskEntries.push({ startTime: entry.startTime, duration: entry.duration });
            if (this.longTaskEntries.length > MAX_RETAINED_LONG_TASKS) {
              this.longTaskEntries.splice(0, this.longTaskEntries.length - MAX_RETAINED_LONG_TASKS);
            }
          }
        }
      });
      this.observer.observe({ type: "longtask", buffered: true });
    } catch {
      this.observer = null;
    }
  }

  private emit(
    trace: RendererPerformanceTrace,
    stage: RendererPerformanceStage,
    duration: number,
  ) {
    if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
    window.dispatchEvent(new CustomEvent("puppyone:renderer-performance", {
      detail: { traceId: trace.id, documentId: trace.documentId, stage, duration },
    }));
  }

  private trim() {
    while (this.traces.size > MAX_RETAINED_TRACES) {
      const oldest = this.traces.keys().next().value;
      if (!oldest) break;
      this.traces.delete(oldest);
    }
  }
}

class BoundedNumberSamples {
  private readonly buffer: number[];
  private nextIndex = 0;
  private sampleCount = 0;

  constructor(private readonly capacity: number) {
    this.buffer = new Array<number>(capacity);
  }

  push(value: number) {
    this.buffer[this.nextIndex] = value;
    this.nextIndex = (this.nextIndex + 1) % this.capacity;
    this.sampleCount = Math.min(this.capacity, this.sampleCount + 1);
  }

  values(): number[] {
    if (this.sampleCount < this.capacity) return this.buffer.slice(0, this.sampleCount);
    return [
      ...this.buffer.slice(this.nextIndex),
      ...this.buffer.slice(0, this.nextIndex),
    ];
  }

  clear() {
    this.buffer.length = this.capacity;
    this.nextIndex = 0;
    this.sampleCount = 0;
  }
}

export function getRendererPerformanceTracker(): RendererPerformanceTracker {
  const globalObject = globalThis as typeof globalThis & {
    [GLOBAL_TRACKER_KEY]?: RendererPerformanceTracker;
  };
  globalObject[GLOBAL_TRACKER_KEY] ??= new RendererPerformanceTracker();
  return globalObject[GLOBAL_TRACKER_KEY];
}

function percentile(sortedValues: readonly number[], quantile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * quantile) - 1));
  return sortedValues[index] ?? 0;
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function markBrowserPerformance(
  traceId: string,
  stage: RendererPerformanceStage,
  documentId: string,
) {
  if (typeof performance === "undefined") return;
  const markName = `puppyone-renderer:${traceId}:${stage}`;
  try {
    performance.mark(markName, { detail: { traceId, stage, documentId } });
    if (stage !== "file_select") {
      performance.measure(
        `puppyone-renderer:${traceId}:file_select_to_${stage}`,
        `puppyone-renderer:${traceId}:file_select`,
        markName,
      );
    }
  } catch {
    // Performance mark support must never affect the interaction path.
  }
}

function clearBrowserPerformanceEntries() {
  for (const entryType of ["mark", "measure"] as const) {
    for (const entry of performance.getEntriesByType(entryType)) {
      if (!entry.name.startsWith("puppyone-renderer:")) continue;
      if (entryType === "mark") performance.clearMarks(entry.name);
      else performance.clearMeasures(entry.name);
    }
  }
}
