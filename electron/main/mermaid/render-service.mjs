/** Application-owned finite queue. Rendering never executes in the UI process. */
export function createMermaidRenderService({ createHost, timeoutMs = 15_000, queueTimeoutMs = 30_000, idleMs = 30_000 }) {
  const jobs = new Map();
  let active = null;
  let host = null;
  let hostExit = null;
  let idleTimer = null;
  let disposed = false;
  const finish = (job, result) => {
    if (jobs.get(job.key) !== job) return;
    clearTimeout(job.timer); jobs.delete(job.key); job.resolve(result);
  };
  async function pump() {
    if (active || disposed) return;
    const job = jobs.values().next().value;
    if (!job) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { void stopHost().catch(() => undefined); }, idleMs);
      return;
    }
    clearTimeout(idleTimer); clearTimeout(job.timer); active = job;
    const startedAt = performance.now();
    job.timer = setTimeout(() => { void cancel(job.key, "Diagram rendering timed out.").catch((error) => {
      job.resolve({ ok: false, error: error.message });
    }); }, timeoutMs);
    try {
      if (hostExit) await hostExit;
      if (job.cancelled) return;
      host ??= createHost();
      const result = await host.render(job.request);
      if (!job.cancelled) {
        finish(job, { ok: true, ...result,
          timings: { ...result.timings, queueMs: startedAt - job.queuedAt, hostMs: performance.now() - startedAt } });
        active = null; void pump();
      }
    } catch (error) {
      if (!job.cancelled) {
        // A failed/crashed host is never reused. Exit must precede the next job.
        await cancel(job.key, String(error?.message || "Diagram renderer failed.").slice(0, 512))
          .catch((failure) => job.resolve({ ok: false, error: failure.message }));
      }
    }
  }
  async function stopHost() {
    if (hostExit) return hostExit;
    const stopped = host;
    hostExit = Promise.resolve().then(() => stopped?.stop()).then(() => {
      if (host === stopped) host = null;
    }).finally(() => { hostExit = null; });
    return hostExit;
  }
  async function cancel(key, reason = "Diagram rendering cancelled.") {
    const job = jobs.get(key);
    if (!job) return;
    if (job.stopping) return job.stopping;
    job.cancelled = true;
    clearTimeout(job.timer);
    job.stopping = (async () => {
      if (active === job) {
        await stopHost();
        active = null;
      }
      finish(job, { ok: false, error: reason });
      void pump();
    })().catch((error) => { job.stopping = null; throw error; });
    return job.stopping;
  }
  return {
    render(ownerId, request) {
      if (disposed) throw new Error("Diagram renderer has stopped.");
      validateRequest(request);
      const key = `${ownerId}:${request.id}`;
      if (jobs.has(key)) throw new Error("Duplicate diagram request identifier.");
      if (jobs.size >= 32 || [...jobs.values()].filter((job) => job.ownerId === ownerId).length >= 16) {
        throw new Error("The diagram render queue is full.");
      }
      return new Promise((resolve) => {
        const job = { key, ownerId, request, resolve, queuedAt: performance.now(), stopping: null, cancelled: false, timer: null };
        job.timer = setTimeout(() => { void cancel(key, "Diagram render queue timed out.").catch(() => undefined); }, queueTimeoutMs);
        jobs.set(key, job); void pump();
      });
    },
    cancel(ownerId, id) { return cancel(`${ownerId}:${id}`); },
    async releaseOwner(ownerId) {
      await Promise.all([...jobs.values()].filter((job) => job.ownerId === ownerId).map((job) => cancel(job.key)));
    },
    async dispose() {
      disposed = true; clearTimeout(idleTimer);
      await Promise.all([...jobs.keys()].map((key) => cancel(key)));
      await stopHost();
    },
  };
}

function validateRequest(request) {
  if (!request || typeof request.id !== "string" || !/^[\w-]{1,100}$/.test(request.id)
    || typeof request.source !== "string" || !request.source.trim()
    || Buffer.byteLength(request.source) > 128 * 1024
    || !request.config || typeof request.config !== "object" || Array.isArray(request.config)
    || Buffer.byteLength(JSON.stringify(request.config)) > 16 * 1024) {
    throw new Error("Invalid diagram render request.");
  }
}
