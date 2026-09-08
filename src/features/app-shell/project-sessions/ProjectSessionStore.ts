import { assertProjectSessionSnapshot } from "../../../../shared/project-session-contract/schema.mjs";
import type { ProjectSessionSnapshot } from "../../../../shared/project-session-contract/types";

export class ProjectSessionStore {
  private snapshot: ProjectSessionSnapshot = { streamId: "", revision: 0, projects: [] };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  accept(value: unknown, beforePublish?: (snapshot: ProjectSessionSnapshot) => void) {
    const snapshot = assertProjectSessionSnapshot(value);
    if (snapshot.streamId === this.snapshot.streamId && snapshot.revision <= this.snapshot.revision) return;
    beforePublish?.(snapshot);
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}
