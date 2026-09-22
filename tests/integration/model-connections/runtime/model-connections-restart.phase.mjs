#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { app, safeStorage, utilityProcess } from "electron";
import { createModelConnections } from "../../../../electron/main/model-connections/index.mjs";
import { createPuppyOneModelVerifier } from "../../../../electron/main/agent/runtimes/puppyone-agent/model-connection-verifier.mjs";
import { createAgentProcessService } from "../../../../electron/main/item-hosts/agent-process-service.mjs";
import { createItemHostBudget } from "../../../../electron/main/item-hosts/resource-budget.mjs";
import { createAgentConversationCatalog } from "../../../../electron/main/agent/persistence/agent-conversation-catalog.mjs";
import { createAgentAttachmentStore } from "../../../../electron/main/agent/infrastructure/attachments/agent-attachment-store.mjs";

const repository = path.resolve(import.meta.dirname, "../../../..");
const option = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = option("phase");
const userDataPath = option("profile");
const workspace = option("workspace");
const stateFile = option("state");
const baseUrl = option("base-url");
if (!(["write", "read"].includes(phase) && userDataPath && workspace && stateFile && baseUrl)) {
  throw new Error("Restart smoke requires phase, profile, workspace, state and base-url options.");
}
app.setAppPath(repository);
app.setPath("userData", userDataPath);
const secret = "synthetic-restart-private-key";
const owner = { id: 1, hostItemId: "model-restart-chat", isDestroyed: () => false, send() {} };
const deadline = setTimeout(() => { console.error(`Model connection restart ${phase} phase timed out.`); app.exit(1); }, 50_000);
let connections;
let service;

async function until(operation, predicate) {
  const expires = Date.now() + 15_000;
  while (Date.now() < expires) {
    const result = await operation();
    if (predicate(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Restart ${phase} phase did not reach its expected session state.`);
}

async function createRuntimeService() {
  const conversationCatalog = createAgentConversationCatalog({ filePath: path.join(userDataPath, "conversations.json") });
  const attachmentStore = createAgentAttachmentStore({ rootPath: path.join(userDataPath, "attachments") });
  await attachmentStore.initialize();
  const budget = createItemHostBudget();
  const runtimeService = createAgentProcessService({
    utilityProcess,
    modulePath: path.join(repository, "electron/utility/agent/main.mjs"),
    budget,
    appVersion: "model-connections-restart-smoke",
    runtimeEnvironment: { appPath: repository, userDataPath, executablePath: process.execPath },
    conversationCatalog,
    attachmentStore,
    modelConnections: connections,
    catalogService: { closeAll: async () => {}, hasRuntimeResources: () => false },
  });
  return { runtimeService, conversationCatalog, budget };
}

async function startTurn(identity, route, commandId) {
  await service.startTurn(owner, { ...identity, commandId, prompt: `Confirm ${phase} launch.`, model: route }, workspace);
  const completed = await until(
    () => service.replay(owner, identity, workspace),
    (value) => value.events.some((event) => event.type === "turn.completed"),
  );
  assert.match(JSON.stringify(completed), /Restarted model connection works/);
  assert.equal(JSON.stringify(completed).includes(secret), false);
}

async function assertNoPlaintextCredential() {
  for (const file of await fs.readdir(userDataPath, { recursive: true })) {
    const full = path.join(userDataPath, file);
    if ((await fs.stat(full)).isFile()) {
      assert.equal((await fs.readFile(full)).includes(Buffer.from(secret)), false, `Credential leaked: ${file}`);
    }
  }
}

async function writePhase() {
  const saved = await connections.save({ driver: "openai-compatible", sourceKind: "api", name: "Restarted API",
    auth: "bearer", apiKey: secret, baseUrl, manualContextWindow: 4096, defaultModelId: "restart-model" });
  const connection = saved.connections[0];
  const verified = await connections.verify({ id: connection.id, expectedGeneration: connection.configGeneration, modelId: "restart-model" });
  assert.equal(verified.catalogs[0].status, "ready");
  assert.equal(typeof verified.catalogs[0].models[0].verifiedAt, "string");
  const { runtimeService, conversationCatalog } = await createRuntimeService();
  service = runtimeService;
  const route = `${connection.id}/restart-model`;
  const created = await service.createSession(owner, { runtimeId: "puppyone-agent", model: route }, workspace);
  const identity = { sessionId: created.session.id, instanceId: created.session.instanceId };
  await startTurn(identity, route, "restart-write-turn");
  const persisted = await conversationCatalog.findById(identity.sessionId, workspace);
  assert.equal(persisted.modelBindingRevision, `${connection.id}:1`);
  await fs.writeFile(stateFile, JSON.stringify({ connectionId: connection.id, route, sessionId: identity.sessionId }), { mode: 0o600 });
  await assertNoPlaintextCredential();
}

async function readPhase() {
  const expected = JSON.parse(await fs.readFile(stateFile, "utf8"));
  const initial = await connections.read();
  assert.equal(initial.connections.length, 1);
  assert.equal(initial.connections[0].id, expected.connectionId);
  assert.equal(initial.connections[0].credentialConfigured, true);
  assert.equal(initial.catalogs[0].status, "unread");
  assert.equal(JSON.stringify(initial).includes(secret), false);
  assert.equal(JSON.stringify(initial).includes("credentialRef"), false);

  const refreshed = await connections.catalog();
  assert.equal(refreshed.catalogs[0].status, "ready");
  assert.equal(refreshed.catalogs[0].models[0].id, "restart-model");
  assert.equal(typeof refreshed.catalogs[0].models[0].verifiedAt, "string", "Verification evidence must survive restart.");
  const { runtimeService, budget } = await createRuntimeService();
  service = runtimeService;
  const opened = await service.openSession(owner, { sessionId: expected.sessionId, runtimeId: "puppyone-agent" }, workspace);
  assert.equal(opened.status, "opened");
  assert.notEqual(opened.snapshot.capabilities.readOnly, true);
  assert.equal(opened.snapshot.session.selectedModel, expected.route);
  const identity = { sessionId: opened.snapshot.session.id, instanceId: opened.snapshot.session.instanceId };
  await startTurn(identity, expected.route, "restart-read-turn");
  assert.ok(service.diagnostics().some((entry) => entry.pid !== process.pid));
  await service.closeAll();
  assert.equal(budget.snapshot().length, 0);
  await assertNoPlaintextCredential();
}

async function run() {
  app.dock?.hide();
  let failed = false;
  try {
    assert.equal(safeStorage.isEncryptionAvailable(), true, "OS encrypted storage is required for restart persistence.");
    connections = createModelConnections({ userDataPath, secureStorage: safeStorage,
      verifyModel: createPuppyOneModelVerifier({ appPath: repository, userDataPath, executablePath: process.execPath }) });
    if (phase === "write") await writePhase();
    else await readPhase();
    console.log(`MODEL_CONNECTION_RESTART_PHASE ${phase} ok`);
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    await service?.closeAll().catch((error) => { failed = true; console.error(error); });
    await connections?.dispose();
    clearTimeout(deadline);
    app.exit(failed ? 1 : 0);
  }
}

app.whenReady().then(run).catch((error) => { console.error(error); app.exit(1); });
