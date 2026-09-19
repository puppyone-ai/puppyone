import { describe, expect, it, vi } from "vitest";
import { createAgentProcessService } from "../../../../electron/main/item-hosts/agent-process-service.mjs";

const selected = "mc_11111111-1111-1111-1111-111111111111/model";
const other = "mc_22222222-2222-2222-2222-222222222222/model";
function fixture(runtimeId = "puppyone-agent") {
  let options;
  const modelConnections = { catalog: vi.fn(async () => ({})), acquire: vi.fn(async () => ({ leaseId: "lease", configuration: { apiKey: "synthetic-private-key" } })),
    validate: vi.fn(), release: vi.fn(), releaseScope: vi.fn() };
  const conversationCatalog = { findById: vi.fn(async () => ({ runtimeId, selectedModel: selected, modelBindingRevision: "durable-fence" })) };
  const host = { exited: false, call: vi.fn(async () => ({ session: { id: "session", instanceId: "instance", runtimeId } })), close: vi.fn(async () => { host.exited = true; }) };
  const createHost = vi.fn((value) => { options = value; return host; });
  const service = createAgentProcessService({ modelConnections, conversationCatalog, attachmentStore: {}, catalogService: {}, createHost });
  const sender = { id: 1, hostItemId: "item" };
  return { service, modelConnections, conversationCatalog, host, createHost, sender, options: () => options };
}
describe("Main authorizes model credentials by utility instance and route", () => {
  it("never broadcasts credentials in initialization and rejects another connection", async () => {
    const { service, sender, options, modelConnections } = fixture();
    await service.createSession(sender, { runtimeId: "puppyone-agent", model: selected }, "/project");
    expect(options().initialize.modelConnectionsEnabled).toBe(true);
    expect(JSON.stringify(options().initialize)).not.toContain("apiKey");
    await expect(options().handle("model-connections:acquire", [other])).rejects.toMatchObject({ code: "HOST_AUTHORITY" });
    await options().handle("model-connections:acquire", [selected]);
    expect(modelConnections.acquire).toHaveBeenCalledWith(expect.objectContaining({ route: selected, scope: options().identity.key }));
    await service.closeItem(1, "item");
    await expect(options().handle("model-connections:acquire", [selected])).rejects.toThrow();
    expect(modelConnections.releaseScope).toHaveBeenCalledWith(options().identity.key);
  });
  it("denies non-built-in runtimes access to model credentials", async () => {
    const { service, sender, options } = fixture("codex");
    await service.createSession(sender, { runtimeId: "codex", model: selected }, "/project");
    await expect(options().handle("model-connections:read", [])).rejects.toMatchObject({ code: "HOST_AUTHORITY" });
    await service.closeItem(1, "item");
  });
  it("uses persisted history authority instead of a renderer-supplied replacement model", async () => {
    const { service, sender, options, modelConnections } = fixture();
    await service.resumeSession(sender, { sessionId: "session", runtimeId: "puppyone-agent", model: other }, "/project");
    await expect(options().handle("model-connections:acquire", [other])).rejects.toMatchObject({ code: "HOST_AUTHORITY" });
    await options().handle("model-connections:acquire", [selected]);
    expect(modelConnections.acquire).toHaveBeenCalledWith(expect.objectContaining({ expectedBindingRevision: "durable-fence" }));
    await service.closeItem(1, "item");
  });
  it("reserves history before an asynchronous catalog read", async () => {
    const { service, sender, conversationCatalog } = fixture();
    let complete;
    conversationCatalog.findById.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const pending = service.resumeSession(sender, { sessionId: "session", runtimeId: "puppyone-agent" }, "/project");
    await expect(service.resumeSession({ ...sender, hostItemId: "other" }, { sessionId: "session", runtimeId: "puppyone-agent" }, "/project")).rejects.toMatchObject({ code: "SESSION_DUPLICATE" });
    complete({ runtimeId: "puppyone-agent", selectedModel: selected });
    await pending; await service.closeItem(1, "item");
  });
  it("releases the history reservation when the host budget rejects startup", async () => {
    const { service, sender, createHost } = fixture();
    createHost.mockImplementationOnce(() => { throw new Error("Host budget exhausted"); });
    const request = { sessionId: "session", runtimeId: "puppyone-agent" };
    await expect(service.resumeSession(sender, request, "/project")).rejects.toThrow("Host budget exhausted");
    await expect(service.resumeSession(sender, request, "/project")).resolves.toHaveProperty("session.id", "session");
    await service.closeItem(1, "item");
  });
});
