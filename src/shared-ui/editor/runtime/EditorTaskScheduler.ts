export type EditorTaskOwner = Readonly<{ scope: string; instance: string; generation: number }>;
export type EditorTaskState = "queued" | "starting" | "running" | "cancelling" | "exit-unconfirmed" | "exited";
export type EditorTaskRequest = Readonly<{
  owner: EditorTaskOwner;
  kind: string;
  inputBytes: number;
  maxInputBytes: number;
  priority?: "interactive" | "background";
  signal?: AbortSignal;
}>;
export type EditorTaskLease<T> = Readonly<{ id: string; value: T; close: () => Promise<void> }>;
type Allocation<T> = { value: T; stop: () => void | Promise<void> };
type Job = {
  id: string; request: EditorTaskRequest; state: EditorTaskState; queuedAt: number;
  start: () => Promise<Allocation<unknown>>; allocation?: Allocation<unknown>;
  resolve: (lease: EditorTaskLease<unknown>) => void; reject: (error: unknown) => void;
  controller: AbortController; timeout: ReturnType<typeof setTimeout> | null;
  removeAbort: () => void; stopping?: Promise<void>; exitListeners: Set<() => void>;
};

/** Versioned admission policy. Logical allocations are bounded; this is not an OS RSS quota. */
export const EDITOR_TASK_POLICY = Object.freeze({
  version: 1, maxActive: 4, maxPerOwner: 1, maxPerScope: 2, maxBackground: 1, maxQueued: 32, maxBackgroundQueued: 8,
  maxQueuedBytes: 128 * 1024 * 1024, queueTimeoutMs: 30_000, startTimeoutMs: 5_000,
  exitTimeoutMs: 2_000, agingMs: 5_000,
});

export class EditorTaskScheduler {
  private jobs = new Map<string, Job>();
  private sequence = 0;
  private lastOwner = "";
  constructor(private readonly policy = EDITOR_TASK_POLICY) {}

  snapshot(): readonly Readonly<{ id: string; owner: EditorTaskOwner; kind: string; state: EditorTaskState }>[] {
    return [...this.jobs.values()].map((job) => ({ id: job.id, owner: job.request.owner, kind: job.request.kind, state: job.state }));
  }

  acquire<T>(request: EditorTaskRequest, create: (signal: AbortSignal) => Allocation<T> | Promise<Allocation<T>>): Promise<EditorTaskLease<T>> {
    if (request.signal?.aborted) return Promise.reject(abortError());
    if (!Number.isFinite(request.inputBytes) || request.inputBytes < 0 || !Number.isFinite(request.maxInputBytes)
      || request.maxInputBytes <= 0 || request.inputBytes > request.maxInputBytes) return Promise.reject(new RangeError("Editor task input exceeds its budget."));
    const queued = [...this.jobs.values()].filter((job) => job.state === "queued");
    if ((request.priority === "background" && queued.filter((job) => job.request.priority === "background").length >= this.policy.maxBackgroundQueued)
      || queued.length >= this.policy.maxQueued || queued.reduce((sum, job) => sum + job.request.inputBytes, request.inputBytes) > this.policy.maxQueuedBytes) {
      return Promise.reject(new Error("The editor task queue is full."));
    }
    const id = `editor-task:${++this.sequence}`;
    const controller = new AbortController();
    const promise = new Promise<EditorTaskLease<T>>((resolve, reject) => {
      const job: Job = {
        id, request: Object.freeze({ ...request, owner: Object.freeze({ ...request.owner }) }),
        state: "queued", queuedAt: Date.now(), controller, timeout: null, removeAbort: () => undefined, exitListeners: new Set(),
        start: async () => create(controller.signal), resolve: (lease) => resolve(lease as EditorTaskLease<T>), reject,
      };
      const cancel = () => { void this.cancel(job, abortError()).catch(() => undefined); };
      request.signal?.addEventListener("abort", cancel, { once: true });
      job.removeAbort = () => request.signal?.removeEventListener("abort", cancel);
      job.timeout = setTimeout(() => { void this.cancel(job, new DOMException("Editor task queue timed out.", "TimeoutError")).catch(() => undefined); }, this.policy.queueTimeoutMs);
      this.jobs.set(id, job);
    });
    this.pump();
    return promise;
  }

  async retire(owner: Pick<EditorTaskOwner, "scope"> & Partial<Pick<EditorTaskOwner, "instance" | "generation">>): Promise<void> {
    const jobs = [...this.jobs.values()].filter((job) => job.request.owner.scope === owner.scope
      && (owner.instance === undefined || job.request.owner.instance === owner.instance)
      && (owner.generation === undefined || job.request.owner.generation === owner.generation));
    const results = await Promise.allSettled(jobs.map((job) => this.cancel(job, abortError())));
    const failures = results.flatMap((entry) => entry.status === "rejected" ? [entry.reason] : []);
    if (failures.length) throw new AggregateError(failures, "Some editor tasks have not confirmed exit.");
  }

  private pump(): void {
    const active = [...this.jobs.values()].filter((job) => job.state !== "queued");
    if (active.length >= this.policy.maxActive) return;
    const candidates = [...this.jobs.values()].filter((job) => job.state === "queued").sort((a, b) => {
      const score = (job: Job) => (job.request.priority === "background" ? 0 : 1) + Math.floor((Date.now() - job.queuedAt) / this.policy.agingMs);
      return score(b) - score(a) || Number(ownerKey(a.request.owner) === this.lastOwner) - Number(ownerKey(b.request.owner) === this.lastOwner) || a.queuedAt - b.queuedAt;
    });
    for (const job of candidates) {
      if (active.length >= this.policy.maxActive) break;
      if (active.filter((other) => ownerKey(other.request.owner) === ownerKey(job.request.owner)).length >= this.policy.maxPerOwner) continue;
      if (active.filter((other) => other.request.owner.scope === job.request.owner.scope).length >= this.policy.maxPerScope) continue;
      if (job.request.priority === "background" && active.filter((other) => other.request.priority === "background").length >= this.policy.maxBackground) continue;
      active.push(job); job.state = "starting"; this.lastOwner = ownerKey(job.request.owner);
      if (job.timeout) clearTimeout(job.timeout);
      job.timeout = setTimeout(() => { void this.cancel(job, new DOMException("Editor task startup timed out.", "TimeoutError")).catch(() => undefined); }, this.policy.startTimeoutMs);
      void this.start(job);
    }
  }

  private async start(job: Job): Promise<void> {
    try {
      job.allocation = await job.start();
      if (job.timeout) clearTimeout(job.timeout);
      job.timeout = null;
      if (job.controller.signal.aborted) { await this.stop(job); return; }
      job.state = "running";
      job.resolve({ id: job.id, value: job.allocation.value, close: () => this.stop(job) });
    } catch (error) {
      job.reject(error);
      if (job.allocation) {
        job.state = "exit-unconfirmed";
      } else this.exited(job);
    }
  }

  private async cancel(job: Job, error: unknown): Promise<void> {
    if (!this.jobs.has(job.id)) return;
    job.controller.abort(error); job.reject(error);
    if (job.state === "queued") { this.exited(job); return; }
    if (job.allocation) { await this.stop(job); return; }
    // A starting allocation may arrive after cancellation. Keep its slot until
    // start() has destroyed it; do not claim that signalling abort freed it.
    job.state = "exit-unconfirmed";
    await new Promise<void>((resolve, reject) => {
      const exited = () => { clearTimeout(timeout); resolve(); };
      const timeout = setTimeout(() => {
        job.exitListeners.delete(exited);
        reject(new Error("Editor task startup has not confirmed cancellation."));
      }, this.policy.exitTimeoutMs);
      job.exitListeners.add(exited);
    });
  }

  private stop(job: Job): Promise<void> {
    if (!this.jobs.has(job.id)) return Promise.resolve();
    if (job.stopping) return job.stopping;
    job.state = "cancelling";
    job.controller.abort(abortError());
    job.stopping = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { job.state = "exit-unconfirmed"; job.stopping = undefined; reject(new Error("Editor task exit could not be confirmed.")); }, this.policy.exitTimeoutMs);
      void Promise.resolve().then(() => job.allocation?.stop()).then(() => {
        clearTimeout(timeout); this.exited(job); resolve();
      }, (error) => { clearTimeout(timeout); job.state = "exit-unconfirmed"; job.stopping = undefined; reject(error); });
    });
    return job.stopping;
  }

  private exited(job: Job): void {
    job.state = "exited"; job.removeAbort();
    if (job.timeout) clearTimeout(job.timeout);
    this.jobs.delete(job.id);
    job.exitListeners.forEach((listener) => listener()); job.exitListeners.clear();
    this.pump();
  }
}

function ownerKey(owner: EditorTaskOwner): string { return JSON.stringify([owner.scope, owner.instance]); }
function abortError(): DOMException { return new DOMException("Editor task cancelled.", "AbortError"); }
export const editorTaskScheduler = new EditorTaskScheduler();
