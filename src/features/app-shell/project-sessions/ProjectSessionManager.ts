import { ProjectSessionStore } from "./ProjectSessionStore";
import { ProjectWorkbenchStore } from "../auxiliary-workbench/ProjectWorkbenchStore";
import type { ProjectSessionClient } from "./projectSessionClient";

/** One instance per window. Project closure, never view unmount, releases data. */
export class ProjectSessionManager {
  readonly store = new ProjectSessionStore();
  private projects = new Map<string, ProjectWorkbenchStore>();
  private stop: (() => void) | null = null;
  private connection = 0;
  private poll: ReturnType<typeof setTimeout> | null = null;
  connect(client: ProjectSessionClient) {
    this.disconnect();
    const connection = ++this.connection;
    const accept = (snapshot: Parameters<ProjectSessionStore["accept"]>[0]) => {
      if (this.connection !== connection) return;
      this.store.accept(snapshot, ({ projects }) => {
        for (const [generation, store] of this.projects) {
          if (!projects.some((project) => project.generation === generation)) {
            store.dispose(); this.projects.delete(generation);
          }
        }
        for (const record of projects) {
          let store = this.projects.get(record.generation);
          if (!store) { store = new ProjectWorkbenchStore(record); this.projects.set(record.generation, store); }
          store.setClosing(record.state === "closing", record.failures);
        }
      });
    };
    // Subscribe first; a late read cannot overwrite a newer notification.
    this.stop = client.subscribe(accept);
    const refresh = async () => {
      try { accept(await client.read()); }
      catch (error) { if (connection === this.connection) console.warn("Unable to refresh project sessions:", error); }
      finally { if (connection === this.connection) this.poll = setTimeout(() => { void refresh(); }, 5_000); }
    };
    void refresh();
    return () => { if (this.connection === connection) this.disconnect(); };
  }
  getProject(root: string): ProjectWorkbenchStore | null {
    const project = this.store.getSnapshot().projects.find((entry) => entry.rootPath === root);
    if (!project) return null;
    return this.projects.get(project.generation) ?? null;
  }
  private disconnect() {
    ++this.connection;
    this.stop?.(); this.stop = null;
    if (this.poll) clearTimeout(this.poll);
    this.poll = null;
  }
  dispose() { this.disconnect(); this.projects.forEach((store) => store.dispose()); this.projects.clear(); }
}
