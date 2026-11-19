import { windowProjectStore, type ProjectTarget } from "./windowProjectStore";

export function sameProjectTarget(a: ProjectTarget | null, b: ProjectTarget | null) {
  if (!a || !b) return a === b;
  if (a.kind === "local" && b.kind === "local") return a.path === b.path;
  if (a.kind === "cloud" && b.kind === "cloud") return a.projectId === b.projectId;
  if (a.kind === "host" && b.kind === "host") return a.hostId === b.hostId && a.folderId === b.folderId;
  return a.kind === "dropped" && b.kind === "dropped" && a.folder === b.folder;
}

export function projectMatchesTarget(project: { localPath: string; cloudProjectId?: string }, target: ProjectTarget | null) {
  if (target?.kind === "local") return project.localPath === target.path;
  return target?.kind === "cloud" && project.cloudProjectId === target.projectId;
}

/** One queue per window, shared by every project-selection surface. */
export class ProjectNavigation {
  private queued: ProjectTarget | null = null;
  private revision = 0;
  private running: Promise<void> | null = null;

  constructor(private readonly open: (target: ProjectTarget, isCurrent: () => boolean) => Promise<void>,
    private readonly onError: (error: unknown, target: ProjectTarget) => void) {}

  select = (target: ProjectTarget): Promise<void> => {
    if (sameProjectTarget(target, windowProjectStore.getState().opening)) return this.running ?? Promise.resolve();
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

  private publish(target: ProjectTarget | null) {
    windowProjectStore.setState({ opening: target });
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
