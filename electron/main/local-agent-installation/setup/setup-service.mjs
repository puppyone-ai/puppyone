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
    const record = { ownerId, revision, request, snapshot: null, busy: false };
    clients.delete(key);
    clients.set(key, record);
    cancelUnusedPresence();
    // Bounded per-app request receipts, never paths, credentials or environment.
    while (clients.size > 128) clients.delete(clients.keys().next().value);
    for (const [id, until] of Object.entries(request.preferences.snoozedUntil)) {
      if (until > now()) sessionSuppressed.add(id);
    }
    const current = installationService.getSnapshot();
    // Main's installation generation, not mounting a view or a timer, owns refresh.
    const installations = current ?? await installationService.discover();
    if (disposed || clients.get(key) !== record) throw new Error("Setup request superseded.");
    const companions = request.preferences.enabled
      ? await presenceService.discover({ installationGeneration: installations.generation }) : [];
    if (disposed || clients.get(key) !== record) throw new Error("Setup request superseded.");
    record.presenceRevision = presenceService.getRevision?.(companions);
    const currentCompanions = presenceService.isCurrentRevision?.(record.presenceRevision) === false ? [] : companions;
    record.snapshot = {
      revision, installationGeneration: installations.generation,
      entries: adviseSetup({ registry: setupRegistry, platform, request, installations, companions: currentCompanions, now: now(), sessionSuppressed }),
    };
    return record.snapshot;
  }

  async function act(ownerId, input) {
    exactKeys(input, ["clientId", "revision", "setupId", "actionId", "mode"]);
    if (input.actionId !== "open-guide" || !["manual", "recommendation"].includes(input.mode)
      || typeof input.revision !== "string") throw new Error("Invalid setup action.");
    const record = clients.get(`${ownerId}:${clientId(input.clientId)}`);
    if (disposed || !record?.snapshot || record.revision !== input.revision || record.busy) return { status: "stale" };
    const route = setupRegistry.find(({ id }) => id === input.setupId);
    const entry = record.snapshot.entries.find(({ setupId }) => setupId === input.setupId);
    if (!route || !entry || !route.platforms.includes(platform)) throw new Error("Unavailable setup route.");
    const current = installationService.getSnapshot();
    if (current?.results.some(({ agentId, status }) => agentId === route.installationId && status === "found")) {
      return { status: "detected" };
    }
    // Opening a fixed official guide is read-only. Session evidence does not expire
    // on a wall clock; recommendations still require the same authoritative scan.
    if (input.mode === "recommendation" && (!entry.recommended || installationService.isScanning()
      || presenceService.isCurrentRevision?.(record.presenceRevision) === false
      || current?.generation !== record.snapshot.installationGeneration)) return { status: "stale" };
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
  exactKeys(input, ["clientId", "surface", "eligibleInstallationIds", "hiddenAgentIds", "preferences"]);
  if (!["chat", "terminal"].includes(input.surface)) throw new Error("Invalid setup context.");
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
