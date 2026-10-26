import { cloudApiRequest, type DesktopCloudSession } from "../../../lib/cloudApi";
import { cloudCache, type CloudCacheContext } from "../cache/cloudCache";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";

/** Resource-scoped reads shared by preflight and mounted Cloud workbenches. */
export function createCloudFileReads(session: DesktopCloudSession,
  context: Extract<ProjectCloudContext, { status: "resolved" }>, apiBaseUrl: string, scopePath: string) {
  const key = (resource: string, path: string): CloudCacheContext => ({
    session: { ...session, api_base_url: apiBaseUrl }, projectId: context.projectId,
    revision: JSON.stringify([context.target, scopePath, [...(context.capabilities ?? [])].sort()]),
    resource: `workbench:${resource}`, path,
  });
  const invalidate = () => cloudCache.invalidate({ projectId: context.projectId });
  return {
    invalidate,
    peek: <T>(resource: string, path: string) => cloudCache.read<T>(key(resource, path), { allowStale: true }),
    load: <T>(resource: string, path: string, loader: () => Promise<T>, ttlMs = 0) =>
      cloudCache.load(key(resource, path), loader, { ttlMs }),
    // A shared request belongs to its authenticated resource, not whichever
    // component requested it first. Each consumer checks its own UI lease.
    fetch: <T>(endpoint: string) => cloudApiRequest<T>(`/content/${encodeURIComponent(context.projectId)}/${endpoint}`,
      session, undefined, {}, apiBaseUrl).catch((error: unknown) => {
      if (error && typeof error === "object" && "status" in error && (error.status === 401 || error.status === 403)) invalidate();
      throw error;
    }),
  };
}

/** Cancelling one editor must not cancel another consumer's shared request. */
export function waitForCloudRead<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => { cleanup(); if (!signal.aborted) resolve(value); }, (error) => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
