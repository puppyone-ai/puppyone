#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { app, safeStorage, utilityProcess } from "electron";
import { createModelConnections } from "../../../../electron/main/model-connections/index.mjs";
import { createPuppyOneModelVerifier } from "../../../../electron/main/agent/runtimes/puppyone-agent/model-connection-verifier.mjs";
import { createAgentProcessService } from "../../../../electron/main/item-hosts/agent-process-service.mjs";
import { createItemHostBudget } from "../../../../electron/main/item-hosts/resource-budget.mjs";
import { createAgentConversationCatalog } from "../../../../electron/main/agent/persistence/agent-conversation-catalog.mjs";
import { createAgentAttachmentStore } from "../../../../electron/main/agent/infrastructure/attachments/agent-attachment-store.mjs";

const appPath = path.resolve(import.meta.dirname, "../../../..");
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-model-connections-smoke-"));
const userDataPath = path.join(fixture, "profile");
const workspace = path.join(fixture, "workspace");
await fs.mkdir(workspace);
app.setPath("userData", userDataPath);
const budget = createItemHostBudget();
const owner = { id: 1, hostItemId: "model-test-chat", isDestroyed: () => false, send() {} };
const secret = "synthetic-smoke-private-key";
let requests = 0;
const server = http.createServer((request, response) => {
  assert.equal(request.headers.authorization, `Bearer ${secret}`);
  if (request.url === "/v1/models") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ data: [{ id: "smoke-model" }] })); return; }
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    requests++;
    const body = JSON.parse(raw);
    const verification = body.tools?.some((tool) => tool.function?.name === "puppyone_connection_check");
    const toolCall = verification && !body.messages.some((message) => message.role === "tool");
    const delta = toolCall ? { tool_calls: [{ index: 0, id: "call_check", type: "function", function: { name: "puppyone_connection_check", arguments: '{"token":"puppyone-model-check"}' } }] } : { content: "Native model connection smoke passed." };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ id: "smoke", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: "smoke", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: toolCall ? "tool_calls" : "stop" }] })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
});
let service;
let connections;
const deadline = setTimeout(() => { console.error("Model connection smoke timed out."); app.exit(1); }, 90_000);
async function until(operation, predicate) {
  const expires = Date.now() + 15_000;
  while (Date.now() < expires) {
    const result = await operation(); if (predicate(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Native session did not reach its expected state.");
}
async function run() {
  app.dock?.hide();
  let failed = false;
  try {
    assert.equal(safeStorage.isEncryptionAvailable(), true, "OS encrypted storage is required for this smoke.");
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    connections = createModelConnections({ userDataPath, secureStorage: safeStorage,
      verifyModel: createPuppyOneModelVerifier({ appPath, userDataPath, executablePath: process.execPath }) });
    const snapshot = await connections.save({ driver: "openai-compatible", name: "Synthetic native test", auth: "bearer", apiKey: secret,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, manualContextWindow: 4096, defaultModelId: "smoke-model" });
    const connection = snapshot.connections[0];
    await connections.verify({ id: connection.id, expectedGeneration: 1, modelId: "smoke-model" });
    const conversationCatalog = createAgentConversationCatalog({ filePath: path.join(userDataPath, "conversations.json") });
    const attachmentStore = createAgentAttachmentStore({ rootPath: path.join(userDataPath, "attachments") });
    await attachmentStore.initialize();
    service = createAgentProcessService({ utilityProcess, modulePath: path.join(appPath, "electron/utility/agent/main.mjs"), budget, appVersion: "model-connections-smoke",
      runtimeEnvironment: { appPath, userDataPath, executablePath: process.execPath },
      conversationCatalog, attachmentStore, modelConnections: connections,
      catalogService: { closeAll: async () => {}, hasRuntimeResources: () => false } });
    const route = `${connection.id}/smoke-model`;
    const created = await service.createSession(owner, { runtimeId: "puppyone-agent", model: route }, workspace);
    const identity = { sessionId: created.session.id, instanceId: created.session.instanceId };
    assert.equal(created.session.selectedModel, route);
    assert.equal(created.capabilities.modelConnections, true);
    await service.startTurn(owner, { ...identity, commandId: "native-smoke-turn", prompt: "Reply with a short confirmation.", model: route }, workspace);
    const completed = await until(() => service.replay(owner, identity, workspace), (value) => value.events.some((event) => event.type === "turn.completed"));
    assert.match(JSON.stringify(completed), /Native model connection smoke passed/);
    assert.equal(JSON.stringify(completed).includes(secret), false);
    const pids = service.diagnostics().map((entry) => entry.pid);
    assert.notEqual(pids[0], process.pid);
    await connections.remove({ id: connection.id, expectedGeneration: 1 });
    assert.equal(service.getSessionCount(), 0, "Revocation must stop the authorized utility and worker.");
    assert.equal(budget.snapshot().length, 0);
    const reopened = await service.openSession(owner, { sessionId: identity.sessionId, runtimeId: "puppyone-agent" }, workspace);
    assert.equal(reopened.status, "opened");
    assert.equal(reopened.snapshot.capabilities.readOnly, true);
    assert.match(JSON.stringify(reopened.snapshot.display), /Native model connection smoke passed/);
    assert.equal(requests, 3, "Opening unavailable history must not perform inference.");
    await service.closeAll();
    for (const file of await fs.readdir(userDataPath, { recursive: true })) {
      const full = path.join(userDataPath, file);
      if ((await fs.stat(full)).isFile()) assert.equal((await fs.readFile(full)).includes(Buffer.from(secret)), false, `Credential leaked: ${file}`);
    }
    console.log(JSON.stringify({ ok: true, platform: process.platform, encryptedStorage: true, mainUtilityWorkerRoundTrip: true,
      revocation: true, readOnlyHistory: true, inferenceRequests: requests, remainingResourceLeases: budget.snapshot().length }, null, 2));
  } catch (error) { failed = true; console.error(error); }
  finally {
    await service?.closeAll().catch((error) => { failed = true; console.error(error); });
    await connections?.dispose();
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    await fs.rm(fixture, { recursive: true, force: true });
    clearTimeout(deadline); app.exit(failed ? 1 : 0);
  }
}
app.whenReady().then(run).catch((error) => { console.error(error); app.exit(1); });
