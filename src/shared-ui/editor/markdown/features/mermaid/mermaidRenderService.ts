import type { MermaidConfig } from "mermaid";
import { acquireEditorHostLease } from "../../../runtime/EditorHostLeases";
import type { EditorTaskOwner } from "../../../runtime/EditorTaskScheduler";

export const MERMAID_MAX_SOURCE_BYTES = 128 * 1024;
export const MERMAID_MAX_SVG_BYTES = 4 * 1024 * 1024;
// Bump when engine, font assets or SVG policy changes. Cache is memory-only.
export const MERMAID_RENDER_VERSION = "mermaid-11.17.0-fonts-1-svg-2";
export type MermaidThemeSnapshot = { key: string; config: MermaidConfig };
export type MermaidRenderResult = { svg: string; cacheKey: string; themeKey: string };
export type MermaidRenderRequest = {
  source: string; theme?: MermaidThemeSnapshot; signal?: AbortSignal; owner?: EditorTaskOwner;
};
export type MermaidHostRequest = { source: string; config: MermaidConfig };
export type MermaidRenderTransport = {
  start(request: MermaidHostRequest): { result: Promise<string>; cancel: () => Promise<void> };
};
type Job = { result: Promise<MermaidRenderResult>; cancel: () => Promise<void>; users: number; settled: boolean };
const abortError = () => new DOMException("Mermaid render cancelled.", "AbortError");

/** Pure SVG work may be shared; each consumer retains its own L3 exit lease.
 * No principal, DOM node, asset capability or navigation callback is cached. */
export function createMermaidRenderService(sanitize: (svg: string) => string) {
  const cache = new Map<string, { result: MermaidRenderResult; bytes: number }>();
  const jobs = new Map<string, Job>();
  let cacheBytes = 0;
  let transport: MermaidRenderTransport | null = null;
  let anonymous = 0;
  const normalize = (source: string) => {
    if (new TextEncoder().encode(source).length > MERMAID_MAX_SOURCE_BYTES) throw new Error("Mermaid source exceeds the render limit.");
    const text = source.replace(/\r\n?/g, "\n").trim();
    if (!text) throw new Error("Mermaid diagram is empty.");
    return text;
  };
  const keyFor = (source: string, theme: MermaidThemeSnapshot) => `${MERMAID_RENDER_VERSION}\n${JSON.stringify(theme.config)}\n${normalize(source)}`;
  function peek(source: string, theme: MermaidThemeSnapshot) {
    const key = keyFor(source, theme);
    const entry = cache.get(key);
    if (!entry) return null;
    cache.delete(key); cache.set(key, entry);
    return entry.result;
  }
  function subscribe(source: string, theme: MermaidThemeSnapshot) {
    const cacheKey = keyFor(source, theme);
    let job = jobs.get(cacheKey);
    if (!job) {
      if (!transport) throw new Error("Mermaid render host is unavailable.");
      if (jobs.size >= 32) throw new Error("The diagram render queue is full.");
      const run = transport.start({ source: normalize(source), config: theme.config });
      const entry: Job = { users: 0, settled: false, cancel: run.cancel, result: run.result.then((raw) => {
        if (entry.users === 0) throw abortError();
        if (new TextEncoder().encode(raw).length > MERMAID_MAX_SVG_BYTES) throw new Error("Mermaid SVG exceeds the render limit.");
        const result = { svg: sanitize(raw), cacheKey, themeKey: theme.key };
        const bytes = new TextEncoder().encode(result.svg + cacheKey).length;
        cache.set(cacheKey, { result, bytes }); cacheBytes += bytes;
        while (cache.size > 48 || cacheBytes > 16 * 1024 * 1024) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cacheBytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
        }
        return result;
      }).finally(() => {
        entry.settled = true;
        if (jobs.get(cacheKey) === entry) jobs.delete(cacheKey);
      }) };
      job = entry; jobs.set(cacheKey, job);
    }
    job.users++;
    const shared = job;
    let released = false;
    let rejectConsumer: (reason: unknown) => void = () => undefined;
    const result = new Promise<MermaidRenderResult>((resolve, reject) => {
      rejectConsumer = reject;
      shared.result.then(resolve, reject);
    });
    // A close barrier can release before ready's consumer attaches.
    void result.catch(() => undefined);
    let stopping: Promise<void> | null = null;
    let cancellationRequired = false;
    return { value: result, release: () => {
      if (stopping) return stopping;
      if (!released) { released = true; shared.users--; rejectConsumer(abortError()); }
      if (shared.users === 0 && !shared.settled) {
        if (jobs.get(cacheKey) === shared) jobs.delete(cacheKey);
        cancellationRequired = true;
      }
      if (cancellationRequired) {
        stopping = shared.cancel().then(() => { cancellationRequired = false; })
          .catch((error) => { stopping = null; throw error; });
      } else stopping = Promise.resolve();
      return stopping;
    } };
  }
  return {
    configure(next: MermaidRenderTransport) { transport = next; },
    peek,
    async render(request: MermaidRenderRequest & { theme: MermaidThemeSnapshot }): Promise<MermaidRenderResult> {
      request.signal?.throwIfAborted();
      const cached = peek(request.source, request.theme);
      if (cached) return cached;
      const owner = request.owner ?? { scope: "renderer", instance: `mermaid:${++anonymous}`, generation: 0 };
      const lease = acquireEditorHostLease(owner, async () => {
        const nowCached = peek(request.source, request.theme);
        return nowCached ? { value: Promise.resolve(nowCached), release: async () => undefined }
          : subscribe(request.source, request.theme);
      }, request.signal);
      try { return await lease.ready; }
      finally { await lease.close(); }
    },
  };
}
