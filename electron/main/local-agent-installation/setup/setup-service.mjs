import { randomUUID } from "node:crypto";
import { setupRegistry } from "./setup-registry.mjs";
import { adviseSetup } from "./setup-advisor.mjs";

/** Main owns both evidence and allowed actions; Renderer can only narrow scope. */
export function createLocalAgentSetupService({ installationService, presenceService, platform, openExternal, now = Date.now }) {
  const clients = new Map();
  const sessionSuppressed = new Set();
  let disposed = false;
  let pendingInspections = 0;

  async function inspect(ownerId, input) {
    if (disposed) throw new Error("Setup service is closed.");
    const request = parseRequest(input);
    if (pendingInspections >= 32) throw new Error("Setup inspection is busy.");
    pendingInspections += 1;
    try { return await inspectRequest(ownerId, request); }
    finally { pendingInspections -= 1; }
  }

  async function inspectRequest(ownerId, request) {
    const key = `${ownerId}:${request.clientId}`;
    const revision = randomUUID();
    const record = { ownerId, revision, request, at: now(), snapshot: null, busy: false };
    clients.delete(key);
    clients.set(key, record);
    cancelUnusedPresence();
    // Bounded per-app request receipts, never paths, credentials or environment.
    while (clients.size > 128) clients.delete(clients.keys().next().value);
    for (const [id, until] of Object.entries(request.preferences.snoozedUntil)) {
      if (until > now()) sessionSuppressed.add(id);
    }
    const current = installationService.getSnapshot();
    const evidenceAt = Date.parse(current?.completedAt);
    const expired = Number.isFinite(evidenceAt) && (now() < evidenceAt || now() - evidenceAt >= 30_000);
    const scanning = installationService.isScanning();
    const [installations, companions] = await Promise.all([
      scanning || !current || expired ? installationService.discover({ refresh: expired && !scanning }) : current,
      request.preferences.enabled ? presenceService.discover({ refresh: request.refreshPresence }) : [],
    ]);
    if (disposed || clients.get(key) !== record) throw new Error("Setup request superseded.");
    record.presenceRevision = presenceService.getRevision?.(companions);
    const currentCompanions = presenceService.isCurrentRevision?.(record.presenceRevision) === false ? [] : companions;
    record.snapshot = {
      revision, installationGeneration: installations.generation,
      entries: adviseSetup({ registry: setupRegistry, platform, request, installations, companions: currentCompanions, now: now(), sessionSuppressed }),
    };
    record.at = now();
    record.evidenceAt = Number.isFinite(Date.parse(installations.completedAt)) ? Date.parse(installations.completedAt) : record.at;
    return record.snapshot;
  }

  async function act(ownerId, input) {
    exactKeys(input, ["clientId", "revision", "setupId", "actionId", "mode"]);
    if (input.actionId !== "open-guide" || !["manual", "recommendation"].includes(input.mode)
      || typeof input.revision !== "string") throw new Error("Invalid setup action.");
    const record = clients.get(`${ownerId}:${clientId(input.clientId)}`);
    if (disposed || !record?.snapshot || record.revision !== input.revision || record.busy
      || now() < record.at || now() - record.at >= 30_000
      || now() - record.evidenceAt >= 30_000 || installationService.isScanning()) return { status: "stale" };
    const route = setupRegistry.find(({ id }) => id === input.setupId);
    const entry = record.snapshot.entries.find(({ setupId }) => setupId === input.setupId);
    if (!route || !entry || !route.platforms.includes(platform)) throw new Error("Unavailable setup route.");
    const current = installationService.getSnapshot();
    if (current?.results.some(({ agentId, status }) => agentId === route.installationId && status === "found")) {
      return { status: "detected" };
    }
    if (input.mode === "recommendation" && !entry.recommended) return { status: "stale" };
    if (input.mode === "recommendation" && presenceService.isCurrentRevision?.(record.presenceRevision) === false) return { status: "stale" };
    if (current?.generation !== record.snapshot.installationGeneration) return { status: "stale" };
    record.busy = true;
    try {
      await openExternal(route.guideUrl);
      return { status: "guide-opened" };
    } catch { return { status: "failed" }; }
    finally { record.busy = false; }
  }

  function release(ownerId, id) {
    if (id !== undefined) clients.delete(`${ownerId}:${clientId(id)}`);
    else for (const [key, record] of clients) if (record.ownerId === ownerId) clients.delete(key);
    cancelUnusedPresence();
  }
  function cancelUnusedPresence() {
    if (![...clients.values()].some(({ request }) => request.preferences.enabled)) presenceService.cancel?.();
  }
  return Object.freeze({ inspect, act, release, dispose() { disposed = true; clients.clear(); presenceService.dispose(); } });
}

function parseRequest(input) {
  exactKeys(input, ["clientId", "surface", "eligibleInstallationIds", "hiddenAgentIds", "preferences", "refreshPresence"]);
  if (!["chat", "terminal"].includes(input.surface) || typeof input.refreshPresence !== "boolean") throw new Error("Invalid setup context.");
  const preferences = input.preferences;
  exactKeys(preferences, ["enabled", "dismissedSetupIds", "snoozedUntil"]);
  if (typeof preferences.enabled !== "boolean") throw new Error("Invalid setup preference.");
  const snoozedUntil = preferences.snoozedUntil;
  if (!snoozedUntil || Array.isArray(snoozedUntil) || typeof snoozedUntil !== "object"
    || Object.keys(snoozedUntil).length > setupRegistry.length) throw new Error("Invalid setup snooze.");
  for (const [id, until] of Object.entries(snoozedUntil)) {
    if (!setupRegistry.some((entry) => entry.id === id) || !Number.isSafeInteger(until) || until < 0) throw new Error("Invalid setup snooze.");
  }
  return {
    ...input, clientId: clientId(input.clientId),
    eligibleInstallationIds: ids(input.eligibleInstallationIds), hiddenAgentIds: ids(input.hiddenAgentIds),
    preferences: { enabled: preferences.enabled, dismissedSetupIds: ids(preferences.dismissedSetupIds), snoozedUntil: { ...snoozedUntil } },
  };
}

function ids(value) {
  if (!Array.isArray(value) || value.length > 16 || value.some((id) => typeof id !== "string" || id.length > 80)) throw new Error("Invalid setup IDs.");
  return [...new Set(value.filter((id) => setupRegistry.some((entry) => entry.id === id)))];
}
function clientId(value) {
  if (typeof value !== "string" || !/^[a-z0-9:-]{1,100}$/u.test(value)) throw new Error("Invalid setup client.");
  return value;
}
function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) {
    throw new Error("Invalid setup request.");
  }
}
