import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConnectionModelRuntime, installModelFetchBoundary } from "../../../../electron/main/agent/runtimes/puppyone-agent/worker/model-configuration.mjs";
import { createPuppyOneModelVerifier } from "../../../../electron/main/agent/runtimes/puppyone-agent/model-connection-verifier.mjs";
import { createModelMetadataClient } from "../../../../electron/main/model-connections/http-client.mjs";
import { PuppyOneAgentAdapter } from "../../../../electron/main/agent/runtimes/puppyone-agent/puppyone-agent-adapter.mjs";
import { buildPuppyOneAgentEnvironment } from "../../../../electron/main/agent/runtimes/puppyone-agent/puppyone-agent-environment.mjs";
import { redactModelResponse } from "../../../../electron/main/agent/runtimes/puppyone-agent/worker/redact-model-response.mjs";

const cleanups = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });
async function server(handler) {
  const instance = http.createServer(handler);
  await new Promise((resolve, reject) => { instance.once("error", reject); instance.listen(0, "127.0.0.1", resolve); });
  cleanups.push(() => new Promise((resolve) => { instance.closeAllConnections(); instance.close(resolve); }));
  return `http://127.0.0.1:${instance.address().port}/v1`;
}
function configuration(baseUrl) {
  return { schemaVersion: 1, connectionId: "mc_11111111-1111-1111-1111-111111111111", configGeneration: 1, securityGeneration: 1,
    baseUrl, apiKey: "synthetic-private-key", auth: "bearer", selectedModelId: "test-model",
    models: [{ id: "test-model", name: "Test", contextWindow: 4096, capabilities: { text: "supported", tools: "supported", images: "unsupported" } }] };
}

describe("model network boundaries", () => {
  it("redacts split provider echoes before native persistence, preserving Unicode", async () => {
    const text = 'data: {"content":"中文😀 synthetic-private-key done"}\n\n';
    const bytes = new TextEncoder().encode(text);
    const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    expect(await redactModelResponse(new Response(stream), "synthetic-private-key").text()).toBe(text.replace("synthetic-private-key", "[redacted]"));
  });
  it("bounds parallel metadata requests and cancels queued work", async () => {
    let running = 0; let highest = 0;
    const replies = [];
    const baseUrl = await server((_request, response) => {
      running++; highest = Math.max(highest, running);
      replies.push(() => { running--; response.end("{}"); });
    });
    const request = createModelMetadataClient({ maxConcurrent: 2 });
    const first = request(baseUrl); const second = request(baseUrl);
    const controller = new AbortController();
    const third = request(baseUrl, { signal: controller.signal });
    controller.abort();
    await expect(third).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(replies).toHaveLength(2));
    replies.forEach((reply) => reply());
    await Promise.all([first, second]);
    expect(highest).toBe(2);
  });
  it("rejects metadata that echoes a credential", async () => {
    const baseUrl = await server((_request, response) => response.end(JSON.stringify({ data: [{ id: "synthetic-private-key" }] })));
    await expect(createModelMetadataClient()(baseUrl, { apiKey: "synthetic-private-key" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("does not follow a metadata redirect with credentials", async () => {
    let leaked = false;
    const target = await server((_request, response) => { leaked = true; response.end("{}"); });
    const origin = await server((_request, response) => { response.writeHead(302, { location: `${target}/models` }); response.end(); });
    await expect(createModelMetadataClient()(`${origin}/models`, { apiKey: "synthetic-private-key" })).rejects.toMatchObject({ code: "REDIRECT_REJECTED" });
    expect(leaked).toBe(false);
  });
  it("rejects runtime requests outside the bound origin and API prefix", async () => {
    const fetch = installModelFetchBoundary(configuration("https://example.com/proxy/v1"), async () => new Response("ok"));
    await expect(fetch("https://other.example/v1/chat/completions")).rejects.toThrow();
    await expect(fetch("https://example.com/other/v1/chat/completions")).rejects.toThrow();
    await expect(fetch("https://example.com/proxy/v1/chat/completions")).resolves.toBeInstanceOf(Response);
  });
  it("creates the pinned SDK runtime using only memory credentials and explicit models", async () => {
    const config = configuration("http://127.0.0.1:11434/v1");
    const runtime = await createConnectionModelRuntime(config);
    expect(runtime.getModel(config.connectionId, "test-model")).toMatchObject({ provider: config.connectionId, id: "test-model", contextWindow: 4096 });
    expect(runtime.getAvailableSnapshot().filter((model) => model.provider === config.connectionId)).toHaveLength(1);
    expect(JSON.stringify(runtime.getRegisteredProviderConfig(config.connectionId))).not.toContain(config.apiKey);
  });
  it("runs the actual SDK verification worker over a private pipe against a synthetic HTTP service", async () => {
    const requests = [];
    const baseUrl = await server((request, response) => {
      let raw = "";
      request.on("data", (data) => { raw += data; });
      request.on("end", () => {
        const body = JSON.parse(raw);
        requests.push({ url: request.url, authorization: request.headers.authorization, body });
        const toolResult = body.messages.some((message) => message.role === "tool");
        response.writeHead(200, { "content-type": "text/event-stream" });
        const delta = toolResult ? { content: "Connection verified." } : { tool_calls: [{ index: 0, id: "call_check", type: "function", function: { name: "puppyone_connection_check", arguments: '{"token":"puppyone-model-check"}' } }] };
        response.write(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: toolResult ? "stop" : "tool_calls" }] })}\n\n`);
        response.end("data: [DONE]\n\n");
      });
    });
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "model-connection-runtime-"));
    cleanups.push(() => fs.rm(temporary, { recursive: true, force: true }));
    const verify = createPuppyOneModelVerifier({ appPath: path.resolve(import.meta.dirname, "../../../.."), userDataPath: temporary });
    await verify(configuration(baseUrl));
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.authorization === "Bearer synthetic-private-key")).toBe(true);
    expect(requests[1].body.messages.some((message) => message.role === "tool")).toBe(true);
    expect(await fs.readdir(temporary)).toEqual([]);
  }, 20_000);
});

it("runs an actual bound Agent tool approval, persists safe history and reopens it without a connection", async () => {
  const requests = [];
  const baseUrl = await server((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw); requests.push(body);
      const toolResult = body.messages.some((message) => message.role === "tool");
      response.writeHead(200, { "content-type": "text/event-stream" });
      const delta = toolResult ? { content: "Completed synthetic-private-key safely." } : {
        tool_calls: [{ index: 0, id: "call_write", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "approval-proof.txt", content: "approved" }) } }],
      };
      response.write(`data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: toolResult ? "stop" : "tool_calls" }] })}\n\n`);
      response.end("data: [DONE]\n\n");
    });
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "model-connection-agent-"));
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
  const config = configuration(baseUrl);
  const route = `${config.connectionId}/test-model`;
  const readiness = { executablePath: process.execPath,
    argsPrefix: [path.resolve(import.meta.dirname, "../../../../electron/main/agent/runtimes/puppyone-agent/worker/main.mjs")],
    profilePath: path.join(root, "profile"), version: "0.85.1", source: "bundled", compatibility: "puppyone-pi-rpc-v1",
    environment: buildPuppyOneAgentEnvironment(process.env, { profilePath: path.join(root, "profile") }) };
  const snapshot = { revision: 1, connections: [{ id: config.connectionId, name: "Test", driver: "openai-compatible", configGeneration: 1 }],
    catalogs: [{ connectionId: config.connectionId, configGeneration: 1, status: "ready", models: [{ ...config.models[0], available: true }] }] };
  const port = { read: async () => snapshot, acquire: vi.fn(async () => ({ leaseId: "test-lease", configuration: config })), validate: vi.fn(async () => {}), release: vi.fn(async () => {}) };
  const events = [];
  const adapter = new PuppyOneAgentAdapter({ readiness, workspaceRoot: root, modelConnectionPort: port, onEvent: (event) => events.push(event) });
  let nativeId;
  try {
    const boot = await adapter.bootstrapSession({ kind: "create", model: route });
    nativeId = boot.providerSession.providerSessionId;
    await adapter.startTurn({ prompt: "Write the approval proof file.", model: route });
    await vi.waitFor(() => expect(events.some((event) => event.type === "approval.requested")).toBe(true), { timeout: 10_000 });
    await expect(fs.stat(path.join(root, "approval-proof.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    const approval = events.find((event) => event.type === "approval.requested");
    adapter.resolveApproval({ requestId: approval.payload.requestId, decision: "accept", turnId: approval.turnId });
    await vi.waitFor(() => expect(events.some((event) => event.type === "turn.completed")).toBe(true), { timeout: 10_000 });
    expect(await fs.readFile(path.join(root, "approval-proof.txt"), "utf8")).toBe("approved");
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(await adapter.readHistory())).not.toContain(config.apiKey);
  } finally { await adapter.dispose(); }
  expect(port.release).toHaveBeenCalledWith("test-lease");
  for (const file of await fs.readdir(path.join(root, "profile"), { recursive: true })) {
    const full = path.join(root, "profile", file);
    if ((await fs.stat(full)).isFile()) expect(await fs.readFile(full, "utf8")).not.toContain(config.apiKey);
  }
  const unavailablePort = { ...port, read: async () => ({ revision: 2, connections: [], catalogs: [] }), acquire: vi.fn() };
  const history = new PuppyOneAgentAdapter({ readiness, workspaceRoot: root, modelConnectionPort: unavailablePort });
  try {
    const boot = await history.bootstrapSession({ kind: "resume", threadId: nativeId, model: route });
    expect(boot.inspection.capabilities.readOnly).toBe(true);
    expect(boot.providerSession.providerSessionId).toBe(nativeId);
    expect((await history.readHistory()).length).toBeGreaterThan(0);
    await expect(history.startTurn({ prompt: "must not send", model: route })).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE_READ_ONLY" });
    expect(unavailablePort.acquire).not.toHaveBeenCalled();
    expect(requests).toHaveLength(2);
  } finally { await history.dispose(); }
}, 30_000);
