import { describe, expect, it, vi } from "vitest";
import { ModelConnectionStore } from "../../../../src/features/model-connections/application/ModelConnectionStore";
import type { ModelConnectionClientPort } from "../../../../src/features/model-connections/application/ModelConnectionClientPort";
import type { ModelConnectionSnapshot, SaveModelConnectionRequest } from "../../../../shared/model-connections/types";

const snapshot = (revision: number): ModelConnectionSnapshot => ({ schemaVersion: 1, revision, connections: [], catalogs: [], managed: { available: false, reason: "gateway-unavailable" } });
function fixture() {
  let publish: (value: ModelConnectionSnapshot) => void = () => {};
  const unsubscribe = vi.fn();
  const client: ModelConnectionClientPort = { read: vi.fn(async () => snapshot(1)), save: vi.fn(async () => snapshot(2)),
    refresh: vi.fn(async () => snapshot(2)), remove: vi.fn(async () => snapshot(2)), verify: vi.fn(async () => snapshot(2)), discover: vi.fn(async () => []),
    subscribe: vi.fn((listener) => { publish = listener; return unsubscribe; }) };
  return { client, store: new ModelConnectionStore(client), publish: (value: ModelConnectionSnapshot) => publish(value), unsubscribe };
}
describe("renderer model connection replica", () => {
  it("shares subscriptions and rejects late older snapshots", async () => {
    const { client, store, publish, unsubscribe } = fixture();
    const one = store.connect(); const two = store.connect();
    await vi.waitFor(() => expect(store.getSnapshot().snapshot?.revision).toBe(1));
    publish(snapshot(5)); publish(snapshot(3));
    expect(store.getSnapshot().snapshot?.revision).toBe(5);
    expect(client.subscribe).toHaveBeenCalledOnce();
    one(); expect(unsubscribe).not.toHaveBeenCalled(); two(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("never stores the write-only Key or a remote error body, including while save is pending", async () => {
    const { client, store } = fixture();
    let reject: (reason: Error) => void = () => {};
    vi.mocked(client.save).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const request: SaveModelConnectionRequest = { name: "Example", driver: "openai-compatible", baseUrl: "https://example.com/v1", auth: "bearer", apiKey: "synthetic-secret-key" };
    const pending = store.save(request);
    expect(JSON.stringify(store.getSnapshot())).not.toContain(request.apiKey);
    reject(new Error("remote error synthetic-secret-key"));
    expect(await pending).toBe(false);
    expect(store.getSnapshot().error).toBe("OPERATION_FAILED");
    expect(JSON.stringify(store.getSnapshot())).not.toContain(request.apiKey);
  });
});
