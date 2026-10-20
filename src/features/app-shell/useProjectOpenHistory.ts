import { useEffect, useSyncExternalStore } from "react";
import type { ProjectHomeItem } from "./workspaceHomeModel";

type Opened = { location: "local" | "cloud"; path?: string };
const CHANGED = "puppyone-project-open-history";
const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener(CHANGED, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(CHANGED, notify);
  };
};
const read = (key: string | null) => {
  try { return key ? localStorage.getItem(key) ?? "{}" : "{}"; } catch { return "{}"; }
};
function parse(raw: string): Record<string, Opened> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry && typeof entry === "object"
      && (entry.location === "cloud" || (entry.location === "local" && typeof entry.path === "string"))));
  } catch { return {}; }
}

/** Remembers successful opens, scoped to account and server. Never stores a catalog or grants access. */
export function useProjectOpenHistory({ scope, items, activeLocalPath, activeCloudProjectId }: {
  scope: string | null;
  items: ProjectHomeItem[];
  activeLocalPath?: string;
  activeCloudProjectId?: string;
}): ProjectHomeItem[] {
  const key = scope ? `puppyone.project-open-location:${scope}` : null;
  const raw = useSyncExternalStore(subscribe, () => read(key), () => "{}");
  const localProjectId = items.find(item => item.localPath === activeLocalPath)?.cloudProjectId;
  useEffect(() => {
    const id = activeCloudProjectId ?? localProjectId;
    if (!key || !id || (!activeCloudProjectId && !activeLocalPath)) return;
    const entry: Opened = activeCloudProjectId ? { location: "cloud" } : { location: "local", path: activeLocalPath };
    const history = parse(read(key));
    if (JSON.stringify(history[id]) === JSON.stringify(entry)) return;
    // Keep this preference bounded. A missing or unavailable location falls back to an accessible one.
    const next = Object.fromEntries([...Object.entries(history).filter(([project]) => project !== id).slice(-99), [id, entry]]);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event(CHANGED));
    } catch { /* Opening a project never depends on preference storage. */ }
  }, [activeCloudProjectId, activeLocalPath, key, localProjectId]);
  const history = parse(raw);
  return items.map(item => {
    const opened = item.cloudProjectId ? history[item.cloudProjectId] : undefined;
    const location = opened?.location === "local" && opened.path !== item.localPath ? undefined : opened?.location;
    return location ? { ...item, lastOpenedLocation: location } : item;
  });
}
