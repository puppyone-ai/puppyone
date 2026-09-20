import { afterEach, describe, expect, it, vi } from "vitest";
import { withManagedConnection } from "../../../../electron/main/model-connections/managed-connection.mjs";
import { parseConnectionCommand } from "../../../../shared/model-connections/schema.mjs";

const services = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.dispose())); });

function fixture({ signedIn = true, balance = 5_000_000, trial = 0 } = {}) {
  let state = { status: signedIn ? "authenticated" : "signed-out", session: signedIn ? {
    user_id: "user-one", session_generation: "session-one", api_base_url: "https://qubits-api.puppyone.ai/api/v1",
  } : null };
  let observer;
  const auth = {
    readState: async () => state,
    subscribe: (callback) => { observer = callback; return () => {}; },
    requestSessionApi: vi.fn(async (_base, path) => path === "/ai/balance" ? {
      balance_micro_usd: balance, available_micro_usd: balance, reserved_micro_usd: 0,
    } : { checkout_url: "https://sandbox.polar.sh/checkout/test" }),
    startOAuth: vi.fn(async () => {}),
    openAgentStream: vi.fn(async () => ({ response: new Response('data: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }), close: vi.fn() })),
  };
  const snapshot = { schemaVersion: 1, revision: 0, connections: [], catalogs: [], managed: { available: false, reason: "gateway-unavailable" } };
  const connections = { read: async () => snapshot, catalog: async () => snapshot, subscribe: () => () => {},
    dispose: vi.fn(), acquire: vi.fn(), validate: () => { throw new Error("LEASE_REVOKED"); },
    release: vi.fn(), releaseScope: vi.fn() };
  const openExternal = vi.fn();
  const service = withManagedConnection({ connections, getAuth: () => auth,
    apiBase: "https://qubits-api.puppyone.ai/api/v1", openExternal,
    requestPublic: async () => ({ sandbox: true, trial_credit_micro_usd: trial, packs: [{ id: "test-credit", price_cents: 500, credit_micro_usd: 5_000_000 }],
      models: [{ id: "test/model", name: "Test", context_window: 32768, max_output_tokens: 4096 }] }),
  });
  services.push(service);
  return { service, auth, openExternal, connections,
    signOut: () => { state = { status: "signed-out", session: null }; observer(state); },
    replaceUser: () => { state = { status: "authenticated", session: { ...state.session, user_id: "user-two", session_generation: "session-two" } }; observer(state); } };
}

async function acquire(service, onRevoke = vi.fn()) {
  const snapshot = await service.read();
  const route = `${snapshot.connections[0].id}/test/model`;
  return { route, ...await service.acquire({ route, scope: "test-scope", onRevoke }), onRevoke };
}

describe("Main-owned managed Agent connection", () => {
  it("exposes a read-only model and balance but no lease or credentials", async () => {
    const { service } = fixture();
    const snapshot = await service.read();
    expect(snapshot.managed.available).toBe(true);
    expect(snapshot.connections[0].sourceKind).toBe("managed");
    expect(JSON.stringify(snapshot)).not.toMatch(/apiKey|access_token|refresh_token|capability/);
    expect(() => parseConnectionCommand("save", { ...snapshot.connections[0] })).toThrow();
    await expect(service.remove({ id: snapshot.connections[0].id })).rejects.toThrow();
  });

  it("requires sign-in and balance for managed acquisition", async () => {
    const signedOut = fixture({ signedIn: false });
    expect((await signedOut.service.read()).managed.reason).toBe("sign-in-required");
    await signedOut.service.managed({ action: "sign-in" });
    expect(signedOut.auth.startOAuth).toHaveBeenCalledWith({ apiBase: "https://qubits-api.puppyone.ai/api/v1" });
    const { service } = fixture({ balance: 0 });
    await expect(acquire(service)).rejects.toThrow("CREDENTIAL_REQUIRED");
  });

  it("accepts only the private capability, fixed path, no browser Origin and configured model", async () => {
    const { service, auth } = fixture();
    const lease = await acquire(service);
    const url = `${lease.configuration.baseUrl}/chat/completions`;
    const options = { method: "POST", headers: { Authorization: `Bearer ${lease.configuration.apiKey}` },
      body: JSON.stringify({ model: "test/model", messages: [{ role: "user", content: "hello" }] }) };
    expect((await fetch(url, { ...options, headers: {} })).status).toBe(401);
    expect((await fetch(url, { ...options, headers: { ...options.headers, Origin: "https://attacker.example" } })).status).toBe(403);
    expect((await fetch(`${lease.configuration.baseUrl}/models`, options)).status).toBe(403);
    expect((await fetch(url, { ...options, body: JSON.stringify({ model: "arbitrary/expensive" }) })).status).toBe(400);
    const response = await fetch(url, options);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("[DONE]");
    expect(auth.openAgentStream).toHaveBeenCalledTimes(1);
    expect(auth.openAgentStream.mock.calls[0][2].requestId).toMatch(/^[a-f0-9-]{36}$/);
  });

  it.each(["signOut", "replaceUser"])("revokes the local capability immediately on %s", async (operation) => {
    const fixtureValue = fixture();
    const lease = await acquire(fixtureValue.service);
    fixtureValue[operation]();
    expect(lease.onRevoke).toHaveBeenCalledOnce();
    expect(() => fixtureValue.service.validate({ leaseId: lease.leaseId, route: lease.route, scope: "test-scope" })).toThrow();
    const response = await fetch(`${lease.configuration.baseUrl}/chat/completions`, { method: "POST",
      headers: { Authorization: `Bearer ${lease.configuration.apiKey}` }, body: '{}' });
    expect(response.status).toBe(401);
  });

  it("opens a server-created sandbox checkout without exposing credentials to the renderer", async () => {
    const { service, auth, openExternal } = fixture();
    await service.managed({ action: "checkout", packId: "test-credit" });
    expect(openExternal).toHaveBeenCalledWith("https://sandbox.polar.sh/checkout/test");
    auth.requestSessionApi.mockImplementation(async (_base, path) => path === "/ai/balance" ? {
      available_micro_usd: 1, balance_micro_usd: 1, reserved_micro_usd: 0,
    } : { checkout_url: "https://attacker.example/checkout" });
    await expect(service.managed({ action: "checkout", packId: "test-credit" })).rejects.toThrow("INVALID_RESPONSE");
  });
});


describe("one-time trial activation", () => {
  it("claims only after sign-in and once per account session before reading balance", async () => {
    const signedOut = fixture({ signedIn: false, trial: 1_000_000 });
    await signedOut.service.read();
    expect(signedOut.auth.requestSessionApi).not.toHaveBeenCalled();
    const { service, auth } = fixture({ trial: 1_000_000 });
    await service.read();
    await service.managed({ action: "refresh" });
    const calls = auth.requestSessionApi.mock.calls;
    expect(calls.filter((call) => call[1] === "/ai/trial")).toHaveLength(1);
    expect(calls[0]).toEqual(["https://qubits-api.puppyone.ai/api/v1", "/ai/trial", { method: "POST", body: "{}" }]);
    expect(calls[1][1]).toBe("/ai/balance");
  });
});
