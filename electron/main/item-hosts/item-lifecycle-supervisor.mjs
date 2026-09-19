import { randomUUID } from "node:crypto";
import { hostError } from "../../../shared/item-host-contract/rpc.mjs";

/** Resource authority only. No transcript, PTY screen, or mutable business ledger. */
export function createItemLifecycleSupervisor({ maximumRecords = 4096 } = {}) {
  const records = new Map();
  const operations = new Map();
  const keyOf = (identity) => JSON.stringify([identity.ownerId, identity.projectContext?.projectId,
    identity.projectContext?.generation, identity.root, identity.kind, identity.itemId, identity.creationId]);
  const summary = (record) => ({
    executionId: record.executionId, kind: record.kind, itemId: record.itemId, creationId: record.creationId,
    projectContext: record.projectContext, desiredLifecycle: record.desiredLifecycle,
    observedLifecycle: record.observedLifecycle, cleanup: record.cleanup,
    operationId: record.operationId, revision: record.revision, errorCode: record.errorCode,
  });
  const assertActive = (record) => {
    if (record.desiredLifecycle !== "active") throw hostError("SESSION_STALE", "This execution has been terminated.");
  };
  function reserve(identity, { forTermination = false } = {}) {
    const key = keyOf(identity);
    const existing = records.get(key);
    if (existing) { assertActive(existing); throw hostError("SESSION_DUPLICATE", "This execution is already reserved."); }
    if (!forTermination && [...records.values()].some(record => record.desiredLifecycle === "active"
      && record.ownerId === identity.ownerId && record.root === identity.root && record.kind === identity.kind
      && record.itemId === identity.itemId && record.projectContext?.generation === identity.projectContext?.generation)) {
      throw hostError("SESSION_DUPLICATE", "This item already owns an active execution.");
    }
    // Do not evict tombstones: a delayed create must never resurrect a closed item.
    if (records.size >= maximumRecords) throw hostError("HOST_LIFECYCLE_BUDGET", "Execution management capacity is exhausted.");
    const record = { ...identity, key, executionId: randomUUID(), desiredLifecycle: "active",
      observedLifecycle: "starting", cleanup: "pending", operationId: null, revision: 0,
      errorCode: null, host: null, release: null, seal: null, pending: null };
    records.set(key, record);
    return record;
  }
  function attach(record, { host, release = () => {}, seal = () => {} }) {
    assertActive(record);
    record.host = host;
    record.release = release;
    record.seal = seal;
    record.revision++;
  }
  function cleanup(record) {
    if (record.pending) return record.pending;
    if (record.cleanup === "confirmed") return Promise.resolve(summary(record));
    record.cleanup = "running";
    record.errorCode = null;
    record.revision++;
    const startedAt = performance.now();
    const pending = Promise.resolve().then(async () => {
      // host.close owns the bounded normal exit and external escalation. Never
      // await a feature closeSession RPC before entering that outer supervision.
      await record.host?.close({ startedAt });
      record.observedLifecycle = "exited";
      await record.release?.();
      record.cleanup = "confirmed";
      // Retain the identity tombstone, not live process objects or closures.
      record.host = null;
      record.release = null;
      record.seal = null;
    }).catch(error => {
      record.cleanup = "unconfirmed";
      record.errorCode = typeof error?.code === "string" ? error.code : "HOST_CLEANUP_UNCONFIRMED";
    }).finally(() => { record.pending = null; record.revision++; });
    record.pending = pending.then(() => summary(record));
    return record.pending;
  }
  function terminateRecord(record, operationId = record.operationId ?? randomUUID()) {
    if (record.desiredLifecycle === "active") {
      const operationKey = `${record.ownerId}:${operationId}`;
      if (operations.has(operationKey) && operations.get(operationKey) !== record.key) {
        throw hostError("HOST_OPERATION_CONFLICT", "The operation identity belongs to another execution.");
      }
      operations.set(operationKey, record.key);
      record.desiredLifecycle = "terminated";
      record.observedLifecycle = record.host?.exited ? "exited" : "stopping";
      record.operationId = operationId;
      record.revision++;
      // Admission is already sealed even if an optional feature notification fails.
      try { record.seal?.(); } catch { /* External cleanup remains available. */ }
      void cleanup(record);
    }
    return summary(record);
  }
  function terminate(identity, operationId, { retry = false } = {}) {
    const key = keyOf(identity);
    const operationKey = `${identity.ownerId}:${operationId}`;
    const previous = operations.get(operationKey);
    if (previous && previous !== key) throw hostError("HOST_OPERATION_CONFLICT", "The operation identity belongs to another execution.");
    let record = records.get(key);
    if (!record) {
      if (retry) throw hostError("SESSION_STALE", "The execution is not registered.");
      // A close can overtake create IPC. Reserve a terminated tombstone now.
      record = reserve(identity, { forTermination: true });
    }
    // Repeated clicks may return the canonical receipt without allocating aliases.
    // Exhausting operation aliases must never block termination of owned resources.
    if (!record.operationId) operations.set(operationKey, key);
    const receipt = terminateRecord(record, operationId);
    if (retry && record.cleanup === "unconfirmed") void cleanup(record);
    return retry ? summary(record) : receipt;
  }
  async function close(record) {
    terminateRecord(record);
    const receipt = await cleanup(record);
    if (receipt.cleanup !== "confirmed") throw hostError(receipt.errorCode, "Execution cleanup is not confirmed; its ownership is retained.");
    return receipt;
  }
  return Object.freeze({
    reserve, attach, assertActive, summary, terminate, terminateRecord, close,
    markLive(record) { assertActive(record); record.observedLifecycle = "live"; record.revision++; },
    observeExit(record) { record.observedLifecycle = "exited"; record.revision++; },
    list: (predicate = () => true) => [...records.values()].filter(predicate).map(summary),
    async closeMatching(predicate) {
      const selected = [...records.values()].filter(predicate);
      const results = await Promise.allSettled(selected.map(close));
      const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, "Execution cleanup is incomplete.");
      return selected.length;
    },
  });
}
