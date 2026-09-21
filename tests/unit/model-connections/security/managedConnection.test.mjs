import { afterEach, describe, expect, it, vi } from "vitest";
import { withManagedConnection } from "../../../../electron/main/model-connections/managed-connection.mjs";
import { parseConnectionCommand } from "../../../../shared/model-connections/schema.mjs";
import { parseManagedUsage } from "../../../../electron/main/model-connections/managed-usage.mjs";

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
  const requestPublic = vi.fn(async () => ({ sandbox: true, trial_credit_micro_usd: trial, packs: [{ id: "test-credit", price_cents: 500, credit_micro_usd: 5_000_000 }],
    models: [{ id: "test/model", name: "Test", context_window: 32768, max_output_tokens: 4096 }] }));
  const service = withManagedConnection({ connections, getAuth: () => auth,
    apiBase: "https://qubits-api.puppyone.ai/api/v1", openExternal,
    requestPublic,
  });
  services.push(service);
  return { service, auth, openExternal, connections, requestPublic,
    signIn: () => { state = { status: "authenticated", session: { user_id: "user-one", session_generation: "session-one", api_base_url: "https://qubits-api.puppyone.ai/api/v1" } }; observer(state); },
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

  it("maps browser handoff failures to a safe sign-in error", async () => {
    const signedOut = fixture({ signedIn: false });
    signedOut.auth.startOAuth.mockRejectedValueOnce(new Error("Desktop browser login is not configured"));
    await expect(signedOut.service.managed({ action: "sign-in" }))
      .rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
  });

  it("reports loading through sign-in and retries, and failure only after a request fails", async () => {
    const value = fixture({ signedIn: false });
    await value.service.read();
    const updates = [];
    value.service.subscribe((snapshot) => updates.push(snapshot.managed));
    let failBalance;
    value.auth.requestSessionApi.mockImplementationOnce(() => new Promise((_resolve, reject) => { failBalance = reject; }));
    value.signIn();
    await vi.waitFor(() => expect(failBalance).toBeTypeOf("function"));
    expect(updates.at(-1)).toMatchObject({ signedIn: true, reason: "loading", errorCode: null });
    expect(updates.every((state) => state.reason !== "gateway-unavailable")).toBe(true);
    failBalance(new Error("Request timed out"));
    expect((await value.service.read()).managed).toMatchObject({ reason: "gateway-unavailable", errorCode: "GATEWAY_UNAVAILABLE" });

    let finishBalance;
    value.auth.requestSessionApi.mockImplementationOnce(() => new Promise((resolve) => { finishBalance = resolve; }));
    const retry = value.service.managed({ action: "refresh" });
    await vi.waitFor(() => expect(finishBalance).toBeTypeOf("function"));
    expect(updates.at(-1)).toMatchObject({ reason: "loading", errorCode: null });
    finishBalance({ balance_micro_usd: 1_000_000, available_micro_usd: 1_000_000, reserved_micro_usd: 0 });
    expect((await retry).managed).toMatchObject({ reason: "ready", available: true, errorCode: null });
  });

  it("leaves loading when the public request fails synchronously", async () => {
    const value = fixture();
    value.requestPublic.mockImplementationOnce(() => { throw new Error("Connection unavailable"); });
    expect((await value.service.read()).managed.reason).toBe("gateway-unavailable");
    expect((await value.service.managed({ action: "refresh" })).managed.reason).toBe("ready");
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

  it("clears account data immediately on logout and ignores a late balance response", async () => {
    const value = fixture();
    expect((await value.service.read()).managed.availableMicroUsd).toBe(5_000_000);
    const updates = [];
    const unsubscribe = value.service.subscribe((snapshot) => updates.push(snapshot.managed));
    let finishBalance;
    value.auth.requestSessionApi.mockImplementationOnce(() => new Promise((resolve) => { finishBalance = resolve; }));
    const refresh = value.service.managed({ action: "refresh" });
    await vi.waitFor(() => expect(finishBalance).toBeTypeOf("function"));
    updates.length = 0;
    value.signOut();
    expect(updates.at(-1)).toMatchObject({ signedIn: false, reason: "sign-in-required",
      balanceMicroUsd: 0, availableMicroUsd: 0, reservedMicroUsd: 0, trialGrantedMicroUsd: 0,
      lastUsage: null, errorCode: null });
    finishBalance({ balance_micro_usd: 4_000_000, available_micro_usd: 3_000_000,
      reserved_micro_usd: 1_000_000, trial_granted_micro_usd: 1_000_000 });
    await refresh;
    const after = (await value.service.read()).managed;
    expect(after).toMatchObject({ signedIn: false, availableMicroUsd: 0, trialGrantedMicroUsd: 0 });
    expect(updates.every((managed) => !managed.signedIn && managed.balanceMicroUsd === 0
      && managed.reservedMicroUsd === 0 && managed.trialGrantedMicroUsd === 0)).toBe(true);
    expect(value.auth.requestSessionApi.mock.calls.filter((call) => call[1] === "/ai/balance")).toHaveLength(2);
    unsubscribe();
  });

  it("clears the previous account's billing error as soon as it signs out", async () => {
    const value = fixture();
    value.auth.requestSessionApi.mockRejectedValueOnce(new Error("Wallet unavailable"));
    expect((await value.service.read()).managed.errorCode).toBe("GATEWAY_UNAVAILABLE");
    const updates = [];
    const unsubscribe = value.service.subscribe((snapshot) => updates.push(snapshot.managed));
    value.signOut();
    expect(updates[0]).toMatchObject({ signedIn: false, errorCode: null });
    await value.service.read();
    unsubscribe();
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
  it("refreshes the new account immediately when sign-in finishes during a catalog request", async () => {
    const value = fixture({ signedIn: false, trial: 1_000_000 });
    let finish;
    value.requestPublic.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const firstRead = value.service.read();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    value.signIn();
    finish({ models: [], packs: [], trial_credit_micro_usd: 1_000_000 });
    await firstRead;
    await vi.waitFor(async () => expect((await value.service.read()).managed.available).toBe(true));
    expect(value.auth.requestSessionApi.mock.calls.filter((call) => call[1] === "/ai/trial")).toHaveLength(1);
    expect((await value.service.read()).managed.trialCreditMicroUsd).toBe(1_000_000);
    expect(value.auth.openAgentStream).not.toHaveBeenCalled();
  });

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

describe("server-owned usage receipts", () => {
  it.each(["signOut", "replaceUser"])("reads the settled charge after streaming and clears it on %s", async (operation) => {
    const value = fixture();
    const reservationId = "00000000-0000-4000-8000-000000000001";
    value.auth.openAgentStream.mockResolvedValue({ response: new Response('data: [DONE]\n\n', {
      headers: { "content-type": "text/event-stream", "x-puppyone-reservation-id": reservationId },
    }), close: vi.fn() });
    value.auth.requestSessionApi.mockImplementation(async (_base, path) => path.startsWith("/ai/usage/") ? {
      reservation_id: reservationId, status: "settled", model_id: "test/model", price_book_id: "prices-1",
      charged_micro_usd: 47, provider_cost_usd: "PRIVATE-COST", provider_route: { private: true },
      usage: { input_tokens: 10, cached_tokens: 4, output_tokens: 20 },
    } : { balance_micro_usd: 999_953, available_micro_usd: 999_953, reserved_micro_usd: 0 });
    const lease = await acquire(value.service);
    const response = await fetch(`${lease.configuration.baseUrl}/chat/completions`, { method: "POST",
      headers: { Authorization: `Bearer ${lease.configuration.apiKey}` },
      body: JSON.stringify({ model: "test/model", messages: [{ role: "user", content: "hello" }] }) });
    await response.text();
    await value.service.managed({ action: "refresh" });
    const snapshot = await value.service.read();
    expect(snapshot.managed.lastUsage).toMatchObject({ status: "settled", chargedMicroUsd: 47,
      inputTokens: 10, cachedTokens: 4, outputTokens: 20 });
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE-COST");
    value[operation]();
    expect((await value.service.read()).managed.lastUsage).toBeNull();
  });

  it("does not turn missing usage or a mismatched receipt into a charge", () => {
    expect(parseManagedUsage({ reservation_id: "wrong" }, "expected")).toBeNull();
    expect(parseManagedUsage({ reservation_id: "id", status: "settled", model_id: "model",
      charged_micro_usd: 1 }, "id")).toBeNull();
    expect(parseManagedUsage({ reservation_id: "id", status: "running", model_id: "model",
      charged_micro_usd: 0 }, "id")).toMatchObject({ status: "pending", chargedMicroUsd: null });
  });
});
