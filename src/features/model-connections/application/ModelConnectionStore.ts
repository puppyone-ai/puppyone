import type { ModelConnectionCandidate, ModelConnectionSnapshot, SaveModelConnectionRequest } from "../../../../shared/model-connections/types";
import type { ConnectionRevisionRequest, ModelConnectionClientPort } from "./ModelConnectionClientPort";

export type ModelConnectionViewState = {
  snapshot: ModelConnectionSnapshot | null;
  candidates: ModelConnectionCandidate[];
  pending: Readonly<Record<string, boolean>>;
  error: string | null;
};

/** A renderer replica. Never retain write-only request bodies or credentials. */
export class ModelConnectionStore {
  private state: ModelConnectionViewState = { snapshot: null, candidates: [], pending: {}, error: null };
  private listeners = new Set<() => void>();
  private references = 0;
  private unsubscribe: (() => void) | null = null;
  constructor(private readonly client: ModelConnectionClientPort) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  connect = () => {
    if (this.references++ === 0) {
      this.unsubscribe = this.client.subscribe(this.apply);
      void this.load();
    }
    return () => { if (--this.references === 0) { this.unsubscribe?.(); this.unsubscribe = null; } };
  };
  load = () => this.run("read", () => this.client.read());
  managed = (request: import("../../../../shared/model-connections/types").ManagedConnectionAction) => this.run("managed", () => {
    if (!this.client.managed) throw new Error("NATIVE_BRIDGE_UNAVAILABLE");
    return this.client.managed(request);
  });
  save = (request: SaveModelConnectionRequest) => this.run("save", () => this.client.save(request));
  remove = (request: ConnectionRevisionRequest) => this.run(request.id, () => this.client.remove(request));
  refresh = (id: string) => this.run(id, () => this.client.refresh({ id }));
  verify = (request: ConnectionRevisionRequest & { modelId: string }) => this.run(request.id, () => this.client.verify(request));
  discover = async () => {
    if (this.state.pending.discover) return;
    this.busy("discover", true);
    try { this.patch({ candidates: await this.client.discover(), error: null }); }
    catch (error) { this.fail(error); }
    finally { this.busy("discover", false); }
  };
  private async run(key: string, operation: () => Promise<ModelConnectionSnapshot>) {
    if (this.state.pending[key]) return false;
    this.busy(key, true);
    try { this.apply(await operation()); this.patch({ error: null }); return true; }
    catch (error) { this.fail(error); return false; }
    finally { this.busy(key, false); }
  }
  private apply = (snapshot: ModelConnectionSnapshot) => {
    if (!this.state.snapshot || snapshot.revision >= this.state.snapshot.revision) this.patch({ snapshot });
  };
  private busy(key: string, pending: boolean) { this.patch({ pending: { ...this.state.pending, [key]: pending } }); }
  private fail(error: unknown) {
    const code = error instanceof Error && /^[A-Z_]{1,80}$/u.test(error.message) ? error.message : "OPERATION_FAILED";
    this.patch({ error: code });
  }
  private patch(patch: Partial<ModelConnectionViewState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
