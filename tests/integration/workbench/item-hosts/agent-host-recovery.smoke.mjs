import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, utilityProcess } from "electron";
import { createAgentProcessService } from "../../../../electron/main/item-hosts/agent-process-service.mjs";
import { createItemHostBudget } from "../../../../electron/main/item-hosts/resource-budget.mjs";
import { createAgentConversationCatalog } from "../../../../electron/main/agent/persistence/agent-conversation-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-host-recovery-"));
app.setPath("userData", path.join(temporary, "profile"));
const budget = createItemHostBudget();
const events = [];
const catalog = createAgentConversationCatalog({ filePath: path.join(temporary, "conversations.json") });
const service = createAgentProcessService({ utilityProcess, budget, appVersion: "fixture",
  modulePath: path.join(root, "tests/fixtures/agent/runtimes/recoverable-agent-utility.mjs"),
  conversationCatalog: catalog, attachmentStore: {},
  catalogService: { closeAll: async () => {}, hasRuntimeResources: () => false },
  onHostEvent: (record, event) => events.push({ sessionId: record.sessionId, ...event }),
});
const owner = { id: 1, hostItemId: "fixture-agent", isDestroyed: () => false };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = performance.now() + 8000;
  while (!await check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}`);
    await delay(20);
  }
}
const watchdog = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  app.dock?.hide();
  let failed = false;
  try {
    const created = await service.createSession(owner, { runtimeId: "codex" }, temporary);
    const identity = { sessionId: created.session.id, instanceId: created.session.instanceId, runtimeId: "codex" };
    await service.startTurn(owner, { ...identity, commandId: "fixture-start", prompt: "Synthetic task" }, temporary);
    await until(async () => (await catalog.findById(identity.sessionId, temporary))?.terminalState === "running", "active metadata saved");
    const previous = service.diagnostics()[0];
    process.kill(previous.pid, "SIGKILL");
    await until(() => events.some(event => event.type === "host-exited"), "crash cleanup confirmed");
    const [first, second] = await Promise.all([
      service.resumeSession(owner, identity, temporary), service.resumeSession(owner, identity, temporary),
    ]);
    assert.equal(first.session.id, identity.sessionId);
    assert.equal(second.session.instanceId, first.session.instanceId);
    assert.notEqual(first.session.instanceId, identity.instanceId);
    assert.equal(first.session.activeTurnId, null);
    assert.equal(service.diagnostics().length, 1);
    assert.notEqual(service.diagnostics()[0].generation, previous.generation);
    assert.throws(() => service.startTurn(owner, identity, temporary), /owned/);
    await service.closeAll();
    assert.equal(budget.snapshot().length, 0);
    console.log(JSON.stringify({ ok: true, realUtilityCrash: true, singleReplacement: true,
      sameConversation: true, oldInstanceRejected: true, promptNotReplayed: true, resourceLeases: 0 }));
  } catch (error) { failed = true; console.error(error); }
  finally {
    await service.closeAll().catch(error => { failed = true; console.error(error); });
    await fs.rm(temporary, { recursive: true, force: true });
    clearTimeout(watchdog);
    app.exit(failed ? 1 : 0);
  }
}).catch(error => { console.error(error); app.exit(1); });
