export type WorkbenchLauncherSnapshot = Readonly<{ historyOpen: boolean; openingTargetId: string | null; historyRevision: number }>;

/** A launcher keeps its navigation state when its project's view is hidden. */
export class WorkbenchLauncherState {
  private state: WorkbenchLauncherSnapshot = { historyOpen: false, openingTargetId: null, historyRevision: 0 };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  patch(value: Partial<WorkbenchLauncherSnapshot>) {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => listener());
  }
  dispose() { this.listeners.clear(); }
}
