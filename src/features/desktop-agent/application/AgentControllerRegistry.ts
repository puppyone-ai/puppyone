import { AgentSessionController } from "./AgentSessionController";
import type { AgentClientProvider } from "./AgentClientPort";

/** Owned by one project generation; disposing it releases local replicas only. */
export class AgentControllerRegistry {
  private readonly controllers = new Map<string, AgentSessionController>();
  private readonly closing = new Map<AgentSessionController, Promise<boolean>>();
  private disposed = false;

  constructor(private readonly root: string, private readonly createClient: () => AgentClientProvider) {}

  get(id: string) {
    if (this.disposed) throw new Error("This project's Agent controllers have been released.");
    let controller = this.controllers.get(id);
    if (!controller) {
      controller = new AgentSessionController(this.root, this.createClient());
      this.controllers.set(id, controller);
    }
    return controller;
  }

  close(id: string): Promise<boolean> {
    const controller = this.controllers.get(id);
    if (!controller) return Promise.resolve(true);
    const pending = this.closing.get(controller);
    if (pending) return pending;
    const close = this.closeController(id, controller).finally(() => this.closing.delete(controller));
    this.closing.set(controller, close);
    return close;
  }

  private async closeController(id: string, controller: AgentSessionController) {
    if (!await controller.closeTabSession()) return false;
    controller.dispose();
    if (this.controllers.get(id) === controller) this.controllers.delete(id);
    return true;
  }

  async discard(id: string) {
    const controller = this.controllers.get(id);
    if (!controller) return;
    // Detach the abandoned reservation before awaiting native rollback. Its
    // completion must never remove a replacement using the same Item id.
    this.controllers.delete(id);
    await controller.rollbackPreparation();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controllers.forEach((controller) => controller.dispose());
    this.controllers.clear();
  }
}
