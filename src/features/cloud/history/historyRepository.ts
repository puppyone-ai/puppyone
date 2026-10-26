import type { DesktopCloudSession, MutableSessionHandler } from "../../../lib/cloudApi";
import { getCloudHistory, getCloudHistoryDetail, type DesktopCloudHistory, type DesktopCloudHistoryCommit } from "../../../lib/cloudHistoryApi";
import { cloudCache, type CloudCacheContext } from "../cache/cloudCache";

type Flight<T> = { source?: Promise<T>; promise: Promise<T>; controller: AbortController; users: number; settled: boolean; timer?: ReturnType<typeof setTimeout> };
const flights = new Map<string, Flight<unknown>>();
export type HistoryContext = { session: DesktopCloudSession; projectId: string; apiBaseUrl: string | null; revisionKey?: string | null };

function context(value: HistoryContext, resource: string): CloudCacheContext {
  return { session: value.session, projectId: value.projectId, revision: value.revisionKey ?? "latest",
    resource: `history:${value.apiBaseUrl ?? value.session.api_base_url}:${resource}` };
}

function acquire<T>(key: CloudCacheContext, loader: (signal: AbortSignal) => Promise<T>) {
  cloudCache.activateSession(key.session);
  const id = JSON.stringify([key.session.user_id, key.session.session_generation, key.session.api_base_url,
    key.projectId, key.revision, key.resource]);
  const cached = cloudCache.read<T>(key, { allowStale: true });
  let flight = flights.get(id) as Flight<T> | undefined;
  if (flight?.source && !cloudCache.isPending(key, flight.source)) flight = undefined;
  if (!flight) {
    const controller = new AbortController();
    flight = { controller, users: 0, settled: false, promise: Promise.resolve(undefined as T) };
    const active = flight;
    active.source = cloudCache.load(key, () => loader(controller.signal), { ttlMs: 30_000, refresh: true });
    active.promise = active.source.catch(error => {
      if (flights.get(id) === active) cloudCache.discard(key);
      throw error;
    }).finally(() => { active.settled = true; if (flights.get(id) === active) flights.delete(id); });
    flights.set(id, active);
  }
  clearTimeout(flight.timer);
  flight.users += 1;
  const active = flight;
  let released = false;
  return { cached, promise: active.promise, release() {
    if (released) return;
    released = true;
    active.users -= 1;
    // A short grace period absorbs StrictMode/remount handoff. It is not a retry.
    if (!active.users && !active.settled) active.timer = setTimeout(() => {
      if (active.users || active.settled) return;
      if (flights.get(id) === active) { flights.delete(id); cloudCache.discard(key); }
      active.controller.abort();
    }, 100);
  } };
}

export function acquireHistoryPage(value: HistoryContext, cursor?: string | null, onSessionChange?: MutableSessionHandler) {
  return acquire<DesktopCloudHistory>(context(value, `page:${cursor ?? "first"}`), signal =>
    getCloudHistory(value.session, value.projectId, 80, onSessionChange, value.apiBaseUrl, cursor, { summary: true, signal }));
}

export function acquireHistoryDetail(value: HistoryContext, commitId: string) {
  return acquire<DesktopCloudHistoryCommit>(context(value, `detail:${commitId}`), signal =>
    getCloudHistoryDetail(value.session, value.projectId, commitId, value.apiBaseUrl, signal));
}
