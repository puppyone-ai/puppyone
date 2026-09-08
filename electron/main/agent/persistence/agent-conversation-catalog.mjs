import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { historyNativeId } from "../../../../shared/agent-contract/history-schema.mjs";

const CATALOG_VERSION = 2;
const MAX_RECORDS = 500;

/** Durable metadata-only index. Native harnesses alone own the transcript. */
export function createAgentConversationCatalog({ filePath, logger = console, maxRecords = MAX_RECORDS } = {}) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new TypeError("Agent conversation catalog requires an absolute file path.");
  }
  const capacity = Number.isSafeInteger(maxRecords) && maxRecords > 0 ? Math.min(maxRecords, MAX_RECORDS) : MAX_RECORDS;
  let records = [];
  let loadPromise;
  let writeChain = Promise.resolve();
  let revision = 0;
  const changedAt = new Map();
  let truncated = false;

  function load() {
    if (!loadPromise) loadPromise = (async () => {
      try {
        const parsed = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
        if (![1, CATALOG_VERSION].includes(parsed?.version) || !Array.isArray(parsed.records)) {
          throw new Error("Agent conversation catalog has an unsupported format.");
        }
        const normalized = parsed.records.map(normalizeRecord);
        if (normalized.some((record) => !record)) throw new Error("Agent conversation catalog contains invalid metadata.");
        const nativeIds = new Set(normalized.map(nativeKey));
        const productIds = new Set(normalized.map((entry) => entry.sessionId));
        if (nativeIds.size !== normalized.length || productIds.size !== normalized.length) throw new Error("Agent conversation catalog contains conflicting identities.");
        truncated = parsed.truncated === true;
        records = normalized.sort(compareRecords);
      } catch (error) {
        if (error?.code === "ENOENT") return;
        logger.warn?.("Agent conversation catalog could not be read; preserving the existing file.");
        throw error;
      }
    })();
    return loadPromise;
  }

  async function persist(next, wasTruncated, guard) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporaryPath,
        `${JSON.stringify({ version: CATALOG_VERSION, records: next, truncated: wasTruncated }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 });
      guard?.();
      await fs.promises.rename(temporaryPath, filePath);
    } finally {
      await fs.promises.unlink(temporaryPath).catch(() => {});
    }
  }

  // Serialize the entire read/modify/persist operation, not only file writes.
  // Memory is published only after a successful atomic replacement.
  function mutate(operation, guard) {
    const result = writeChain.then(async () => {
      await load();
      guard?.();
      const draft = records.map(clone);
      const outcome = operation(draft);
      if (outcome.unchanged) return outcome.value;
      const next = draft.sort(compareRecords);
      const nextTruncated = truncated;
      await persist(next, nextTruncated, guard);
      revision += 1;
      const previousById = new Map(records.map((entry) => [entry.sessionId, entry]));
      for (const record of next) {
        const previous = previousById.get(record.sessionId);
        if (outcome.touched?.includes(record.sessionId) || JSON.stringify(previous) !== JSON.stringify(record)) {
          changedAt.set(record.sessionId, revision);
        }
      }
      records = next;
      truncated = nextTruncated;
      const retained = new Set(next.map((record) => record.sessionId));
      for (const id of changedAt.keys()) if (!retained.has(id)) changedAt.delete(id);
      return outcome.value;
    });
    writeChain = result.catch(() => {});
    return result;
  }

  async function read(operation) {
    await load();
    // Readers see the last atomically published snapshot, even while a write is settling.
    return operation();
  }

  function put(draft, value) {
    const normalized = normalizeRecord(value);
    if (!normalized) throw new TypeError("Agent conversation metadata is invalid.");
    const identity = nativeKey(normalized);
    const existing = draft.find((entry) => nativeKey(entry) === identity);
    if (existing && existing.sessionId !== normalized.sessionId) {
      throw new Error("Native conversation identity already has a product session id.");
    }
    const index = draft.findIndex((entry) => entry.sessionId === normalized.sessionId);
    if (index >= 0 && nativeKey(draft[index]) !== identity) throw new Error("Product session id cannot be rebound to a different native conversation.");
    if (index >= 0) draft.splice(index, 1);
    draft.push(normalized);
    return clone(normalized);
  }

  function upsert(draft, record) {
    const normalized = normalizeRecord({ ...record, sessionId: "native-candidate" });
    if (!normalized) throw new TypeError("Agent conversation metadata is invalid.");
    const existing = draft.find((entry) => nativeKey(entry) === nativeKey(normalized));
    return put(draft, {
      ...existing,
      ...Object.fromEntries(Object.entries(record).filter(([, value]) => value != null)),
      sessionId: existing?.sessionId ?? randomUUID(),
      updatedAtKnown: record.updatedAtKnown !== false,
      ...(record.updatedAtKnown === false && existing?.updatedAtKnown !== false && existing?.updatedAt
        ? { updatedAt: existing.updatedAt, createdAt: existing.createdAt, updatedAtKnown: true } : {}),
      // Discovery cannot change product-owned selections, archive or session observations.
      ...(existing ? Object.fromEntries(["archivedAt", "terminalState", "lastSequence", "selectedProviderId",
        "selectedModel", "selectedVariant", "selectedEffort", "selectedMode", "capabilityRevision"]
        .filter((key) => existing[key] != null).map((key) => [key, existing[key]])) : {}),
      origin: existing?.origin ?? "native-discovery",
      availability: "available",
      lastSeenAt: new Date().toISOString(),
      unavailableAt: null,
    });
  }

  function reconcile(draft, { workspaceRoot, runtimeId, sourceScopeId = "default", providerSessionIds,
    reconciledAt = new Date().toISOString(), startedRevision = revision }) {
    const seen = new Set(providerSessionIds);
    const unavailableSessionIds = [];
    let changed = false;
    for (let i = 0; i < draft.length; i += 1) {
      const entry = draft[i];
      if (entry.workspaceRoot !== path.resolve(workspaceRoot) || entry.runtimeId !== runtimeId
        || entry.sourceScopeId !== sourceScopeId || entry.archivedAt || seen.has(entry.providerSessionId)
        || (changedAt.get(entry.sessionId) ?? 0) > startedRevision) continue;
      unavailableSessionIds.push(entry.sessionId);
      if (entry.availability !== "unavailable") {
        draft[i] = { ...entry, availability: "unavailable", unavailableAt: reconciledAt };
        changed = true;
      }
    }
    return { unavailableSessionIds, changed };
  }

  const catalog = {
    // Reserve identity before a live Session becomes visible; reservation is not persistence proof.
    bindNative(record) {
      return mutate((draft) => {
        const candidate = normalizeRecord(record);
        if (!candidate) throw new TypeError("Agent conversation identity is invalid.");
        const existing = draft.find((entry) => nativeKey(entry) === nativeKey(candidate));
        if (existing) return { unchanged: true, value: clone(existing) };
        const saved = put(draft, { ...record, availability: "unverified" });
        return { value: saved, touched: [saved.sessionId] };
      });
    },
    save(record) {
      return mutate((draft) => {
        const existing = draft.find((entry) => entry.sessionId === safeId(record?.sessionId));
        const saved = put(draft, { ...existing, ...record,
          origin: existing?.origin ?? record?.origin ?? "puppyone",
          archivedAt: existing?.archivedAt ?? record?.archivedAt,
          availability: record?.availability ?? existing?.availability ?? "unverified",
        });
        return { value: saved, touched: [saved.sessionId] };
      });
    },
    upsertNative: (record) => mutate((draft) => {
      const saved = upsert(draft, record);
      return { value: saved, touched: [saved.sessionId] };
    }),
    // One native page is validated and committed atomically with an optional final reconciliation.
    applyNativePage({ entries, scope, reconcileMissing = false, guard }) {
      return mutate((draft) => {
        const saved = entries.map((record) => upsert(draft, record));
        const result = reconcileMissing ? reconcile(draft, scope) : { unavailableSessionIds: [] };
        return { touched: saved.map((record) => record.sessionId), value: { indexed: saved.length, unavailableSessionIds: result.unavailableSessionIds,
          sessions: saved, truncated } };
      }, guard);
    },
    reconcileNative: (scope) => mutate((draft) => {
      const result = reconcile(draft, scope);
      return { unchanged: !result.changed, value: { unavailableSessionIds: result.unavailableSessionIds } };
    }),
    markUnavailable: (id, unavailableAt = new Date().toISOString()) => update(id, { availability: "unavailable", unavailableAt }),
    archive: (id, archivedAt = new Date().toISOString()) => update(id, { archivedAt }),
    remove: (id) => mutate((draft) => {
      const index = draft.findIndex((entry) => entry.sessionId === safeId(id));
      if (index < 0) return { unchanged: true, value: false };
      draft.splice(index, 1);
      return { value: true };
    }),
    findById: (id, workspaceRoot = null) => read(() => clone(records.find((entry) => entry.sessionId === safeId(id)
      && (!workspaceRoot || entry.workspaceRoot === absolutePath(workspaceRoot))) ?? null)),
    findLatest: (workspaceRoot, runtimeId = null) => read(() => clone(records.find((entry) => !entry.archivedAt
      && entry.availability === "available" && entry.workspaceRoot === absolutePath(workspaceRoot)
      && (!runtimeId || entry.runtimeId === runtimeId)) ?? null)),
    list: (workspaceRoot = null, { runtimeId = null, includeArchived = false, includeUnavailable = false, includeUnverified = false } = {}) => read(() => records.filter((entry) => (
      (!workspaceRoot || entry.workspaceRoot === absolutePath(workspaceRoot)) && (!runtimeId || entry.runtimeId === runtimeId)
      && (includeArchived || !entry.archivedAt) && (includeUnavailable || entry.availability !== "unavailable")
      && (includeUnverified || entry.availability !== "unverified")
    )).map(clone)),
    listPage: (workspaceRoot, options = {}) => read(() => {
      const { runtimeId = null, includeArchived = false, cursor = null } = options;
      const scope = [absolutePath(workspaceRoot), runtimeId, Boolean(includeArchived)];
      const scopeId = createHash("sha256").update(JSON.stringify(scope)).digest("hex");
      let after = null;
      if (cursor) {
        let decoded;
        try { decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); } catch { throw new TypeError("History catalog cursor is invalid."); }
        if (decoded.scope !== scopeId || !isoDate(decoded.updatedAt) || !safeId(decoded.sessionId)) {
          throw new TypeError("History catalog cursor does not match this query.");
        }
        after = decoded;
      }
      const eligible = records.filter((entry) => entry.workspaceRoot === scope[0]
        && (!runtimeId || entry.runtimeId === runtimeId)
        && entry.availability !== "unverified" && (!after || compareRecords(entry, after) > 0));
      // Explicit removals share the page budget; absence from a page proves nothing.
      const page = eligible.slice(0, capacity);
      const visible = (entry) => entry.availability === "available" && (includeArchived || !entry.archivedAt);
      const sessions = page.filter(visible).map(clone);
      const last = page.at(-1);
      const excludedSessionIds = page.filter((entry) => !visible(entry)).map((entry) => entry.sessionId);
      return { sessions, excludedSessionIds, nextCursor: eligible.length > capacity
        ? Buffer.from(JSON.stringify({ scope: scopeId, updatedAt: last.updatedAt, sessionId: last.sessionId })).toString("base64url") : null };
    }),
    getRevision: () => read(() => revision),
    getCoverage: () => read(() => ({ truncated, capacity, retained: records.length })),
  };
  function update(id, patch) {
    return mutate((draft) => {
      const index = draft.findIndex((entry) => entry.sessionId === safeId(id));
      if (index < 0) return { unchanged: true, value: false };
      draft[index] = normalizeRecord({ ...draft[index], ...patch });
      return { value: true };
    });
  }
  return catalog;
}

function nativeKey(record) {
  return JSON.stringify([record.workspaceRoot, record.runtimeId, record.sourceScopeId, record.providerSessionId]);
}

function normalizeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sessionId = safeId(value.sessionId);
  const workspaceRoot = absolutePath(value.workspaceRoot);
  const runtimeId = safeId(value.runtimeId ?? value.runtime?.id);
  const providerSessionId = historyNativeId(value.providerSessionId);
  const createdAt = isoDate(value.createdAt);
  const updatedAt = isoDate(value.updatedAt);
  if (!sessionId || !workspaceRoot || !runtimeId || !providerSessionId || !createdAt || !updatedAt
    || (value.sourceScopeId != null && !historyNativeId(value.sourceScopeId))) return null;
  return compact({
    sessionId,
    workspaceRoot,
    runtimeId,
    runtime: normalizeRuntime(value.runtime, runtimeId),
    providerSessionId,
    sourceScopeId: historyNativeId(value.sourceScopeId) ?? "default",
    title: bounded(value.title, 500) || "Agent session",
    createdAt,
    updatedAt,
    ...(value.updatedAtKnown === false ? { updatedAtKnown: false } : {}),
    archivedAt: isoDate(value.archivedAt),
    terminalState: terminalState(value.terminalState),
    lastSequence: Number.isSafeInteger(value.lastSequence) && value.lastSequence >= 0 ? value.lastSequence : 0,
    partial: true,
    selectedProviderId: safeId(value.selectedProviderId) ?? providerIdFromModel(value.selectedModel ?? value.model),
    selectedModel: bounded(value.selectedModel ?? value.model, 512),
    selectedVariant: bounded(value.selectedVariant ?? value.variant, 160),
    selectedEffort: bounded(value.selectedEffort ?? value.effort, 160),
    selectedMode: bounded(value.selectedMode ?? value.mode, 160),
    capabilityRevision: bounded(value.capabilityRevision, 160),
    origin: value.origin === "native-discovery" ? "native-discovery" : "puppyone",
    availability: ["available", "unverified", "unavailable"].includes(value.availability)
      ? value.availability
      : value.origin === "native-discovery" ? "available" : "unverified",
    lastSeenAt: isoDate(value.lastSeenAt),
    unavailableAt: isoDate(value.unavailableAt),
  });
}

function normalizeRuntime(value, runtimeId) {
  const runtime = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return compact({
    id: runtimeId,
    displayName: bounded(runtime.displayName, 160) || runtimeId,
    kind: bounded(runtime.kind, 80),
    version: bounded(runtime.version, 80),
    source: bounded(runtime.source, 80),
    compatibility: bounded(runtime.compatibility, 120),
  });
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/.test(value) ? value : null;
}

function terminalState(value) {
  return ["idle", "running", "completed", "failed", "interrupted", "provider-exited", "outcome-unknown"].includes(value)
    ? value
    : "idle";
}

function providerIdFromModel(value) {
  if (typeof value !== "string") return null;
  const separator = value.indexOf("/");
  return separator > 0 ? safeId(value.slice(0, separator)) : null;
}

function absolutePath(value) {
  return typeof value === "string" && path.isAbsolute(value) ? path.resolve(value) : null;
}

function bounded(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) || null : null;
}

function isoDate(value) {
  if (typeof value !== "string" || value.length > 64) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry != null));
}

function clone(value) {
  return value ? structuredClone(value) : null;
}

function compareRecords(left, right) {
  return right.updatedAt.localeCompare(left.updatedAt) || left.sessionId.localeCompare(right.sessionId);
}
