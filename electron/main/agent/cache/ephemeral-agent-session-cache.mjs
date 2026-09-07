import { nativeSessionId } from "../../../../shared/agent-contract/native-session-id.mjs";
import fs from "node:fs";
import path from "node:path";
import { countTextBytes, isAgentEventEnvelope, redactSecrets } from "../agent-events.mjs";
import { canonicalRuntimeId } from "../migrations/legacy-session-format.mjs";

const MAX_SESSIONS = 8;
const MAX_EVENTS_PER_SESSION = 1_000;
const MAX_SESSION_BYTES = 2 * 1024 * 1024;
const LEGACY_JOURNAL_FILENAME = "desktop-agent-sessions.json";

/**
 * Process-local recovery cache for currently active Agent connections.
 *
 * PuppyOne does not own Chat History. This cache never writes transcripts or
 * native session ids to disk and disappears with the Electron main process.
 * The legacy durable journal is removed once during startup.
 */
export function createEphemeralAgentSessionCache({
  app,
  fsModule = fs,
  logger = console,
  legacyFilename = LEGACY_JOURNAL_FILENAME,
} = {}) {
  const legacyPath = app?.getPath
    ? path.join(app.getPath("userData"), legacyFilename)
    : null;
  let records = [];
  const legacyCleanup = legacyPath
    ? removeLegacyJournals(legacyPath, fsModule).catch((error) => {
      logger.warn?.("Unable to remove the legacy Desktop Agent chat journal:", error);
    })
    : Promise.resolve();

  async function readAll() {
    await legacyCleanup;
    return records;
  }

  async function findLatest(workspaceRoot, runtimeId = null) {
    return (await readAll())
      .filter((entry) => (
        entry.workspaceRoot === workspaceRoot
        && entry.providerSessionId
        && !entry.archivedAt
        && (!runtimeId || entry.runtimeId === runtimeId)
      ))
      .sort(byUpdatedDescending)[0] ?? null;
  }

  async function findById(sessionId, workspaceRoot = null) {
    return (await readAll()).find((entry) => (
      entry.sessionId === sessionId
      && (!workspaceRoot || entry.workspaceRoot === workspaceRoot)
    )) ?? null;
  }

  async function list(workspaceRoot, { runtimeId = null, includeArchived = false } = {}) {
    // Compatibility surface only. PuppyOne deliberately exposes no Chat History.
    void workspaceRoot;
    void runtimeId;
    void includeArchived;
    await legacyCleanup;
    return [];
  }

  async function save(record) {
    await legacyCleanup;
    const safeRecord = normalizeRecord(record);
    records = [safeRecord, ...records.filter((entry) => entry.sessionId !== safeRecord.sessionId)]
      .sort(byUpdatedDescending)
      .slice(0, MAX_SESSIONS);
  }

  async function archive(sessionId, archivedAt = new Date().toISOString()) {
    await legacyCleanup;
    records = records.map((entry) => entry.sessionId === sessionId
      ? { ...entry, archivedAt, updatedAt: archivedAt }
      : entry);
  }

  async function remove(sessionId) {
    await legacyCleanup;
    records = records.filter((entry) => entry.sessionId !== sessionId);
  }

  function clear() {
    records = [];
  }

  return { findLatest, findById, list, save, archive, remove, readAll, clear };
}

async function removeLegacyJournals(legacyPath, fsModule) {
  await fsModule.promises.rm(legacyPath, { force: true });
  const directory = path.dirname(legacyPath);
  const temporaryPrefix = `${path.basename(legacyPath)}.`;
  const entries = await fsModule.promises.readdir(directory).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  await Promise.all(entries
    .filter((name) => name.startsWith(temporaryPrefix) && name.endsWith(".tmp"))
    .slice(0, 128)
    .map((name) => fsModule.promises.rm(path.join(directory, name), { force: true })));
}

function normalizeRecord(record) {
  const runtimeId = normalizeRuntimeId(record?.runtimeId ?? record?.provider);
  const sourceEvents = Array.isArray(record?.events)
    ? record.events.filter((event) => isAgentEventEnvelope(event) && event.type !== "command.output.delta")
    : [];
  const candidateEvents = sourceEvents.slice(-MAX_EVENTS_PER_SESSION).map((event) => redactSecrets({
    ...event,
    runtimeId,
    provider: runtimeId,
  }));
  const safe = redactSecrets({
    sessionId: normalizeId(record?.sessionId),
    workspaceRoot: normalizePath(record?.workspaceRoot),
    runtimeId,
    provider: runtimeId,
    runtime: normalizeRuntime(record?.runtime, runtimeId),
    providerSessionId: nativeSessionId(record?.providerSessionId),
    sourceScopeId: nativeSessionId(record?.sourceScopeId) ?? "default",
    title: normalizeText(record?.title, 200) || "Agent session",
    createdAt: normalizeDate(record?.createdAt),
    updatedAt: normalizeDate(record?.updatedAt),
    archivedAt: record?.archivedAt ? normalizeDate(record.archivedAt) : null,
    terminalState: normalizeText(record?.terminalState, 40) || "idle",
    selectedModel: normalizeText(record?.selectedModel, 300) || null,
    selectedEffort: normalizeText(record?.selectedEffort, 160) || null,
    selectedMode: normalizeText(record?.selectedMode, 160) || null,
    lastSequence: normalizeSequence(record?.lastSequence),
    partial: candidateEvents.length < sourceEvents.length || Boolean(record?.partial),
    events: [],
  });
  let retainedBytes = countTextBytes(safe);
  for (let index = candidateEvents.length - 1; index >= 0; index -= 1) {
    const event = candidateEvents[index];
    const eventBytes = countTextBytes(event) + 1;
    if (retainedBytes + eventBytes > MAX_SESSION_BYTES) {
      safe.partial = true;
      break;
    }
    safe.events.unshift(event);
    retainedBytes += eventBytes;
  }
  return safe;
}

function normalizeRuntime(runtime, fallbackId) {
  return {
    id: fallbackId,
    displayName: normalizeText(runtime?.displayName, 100) || defaultRuntimeName(fallbackId),
    kind: normalizeText(runtime?.kind, 40) || "native-cli",
    version: normalizeText(runtime?.version, 80) || null,
    source: normalizeText(runtime?.source, 40) || null,
    compatibility: normalizeText(runtime?.compatibility, 80) || null,
  };
}

function defaultRuntimeName(id) {
  return String(id).replace(/[-_.]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeRuntimeId(value) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{1,39}$/.test(value)) throw new Error("Invalid Agent runtime id.");
  return canonicalRuntimeId(value);
}

function normalizeId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(value)) throw new Error("Invalid Agent session id.");
  return value;
}

function normalizePath(value) {
  if (typeof value !== "string" || !value || value.length > 4_096) throw new Error("Invalid Agent workspace path.");
  return value;
}

function normalizeText(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function normalizeDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeSequence(value) {
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0;
}

function byUpdatedDescending(left, right) {
  return String(right.updatedAt).localeCompare(String(left.updatedAt));
}

export const agentSessionCachePolicy = Object.freeze({
  durable: false,
  maxSessions: MAX_SESSIONS,
  maxEventsPerSession: MAX_EVENTS_PER_SESSION,
  maxSessionBytes: MAX_SESSION_BYTES,
  legacyJournalFilename: LEGACY_JOURNAL_FILENAME,
});
