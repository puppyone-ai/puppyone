import type { RepositoryTarget } from "../repositoryTarget";

const historyKey = (apiBaseUrl: string, userId: string) =>
  `puppyone.cloud-project-history.v1:${JSON.stringify([apiBaseUrl, userId])}`;
export const cloudHistoryTargetKey = (target: RepositoryTarget) =>
  JSON.stringify([target.project_id, target.kind === "scope" ? target.scope_id : null]);

/** Navigation timestamps only, never a folder binding, credential or authorization cache. */
export function readCloudProjectHistory(apiBaseUrl: string, userId: string): Map<string, string> {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(historyKey(apiBaseUrl, userId)) ?? "[]");
    if (!Array.isArray(entries)) return new Map();
    return new Map(entries.filter((entry): entry is [string, string] => Array.isArray(entry)
      && entry.length === 2 && typeof entry[0] === "string" && typeof entry[1] === "string"
      && Number.isFinite(Date.parse(entry[1]))).slice(0, 200));
  } catch { return new Map(); }
}

export function rememberCloudProjectOpen(apiBaseUrl: string, userId: string, target: RepositoryTarget) {
  try {
    const history = readCloudProjectHistory(apiBaseUrl, userId);
    history.set(cloudHistoryTargetKey(target), new Date().toISOString());
    const entries = [...history].sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).slice(0, 200);
    localStorage.setItem(historyKey(apiBaseUrl, userId), JSON.stringify(entries));
  } catch { /* Storage failure must never block a successfully authorized open. */ }
}
