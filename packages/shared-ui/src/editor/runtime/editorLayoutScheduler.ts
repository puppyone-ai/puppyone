export type EditorLayoutReason = "host" | "geometry" | "content" | "navigation" | "typography" | "appearance";
export type EditorLayoutPhase = "prepare" | "read" | "write" | "commit" | "convergence";

/** read gathers host/widget boxes; write publishes them; commit lets each
 * engine update its own height map and reading anchor. */
export type EditorLayoutParticipant = Readonly<{
  prepare(): void;
  read(reasons: ReadonlySet<EditorLayoutReason>): boolean;
  write(): void;
  commit(): void;
  onError?(error: unknown, phase: EditorLayoutPhase): void;
}>;

type Entry = {
  element: HTMLElement;
  participant: EditorLayoutParticipant;
  reasons: Set<EditorLayoutReason>;
  observers: Set<() => void>;
  active: boolean;
  faulted: boolean;
};

export type EditorLayoutRegistration = Readonly<{
  invalidate(reason: EditorLayoutReason): void;
  observe(element: HTMLElement, changed: () => void): () => void;
  dispose(): void;
}>;

const MAX_PASSES = 3;
const coordinators = new WeakMap<Document, DocumentEditorLayout>();

/** One scheduler/ResizeObserver per DOM Document, no document-model data.
 * View state remains in the participant. Gestures, passive resize and async
 * content all share this queue. */
class DocumentEditorLayout {
  readonly entries = new Map<HTMLElement, Entry>();
  private pending = new Set<Entry>();
  private observed = new Map<HTMLElement, Set<() => void>>();
  private observer: ResizeObserver | null = null;
  private queued = false;
  private flushing = false;
  private hostDepth = 0;
  private hostPrepared = new Set<Entry>();
  private batches = 0;
  private commits = 0;
  private failures = 0;
  private maxPasses = 0;
  private recentBatchMs: number[] = [];

  constructor(private readonly document: Document) {}

  register(element: HTMLElement, participant: EditorLayoutParticipant): EditorLayoutRegistration {
    const previous = this.entries.get(element);
    if (previous) this.release(previous);
    const entry: Entry = { element, participant, reasons: new Set(), observers: new Set(), active: true, faulted: false };
    this.entries.set(element, entry);
    return {
      invalidate: reason => this.invalidate(entry, reason),
      observe: (target, changed) => this.observe(entry, target, changed),
      dispose: () => this.release(entry),
    };
  }

  private usable(entry: Entry): boolean {
    return entry.active && !entry.faulted && entry.element.isConnected && this.entries.get(entry.element) === entry;
  }

  private fail(entry: Entry, error: unknown, phase: EditorLayoutPhase) {
    entry.faulted = true;
    this.pending.delete(entry);
    entry.reasons.clear();
    for (const stop of [...entry.observers]) stop();
    this.failures += 1;
    // A broken provider must neither stop siblings nor poison later gestures.
    // Its error reporter is also isolated from the layout pipeline.
    try {
      if (entry.participant.onError) entry.participant.onError(error, phase);
      else console.error(`Editor layout failed during ${phase}`, error);
    } catch (reportError) {
      console.error("Editor layout error reporting failed", reportError);
    }
  }

  private invoke(entry: Entry, phase: Exclude<EditorLayoutPhase, "convergence">, reasons = new Set<EditorLayoutReason>()): boolean {
    if (!this.usable(entry)) return false;
    try {
      if (phase === "read") return entry.participant.read(reasons);
      entry.participant[phase]();
      return true;
    } catch (error) {
      this.fail(entry, error, phase);
      return false;
    }
  }

  private invalidate(entry: Entry, reason: EditorLayoutReason) {
    if (!entry.active || entry.faulted) return;
    entry.reasons.add(reason);
    this.pending.add(entry);
    if (this.queued || this.flushing || this.hostDepth) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; this.flush(); });
  }

  flush() {
    if (this.flushing || this.hostDepth || !this.pending.size) return;
    this.flushing = true;
    const start = performance.now();
    let passes = 0;
    try {
      while (this.pending.size && passes < MAX_PASSES) {
        passes += 1;
        const batch = [...this.pending];
        this.pending.clear();
        const ready: Entry[] = [];
        for (const entry of batch) {
          const reasons = entry.reasons;
          entry.reasons = new Set();
          if (this.invoke(entry, "read", reasons)) ready.push(entry);
        }
        // Publish every pane's geometry before asking any engine to measure.
        for (const entry of ready) this.invoke(entry, "write");
        for (const entry of ready) if (this.invoke(entry, "commit")) this.commits += 1;
      }
      for (const entry of [...this.pending]) {
        this.fail(entry, new Error(`Editor layout did not converge in ${MAX_PASSES} passes`), "convergence");
      }
    } finally {
      this.flushing = false;
      this.batches += 1;
      this.maxPasses = Math.max(this.maxPasses, passes);
      this.recentBatchMs.push(performance.now() - start);
      if (this.recentBatchMs.length > 128) this.recentBatchMs.shift();
    }
  }

  mutate(root: HTMLElement, mutate: () => void) {
    if (!this.hostDepth) this.flush();
    this.hostDepth += 1;
    for (const entry of this.entries.values()) {
      if (!root.contains(entry.element) || this.hostPrepared.has(entry)) continue;
      if (this.invoke(entry, "prepare")) this.hostPrepared.add(entry);
    }
    try {
      mutate();
    } finally {
      this.hostDepth -= 1;
      if (!this.hostDepth) {
        for (const entry of this.hostPrepared) this.invalidate(entry, "host");
        this.hostPrepared.clear();
        this.flush();
      }
    }
  }

  private observe(entry: Entry, element: HTMLElement, changed: () => void): () => void {
    if (!entry.active || entry.faulted) return () => {};
    if (!this.observer) {
      const Observer = this.document.defaultView?.ResizeObserver;
      if (Observer) this.observer = new Observer(entries => {
        for (const observation of entries) {
          for (const notify of [...(this.observed.get(observation.target as HTMLElement) ?? [])]) notify();
        }
        // Observer delivery is pre-paint. Never defer its geometry to rAF.
        this.flush();
      });
    }
    let callbacks = this.observed.get(element);
    if (!callbacks) {
      this.observed.set(element, callbacks = new Set());
      this.observer?.observe(element);
    }
    const notify = () => {
      if (!entry.active || entry.faulted) return;
      try { changed(); this.invalidate(entry, "geometry"); }
      catch (error) { this.fail(entry, error, "read"); }
    };
    callbacks.add(notify);
    let observing = true;
    const stop = () => {
      if (!observing) return;
      observing = false;
      callbacks.delete(notify);
      entry.observers.delete(stop);
      if (!callbacks.size) { this.observed.delete(element); this.observer?.unobserve(element); }
    };
    entry.observers.add(stop);
    return stop;
  }

  private release(entry: Entry) {
    if (!entry.active) return;
    entry.active = false;
    this.pending.delete(entry);
    this.hostPrepared.delete(entry);
    for (const stop of [...entry.observers]) stop();
    if (this.entries.get(entry.element) === entry) this.entries.delete(entry.element);
    if (!this.entries.size) { this.observer?.disconnect(); this.observer = null; }
  }

  snapshot() {
    return { participants: this.entries.size, observedElements: this.observed.size,
      pending: this.pending.size, batches: this.batches, commits: this.commits,
      failures: this.failures, maxPasses: this.maxPasses, recentBatchMs: [...this.recentBatchMs] };
  }
}

function coordinator(document: Document) {
  let value = coordinators.get(document);
  if (!value) coordinators.set(document, value = new DocumentEditorLayout(document));
  return value;
}

export function registerEditorLayoutParticipant(element: HTMLElement, participant: EditorLayoutParticipant): EditorLayoutRegistration {
  return coordinator(element.ownerDocument).register(element, participant);
}

export function commitEditorLayout(root: HTMLElement, mutate: () => void): void {
  coordinator(root.ownerDocument).mutate(root, mutate);
}

export function getEditorLayoutSnapshot(document: Document) {
  return coordinator(document).snapshot();
}
