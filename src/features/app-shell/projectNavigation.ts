export type ProjectNavigationTarget =
  | Readonly<{ kind: "local"; path: string }>
  | Readonly<{ kind: "cloud"; projectId: string }>;

export function sameProjectTarget(a: ProjectNavigationTarget | null, b: ProjectNavigationTarget | null) {
  if (!a || !b || a.kind !== b.kind) return a === b;
  return a.kind === "local" && b.kind === "local" ? a.path === b.path
    : a.kind === "cloud" && b.kind === "cloud" && a.projectId === b.projectId;
}

export function projectMatchesTarget(project: { localPath: string; cloudProjectId?: string }, target: ProjectNavigationTarget | null) {
  if (!target) return false;
  if (target.kind === "local") return project.localPath === target.path;
  return project.cloudProjectId === target.projectId;
}

/** One queue per window, shared by every project-selection surface. */
export class ProjectNavigation {
  private pending: ProjectNavigationTarget | null = null;
  private queued: ProjectNavigationTarget | null = null;
  private revision = 0;
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly open: (target: ProjectNavigationTarget, isCurrent: () => boolean) => Promise<void>,
    private readonly onError: (error: unknown, target: ProjectNavigationTarget) => void) {}

  getSnapshot = () => this.pending;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  select = (target: ProjectNavigationTarget): Promise<void> => {
    if (sameProjectTarget(target, this.pending)) return this.running ?? Promise.resolve();
    this.revision++;
    this.queued = target;
    this.publish(target);
    // Schedule the drain so a synchronous second click can replace the first.
    this.running ??= Promise.resolve().then(this.drain);
    return this.running;
  };

  cancel = () => {
    this.revision++;
    this.queued = null;
    this.publish(null);
  };

  private publish(target: ProjectNavigationTarget | null) {
    this.pending = target;
    this.listeners.forEach((listener) => listener());
  }

  private drain = async () => {
    try {
      while (this.queued) {
        const target = this.queued;
        const revision = this.revision;
        this.queued = null;
        const isCurrent = () => revision === this.revision;
        try { await this.open(target, isCurrent); }
        catch (error) { if (isCurrent()) this.onError(error, target); }
      }
    } finally {
      this.running = null;
      this.publish(null);
    }
  };
}
