import { randomUUID } from "node:crypto";
import path from "node:path";
import { redactSecretText } from "../../agent-events.mjs";
import { resolveAgentSessionHistoryPort } from "../../runtime/agent-session-history-port.mjs";
import { agentHistoryLimits, historyCursor, historyLocators, historyPageSize } from "../../../../../shared/agent-contract/history-schema.mjs";
import { historyFailure, observeHistoryOperation } from "./history-operation.mjs";

export const DEFAULT_NATIVE_CONVERSATION_DISCOVERY_TIMEOUT_MS = 15_000;
const CLEANUP_TIMEOUT_MS = 2_000;
const SCAN_TTL_MS = 5 * 60_000;

/** Bounded History scans own query resources and a metadata-only catalog port. */
export function createNativeConversationIndexer({ runtimeRegistry, runtimeResolutionCoordinator, catalog,
  processSupervisor, discoveryTimeoutMs = DEFAULT_NATIVE_CONVERSATION_DISCOVERY_TIMEOUT_MS,
  scanTimeoutMs = 10 * 60_000, maxPages = 100, maxEntries = 10_000, maxScans = 100 } = {}) {
  const scans = new Map();
  const latest = new Map();
  const resources = new Map();
  let disposed = false;

  function current(scan) {
    return !disposed && latest.get(scan.key) === scan && scans.get(scan.id) === scan;
  }
  function expire(scan, reason) {
    scan.controller?.abort(reason);
    scans.delete(scan.id);
    if (latest.get(scan.key) === scan) latest.delete(scan.key);
  }
  function refresh(request) {
    let scan;
    let cursor;
    try {
      if (disposed) throw historyFailure("History queries are closed.", "HISTORY_CLOSED", false);
      const now = Date.now();
      for (const entry of scans.values()) {
        if (entry.expiresAt <= now || now - entry.startedAt >= scanTimeoutMs) {
          expire(entry, historyFailure("History scan expired. Refresh history.", "HISTORY_SCAN_EXPIRED", false));
        }
      }
      const workspaceRoot = path.resolve(request.workspaceRoot);
      const runtimeId = request.runtimeId;
      const key = JSON.stringify([workspaceRoot, runtimeId]);
      cursor = historyCursor(request.cursor);
      const pageSize = historyPageSize(request.limit);
      if (cursor !== null) {
        scan = scans.get(request.scanId);
        if (!scan || scan.key !== key || !current(scan) || scan.nextCursor !== cursor || scan.pageSize !== pageSize) {
          throw historyFailure("History continuation is no longer valid. Refresh history.", "HISTORY_SCAN_EXPIRED", false);
        }
        if (scan.pending) return scan.pending;
      } else {
        if (request.scanId) throw historyFailure("History continuation is invalid.", "HISTORY_SCAN_EXPIRED", false);
        const previous = latest.get(key);
        if (previous) expire(previous, historyFailure("History scan was superseded.", "HISTORY_SCAN_EXPIRED", false));
        if (scans.size >= maxScans || (!resources.has(key) && resources.size >= maxScans)) throw historyFailure("Too many History scans. Try again after a scan finishes.");
        scan = { id: randomUUID(), key, workspaceRoot, runtimeId, startedAt: now, expiresAt: now + SCAN_TTL_MS,
          providerSessionIds: new Set(), cursors: new Set(), nextCursor: null, pages: 0, pageSize, snapshot: null,
          authoritative: true, sourceScopeId: null, startedRevision: null, pending: null };
        scans.set(scan.id, scan);
        latest.set(key, scan);
      }
      const operation = runPage(scan, cursor, pageSize).finally(() => {
        if (scan.pending === operation) scan.pending = null;
      });
      scan.pending = operation;
      return operation;
    } catch (error) {
      return Promise.resolve(failed(request.runtimeId, error));
    }
  }

  async function runPage(scan, cursor, limit) {
    const controller = new AbortController();
    scan.controller = controller;
    const remaining = Math.min(discoveryTimeoutMs, scanTimeoutMs - (Date.now() - scan.startedAt));
    const timer = setTimeout(() => controller.abort(historyFailure("History query timed out.")), Math.max(1, remaining));
    let adapter;
    let releaseResource;
    let indexed = 0;
    let commitPending = false;
    const guard = () => {
      if (!current(scan)) throw historyFailure("History scan was superseded. Refresh history.", "HISTORY_SCAN_EXPIRED", false);
      if (controller.signal.aborted) throw controller.signal.reason;
    };
    try {
      // Includes waiting for cleanup, runtime resolution, process admission and catalog submission.
      const page = await observeHistoryOperation(async () => {
        if (resources.has(scan.key)) await resources.get(scan.key);
        guard();
        resources.set(scan.key, new Promise((resolve) => { releaseResource = resolve; }));
        if (scan.startedRevision === null) scan.startedRevision = await catalog.getRevision();
        guard();
        const selected = await runtimeResolutionCoordinator.resolveForOperation({
          runtimeId: scan.runtimeId, workspaceRoot: scan.workspaceRoot, operation: "history",
        });
        guard();
        if (selected.descriptor.ownership?.session !== "runtime") return null;
        return processSupervisor.runStart({ label: `${scan.runtimeId}:history-discovery`, signal: controller.signal },
          () => observeHistoryOperation(async () => {
            guard();
            adapter = runtimeRegistry.createAdapter(scan.runtimeId, { readiness: selected.readiness,
              workspaceRoot: scan.workspaceRoot, onEvent: () => {}, onExit: () => {} });
            const port = resolveAgentSessionHistoryPort(adapter);
            if (typeof port?.discover !== "function") return null;
            const result = await port.discover({ cursor, limit, signal: controller.signal });
            guard();
            if (result?.supported === false) return null;
            if (result?.supported !== true) throw historyFailure("Native history returned an invalid result.");
            const locators = historyLocators(result.sessions, agentHistoryLimits.nativePage);
            const nextCursor = historyCursor(result.nextCursor);
            if (nextCursor && (nextCursor === cursor || scan.cursors.has(nextCursor))) {
              throw historyFailure("Native history cursor did not advance. Refresh history.", "HISTORY_CURSOR_LOOP", false);
            }
            if (scan.pages >= maxPages || scan.providerSessionIds.size + locators.length > maxEntries) {
              throw historyFailure("History scan reached its resource limit. Refresh history.", "HISTORY_SCAN_LIMIT", false);
            }
            const sourceScopeId = result.sourceScopeId ?? "default";
            if (typeof sourceScopeId !== "string" || !/^[A-Za-z0-9:._/-]{1,512}$/.test(sourceScopeId)) {
              throw historyFailure("Native history returned an invalid source identity.");
            }
            if (scan.sourceScopeId && sourceScopeId !== scan.sourceScopeId) {
              throw historyFailure("History source changed. Refresh history.", "HISTORY_SOURCE_CHANGED", false);
            }
            const snapshot = result.coverage?.snapshotId;
            const proof = result.coverage?.scopeComplete === true && typeof snapshot === "string"
              && snapshot.length > 0 && snapshot.length <= 1024;
            const authoritative = scan.authoritative && proof && (!scan.snapshot || scan.snapshot === snapshot);
            const seen = new Set([...scan.providerSessionIds, ...locators.map((entry) => entry.providerSessionId)]);
            guard();
            commitPending = true;
            const committed = await Promise.resolve().then(() => catalog.applyNativePage({
              entries: locators.map((locator) => ({ ...locator, workspaceRoot: scan.workspaceRoot,
                runtimeId: scan.runtimeId, runtime: selected.descriptor, sourceScopeId })),
              scope: { workspaceRoot: scan.workspaceRoot, runtimeId: scan.runtimeId, sourceScopeId,
                providerSessionIds: [...seen], startedRevision: scan.startedRevision },
              reconcileMissing: nextCursor === null && authoritative,
              guard,
            })).then((result) => {
              indexed = result.indexed;
              return result;
            }).finally(() => { commitPending = false; });
            guard();
            scan.pages += 1;
            scan.providerSessionIds = seen;
            scan.sourceScopeId = sourceScopeId;
            scan.authoritative = authoritative;
            scan.snapshot = snapshot ?? null;
            if (cursor) scan.cursors.add(cursor);
            scan.nextCursor = nextCursor;
            scan.expiresAt = Date.now() + SCAN_TTL_MS;
            return { nextCursor, authoritative, sourceScopeId, truncated: committed.truncated };
          }, controller.signal));
      }, controller.signal);
      guard();
      if (!page) {
        expire(scan);
        return response(scan.runtimeId, "unsupported");
      }
      if (!page.nextCursor) expire(scan);
      return { ...response(scan.runtimeId, page.nextCursor ? "partial" : "complete"), indexed,
        nextCursor: page.nextCursor, scanId: page.nextCursor ? scan.id : null, sourceScopeId: page.sourceScopeId,
        coverage: page.authoritative && !page.nextCursor ? "complete" : "unknown",
        warnings: page.truncated ? ["The local history catalog reached its capacity; some records are not retained."] : [],
      };
    } catch (error) {
      // List failures never invalidate live-session readiness or mutate its state.
      const retryable = !commitPending && error?.retryable !== false && current(scan);
      if (!retryable) expire(scan, error);
      return { ...failed(scan.runtimeId, error), indexed,
        ...(commitPending ? { catalogCommit: "pending", warnings: ["The history catalog write is still settling. Refresh history before continuing."] } : {}),
        retryable, nextCursor: retryable ? cursor : null, scanId: retryable && cursor ? scan.id : null };
    } finally {
      clearTimeout(timer);
      if (releaseResource) {
        // Keep a stalled cleanup quarantined; repeated refreshes cannot spawn more native resources.
        const cleanup = Promise.resolve().then(() => adapter?.dispose?.());
        const cleanupDone = cleanup.then(() => {
          releaseResource();
          resources.delete(scan.key);
        }, () => { /* Resource state is unknown; the source remains quarantined. */ });
        let cleanupTimer;
        await Promise.race([cleanupDone, new Promise((resolve) => { cleanupTimer = setTimeout(resolve, CLEANUP_TIMEOUT_MS); })]);
        clearTimeout(cleanupTimer);
      }
    }
  }
  return { refresh, dispose() {
    disposed = true;
    for (const scan of scans.values()) expire(scan, historyFailure("History queries are closed.", "HISTORY_CLOSED", false));
  } };
}

function response(runtimeId, status) {
  return { runtimeId, status, nextCursor: null, scanId: null, indexed: 0, warnings: [] };
}
function failed(runtimeId, error) {
  return { ...response(runtimeId, "failed"), retryable: error?.retryable !== false,
    warnings: [redactSecretText(error?.message || String(error)).slice(0, 4000)] };
}
