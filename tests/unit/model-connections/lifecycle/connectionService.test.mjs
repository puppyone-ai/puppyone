import { describe, expect, it, vi } from "vitest";
import { createModelConnectionService } from "../../../../electron/main/model-connections/connection-service.mjs";
import { parseConnectionCommand, normalizeModelBaseUrl, modelRoute } from "../../../../shared/model-connections/schema.mjs";
import { openaiCompatibleDriver } from "../../../../electron/main/model-connections/drivers/openai-compatible.mjs";
import { randomUUID } from "node:crypto";

const input = { driver: "openai-compatible", name: "Test local", baseUrl: "http://localhost:11434", auth: "none", manualContextWindow: 4096 };
function fixture(overrides = {}) {
  let saved = [];
  const keys = new Map();
  const store = { read: vi.fn(async () => saved), write: vi.fn(async (value) => { saved = structuredClone(value); }) };
  const credentials = { create: vi.fn(async (key) => { const ref = randomUUID(); keys.set(ref, key); return ref; }),
    read: vi.fn(async (ref) => keys.get(ref)), remove: vi.fn(async (ref) => { keys.delete(ref); }), reconcile: vi.fn(async () => {}) };
  const request = vi.fn(async () => ({ data: [{ id: "test/model" }] }));
  const verifyModel = vi.fn(async () => {});
  const service = createModelConnectionService({ store, credentials, drivers: [openaiCompatibleDriver], request, verifyModel, ...overrides });
  return { service, store, credentials, request, verifyModel, saved: () => saved };
}

describe("model connection contracts", () => {
  it("canonicalizes loopback and reverse-proxy prefixes without duplicate v1", () => {
    expect(normalizeModelBaseUrl("http://localhost:1234/v1/")).toBe("http://127.0.0.1:1234/v1");
    expect(normalizeModelBaseUrl("https://example.com/proxy/v1")).toBe("https://example.com/proxy/v1");
  });
  it.each(["http://example.com", "https://user:password@example.com", "file:///tmp/model", "https://example.com?key=secret", "https://example.com#key"])("rejects unsafe endpoint %s", (url) => {
    expect(() => normalizeModelBaseUrl(url)).toThrow();
  });
  it("does not accept credential commands, arbitrary drivers or invalid contexts as configuration", () => {
    expect(() => parseConnectionCommand("save", { ...input, driver: "arbitrary" })).toThrow();
    expect(() => parseConnectionCommand("save", { ...input, manualContextWindow: -1 })).toThrow();
    // A Key beginning with ! is opaque data, never executed by a config resolver.
    expect(parseConnectionCommand("save", { ...input, auth: "bearer", apiKey: "!echo-not-executed" }).apiKey).toBe("!echo-not-executed");
  });
});

describe("model connection lifecycle", () => {
  it("keeps name/default edits separate from credential rotation and invalidates only old security leases", async () => {
    const { service, credentials } = fixture();
    const base = { ...input, auth: "bearer", apiKey: "first-private-key" };
    const connection = (await service.save(base)).connections[0];
    await service.verify({ id: connection.id, expectedGeneration: 1, modelId: "test/model" });
    const onRevoke = vi.fn();
    const route = modelRoute(connection.id, "test/model");
    const lease = await service.acquire({ route, scope: "session", onRevoke });
    await service.save({ ...input, auth: "bearer", id: connection.id, expectedGeneration: 1, name: "Renamed" });
    service.validate({ leaseId: lease.leaseId, scope: "session", route });
    expect(onRevoke).not.toHaveBeenCalled();
    const rotated = await service.save({ ...base, id: connection.id, expectedGeneration: 2, apiKey: "second-private-key" });
    expect(onRevoke).toHaveBeenCalledOnce();
    expect(credentials.remove).toHaveBeenCalledOnce();
    expect(rotated.catalogs[0].models[0].verifiedAt).toBeUndefined();
    expect(() => service.validate({ leaseId: lease.leaseId, scope: "session", route })).toThrow();
    await service.dispose();
  });
  it("prevents concurrent compatibility tests for the same connection", async () => {
    let complete;
    const { service } = fixture({ verifyModel: () => new Promise((resolve) => { complete = resolve; }) });
    const connection = (await service.save(input)).connections[0];
    const request = { id: connection.id, expectedGeneration: 1, modelId: "test/model" };
    const first = service.verify(request);
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    await expect(service.verify(request)).rejects.toMatchObject({ code: "BUSY" });
    complete(); await first; await service.dispose();
  });
  it("keeps credentials out of snapshots and ordinary configuration", async () => {
    const { service, saved } = fixture();
    const result = await service.save({ ...input, auth: "bearer", apiKey: "test-private-credential" });
    expect(result.connections[0]).toMatchObject({ credentialConfigured: true, transport: "loopback", executionLocation: "unknown" });
    expect(JSON.stringify(result)).not.toContain("credentialRef");
    expect(JSON.stringify(result)).not.toContain("test-private-credential");
    expect(JSON.stringify(saved())).not.toContain("test-private-credential");
    await service.dispose();
  });
  it("requires verification for unknown tools and records only synthetic compatibility evidence", async () => {
    const { service, verifyModel } = fixture();
    const snapshot = await service.save(input);
    const connection = snapshot.connections[0];
    const route = modelRoute(connection.id, "test/model");
    await expect(service.acquire({ route, scope: "session-a" })).rejects.toMatchObject({ code: "MODEL_VERIFICATION_REQUIRED" });
    const verified = await service.verify({ id: connection.id, expectedGeneration: 1, modelId: "test/model" });
    expect(verified.catalogs[0].models[0].capabilities.tools).toBe("supported");
    expect(verifyModel).toHaveBeenCalledOnce();
    const lease = await service.acquire({ route, scope: "session-a" });
    expect(lease.configuration.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(() => service.validate({ leaseId: lease.leaseId, route, scope: "session-b" })).toThrow();
    service.validate({ leaseId: lease.leaseId, route, scope: "session-a" });
    await service.dispose();
  });
  it("does not overwrite edits from another window", async () => {
    const { service } = fixture();
    const connection = (await service.save(input)).connections[0];
    await service.save({ ...input, id: connection.id, expectedGeneration: 1, name: "Renamed" });
    await expect(service.save({ ...input, id: connection.id, expectedGeneration: 1 })).rejects.toMatchObject({ code: "CONFIGURATION_CONFLICT" });
    expect((await service.read()).connections[0].name).toBe("Renamed");
    await service.dispose();
  });
  it("requires Key confirmation when the endpoint changes", async () => {
    const { service } = fixture();
    const connection = (await service.save({ ...input, auth: "bearer", apiKey: "private-test-key" })).connections[0];
    await expect(service.save({ ...input, auth: "bearer", id: connection.id, expectedGeneration: 1, baseUrl: "https://example.com/v1" })).rejects.toMatchObject({ code: "KEY_CONFIRMATION_REQUIRED" });
    await service.dispose();
  });
  it("compensates a failed configuration commit after securing the Key", async () => {
    const { service, store, credentials } = fixture();
    store.write.mockRejectedValueOnce(new Error("disk full"));
    await expect(service.save({ ...input, auth: "bearer", apiKey: "private-test-key" })).rejects.toThrow();
    expect(credentials.remove).toHaveBeenCalledOnce();
    expect((await service.read()).connections).toEqual([]);
    await service.dispose();
  });
  it("revokes an active lease on delete without discarding another connection", async () => {
    const { service } = fixture();
    const first = (await service.save(input)).connections[0];
    await service.save({ ...input, name: "Second" });
    await service.verify({ id: first.id, expectedGeneration: 1, modelId: "test/model" });
    const onRevoke = vi.fn();
    const route = modelRoute(first.id, "test/model");
    const lease = await service.acquire({ route, scope: "session-a", onRevoke });
    const next = await service.remove({ id: first.id, expectedGeneration: 1 });
    expect(next.connections.map((entry) => entry.name)).toEqual(["Second"]);
    expect(onRevoke).toHaveBeenCalledOnce();
    expect(() => service.validate({ leaseId: lease.leaseId, route, scope: "session-a" })).toThrow();
    await service.dispose();
  });
  it("retains stale models on failed refresh, and never authorizes from stale evidence", async () => {
    const { service, request } = fixture();
    const connection = (await service.save(input)).connections[0];
    request.mockRejectedValueOnce(Object.assign(new Error("provider echoed private stuff"), { code: "AUTHENTICATION_FAILED" }));
    const result = await service.refresh({ id: connection.id });
    expect(result.catalogs[0]).toMatchObject({ status: "stale", endpoint: "reachable", authentication: "invalid", errorCode: "AUTHENTICATION_FAILED" });
    expect(result.catalogs[0].models).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private stuff");
    await expect(service.acquire({ route: modelRoute(connection.id, "test/model"), scope: "session" })).rejects.toMatchObject({ code: "CATALOG_UNAVAILABLE" });
    await service.dispose();
  });
  it("coalesces refresh and discards a deleted connection's late result", async () => {
    const { service, request } = fixture();
    const connection = (await service.save(input)).connections[0];
    let finish;
    request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const one = service.refresh({ id: connection.id });
    const two = service.refresh({ id: connection.id });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await service.remove({ id: connection.id, expectedGeneration: 1 });
    finish({ data: [{ id: "late-model" }] });
    await Promise.all([one, two]);
    expect(request).toHaveBeenCalledTimes(2);
    expect((await service.read()).connections).toHaveLength(0);
    await service.dispose();
  });
});
