import { AgentSessionController } from "./AgentSessionController";
import type { AgentClientProvider } from "./AgentClientPort";

/** Owned by one project generation; disposing it releases local replicas only. */
export class AgentControllerRegistry {
  private controllers = new Map<string, AgentSessionController>();
  constructor(private readonly root: string, private readonly createClient: () => AgentClientProvider) {}
  get(id: string) {
    let controller = this.controllers.get(id);
    if (!controller) this.controllers.set(id, controller = new AgentSessionController(this.root, this.createClient()));
    return controller;
  }
  async close(id: string) {
    const controller = this.controllers.get(id);
    if (!controller) return true;
    if (!await controller.closeTabSession()) return false;
    controller.dispose(); this.controllers.delete(id);
    return true;
  }
  async discard(id: string) {
    const controller = this.controllers.get(id);
    if (!controller) return;
    await controller.rollbackPreparation();
    this.controllers.delete(id);
  }
  dispose() { this.controllers.forEach((controller) => controller.dispose()); this.controllers.clear(); }
}
