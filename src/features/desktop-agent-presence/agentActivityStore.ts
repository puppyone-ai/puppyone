import type { AgentActivityEvent } from "../../../shared/agent-activity-contract/types";
import { AGENT_ACTIVITY_LIMITS } from "../../../shared/agent-activity-contract/constants.mjs";
import type { AgentActivityClient } from "./agentActivityApi";
import {
  normalizeWorkspaceRelativePath,
  projectFilePresence,
  type AgentFilePresenceProjection,
} from "./agentActivity";

export const AGENT_FILE_ACTIVITY_COMPLETION_LINGER_MS = AGENT_ACTIVITY_LIMITS.completedLingerMs;

export class AgentActivityStore {
  private readonly activities = new Map<string, AgentActivityEvent>();
  private readonly pathListeners = new Map<string, Set<() => void>>();
  private readonly pathSnapshots = new Map<string, AgentFilePresenceProjection | null>();
  private readonly removalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private connected = false;
  private removeEventListener: (() => void) | null = null;

  constructor(private readonly client: AgentActivityClient) {}

  subscribePath(pathValue: string, listener: () => void) {
    const path = normalizeWorkspaceRelativePath(pathValue);
    if (!path) return () => undefined;
    let listeners = this.pathListeners.get(path);
    if (!listeners) {
      listeners = new Set();
      this.pathListeners.set(path, listeners);
    }
    listeners.add(listener);
    this.ensureConnected();
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.pathListeners.delete(path);
    };
  }

  getPathSnapshot(pathValue: string) {
    const path = normalizeWorkspaceRelativePath(pathValue);
    if (!path) return null;
    if (!this.pathSnapshots.has(path)) this.rebuildPath(path);
    return this.pathSnapshots.get(path) ?? null;
  }

  apply(event: AgentActivityEvent) {
    if (!isPublicEvent(event)) return;
    const previous = this.activities.get(event.activityId) ?? null;
    const affected = new Set([
      ...pathsFor(previous),
      ...pathsFor(event),
    ]);
    this.clearRemovalTimer(event.activityId);
    if (event.phase === "cancelled") {
      this.activities.delete(event.activityId);
    } else {
      this.activities.set(event.activityId, event);
      if (event.phase === "completed" || event.phase === "failed") {
        const timer = setTimeout(
          () => this.remove(event.activityId),
          AGENT_FILE_ACTIVITY_COMPLETION_LINGER_MS,
        );
        this.removalTimers.set(event.activityId, timer);
      }
    }
    this.publishPaths(affected);
  }

  dispose() {
    this.client.unsubscribe();
    this.removeEventListener?.();
    this.removeEventListener = null;
    this.connected = false;
    for (const timer of this.removalTimers.values()) clearTimeout(timer);
    this.removalTimers.clear();
    this.activities.clear();
    this.pathSnapshots.clear();
    this.pathListeners.clear();
  }

  private ensureConnected() {
    if (this.connected) return;
    this.connected = true;
    this.removeEventListener = this.client.onEvent((event) => this.apply(event));
    void this.client.subscribe().then((snapshot) => {
      if (!this.connected || snapshot.schemaVersion !== 1) return;
      snapshot.activities.forEach((event) => this.apply(event));
    }).catch(() => undefined);
  }

  private remove(activityId: string) {
    const previous = this.activities.get(activityId);
    this.clearRemovalTimer(activityId);
    if (!previous) return;
    this.activities.delete(activityId);
    this.publishPaths(new Set(pathsFor(previous)));
  }

  private clearRemovalTimer(activityId: string) {
    const timer = this.removalTimers.get(activityId);
    if (timer) clearTimeout(timer);
    this.removalTimers.delete(activityId);
  }

  private publishPaths(paths: ReadonlySet<string>) {
    for (const path of paths) {
      this.rebuildPath(path);
      this.pathListeners.get(path)?.forEach((listener) => listener());
    }
  }

  private rebuildPath(path: string) {
    this.pathSnapshots.set(path, projectFilePresence(Array.from(this.activities.values()), path));
  }
}

function pathsFor(event: AgentActivityEvent | null) {
  if (!event) return [];
  return event.targets
    .map(({ workspaceRelativePath }) => normalizeWorkspaceRelativePath(workspaceRelativePath))
    .filter((path): path is string => Boolean(path));
}

function isPublicEvent(event: AgentActivityEvent) {
  return event?.schemaVersion === 1
    && typeof event.activityId === "string"
    && Array.isArray(event.targets);
}
