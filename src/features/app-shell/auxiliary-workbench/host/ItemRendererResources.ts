import type { ProjectSessionContext } from "../../../../../shared/project-session-contract/types";
import type { AuxiliaryWorkbenchProject } from "../types";

/** A content-local resource scope, deliberately without a second Tab Store. */
export class ItemRendererResources implements AuxiliaryWorkbenchProject {
  disposed = false;
  private resources = new Map<string, { dispose(): void }>();
  constructor(readonly context: ProjectSessionContext) {}
  assertOpen() { if (this.disposed) throw new Error("The item display was released."); }
  getResource<T extends { dispose(): void }>(key: string, create: () => T): T {
    this.assertOpen();
    if (!this.resources.has(key)) this.resources.set(key, create());
    return this.resources.get(key) as T;
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.resources.forEach((resource) => resource.dispose()); this.resources.clear(); }
}
