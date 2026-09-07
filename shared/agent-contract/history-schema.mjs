import { nativeSessionId as historyNativeId } from "./native-session-id.mjs";
export { nativeSessionId as historyNativeId } from "./native-session-id.mjs";

/** Shared, opaque native History values. Never trim or rewrite native cursors. */
export const agentHistoryLimits = Object.freeze({ pageSize: 100, nativePage: 1000, nativeId: 512, cursor: 1024 });


export function historyCursor(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && value.length <= agentHistoryLimits.cursor) return value;
  throw new TypeError("Native history returned an invalid continuation cursor.");
}

export function historyPageSize(value) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, agentHistoryLimits.pageSize) : 50;
}

export function historyLocators(value, limit) {
  if (!Array.isArray(value) || value.length > Math.min(limit ?? agentHistoryLimits.pageSize, agentHistoryLimits.nativePage)) {
    throw new TypeError("Native history returned an invalid session page.");
  }
  return value.map((entry) => {
    const providerSessionId = historyNativeId(entry?.providerSessionId);
    const updatedAt = historyDate(entry?.updatedAt);
    if (!providerSessionId || !updatedAt) throw new TypeError("Native history returned an invalid session locator.");
    return Object.fromEntries(Object.entries({
      providerSessionId,
      title: bounded(entry.title, 500) || "Agent session",
      createdAt: historyDate(entry.createdAt) ?? updatedAt,
      updatedAt,
      ...(entry.updatedAtKnown === false ? { updatedAtKnown: false } : {}),
      selectedProviderId: historyNativeId(entry.selectedProviderId),
      selectedModel: bounded(entry.selectedModel, 512),
      selectedEffort: bounded(entry.selectedEffort, 160),
      selectedMode: bounded(entry.selectedMode, 160),
    }).filter(([, value]) => value != null));
  });
}

export function historyDate(value) {
  if (typeof value !== "string" || value.length > 64) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function bounded(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) || null : null;
}
