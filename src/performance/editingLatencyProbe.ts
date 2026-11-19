/**
 * Development-only probe for the two-window editing check: how many live
 * workspace requests one typing burst causes, and how long the main thread
 * stalls. Read it from DevTools with `__puppyoneEditingStats.report()`.
 */
type Counter = { count: number; totalMs: number; maxMs: number };
type EditingStats = Readonly<{
  report: () => Record<string, Counter | number>;
  reset: () => void;
}>;

declare global {
  interface Window { __puppyoneEditingStats?: EditingStats }
}

const requests = new Map<string, Counter>();
let longTasks = 0;
let longTaskMs = 0;
let since = Date.now();
let installed = false;

const enabled = () => import.meta.env.DEV && typeof window !== "undefined";

function install(): void {
  if (installed || !enabled()) return;
  installed = true;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) { longTasks += 1; longTaskMs += entry.duration; }
    }).observe({ type: "longtask", buffered: false });
  } catch { /* Long-task timing is unavailable in this renderer. */ }
  window.__puppyoneEditingStats = {
    report: () => ({
      ...Object.fromEntries(requests),
      longTasksOver50ms: longTasks,
      longTaskMs: Math.round(longTaskMs),
      seconds: Math.round((Date.now() - since) / 1000),
    }),
    reset: () => { requests.clear(); longTasks = 0; longTaskMs = 0; since = Date.now(); },
  };
}

/** Count one workspace request by method and endpoint, without its query. */
export function recordWorkspaceRequest(method: string, endpoint: string, durationMs: number): void {
  if (!enabled()) return;
  install();
  const key = `${method.toUpperCase()} ${endpoint.split("?")[0] || "/"}`;
  const counter = requests.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 };
  counter.count += 1;
  counter.totalMs = Math.round(counter.totalMs + durationMs);
  counter.maxMs = Math.max(counter.maxMs, Math.round(durationMs));
  requests.set(key, counter);
}
